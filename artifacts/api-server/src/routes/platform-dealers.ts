import { accountInvitationManagementRouter } from './account-invitations';
import { issueAccountInvitation } from '../lib/account-invitations';
import { invitationEmailReadiness } from '../lib/account-invitation-email';
import platformFeaturesRouter from './platform-features';
import platformConversionRouter from './platform-conversion';
import platformDomainAutomationRouter from './platform-domain-automation';
import platformOnboardingKeysRouter from './platform-onboarding-keys';
import platformDemosRouter from './platform-demos';
import platformDemoLinkRouter from './platform-demo-link';
import platformDealerOnboardingRouter from './platform-dealer-onboarding';
import { sql } from 'drizzle-orm';
import { onboardingItems } from '@workspace/vehicle-meta';
import { Router } from 'express';
import { getAuth, clerkClient } from '@clerk/express';
import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { z } from 'zod/v4';
import { and, eq, desc, isNull } from 'drizzle-orm';
import { db, pool, databasePoolStatus, dealershipsTable, dealerDomainsTable, dealerImportKeysTable, dealerSettingsTable, portalUsersTable, stockImportRunsTable } from '@workspace/db';
import { databaseReady } from './health';
import { importCapacitySql, importCapacitySummary } from '../lib/platform-capacity';
import { processJobStatus } from '../lib/tenant-jobs';
import { importAdmission } from '../lib/stock-import-admission';
import { isPlatformAdmin } from '../lib/platform-admin';
import { sharedStaffPortalConfig, sharedStaffPortalForDealer, sharedStaffWorkspaceUrl } from '../lib/shared-staff-portal';
import { isReservedDealerHost, normaliseTenantHost, multiTenantEnabled } from '../lib/tenant-context';
import { importSecretDigest } from '../middlewares/tenant';
import { importActivityDetails } from '../lib/platform-import-activity';
import { newDealerSettings } from './dealer-settings';
import { platformStockConnection } from '../lib/platform-stock-connection';
import platformStockUploadRouter from './platform-stock-upload';
import { platformStockUploadBlock, readPlatformStockUploadTarget } from '../lib/platform-stock-upload';
const router = Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!multiTenantEnabled() || normaliseTenantHost(req.get('host') ?? '') !== normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST ?? '') || !isPlatformAdmin(getAuth(req).userId ?? undefined)) { res.status(403).json({ error: 'Platform administrator access required.' }); return; }
  if (req.get('origin') && req.get('origin') !== `https://${process.env.PLATFORM_ADMIN_HOST}`) { res.status(403).json({ error: 'Open platform administration on its approved domain.' }); return; } next();
});
router.use('/dealers/:id/invitations', accountInvitationManagementRouter('platform'));
router.use(platformFeaturesRouter);
router.use(platformStockUploadRouter);
router.use(platformOnboardingKeysRouter);
router.use(platformDemosRouter);
router.use(platformDemoLinkRouter);
router.use(platformConversionRouter);
router.use(platformDomainAutomationRouter);
router.use(platformDealerOnboardingRouter);
router.get('/capacity', async (req, res) => {
  let ready = await databaseReady();
  let imports: ReturnType<typeof importCapacitySummary> | { available: false } = { available: false };
  if (ready) {
    try { imports = importCapacitySummary((await pool.query(importCapacitySql)).rows); }
    catch { ready = false; req.log?.warn('Platform capacity import summary unavailable'); }
  }
  res.json({
    generatedAt: new Date().toISOString(), scope: 'this_process',
    database: { ready, pool: databasePoolStatus() },
    imports: { admission: importAdmission.status(), ...imports },
    jobs: processJobStatus(),
  });
});
router.patch('/dealers/:id/checklist', async (req, res) => {
  const input = z.object({ itemId: z.string().refine(id => onboardingItems.some(item => item.id === id)), status: z.enum(['pending', 'done', 'skipped']), note: z.string().trim().max(1000) }).strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'Choose a checklist item and valid status; notes must be at most 1,000 characters.' }); return; }
  const { itemId, status, note } = input.data;
  if (status === 'skipped' && !note) { res.status(400).json({ error: 'Explain why this item is not applicable.' }); return; }
  const entry = { status, note, updatedAt: new Date().toISOString(), updatedBy: getAuth(req).userId! };
  const [dealer] = await db.update(dealershipsTable).set({ onboardingChecklist: sql`${dealershipsTable.onboardingChecklist} || ${JSON.stringify({ [itemId]: entry })}::jsonb` }).where(eq(dealershipsTable.id, req.params.id)).returning({ onboardingChecklist: dealershipsTable.onboardingChecklist });
  if (!dealer) { res.status(404).json({ error: 'Dealer not found.' }); return; }
  res.json(dealer);
});
const publicDealer = ({ onboardingProof: _proof, ...dealer }: typeof dealershipsTable.$inferSelect) => dealer;
router.get('/dealers', async (_req, res) => { const dealers = await db.select().from(dealershipsTable); res.json({ dealers: dealers.map(publicDealer) }); });
router.get('/dealers/:id/imports/:runId', async (req, res) => {
  const details = await importActivityDetails(db, req.params.id, req.params.runId);
  if (!details) { res.status(404).json({ error: 'Import not found for this dealership.' }); return; }
  res.json(details);
});
// Whitelist operational metadata: never return raw stock snapshots, private settings or key hashes.
router.get('/overview', async (_req, res) => {
  const [dealers, domains, keys, latest, successful, runs, demos] = await Promise.all([
    db.select().from(dealershipsTable),
    db.select({ dealerId: dealerDomainsTable.dealerId, hostname: dealerDomainsTable.hostname, verified: dealerDomainsTable.verified }).from(dealerDomainsTable),
    db.select({ dealerId: dealerImportKeysTable.dealerId, activeCount: sql<number>`count(*)::int` }).from(dealerImportKeysTable).where(isNull(dealerImportKeysTable.disabledAt)).groupBy(dealerImportKeysTable.dealerId),
    db.selectDistinctOn([stockImportRunsTable.dealerId], { dealerId: stockImportRunsTable.dealerId, runId: stockImportRunsTable.runId, status: stockImportRunsTable.status, receivedAt: stockImportRunsTable.receivedAt, scrapedAt: stockImportRunsTable.scrapedAt, receivedCount: stockImportRunsTable.receivedCount, updatedAt: stockImportRunsTable.updatedAt, expectedCount: stockImportRunsTable.expectedCount, addedCount: stockImportRunsTable.addedCount, changedCount: stockImportRunsTable.changedCount, missingCount: stockImportRunsTable.missingCount, errors: stockImportRunsTable.errors, source: stockImportRunsTable.source, retailerId: stockImportRunsTable.retailerId }).from(stockImportRunsTable).orderBy(stockImportRunsTable.dealerId, desc(stockImportRunsTable.receivedAt)),
    db.selectDistinctOn([stockImportRunsTable.dealerId], { dealerId: stockImportRunsTable.dealerId, runId: stockImportRunsTable.runId, status: stockImportRunsTable.status, receivedAt: stockImportRunsTable.receivedAt, scrapedAt: stockImportRunsTable.scrapedAt, receivedCount: stockImportRunsTable.receivedCount, updatedAt: stockImportRunsTable.updatedAt, expectedCount: stockImportRunsTable.expectedCount, addedCount: stockImportRunsTable.addedCount, changedCount: stockImportRunsTable.changedCount, missingCount: stockImportRunsTable.missingCount, errors: stockImportRunsTable.errors, source: stockImportRunsTable.source, retailerId: stockImportRunsTable.retailerId }).from(stockImportRunsTable).where(eq(stockImportRunsTable.status, 'completed')).orderBy(stockImportRunsTable.dealerId, desc(stockImportRunsTable.receivedAt)),
    db.select({ dealerId: stockImportRunsTable.dealerId, runId: stockImportRunsTable.runId, status: stockImportRunsTable.status, receivedAt: stockImportRunsTable.receivedAt, scrapedAt: stockImportRunsTable.scrapedAt, receivedCount: stockImportRunsTable.receivedCount, updatedAt: stockImportRunsTable.updatedAt, expectedCount: stockImportRunsTable.expectedCount, addedCount: stockImportRunsTable.addedCount, changedCount: stockImportRunsTable.changedCount, missingCount: stockImportRunsTable.missingCount, errors: stockImportRunsTable.errors, source: stockImportRunsTable.source, retailerId: stockImportRunsTable.retailerId }).from(stockImportRunsTable).orderBy(desc(stockImportRunsTable.receivedAt)).limit(30),
    pool.query('SELECT dealer_id,expires_at FROM dealer_demos WHERE converted_at IS NULL'),
  ]);
  const sharedStaff = sharedStaffPortalConfig();
  res.json({ sharedStaffDealerIds: sharedStaff?.dealerIds ?? null, dealers: dealers.map(dealer => ({ ...publicDealer(dealer),
    isDemo: demos.rows.some(demo => demo.dealer_id === dealer.id),
    demoExpiresAt: demos.rows.find(demo => demo.dealer_id === dealer.id)?.expires_at ?? null,
    domains: domains.filter(d => d.dealerId === dealer.id),
    activeKeyCount: keys.find(k => k.dealerId === dealer.id)?.activeCount ?? 0,
    latestImport: latest.find(r => r.dealerId === dealer.id) ?? null,
    lastSuccessfulImport: successful.find(r => r.dealerId === dealer.id) ?? null,
  })), activity: runs.slice(0, 30) });
});
router.get('/dealers/:id/workspace', async (req, res) => {
  const [dealer] = await db.select().from(dealershipsTable).where(eq(dealershipsTable.id, req.params.id));
  if (!dealer) { res.status(404).json({ error: 'Dealer not found.' }); return; }
  const [domains, members, imports, keys, effectiveStockConnection, uploadTarget] = await Promise.all([
    db.select().from(dealerDomainsTable).where(eq(dealerDomainsTable.dealerId, dealer.id)),
    db.select({ id: portalUsersTable.id, name: portalUsersTable.name, email: portalUsersTable.email, role: portalUsersTable.role, disabledAt: portalUsersTable.disabledAt, sharedSignIn: portalUsersTable.sharedStaffIdentity,
      sharedLinked: sql<boolean>`exists (select 1 from portal_users linked where linked.dealer_id=${portalUsersTable.dealerId} and linked.legacy_portal_user_id=${portalUsersTable.id} and linked.shared_staff_identity and linked.disabled_at is null)`,
    }).from(portalUsersTable).where(and(eq(portalUsersTable.dealerId, dealer.id), isNull(portalUsersTable.legacyPortalUserId))),
    db.select({ runId: stockImportRunsTable.runId, status: stockImportRunsTable.status, receivedAt: stockImportRunsTable.receivedAt, scrapedAt: stockImportRunsTable.scrapedAt, receivedCount: stockImportRunsTable.receivedCount, updatedAt: stockImportRunsTable.updatedAt, expectedCount: stockImportRunsTable.expectedCount, addedCount: stockImportRunsTable.addedCount, changedCount: stockImportRunsTable.changedCount, missingCount: stockImportRunsTable.missingCount, errors: stockImportRunsTable.errors, source: stockImportRunsTable.source, retailerId: stockImportRunsTable.retailerId }).from(stockImportRunsTable).where(eq(stockImportRunsTable.dealerId, dealer.id)).orderBy(desc(stockImportRunsTable.receivedAt)).limit(30),
    db.select({ id: dealerImportKeysTable.id, createdAt: dealerImportKeysTable.createdAt, disabledAt: dealerImportKeysTable.disabledAt }).from(dealerImportKeysTable).where(eq(dealerImportKeysTable.dealerId, dealer.id)),
    platformStockConnection(dealer),
    readPlatformStockUploadTarget(dealer.id),
  ]);
  const isDemo = Boolean(uploadTarget?.demoExpiresAt && !uploadTarget.demoConvertedAt);
  const staffWorkspaceUrl = dealer.status === 'active' && dealer.plan === 'full_portal' && !isDemo ? sharedStaffWorkspaceUrl(dealer.id) : null;
  res.json({ dealer: { ...publicDealer(dealer), isDemo, demoExpiresAt: isDemo ? uploadTarget?.demoExpiresAt : null }, domains, members, imports, keys,
    effectiveStockConnection, stockUploadAllowed: Boolean(uploadTarget && !platformStockUploadBlock(uploadTarget)),
    ...(staffWorkspaceUrl ? { sharedStaffWorkspaceUrl: staffWorkspaceUrl } : {}) });
});
const origin = z.string().url().refine(v => { const u = new URL(v); return u.protocol === 'https:' && (!u.port || u.port === '443') && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash && Boolean(normaliseTenantHost(u.host)); });
const creation = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), name: z.string().trim().min(1).max(120), canonicalOrigin: origin, platform: z.enum(['autotrader','cazoo']), retailerId: z.string().trim().min(1).max(128), sourceUrl: z.string().url(), plan: z.enum(['full_portal','website_only']).optional(), enquiryEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional(), ownerAuthUserId: z.string().regex(/^user_[A-Za-z0-9]+$/).optional(), ownerEmail: z.string().email().optional(), useMyAccount: z.boolean().optional(), inviteOwnerEmail: z.string().trim().toLowerCase().email().max(254).optional(), inviteOwnerLogin: z.enum(['legacy','shared']).optional() }).strict().refine(v => {
  const ownerChoices = [v.ownerAuthUserId, v.ownerEmail, v.useMyAccount, v.inviteOwnerEmail].filter(Boolean).length;
  if (v.inviteOwnerLogin && (!v.inviteOwnerEmail || v.plan === 'website_only')) return false;
  return v.plan === 'website_only' ? Boolean(v.enquiryEmail) && ownerChoices <= 1 : ownerChoices === 1;
});
router.post('/dealers', async (req, res) => {
  const input = creation.safeParse(req.body); if (!input.success) { res.status(400).json({ error: 'Enter the dealership, website and stock source. Choose an owner for Full Portal or enter an enquiry email for Website Only.' }); return; }
  const d = input.data, source = new URL(d.sourceUrl); const host = normaliseTenantHost(new URL(d.canonicalOrigin).host)!;
  if (isReservedDealerHost(host)) { res.status(400).json({ error: 'Use a separate dealer domain. Administration, staff portal and import hosts are reserved.' }); return; }
  const allowed = d.platform === 'cazoo' ? ['cazoo.co.uk','www.cazoo.co.uk'] : ['autotrader.co.uk','www.autotrader.co.uk'];
  if (source.protocol !== 'https:' || source.username || source.password || (source.port && source.port !== '443') || !allowed.includes(source.hostname)) { res.status(400).json({ error: 'Source URL does not match the stock platform.' }); return; }
  if (d.inviteOwnerLogin === 'shared' && (d.plan !== 'full_portal' || !sharedStaffPortalForDealer(d.id))) {
    res.status(409).json({ error: 'Shared staff sign-in is not available for this dealership. Choose the existing portal sign-in for the owner invitation.' }); return;
  }
  let ownerAuthUserId = d.ownerAuthUserId;
  let ownerEmail: string | null = null;
  let ownerName: string | null = null;
  if (d.plan !== 'website_only' && d.inviteOwnerEmail && !invitationEmailReadiness().ready) { res.status(503).json({ error: invitationEmailReadiness().message }); return; }
  if (d.plan !== 'website_only' && (d.useMyAccount || d.inviteOwnerEmail)) ownerAuthUserId = getAuth(req).userId!;
  if (d.plan !== 'website_only' && d.ownerEmail) {
    try {
      const profiles = (await clerkClient.users.getUserList({ emailAddress: [d.ownerEmail.trim().toLowerCase()], limit: 2 })).data;
      if (profiles.length !== 1) { res.status(400).json({ error: 'Use the email of one existing Clerk account. New-account invitations are not enabled yet.' }); return; }
      ownerAuthUserId = profiles[0].id;
      ownerEmail = profiles[0].primaryEmailAddress?.emailAddress ?? d.ownerEmail;
      ownerName = [profiles[0].firstName, profiles[0].lastName].filter(Boolean).join(' ') || null;
    } catch { res.status(503).json({ error: 'Account lookup is unavailable. Try again or choose your own account.' }); return; }
  }
  const token = `dealer-verification=${randomBytes(24).toString('hex')}`;
  try {
    await db.transaction(async tx => {
      await tx.insert(dealershipsTable).values({ id: d.id, name: d.name, canonicalOrigin: new URL(d.canonicalOrigin).origin, stockPlatform: d.platform, retailerId: d.retailerId, sourceUrl: d.sourceUrl, plan: d.plan ?? 'full_portal', enquiryEmail: d.plan === 'website_only' ? d.enquiryEmail : null, onboardingRequired: Boolean(d.plan) });
      await tx.insert(dealerDomainsTable).values({ hostname: host, dealerId: d.id, verificationToken: token });
      if (d.plan !== 'website_only' && ownerAuthUserId) await tx.insert(portalUsersTable).values({ dealerId: d.id, authUserId: ownerAuthUserId, email: ownerEmail, name: ownerName, role: 'owner' });
      const config = newDealerSettings(d.name);
      await tx.insert(dealerSettingsTable).values({ dealerId: d.id, config });
    });
    let ownerInvitation;
    if (d.plan !== 'website_only' && d.inviteOwnerEmail) { try { ownerInvitation = await issueAccountInvitation(d.id,d.inviteOwnerEmail,'owner',{id:getAuth(req).userId!,kind:'platform'},{login:d.inviteOwnerLogin}); } catch { ownerInvitation = {deliveryStatus:'failed',error:'Dealership created. Open Staff to send the owner invitation; no owner access has been granted to the recipient.'}; } }
    res.status(201).json({ ...(ownerInvitation ? {ownerInvitation} : {}), dealerId: d.id, status: 'draft', dns: { type: 'TXT', name: `_dealer-verification.${host}`, value: token }, next: 'Verify DNS ownership and connect the domain in Render before activation.' });
  } catch { res.status(409).json({ error: 'Dealer ID or domain already exists. No dealer created.' }); }
});
router.get('/dealers/:id/domains', async (req, res) => { res.json({ domains: await db.select().from(dealerDomainsTable).where(eq(dealerDomainsTable.dealerId, req.params.id)) }); });
router.post('/dealers/:id/domains', async (req, res) => {
  const hostname = normaliseTenantHost(String(req.body?.hostname ?? ''));
  if (hostname && isReservedDealerHost(hostname)) { res.status(400).json({ error: 'Administration, staff portal and import hosts are reserved.' }); return; }
  const [dealer] = await db.select().from(dealershipsTable).where(eq(dealershipsTable.id, req.params.id));
  if (!dealer || !hostname) { res.status(400).json({ error: 'Choose a registered dealer and valid domain hostname.' }); return; }
  const token = `dealer-verification=${randomBytes(24).toString('hex')}`;
  try { await db.insert(dealerDomainsTable).values({ hostname, dealerId: dealer.id, verificationToken: token }); res.status(201).json({ dns: { type: 'TXT', name: `_dealer-verification.${hostname}`, value: token } }); }
  catch { res.status(409).json({ error: 'This domain is already registered.' }); }
});
router.post('/dealers/:id/verify-domain', async (req, res) => {
  const hostname = normaliseTenantHost(String(req.body?.hostname ?? ''));
  const [domain] = hostname ? await db.select().from(dealerDomainsTable).where(and(eq(dealerDomainsTable.hostname, hostname), eq(dealerDomainsTable.dealerId, req.params.id))) : [];
  if (!domain || isReservedDealerHost(domain.hostname)) { res.status(404).json({ error: 'Domain not found.' }); return; }
  try { const records = await resolveTxt(`_dealer-verification.${domain.hostname}`); if (!records.some(parts => parts.join('') === domain.verificationToken)) throw new Error(); }
  catch { res.status(409).json({ error: 'DNS ownership record not found. Domain remains inactive.' }); return; }
  await db.update(dealerDomainsTable).set({ verified: true }).where(eq(dealerDomainsTable.hostname, domain.hostname)); res.json({ hostname, verified: true, renderDomainSetupStillRequired: true });
});
router.post('/dealers/:id/import-key', async (req, res) => {
  const [dealer] = await db.select().from(dealershipsTable).where(eq(dealershipsTable.id, req.params.id)); if (!dealer) { res.status(404).json({ error: 'Dealer not found.' }); return; }
  const secret = randomBytes(32).toString('base64url'); const [key] = await db.insert(dealerImportKeysTable).values({ dealerId: dealer.id, secretHash: importSecretDigest(secret) }).returning();
  res.status(201).json({ keyId: key.id, secret, endpointPath: `/api/stock/imports/${dealer.id}/grok`, notice: 'Shown once. Save directly in the worker secure secret store; never in logs or chat.' });
});
router.delete('/dealers/:id/import-key/:keyId', async (req, res) => { await db.update(dealerImportKeysTable).set({ disabledAt: new Date() }).where(and(eq(dealerImportKeysTable.id, req.params.keyId), eq(dealerImportKeysTable.dealerId, req.params.id))); res.json({ revoked: true }); });
router.put('/dealers/:id/status', async (req, res) => {
  if (!['active','suspended','draft'].includes(req.body?.status)) { res.status(400).json({ error: 'Choose active, suspended or draft.' }); return; }
  await db.transaction(async tx => {
    const [dealer] = await tx.select().from(dealershipsTable).where(eq(dealershipsTable.id, req.params.id)).for('update');
    if (!dealer) { res.status(404).json({ error: 'Dealer not found.' }); return; }
    if (dealer.onboardingRequired && req.body.status !== 'draft') { res.status(409).json({ error: 'Complete onboarding and use Go live for this dealership.' }); return; }
    const [domain] = await tx.select().from(dealerDomainsTable).where(and(eq(dealerDomainsTable.hostname, normaliseTenantHost(new URL(dealer.canonicalOrigin).host)!), eq(dealerDomainsTable.dealerId, dealer.id), eq(dealerDomainsTable.verified, true)));
    if (req.body.status === 'active' && (!domain || isReservedDealerHost(domain.hostname))) { res.status(409).json({ error: 'Verify the canonical domain first.' }); return; }
    await tx.update(dealershipsTable).set({ status: req.body.status }).where(eq(dealershipsTable.id, dealer.id));
    res.json({ dealerId: dealer.id, status: req.body.status });
  });
});
export default router;
