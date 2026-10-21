import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import { db, engine, dealershipsTable, dealerDomainsTable, dealerSettingsTable, portalUsersTable } from './test/tenant-test-db';
import './search-readiness.test';

process.env.MULTI_TENANT_ENABLED = 'true';
process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';

test('search readiness is owner-only, tenant-scoped, read-only and explicit about unverified external accounts', async t => {
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  const a = { id: 'search-a', name: 'Search A', status: 'active' as const, canonicalOrigin: 'https://a.example.test', stockPlatform: 'autotrader' as const, retailerId: 'a', sourceUrl: 'https://www.autotrader.co.uk/cars/retailer/stock?retailerId=a' };
  const b = { ...a, id: 'search-b', name: 'Search B', canonicalOrigin: 'https://b.example.test', retailerId: 'b' };
  await db.insert(dealershipsTable).values([a, b]);
  await db.insert(dealerDomainsTable).values([{ dealerId: a.id, hostname: 'a.example.test', verified: true, verificationToken: 'fictional-search-a' }, { dealerId: b.id, hostname: 'b.example.test', verified: true, verificationToken: 'fictional-search-b' }]);
  const settings = { identity: { name: 'Search A' }, contact: { phone: '02000000000' }, address: { street: 'A showroom', city: 'London', postcode: 'HA0 0AA' }, hours: [{ days: 'Monday–Saturday', times: '08:00–18:00' }, { days: 'Sunday', times: 'Closed' }], privateNote: 'never-return-private-setting' };
  await db.insert(dealerSettingsTable).values([{ dealerId: a.id, config: settings }, { dealerId: b.id, config: { identity: { name: 'Search B' } } }]);
  await db.insert(portalUsersTable).values([{ dealerId: a.id, authUserId: 'user_a', role: 'owner' }, { dealerId: b.id, authUserId: 'user_b', role: 'owner' }, { dealerId: a.id, authUserId: 'user_sales', role: 'salesperson' }]);
  const { resolveTenant } = await import('./middlewares/tenant');
  const { default: router } = await import('./routes/search-visibility');
  const app = express();
  app.use((req, _res, next) => { req.log = { warn() {}, error() {} } as unknown as typeof req.log; next(); });
  app.use(resolveTenant); app.use('/api', router);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local test server unavailable');
  const get = (host: string, user = '', query = ''): Promise<{ status: number; body: any; text: string; headers: Record<string, unknown> }> => new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${address.port}/api/staff/search-visibility${query}`, { headers: { host, ...(user ? { 'x-test-user': user } : {}) } }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(text), text, headers: response.headers }));
    }); request.on('error', reject); request.end();
  });
  try {
    await t.test('uses the verified dealer and only emits readiness fields', async () => {
      const result = await get('a.example.test', 'user_a', '?dealerId=search-b');
      assert.equal(result.status, 200); assert.equal(result.body.origin, a.canonicalOrigin);
      assert.equal(result.body.status, 'ready_to_submit');
      assert.equal(result.headers['cache-control'], 'no-store'); assert.match(String(result.headers['x-robots-tag']), /noindex/);
      assert.ok(Object.values(result.body.externalChecks).every(value => value === 'unconfirmed'));
      assert.ok(!result.text.includes('never-return')); assert.ok(!result.text.includes('Search B'));
    });
    await t.test('keeps other dealerships separate and does not grant salesperson access', async () => {
      assert.equal((await get('a.example.test')).status, 401);
      assert.equal((await get('a.example.test', 'user_sales')).status, 403);
      assert.equal((await get('b.example.test', 'user_a')).status, 403);
      const result = await get('b.example.test', 'user_b'); assert.equal(result.status, 200); assert.equal(result.body.origin, b.canonicalOrigin); assert.equal(result.body.status, 'needs_details');
      assert.equal((await get('unknown.example.test', 'user_a')).status, 421);
    });
    await t.test('does not modify published settings or invent account verification', async () => {
      await get('a.example.test', 'user_a');
      const rows = await engine.query<{ config: unknown }>('SELECT config FROM dealer_settings WHERE dealer_id=$1', [a.id]);
      assert.deepEqual(rows.rows[0].config, settings);
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await engine.close(); }
});
