import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { db, dealershipsTable, enquiriesTable, pool, type DealerOnboardingProof, type DealerPlan } from '@workspace/db';
import { resolveDealerFeatures } from '@workspace/vehicle-meta';
import { z } from 'zod/v4';
import { readFeatureRules } from '../lib/dealer-features';
import { sendEmailWithSettings } from '../lib/email-provider';
import { isPlatformAdmin } from '../lib/platform-admin';
import { isReservedDealerHost, normaliseTenantHost, runWithTenant } from '../lib/tenant-context';
import { sharedStaffPortalForDealer } from '../lib/shared-staff-portal';
import { websiteEnquirySender, websiteEnquirySenderProof, websiteOnlyEnquiryEmail } from '../lib/website-only-enquiry-email';
import { createOnboardingInboxEnquiry, toEnquiryResponse } from './enquiries';

const onboardingConfiguration = z.object({
  plan: z.enum(['full_portal', 'website_only']),
  enquiryEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
}).strict().refine(value => value.plan !== 'website_only' || Boolean(value.enquiryEmail), { message: 'Enter the dealership’s enquiry email address.' });

const router = Router();
const route = '/dealers/:id/onboarding';
type Client = Pick<typeof pool, 'query'>;

async function readDealer(client: Client, id: string, lock = false) {
  const { rows: [dealer] } = await client.query(`
    SELECT d.id, d.name, d.status, d.plan, d.enquiry_email, d.onboarding_required,
           d.onboarding_proof, d.canonical_origin, d.stock_platform, d.retailer_id, d.source_url,
           d.onboarding_checklist->'https'->>'status' AS https_check,
           EXISTS (SELECT 1 FROM dealer_demos x WHERE x.dealer_id=d.id AND x.converted_at IS NULL) AS demo
    FROM dealerships d WHERE d.id=$1 ${lock ? 'FOR UPDATE OF d' : ''}`, [id]);
  return dealer as {
    id: string; name: string; status: 'active' | 'draft' | 'suspended';
    plan: DealerPlan; enquiry_email: string | null; onboarding_required: boolean;
    onboarding_proof: DealerOnboardingProof | null; canonical_origin: string;
    stock_platform: 'autotrader' | 'cazoo'; retailer_id: string; source_url: string; demo: boolean; https_check: string | null;
  } | undefined;
}

type Dealer = NonNullable<Awaited<ReturnType<typeof readDealer>>>;

async function readiness(client: Client, dealer: Dealer) {
  const now = Date.now();
  const host = normaliseTenantHost(new URL(dealer.canonical_origin).host);
  const { rows: [domain] } = await client.query(`SELECT verified,
    EXISTS (SELECT 1 FROM domain_setup_jobs j WHERE j.dealer_id=$1 AND j.hostname=$2 AND j.status='completed') AS https_ready
    FROM dealer_domains WHERE dealer_id=$1 AND hostname=$2`, [dealer.id, host]);
  const domainReady = host && !isReservedDealerHost(host) && domain?.verified === true && (domain.https_ready === true || dealer.https_check === 'done');
  const { rows: [stock] } = await client.query(`
    SELECT run_id, status, complete, received_count, expected_count, scraped_at,
           jsonb_array_length(errors) AS errors,
           EXISTS (SELECT 1 FROM vehicles v WHERE v.dealer_id=$1 AND v.source=$2 AND v.source_status='live'
                   AND v.inventory_status IN ('available', 'reserved') AND v.archived_at IS NULL
                   AND (NOT v.price_review_required OR coalesce(v.website_price_override, v.source_price) IS NOT NULL)) AS has_stock
    FROM stock_import_runs WHERE dealer_id=$1 AND source=$2 AND retailer_id=$3
    ORDER BY received_at DESC, id DESC LIMIT 1`, [dealer.id, dealer.stock_platform, dealer.retailer_id]);
  const stockTime = stock?.scraped_at instanceof Date ? stock.scraped_at.getTime() : Date.parse(stock?.scraped_at ?? '');
  const stockReady = Boolean(stock?.complete && stock.status === 'completed' && stock.received_count > 0 &&
    stock.received_count === stock.expected_count && stock.errors === 0 && stock.has_stock &&
    stockTime >= now - 24 * 3600000 && stockTime <= now + 5 * 60000);
  const candidate = dealer.onboarding_proof;
  const websiteOnly = dealer.plan === 'website_only';
  const sharedAuth = sharedStaffPortalForDealer(dealer.id);
  const owner = websiteOnly || (await client.query("SELECT auth_user_id, shared_staff_identity FROM portal_users WHERE dealer_id=$1 AND role='owner' AND disabled_at IS NULL", [dealer.id])).rows.some(row => !isPlatformAdmin(row.auth_user_id) && row.shared_staff_identity === Boolean(sharedAuth));
  const featureRules = await readFeatureRules(dealer.id, client);
  const enquiriesEnabled = resolveDealerFeatures(featureRules.defaults, featureRules.overrides, new Date(now)).find(feature => feature.key === 'publicEnquiries')?.enabled === true;
  const testEnquiry = websiteOnly && candidate?.channel === 'email' && candidate.recipient === dealer.enquiry_email &&
    websiteEnquirySender().enabled && candidate.senderHash === websiteEnquirySenderProof()
    ? { channel: 'email' as const, acceptedAt: candidate.acceptedAt, recipient: candidate.recipient }
    : !websiteOnly && candidate?.channel === 'inbox' && (await client.query("SELECT 1 FROM enquiries WHERE dealer_id=$1 AND id=$2 AND reference=$3 AND source='onboarding_test' AND archived_at IS NULL", [dealer.id, candidate.enquiryId, candidate.reference])).rows.length
      ? { channel: 'inbox' as const, acceptedAt: candidate.acceptedAt, enquiryId: candidate.enquiryId, reference: candidate.reference, recipient: null }
      : null;
  const checks = [
    { id: 'domain', label: 'Website domain', ready: Boolean(domainReady), detail: domainReady ? `Ownership and HTTPS confirmed for ${host}.` : domain?.verified ? 'Confirm Render HTTPS in the checklist once the domain is connected.' : 'Verify the website domain in Domains first.' },
    { id: 'stock', label: 'Stock', ready: stockReady, detail: stockReady ? `${stock.received_count} cars received in a complete, recent import.` : 'Import a complete, non-empty stock snapshot from the authorised retailer. It must be less than 24 hours old and contain cars listed for sale.' },
    { id: 'enquiry', label: websiteOnly ? 'Test email' : 'Test enquiry in Inbox', ready: enquiriesEnabled && Boolean(testEnquiry), detail: !enquiriesEnabled ? 'Enable website enquiries in Features.' : testEnquiry?.channel === 'email' ? 'The email provider accepted the test to the saved dealership address.' : testEnquiry?.channel === 'inbox' ? 'The test enquiry is available in the dealership’s private Inbox preview.' : websiteOnly ? 'Send a test to the saved dealership email address.' : 'Create a private test enquiry and check it in the Inbox preview.' },
    ...(!websiteOnly ? [{ id: 'owner', label: 'Dealership owner', ready: owner, detail: sharedAuth ? owner ? 'The dealer’s owner has accepted their shared staff portal invitation.' : 'Invite the owner from Staff and ask them to accept on the shared staff portal.' : owner ? 'A dealership owner account is assigned.' : 'Assign the dealership’s owner or ask them to accept their invitation.' }] : []),
  ];
  return { plan: dealer.plan, enquiryEmail: dealer.enquiry_email, onboardingRequired: dealer.onboarding_required, checks, testEnquiry, ready: !dealer.demo && dealer.status === 'draft' && dealer.onboarding_required && checks.every(check => check.ready) };
}

router.get(route, async (req, res) => {
  const dealer = await readDealer(pool, req.params.id);
  if (!dealer) { res.status(404).json({ error: 'Dealership not found.' }); return; }
  res.json(await readiness(pool, dealer));
});

router.patch(route, async (req, res) => {
  const input = onboardingConfiguration.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'Choose a plan and enter a valid enquiry email for Website Only.' }); return; }
  const email = input.data.plan === 'website_only' ? input.data.enquiryEmail : null;
  const id = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = (await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [`dealer-onboarding:${id}`])).rows[0].locked;
    if (!lock) { await client.query('ROLLBACK'); res.status(409).json({ error: 'A dealership test or launch is already running.' }); return; }
    const { rows } = await client.query(`
      UPDATE dealerships d SET plan=$2, enquiry_email=$3, onboarding_required=true,
        onboarding_proof=CASE WHEN plan=$2 AND enquiry_email IS NOT DISTINCT FROM $3 THEN onboarding_proof ELSE NULL END
      WHERE d.id=$1 AND status='draft' AND NOT EXISTS (SELECT 1 FROM dealer_demos m WHERE m.dealer_id=d.id AND m.converted_at IS NULL)
      RETURNING id`, [id, input.data.plan, email]);
    if (!rows.length) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Plan setup is available for a dealership draft.' }); return; }
    const dealer = await readDealer(client, id);
    const state = await readiness(client, dealer!);
    await client.query('COMMIT');
    res.json(state);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
});

router.get(`${route}/test-enquiry`, async (req, res) => {
  const dealer = await readDealer(pool, req.params.id);
  const proof = dealer?.onboarding_proof;
  if (dealer?.status !== 'draft' || proof?.channel !== 'inbox') { res.status(404).json({ error: 'No private test enquiry is available.' }); return; }
  const [enquiry] = await db.select().from(enquiriesTable).where(and(eq(enquiriesTable.id, proof.enquiryId), eq(enquiriesTable.dealerId, dealer.id), eq(enquiriesTable.source, 'onboarding_test')));
  if (!enquiry) { res.status(404).json({ error: 'No private test enquiry is available.' }); return; }
  res.json({ enquiry: toEnquiryResponse(enquiry) });
});

router.post(`${route}/test-enquiry`, async (req, res) => {
  if (Object.keys(req.body ?? {}).length) { res.status(400).json({ error: 'The test uses the dealership’s saved plan and address.' }); return; }
  const id = req.params.id;
  const client = await pool.connect();
  const lock = `dealer-onboarding:${id}`;
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lock])).rows[0].locked;
    if (!locked) { res.status(409).json({ error: 'A dealership test or launch is already running.' }); return; }
    const dealer = await readDealer(client, id);
    if (!dealer || dealer.status !== 'draft' || dealer.demo || !dealer.onboarding_required) { res.status(409).json({ error: 'Choose a plan for this draft before sending a test.' }); return; }
    const tenant = { dealerId: id, canonicalOrigin: dealer.canonical_origin, platform: dealer.stock_platform,
      retailerId: dealer.retailer_id, sourceUrl: dealer.source_url, plan: dealer.plan };
    let proof: DealerOnboardingProof;
    if (dealer.plan === 'website_only') {
      const to = dealer.enquiry_email;
      const sender = websiteEnquirySender();
      if (!to || !sender.enabled) { res.status(409).json({ error: 'Save the website enquiry address and configure the platform email sender first.' }); return; }
      const reference = `TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
      const content = websiteOnlyEnquiryEmail({ dealerName: dealer.name, reference, type: 'general', customerName: 'DealerOS test customer', email: null, phone: null,
        message: 'This is an example of a customer asking about a car on your website.', test: true });
      try {
        const providerId = await runWithTenant(tenant, () => sendEmailWithSettings(sender, { ...content, to, idempotencyKey: `dealer-onboarding/${id}/${reference}` }));
        proof = { channel: 'email', recipient: to, acceptedAt: new Date().toISOString(), providerId, senderHash: websiteEnquirySenderProof() };
      } catch {
        res.status(502).json({ error: 'The email provider did not confirm the test. Check the sender and recipient before trying again.' }); return;
      }
    } else {
      const previous = (await client.query("SELECT id, reference, created_at FROM enquiries WHERE dealer_id=$1 AND source='onboarding_test' AND archived_at IS NULL LIMIT 1", [id])).rows[0];
      const entry = previous ?? await runWithTenant(tenant, () => createOnboardingInboxEnquiry(id));
      proof = { channel: 'inbox', enquiryId: entry.id, reference: entry.reference, acceptedAt: new Date(entry.createdAt ?? entry.created_at).toISOString() };
    }
    const saved = await client.query(`UPDATE dealerships SET onboarding_proof=$4::jsonb
      WHERE id=$1 AND status='draft' AND onboarding_required AND plan=$2 AND enquiry_email IS NOT DISTINCT FROM $3 RETURNING id`,
      [id, dealer.plan, dealer.enquiry_email, JSON.stringify(proof)]);
    if (!saved.rows.length) { res.status(409).json({ error: 'The dealer’s setup changed during the test. Check the current plan and run the test again.' }); return; }
    res.json(await readiness(client, { ...dealer, onboarding_proof: proof }));
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lock]).catch(() => undefined);
    client.release();
  }
});

router.post(`${route}/launch`, async (req, res) => {
  const id = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = (await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [`dealer-onboarding:${id}`])).rows[0].locked;
    if (!lock) { await client.query('ROLLBACK'); res.status(409).json({ error: 'A dealership test or launch is already running.' }); return; }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`stock-import:${id}`]);
    const dealer = await readDealer(client, id, true);
    if (!dealer) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Dealership not found.' }); return; }
    if (dealer.status === 'active' && !dealer.onboarding_required) { await client.query('COMMIT'); res.json({ dealerId: id, status: 'active', origin: dealer.canonical_origin }); return; }
    const state = await readiness(client, dealer);
    if (!state.ready) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Complete the launch checks before going live.', ...state }); return; }
    await client.query("DELETE FROM enquiries WHERE dealer_id=$1 AND source='onboarding_test'", [id]);
    await client.query(`UPDATE dealerships SET status='active', onboarding_required=false,
        onboarding_checklist=onboarding_checklist || jsonb_build_object('launch', jsonb_build_object('status','done','note','Platform Admin launched this dealership','updatedAt',now(),'updatedBy',$2::text))
      WHERE id=$1`, [id, getAuth(req).userId]);
    await client.query('COMMIT');
    res.json({ dealerId: id, status: 'active', origin: dealer.canonical_origin });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
});

export default router;
