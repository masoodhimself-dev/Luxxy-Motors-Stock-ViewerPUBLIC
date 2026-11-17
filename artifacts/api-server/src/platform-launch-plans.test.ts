import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import pino from 'pino';
import { db, engine, stockImportRunsTable, vehiclesTable } from './test/tenant-test-db';

type OnboardingResponse = { checks: Array<{ id: string; ready: boolean }>; testEnquiry: { recipient: string; channel: string; enquiryId: string } | null };
const onboardingResponse = async (response: Response) => await response.json() as OnboardingResponse;

test('Website Only and Full Portal prove separate launch destinations and preserve privacy', async () => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';
  process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
  process.env.RESEND_API_KEY = 're_fictional_test_key';
  process.env.RESEND_FROM_EMAIL = 'DealerOS <info@example.test>';
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, 'utf8'));
  }
  const { default: platformRouter } = await import('./routes/platform-dealers');
  const { default: enquiryRouter } = await import('./routes/enquiries');
  const { requireStaff } = await import('./middlewares/staff-auth');
  const { resolveTenant } = await import('./middlewares/tenant');
  const { findDueEmailDealers, processDealerEmailOutbox } = await import('./lib/email-outbox');
  const { runWithTenant } = await import('./lib/tenant-context');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = pino({ level: 'silent' }); next(); });
  app.use('/api/platform', platformRouter);
  app.use(resolveTenant);
  app.use('/api', enquiryRouter);
  app.get('/api/staff/entitlement-check', requireStaff, (_req, res) => res.sendStatus(204));
  app.get('/portal', (_req, res) => res.send('Portal'));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = (path: string, method = 'GET', body?: unknown, host = 'admin.example.test', user = 'user_admin') => new Promise<Response>((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${address.port}${path}`, { method, headers: { host, 'content-type': 'application/json', 'x-test-user': user } }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve(new Response(data || null, { status: response.statusCode })));
    });
    req.on('error', reject);
    req.end(body == null ? undefined : JSON.stringify(body));
  });
  const stock = async (id: string) => {
    await engine.query('UPDATE dealer_domains SET verified=true WHERE dealer_id=$1', [id]);
    await db.insert(vehiclesTable).values({ dealerId: id, source: 'autotrader', advertId: `car-for-${id}`, title: 'Fictional Example Car', sourcePrice: 5000 });
    await db.insert(stockImportRunsTable).values({ dealerId: id, runId: `stock-for-${id}`, source: 'autotrader', retailerId: '12345', schemaVersion: '1', scrapedAt: new Date(), expectedCount: 1, receivedCount: 1, complete: true, status: 'completed', rawSnapshot: {} });
    const row = await request(`/api/platform/dealers/${id}/checklist`, 'PATCH', { itemId: 'https', status: 'done', note: 'Checked in isolated QA' });
    assert.equal(row.status, 200);
  };
  const requests: Array<Record<string, any>> = [];
  const realFetch = globalThis.fetch;
  let resendError: number | null = null;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    requests.push(JSON.parse(String(init?.body)));
    return resendError ? Response.json({}, { status: resendError }) : Response.json({ id: `mock-provider-${requests.length}` });
  };

  try {
    const base = '/api/platform/dealers';
    const input = { name: 'Fictional Dealer', platform: 'autotrader', retailerId: '12345', sourceUrl: 'https://www.autotrader.co.uk/fictional' };
    const website = `${base}/website-test`;
    const full = `${base}/full-test`;
    assert.equal((await request(base, 'POST', { ...input, id: 'website-test', canonicalOrigin: 'https://website.example.test', plan: 'website_only', enquiryEmail: ' WEBSITE@EXAMPLE.TEST ' })).status, 201);
    assert.equal((await engine.query("SELECT 1 FROM portal_users WHERE dealer_id='website-test'")).rows.length, 0);
    assert.equal((await request(base, 'POST', { ...input, id: 'full-test', canonicalOrigin: 'https://full.example.test', plan: 'full_portal', ownerAuthUserId: 'user_owner' })).status, 201);
    assert.equal((await request(`${website}/status`, 'PUT', { status: 'suspended' })).status, 409);
    assert.equal((await request(`${website}/status`, 'PUT', { status: 'active' })).status, 409);
    await stock('website-test');
    assert.deepEqual((await onboardingResponse(await request(`${website}/onboarding`))).checks.map(check => check.id), ['domain', 'stock', 'enquiry']);
    assert.equal((await request(`${website}/onboarding/launch`, 'POST')).status, 409);
    assert.equal((await request(`${website}/onboarding/test-enquiry`, 'POST', { to: 'override@example.test' })).status, 400);
    resendError = 422;
    assert.equal((await request(`${website}/onboarding/test-enquiry`, 'POST')).status, 502);
    assert.equal((await onboardingResponse(await request(`${website}/onboarding`))).testEnquiry, null);
    resendError = null;
    const sent = await request(`${website}/onboarding/test-enquiry`, 'POST');
    assert.equal(sent.status, 200, await sent.clone().text());
    assert.equal((await onboardingResponse(sent)).testEnquiry?.recipient, 'website@example.test');
    assert.match(requests.at(-1)?.subject, /^\[TEST\]/);
    assert.deepEqual(requests.at(-1)?.to, ['website@example.test']);
    assert.equal((await request(`${website}/onboarding`, 'PATCH', { plan: 'website_only', enquiryEmail: 'next@example.test' })).status, 200);
    assert.equal((await request(`${website}/onboarding/launch`, 'POST')).status, 409);
    assert.equal((await request(`${website}/onboarding/test-enquiry`, 'POST')).status, 200);
    assert.equal((await request(`${website}/onboarding/launch`, 'POST')).status, 200);
    assert.equal((await request('/portal', 'GET', undefined, 'website.example.test', 'user_owner')).status, 404);
    assert.equal((await request('/api/staff/entitlement-check', 'GET', undefined, 'website.example.test', 'user_owner')).status, 403);
    const beforeLiveEnquiry = requests.length;
    const submitted = await request('/api/enquiries', 'POST', { type: 'general', vehicleId: null, phone: null, preferredContact: 'email', appointmentAt: null, customerName: 'Fictional Customer', email: 'customer@example.test', message: 'Do you have the service history for the car?' }, 'website.example.test', '');
    assert.equal(submitted.status, 201, await submitted.clone().text());
    assert.equal(requests.length, beforeLiveEnquiry + 1);
    assert.equal(requests.at(-1)?.reply_to, 'customer@example.test');
    assert.deepEqual(requests.at(-1)?.to, ['next@example.test']);
    assert.doesNotMatch(requests.at(-1)?.html, /\/portal/);
    assert.equal((await engine.query("SELECT 1 FROM leads WHERE dealer_id='website-test'")).rows.length, 0);

    resendError = 503;
    const retryInput = { type: 'general', vehicleId: null, phone: null, preferredContact: 'email', appointmentAt: null, customerName: 'Fictional Retry', email: 'retry@example.test', message: 'Is this car available to view?' };
    assert.equal((await request('/api/enquiries', 'POST', retryInput, 'website.example.test', '')).status, 201);
    await engine.query("UPDATE email_outbox SET next_attempt_at=now() WHERE dealer_id='website-test' AND status='queued'");
    await engine.query('UPDATE email_account_throttle SET next_allowed_at=now()');
    const [due] = await findDueEmailDealers();
    assert.equal(due?.plan, 'website_only');
    assert.equal(due?.enquiry_email, 'next@example.test');
    resendError = null;
    const attemptedSends = requests.length;
    await runWithTenant({ dealerId: String(due.id), canonicalOrigin: String(due.canonical_origin), platform: 'autotrader', retailerId: String(due.retailer_id), sourceUrl: String(due.source_url), plan: 'website_only', enquiryEmail: String(due.enquiry_email) }, () => processDealerEmailOutbox(pino({ level: 'silent' })));
    assert.equal(requests.length, attemptedSends + 1);
    assert.equal(requests.at(-1)?.reply_to, 'retry@example.test');
    assert.deepEqual(requests.at(-1)?.to, ['next@example.test']);
    assert.equal((await engine.query("SELECT 1 FROM email_outbox WHERE dealer_id='website-test' AND status='queued'")).rows.length, 0);

    await stock('full-test');
    const providerCalls = requests.length;
    const inbox = await request(`${full}/onboarding/test-enquiry`, 'POST');
    assert.equal(inbox.status, 200, await inbox.clone().text());
    const proof = (await onboardingResponse(inbox)).testEnquiry;
    assert.ok(proof);
    assert.equal(proof.channel, 'inbox');
    assert.equal(requests.length, providerCalls);
    assert.equal((await request(`${full}/onboarding/test-enquiry`, 'GET', undefined, 'admin.example.test', 'user_other')).status, 403);
    const preview = await (await request(`${full}/onboarding/test-enquiry`)).json() as { enquiry: { id: string; source: string } };
    assert.equal(preview.enquiry.id, proof.enquiryId);
    assert.equal(preview.enquiry.source, 'onboarding_test');
    process.env.STAFF_PORTAL_HOST = 'staff.example.test';
    process.env.STAFF_PORTAL_CLERK_PUBLISHABLE_KEY = 'pk_live_ZmljdGlvbmFs';
    process.env.STAFF_PORTAL_CLERK_SECRET_KEY = 'sk_live_fictional';
    process.env.STAFF_PORTAL_PILOT_DEALER_ID = 'other-dealer';
    assert.equal((await onboardingResponse(await request(`${full}/onboarding`))).checks.find(check => check.id === 'owner')?.ready, true);
    process.env.STAFF_PORTAL_PILOT_DEALER_ID = 'full-test';
    assert.equal((await request(`${full}/domains`, 'POST', { hostname: 'staff.example.test' })).status, 400);
    assert.equal((await request(`${full}/onboarding/launch`, 'POST')).status, 409);
    const draftWorkspace = await (await request(`${full}/workspace`)).json() as { sharedStaffWorkspaceUrl?: string };
    assert.equal(draftWorkspace.sharedStaffWorkspaceUrl, undefined);
    await engine.query("UPDATE portal_users SET shared_staff_identity=true WHERE dealer_id='full-test' AND auth_user_id='user_owner'");
    assert.equal((await request(`${full}/onboarding/launch`, 'POST')).status, 200);
    assert.equal((await request(`${full}/onboarding/test-enquiry`)).status, 404);
    const liveWorkspace = await (await request(`${full}/workspace`)).json() as { sharedStaffWorkspaceUrl?: string };
    assert.equal(liveWorkspace.sharedStaffWorkspaceUrl, 'https://staff.example.test/dealers/full-test/portal');
    assert.equal((await engine.query("SELECT 1 FROM enquiries WHERE dealer_id='full-test'")).rows.length, 0);
    assert.equal((await request('/portal', 'GET', undefined, 'full.example.test', 'user_owner')).status, 200);
  } finally {
    globalThis.fetch = realFetch;
    server.close();
    await engine.close();
  }
});
