import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import { engine } from './test/tenant-test-db';
import { defaultFeatureRule, resolveDealerFeatures } from '@workspace/vehicle-meta';
import { runWithTenant } from './lib/tenant-context';
process.env.MULTI_TENANT_ENABLED = 'true'; process.env.PLATFORM_ADMIN_HOST = 'admin.example.test'; process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
const tenant = (id = 'feature-a') => ({ dealerId: id, canonicalOrigin: `https://${id}.example.test`, platform: 'autotrader' as const, retailerId: 'fictional', sourceUrl: 'https://www.autotrader.co.uk/fictional' });

test('feature schedules use inclusive server-time boundaries and cannot bypass release restrictions', () => {
  const scheduled = { ...defaultFeatureRule('enabled'), disabledAt: '2030-01-01T12:00:00Z' };
  const at = (time: string) => resolveDealerFeatures({ testDriveBookings: scheduled }, {}, new Date(time)).find(f => f.key === 'testDriveBookings')?.enabled;
  assert.equal(at('2030-01-01T11:59:59Z'), true); assert.equal(at('2030-01-01T12:00:00Z'), false);
  const explicit = resolveDealerFeatures({ publicEnquiries: defaultFeatureRule('disabled') }, { publicEnquiries: defaultFeatureRule('enabled'), websiteChat: defaultFeatureRule('enabled') });
  assert.equal(explicit.find(f => f.key === 'publicEnquiries')?.enabled, true); assert.equal(explicit.find(f => f.key === 'websiteChat')?.enabled, false);
});

test('platform controls enforce tenant isolation, audit, mutation gates and queued email pauses', async () => {
  for (const file of (await readdir('../../lib/db/drizzle')).filter(n => /^\d+.*\.sql$/.test(n)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  const { default: platformRouter } = await import('./routes/platform-dealers');
  const { default: publicRouter } = await import('./routes/dealer-features');
  const { enforceDealerFeatures, requireDealerFeature } = await import('./middlewares/dealer-features');
  const { saveFeatureRule, dealerFeatureEnabled } = await import('./lib/dealer-features');
  const { sendPreparedEmail, EmailProviderError, classifyEmailFailure } = await import('./lib/email-provider');
  const app = express(); app.use(express.json()); app.use('/api/platform', platformRouter);
  app.use('/api', (req, _res, next) => runWithTenant(tenant(req.get('x-test-dealer') || 'feature-a'), next)); app.use('/api', publicRouter, enforceDealerFeatures);
  let actions = 0;
  app.post('/api/declarations', requireDealerFeature('testDriveDeclarations'), (_req, res) => { actions++; res.json({ ok: true }); });
  app.post('/api/{*path}', (_req, res) => { actions++; res.json({ ok: true }); }); app.get('/api/history', (_req, res) => res.json({ records: ['retained'] }));
  const server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const address = server.address(); if (!address || typeof address === 'string') throw Error('No test address');
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<Response> => new Promise((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${address.port}${path}`, { method, headers: { host: 'admin.example.test', 'content-type': 'application/json', 'x-test-user': 'user_admin', ...headers } }, res => { let output = ''; res.on('data', c => output += c); res.on('end', () => resolve(new Response(output || null, { status: res.statusCode, headers: { 'cache-control': res.headers['cache-control'] || '' } }))); }); req.on('error', reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
  });
  const input = { mode: 'disabled', disabledAt: null, reason: 'Pause this feature for testing', expectedRevision: 0 };
  const put = (key: string, changes = {}, dealer: string | null = 'feature-a') => request(`/api/platform/${dealer ? `dealers/${dealer}/` : ''}features/${key}`, 'PUT', { ...input, ...changes });
  try {
    for (const id of ['feature-a', 'feature-b']) { const created = await request('/api/platform/dealers', 'POST', { id, name: id, canonicalOrigin: `https://${id}.example.test`, platform: 'autotrader', retailerId: 'fictional', sourceUrl: 'https://www.autotrader.co.uk/fictional', useMyAccount: true }); assert.equal(created.status, 201, await created.clone().text()); }
    assert.equal((await request('/api/platform/features', 'GET', undefined, { 'x-test-user': 'user_other' })).status, 403);
    assert.equal((await request('/api/platform/features', 'GET', undefined, { host: 'dealer.example.test' })).status, 403);
    assert.equal((await request('/api/platform/features/publicEnquiries', 'PUT', input, { origin: 'https://wrong.example.test' })).status, 403);
    assert.equal((await put('unknown')).status, 400); assert.equal((await put('publicEnquiries', { reason: ' ' })).status, 400); assert.equal((await put('publicEnquiries', { disabledAt: 'not-a-date' })).status, 400);
    assert.equal((await put('publicEnquiries', { mode: 'inherit' }, null)).status, 400); assert.equal((await put('websiteChat', { mode: 'enabled' })).status, 409); assert.equal((await put('publicEnquiries', { mode: 'enabled', disabledAt: '2020-01-01T00:00:00Z' })).status, 400);
    assert.equal((await put('publicEnquiries', {}, null)).status, 200); assert.equal(await dealerFeatureEnabled('publicEnquiries', 'feature-a'), false); assert.equal(await dealerFeatureEnabled('publicEnquiries', 'feature-b'), false);
    assert.equal((await put('publicEnquiries', { mode: 'enabled' })).status, 200); assert.equal(await dealerFeatureEnabled('publicEnquiries', 'feature-a'), true); assert.equal(await dealerFeatureEnabled('publicEnquiries', 'feature-b'), false);
    assert.equal((await put('publicEnquiries')).status, 409); assert.equal((await put('publicEnquiries', { mode: 'inherit', expectedRevision: 1 })).status, 200);
    const admin = await (await request('/api/platform/dealers/feature-a/features')).json() as any; assert.equal(admin.audit.length, 2); assert.equal(admin.audit[0].actor, 'user_admin'); assert.equal(admin.audit[0].reason, input.reason);
    const publicResponse = await request('/api/features'); const publicText = await publicResponse.text(); assert.equal(publicResponse.headers.get('cache-control'), 'no-store'); assert.ok(!publicText.includes('user_admin')); assert.ok(!publicText.includes(input.reason)); assert.equal(JSON.parse(publicText).features.publicEnquiries, false);
    for (const key of ['testDriveBookings', 'staffAiDrafts', 'customerEmails', 'testDriveDeclarations', 'partExchange']) assert.equal((await put(key)).status, 200);
    const blocked: Array<[string, object]> = [['/enquiries', { type: 'general' }], ['/enquiries', { type: 'part_exchange' }], ['/enquiries', { type: 'viewing' }], ['/staff/enquiries', { type: 'viewing' }], ['/viewings/token/reschedule', {}], ['/staff/enquiries/id/appointment', { action: 'reschedule' }], ['/test-drive-bookings/id/decision', { decision: 'confirm' }], ['/staff/enquiries/id/ai-draft', {}], ['/staff/enquiries/id/email', {}], ['/declarations', {}]];
    for (const [path, body] of blocked) assert.equal((await request(`/api${path}`, 'POST', body)).status, 403, path); assert.equal(actions, 0, 'No disabled action reaches a mutation, AI or provider handler');
    const allowed: Array<[string, object]> = [['/staff/enquiries/id/appointment', { action: 'cancel' }], ['/test-drive-bookings/id/decision', { decision: 'decline' }], ['/viewings/token/cancel', {}], ['/staff/enquiries', { type: 'general' }]];
    for (const [path, body] of allowed) assert.equal((await request(`/api${path}`, 'POST', body)).status, 200, path); assert.equal((await request('/api/history')).status, 200);
    let providerCalls = 0; const provider: typeof fetch = async () => { providerCalls++; return Response.json({ id: 'must-not-send' }); };
    const config = { enabled: true, apiKey: 're_fictional', from: 'dealer@example.test', replyTo: '' }; const envelope = JSON.stringify({ from: config.from, to: ['customer@example.test'], subject: 'Already queued', html: '<p>Approved message</p>' });
    const isPaused = (error: unknown) => error instanceof EmailProviderError && error.attempted === false && error.providerCode === 'feature_disabled' && classifyEmailFailure(error).kind === 'retryable';
    await assert.rejects(runWithTenant(tenant(), () => sendPreparedEmail(config, envelope, 'queued-before-disable', provider)), isPaused); assert.equal(providerCalls, 0);
    const future = new Date(Date.now() + 3_600_000).toISOString(); await saveFeatureRule({ dealerId: 'feature-a', key: 'customerEmails', mode: 'enabled', disabledAt: future, reason: 'Scheduled email pause', expectedRevision: 1, actor: 'user_admin' });
    await assert.rejects(sendPreparedEmail(config, envelope, 'missing-tenant', provider), (error: unknown) => error instanceof EmailProviderError && error.attempted === false && error.providerCode === 'feature_policy_unavailable');
    assert.equal(providerCalls, 0);
    assert.equal(await dealerFeatureEnabled('customerEmails', 'feature-a'), true); assert.equal(await dealerFeatureEnabled('customerEmails', 'feature-a', new Date(future)), false);
    // Advance the stored deadline to model a queue retry after its scheduled pause.
    await engine.query("UPDATE dealer_feature_overrides SET disabled_at=now()-interval '1 minute' WHERE dealer_id='feature-a' AND feature_key='customerEmails'");
    await assert.rejects(runWithTenant(tenant(), () => sendPreparedEmail(config, envelope, 'queued-before-schedule', provider)), isPaused); assert.equal(providerCalls, 0);
    const before = actions; await engine.exec('DROP TABLE platform_feature_defaults'); assert.equal((await request('/api/enquiries', 'POST', { type: 'general' })).status, 503); assert.equal((await request('/api/features')).status, 503); assert.equal(actions, before);
  } finally { await new Promise<void>(r => server.close(() => r())); await engine.close(); }
});
