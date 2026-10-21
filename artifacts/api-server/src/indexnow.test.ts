import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { db, engine, dealershipsTable, dealerDomainsTable, dealerDemosTable, dealerSettingsTable, portalUsersTable, vehiclesTable } from './test/tenant-test-db';
import { indexNowConfiguration, indexNowReadiness, submitIndexNow, IndexNowError } from './lib/indexnow';
import { createIndexNowRouter } from './routes/indexnow';
import { loadDealerSitemap, verifiedSeoScope } from './routes/seo';
import { resolveTenant } from './middlewares/tenant';

process.env.NODE_ENV = 'test';
process.env.MULTI_TENANT_ENABLED = 'true';
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'ab'.repeat(32);
process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';
process.env.LOG_LEVEL = 'fatal';

const a = { dealerId: 'index-a', origin: 'https://a.example.test', demo: false };
const enabled = { INDEXNOW_ENABLED: 'true', INDEXNOW_SECRET: 'cd'.repeat(32) };

test('IndexNow is opt-in, independently configured and bound to dealer plus canonical origin', () => {
  assert.equal(indexNowConfiguration(a, {}), null);
  assert.equal(indexNowConfiguration(a, { ...enabled, INDEXNOW_ENABLED: 'false' }), null);
  assert.equal(indexNowConfiguration(a, { ...enabled, INDEXNOW_SECRET: 'too-short' }), null);
  assert.equal(indexNowConfiguration({ ...a, demo: true }, enabled), null);
  assert.equal(indexNowConfiguration(null, enabled), null);
  const config = indexNowConfiguration(a, enabled)!;
  assert.match(config.key, /^[a-f0-9]{64}$/); assert.equal(config.keyLocation, `${a.origin}/${config.key}.txt`);
  assert.notEqual(config.key, indexNowConfiguration({ ...a, dealerId: 'index-b' }, enabled)!.key);
  assert.notEqual(config.key, indexNowConfiguration({ ...a, origin: 'https://new.example.test' }, enabled)!.key);
  assert.equal(indexNowReadiness(a, {}).status, 'disabled');
  assert.equal(indexNowReadiness(a, { INDEXNOW_ENABLED: 'true' }).status, 'not_configured');
  assert.equal(indexNowReadiness({ ...a, demo: true }, enabled).status, 'demo_excluded');
  assert.equal(indexNowReadiness(a, enabled).automaticStockNotifications, false);
});

test('manual submission sends only generated canonical public URLs with bounded delivery and no indexing claim', async () => {
  const config = indexNowConfiguration(a, enabled)!;
  const id = randomUUID(); let sent: { url: string; init: RequestInit } | undefined;
  const response = await submitIndexNow(config, a, { vehicles: [{ id }, { id: '../api/private' }], warrantyEnabled: false }, async (url, init) => { sent = { url, init }; return { status: 200 }; });
  assert.equal(sent!.url, 'https://api.indexnow.org/indexnow');
  assert.equal(sent!.init.redirect, 'error'); assert.ok(sent!.init.signal);
  const payload = JSON.parse(String(sent!.init.body));
  assert.deepEqual(payload.urlList, [`${a.origin}/`, `${a.origin}/stock`, `${a.origin}/contact`, `${a.origin}/vehicle/${id}`]);
  assert.equal(payload.host, 'a.example.test'); assert.equal(payload.keyLocation, config.keyLocation);
  assert.ok(!JSON.stringify(payload).includes(enabled.INDEXNOW_SECRET));
  assert.equal(response.status, 'accepted'); assert.equal(response.indexed, 'unconfirmed');
  const pending = await submitIndexNow(config, a, { vehicles: [] }, async () => ({ status: 202 })); assert.equal(pending.status, 'verification_pending');
  await assert.rejects(submitIndexNow(config, a, { vehicles: [] }, async () => ({ status: 429 })), error => error instanceof IndexNowError && error.status === 502);
  await assert.rejects(submitIndexNow({ ...config, endpoint: 'https://evil.example.test/' }, a, { vehicles: [] }, async () => { throw new Error('must not call'); }), error => error instanceof IndexNowError && error.code === 'INDEXNOW_CONFIGURATION');
  let tooManyCalls = 0;
  await assert.rejects(submitIndexNow(config, a, { vehicles: Array.from({ length: 500 }, () => ({ id: randomUUID() })) }, async () => { tooManyCalls++; return { status: 200 }; }), error => error instanceof IndexNowError && error.code === 'INDEXNOW_URL_LIMIT');
  assert.equal(tooManyCalls, 0);
  let signal: AbortSignal | null | undefined;
  await assert.rejects(submitIndexNow(config, a, { vehicles: [] }, async (_url, init) => { signal = init.signal; return new Promise(() => {}); }, 20), error => error instanceof IndexNowError && error.status === 504);
  assert.equal(signal?.aborted, true);
});

test('IndexNow HTTP actions enforce actual tenant membership, same-origin writes, confirmation, disabled state and key isolation', async t => {
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  const dealer = { id: a.dealerId, name: 'Index A', status: 'active' as const, canonicalOrigin: a.origin, stockPlatform: 'autotrader' as const, retailerId: 'a', sourceUrl: 'https://www.autotrader.co.uk/cars/retailer/stock?retailerId=a' };
  const other = { ...dealer, id: 'index-b', canonicalOrigin: 'https://b.example.test', retailerId: 'b' };
  const demo = { ...dealer, id: 'index-demo', canonicalOrigin: 'https://demo.example.test' };
  await db.insert(dealershipsTable).values([dealer, other, demo]);
  await db.insert(dealerDomainsTable).values([dealer, other, demo].map(row => ({ dealerId: row.id, hostname: new URL(row.canonicalOrigin).hostname, verified: true, verificationToken: 'fictional' })));
  await db.insert(dealerDemosTable).values({ dealerId: demo.id, recipient: 'fictional@example.test', expiresAt: new Date(Date.now() + 86400_000), updatedBy: 'test' });
  await db.insert(dealerSettingsTable).values([dealer, other, demo].map(row => ({ dealerId: row.id, config: { warranty: { enabled: false } } })));
  await db.insert(portalUsersTable).values([
    { dealerId: dealer.id, authUserId: 'user_owner_a', role: 'owner' },
    { dealerId: other.id, authUserId: 'user_owner_b', role: 'owner' },
    { dealerId: dealer.id, authUserId: 'user_sales', role: 'salesperson' },
    { dealerId: demo.id, authUserId: 'user_demo', role: 'owner' },
  ]);
  const carA = randomUUID(), carB = randomUUID();
  await db.insert(vehiclesTable).values([
    { id: carA, dealerId: dealer.id, source: 'autotrader', advertId: 'a', sourcePrice: 5000 },
    { id: carB, dealerId: other.id, source: 'autotrader', advertId: 'b', sourcePrice: 5000 },
  ]);
  delete process.env.INDEXNOW_ENABLED; delete process.env.INDEXNOW_SECRET;
  let calls = 0; let body: Record<string, unknown> | undefined; let time = 0;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.log = { warn() {}, error() {} } as unknown as typeof req.log; next(); });
  app.use(resolveTenant); app.use(createIndexNowRouter({ scope: verifiedSeoScope, load: loadDealerSitemap, now: () => time, transport: async (_url, init) => { calls++; body = JSON.parse(String(init.body)); return { status: 200 }; } }));
  app.use((_req, res) => res.status(404).end());
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local listener unavailable');
  const request = (path: string, options: { host?: string; user?: string; method?: string; body?: unknown; origin?: string } = {}) => new Promise<{ status: number; text: string; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
    const host = options.host ?? 'a.example.test';
    const call = httpRequest(`http://127.0.0.1:${address.port}${path}`, { method: options.method ?? 'GET', headers: { host, 'Content-Type': 'application/json', ...(options.user ? { 'x-test-user': options.user } : {}), ...(options.origin ? { origin: options.origin } : {}) } }, response => {
      let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => resolve({ status: response.statusCode!, text, headers: response.headers }));
    }); call.on('error', reject); if (options.body) call.write(JSON.stringify(options.body)); call.end();
  });
  const path = '/api/staff/search-visibility/indexnow';
  const post = (options: Parameters<typeof request>[1] = {}) => request(path, { method: 'POST', user: 'user_owner_a', body: { confirmed: true }, ...options });
  try {
    await t.test('disabled by default and never sends without an explicit owner action', async () => {
      const status = await request(path, { user: 'user_owner_a' }); assert.equal(status.status, 200); assert.equal(JSON.parse(status.text).status, 'disabled');
      assert.equal((await post()).status, 409); assert.equal(calls, 0);
      process.env.INDEXNOW_ENABLED = enabled.INDEXNOW_ENABLED; process.env.INDEXNOW_SECRET = enabled.INDEXNOW_SECRET;
      assert.equal((await post({ body: {} })).status, 400);
      assert.equal((await post({ body: { confirmed: true, urlList: ['https://evil.example.test'] } })).status, 400);
      assert.equal((await request(path)).status, 401);
      assert.equal((await post({ user: 'user_sales' })).status, 403);
      assert.equal((await post({ host: 'b.example.test' })).status, 403);
      assert.equal((await post({ origin: 'https://b.example.test' })).status, 403);
      assert.equal((await post({ host: 'demo.example.test', user: 'user_demo' })).status, 403);
      assert.equal(calls, 0);
    });
    await t.test('verification files are dealer-bound and absent on demos or when disabled', async () => {
      const config = indexNowConfiguration(a)!;
      const keyFile = `/${config.key}.txt`;
      const result = await request(keyFile); assert.equal(result.status, 200); assert.equal(result.text, config.key);
      assert.match(String(result.headers['content-type']), /text\/plain; charset=utf-8/);
      assert.equal((await request(keyFile, { host: 'b.example.test' })).status, 404);
      assert.equal((await request(keyFile, { host: 'demo.example.test' })).status, 404);
      process.env.INDEXNOW_ENABLED = 'false'; assert.equal((await request(keyFile)).status, 404); process.env.INDEXNOW_ENABLED = 'true';
      assert.equal(calls, 0);
    });
    await t.test('submits canonical current public pages only and limits repeated requests independently per dealer', async () => {
      const result = await post(); assert.equal(result.status, 200); assert.equal(JSON.parse(result.text).indexed, 'unconfirmed');
      assert.equal(calls, 1); const urls = body!.urlList as string[];
      assert.ok(urls.includes(`${a.origin}/vehicle/${carA}`)); assert.ok(!urls.some(url => url.includes(carB)));
      assert.ok(urls.every(url => new URL(url).origin === a.origin));
      assert.ok(!result.text.includes(enabled.INDEXNOW_SECRET));
      assert.equal((await post()).status, 429); assert.equal(calls, 1);
      assert.equal((await post({ host: 'b.example.test', user: 'user_owner_b' })).status, 200); assert.equal(calls, 2);
      time += 300_000; assert.equal((await post()).status, 200); assert.equal(calls, 3);
    });
  } finally {
    delete process.env.INDEXNOW_ENABLED; delete process.env.INDEXNOW_SECRET;
    await new Promise<void>(resolve => server.close(() => resolve())); await engine.close();
  }
});
