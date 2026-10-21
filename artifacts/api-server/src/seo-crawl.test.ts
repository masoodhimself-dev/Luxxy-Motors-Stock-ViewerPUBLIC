import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { db, engine, dealershipsTable, dealerDomainsTable, dealerDemosTable, dealerSettingsTable, vehiclesTable } from './test/tenant-test-db';
import { canonicalSeoOrigin, dealerRobotsText, dealerSitemapXml, escapeSitemapXml, isPrivateSeoPath, seoPrivatePageHeaders } from './lib/seo-crawl';
import { createSeoRouter } from './routes/seo';
import { resolveTenant } from './middlewares/tenant';

process.env.NODE_ENV = 'test';
process.env.MULTI_TENANT_ENABLED = 'true';
process.env.INTEGRATIONS_ENCRYPTION_KEY = 'ab'.repeat(32);
process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';
process.env.LOG_LEVEL = 'fatal';

test('crawl documents include only stable canonical public routes and trustworthy timestamps', () => {
  const id = randomUUID();
  const xml = dealerSitemapXml('https://dealer.example.test', {
    warrantyEnabled: true, settingsLastmod: '2026-01-02T12:00:00Z',
    vehicles: [{ id }, { id }, { id: '../portal?secret=never-return' }, { id: randomUUID(), lastmod: 'not-a-date' }],
  }, new Date('2026-02-01T00:00:00Z'));
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/dealer\.example\.test\/warranty<\/loc>/);
  assert.equal((xml.match(new RegExp(`/vehicle/${id}`, 'g')) ?? []).length, 1);
  assert.equal((xml.match(/<lastmod>/g) ?? []).length, 3);
  assert.ok(!xml.includes('portal')); assert.ok(!/<loc>[^<]*\?/.test(xml)); assert.ok(!xml.includes('never-return'));
  assert.equal(escapeSitemapXml('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
  const unchanged = dealerSitemapXml('https://dealer.example.test', { vehicles: [], settingsLastmod: '2099-01-01', warrantyEnabled: false });
  assert.ok(!unchanged.includes('<lastmod>')); assert.ok(!unchanged.includes('/warranty'));
  for (const origin of ['http://dealer.example.test', 'https://secret@dealer.example.test', 'https://dealer.example.test/path', 'https://dealer.example.test/?x=1', 'https://dealer.example.test/#x', 'https://dealer.example.test:8443']) {
    assert.throws(() => canonicalSeoOrigin(origin));
  }
  const robots = dealerRobotsText('https://dealer.example.test');
  assert.match(robots, /Allow: \/\n/); assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Allow: \/api\/website-assets\//); assert.match(robots, /Allow: \/api\/demo-logo/);
  assert.match(robots, /Sitemap: https:\/\/dealer\.example\.test\/sitemap\.xml/);
  assert.ok(isPrivateSeoPath('/portal/leads/123')); assert.ok(isPrivateSeoPath('/sign-in/oauth'));
  assert.ok(isPrivateSeoPath('/my-purchase/token?secret=redacted')); assert.ok(!isPrivateSeoPath('/vehicle/123'));
  assert.ok(!isPrivateSeoPath('/sign-inbox'));
});

test('sitemap HTTP routes reuse real tenant/public stock boundaries without private fields or writes', async t => {
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  }
  const dealer = { id: 'crawl-a', name: 'Fictional A', status: 'active' as const, canonicalOrigin: 'https://a.example.test', stockPlatform: 'autotrader' as const, retailerId: 'a', sourceUrl: 'https://www.autotrader.co.uk/cars/retailer/stock?retailerId=a' };
  const other = { ...dealer, id: 'crawl-b', name: 'Fictional B', canonicalOrigin: 'https://b.example.test', retailerId: 'b' };
  const demo = { ...dealer, id: 'crawl-demo', canonicalOrigin: 'https://demo.example.test' };
  await db.insert(dealershipsTable).values([dealer, other, demo]);
  await db.insert(dealerDomainsTable).values([dealer, other, demo].map(row => ({ dealerId: row.id, hostname: new URL(row.canonicalOrigin).hostname, verified: true, verificationToken: 'fictional' })));
  // An additional verified alias must not change canonical URLs.
  await db.insert(dealerDomainsTable).values({ dealerId: dealer.id, hostname: 'alias.example.test', verified: true, verificationToken: 'fictional' });
  await db.insert(dealerDemosTable).values({ dealerId: demo.id, recipient: 'fictional@example.test', expiresAt: new Date(Date.now() + 86400_000), updatedBy: 'test' });
  await db.insert(dealerSettingsTable).values([
    { dealerId: dealer.id, config: { warranty: { enabled: true } }, updatedAt: new Date('2026-01-02T12:00:00Z') },
    { dealerId: other.id, config: { warranty: { enabled: false } } },
  ]);
  const row = (advertId: string, extra: Partial<typeof vehiclesTable.$inferInsert> = {}) => ({ id: randomUUID(), dealerId: dealer.id, source: dealer.stockPlatform, advertId, sourcePrice: 5000, rawSourceData: { private: 'never-return-private-data' }, ...extra });
  const available = row('available'), reserved = row('reserved', { inventoryStatus: 'reserved' });
  const override = row('override', { sourcePrice: null, priceReviewRequired: true, websitePriceOverride: 4500 });
  const otherCar = row('other-dealer', { dealerId: other.id });
  const excluded = [
    row('sold', { inventoryStatus: 'sold' }), row('hidden', { inventoryStatus: 'hidden' }),
    row('archived', { archivedAt: new Date() }), row('missing', { missingCount: 2 }),
    row('wrong-source', { source: 'cazoo' }), row('review', { sourcePrice: null, priceReviewRequired: true }),
  ];
  await db.insert(vehiclesTable).values([available, reserved, override, otherCar, ...excluded]);
  const before = (await db.select().from(vehiclesTable)).map(vehicle => ({ id: vehicle.id, updatedAt: vehicle.updatedAt, sourcePrice: vehicle.sourcePrice }));
  const app = express();
  app.use(seoPrivatePageHeaders); app.use(resolveTenant); app.use(createSeoRouter());
  app.use((_req, res) => res.type('html').send('<html>Fictional app shell</html>'));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local test listener unavailable.');
  const request = (path: string, host = 'a.example.test') => new Promise<{ status: number; text: string; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
    const call = httpRequest(`http://127.0.0.1:${address.port}${path}`, { headers: { host, 'x-forwarded-host': 'b.example.test', 'x-dealer-id': other.id } }, response => {
      let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => resolve({ status: response.statusCode!, text, headers: response.headers }));
    }); call.on('error', reject); call.end();
  });
  try {
    await t.test('lists exactly the selected dealer current public stock, independent of spoofed query/headers', async () => {
      const result = await request('/sitemap.xml?dealerId=crawl-b'); assert.equal(result.status, 200);
      assert.match(result.headers['content-type'] ?? '', /application\/xml/); assert.equal(result.headers['cache-control'], 'no-store');
      for (const vehicle of [available, reserved, override]) assert.ok(result.text.includes(vehicle.id));
      for (const vehicle of [otherCar, ...excluded]) assert.ok(!result.text.includes(vehicle.id));
      assert.ok(result.text.includes('/warranty')); assert.ok(!result.text.includes('never-return'));
      assert.ok(!result.text.includes('b.example.test')); assert.ok(!result.text.includes('dealerId'));
      assert.equal((await request('/sitemap.xml', 'alias.example.test')).text, result.text);
      const b = await request('/sitemap.xml', 'b.example.test'); assert.ok(b.text.includes(otherCar.id));
      assert.ok(!b.text.includes(available.id)); assert.ok(!b.text.includes('/warranty'));
    });
    await t.test('demos and unknown hosts cannot publish a sitemap', async () => {
      const demoRobots = await request('/robots.txt', 'demo.example.test'); assert.equal(demoRobots.text, 'User-agent: *\nDisallow: /\n');
      const demoMap = await request('/sitemap.xml', 'demo.example.test'); assert.equal(demoMap.status, 404); assert.ok(!demoMap.text.includes(available.id));
      assert.match(String(demoMap.headers['x-robots-tag'] ?? ''), /noindex/);
      assert.equal((await request('/sitemap.xml', 'unknown.example.test')).status, 421);
    });
    await t.test('robots is dynamic and private shell paths get noindex even before tenancy rejects them', async () => {
      const robots = await request('/robots.txt'); assert.equal(robots.status, 200);
      assert.ok(robots.text.includes('Sitemap: https://a.example.test/sitemap.xml'));
      assert.ok(!robots.text.includes('b.example.test'));
      for (const path of ['/portal', '/portal/leads/123', '/sign-in/oauth', '/sign-up', '/saved', '/enquire', '/my-purchase/token']) {
        const response = await request(path); assert.match(String(response.headers['x-robots-tag'] ?? ''), /noindex/);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      assert.match(String((await request('/platform', 'admin.example.test')).headers['x-robots-tag'] ?? ''), /noindex/);
      assert.match(String((await request('/portal', 'unknown.example.test')).headers['x-robots-tag'] ?? ''), /noindex/);
      assert.equal((await request('/stock')).headers['x-robots-tag'], undefined);
    });
    assert.deepEqual((await db.select().from(vehiclesTable)).map(vehicle => ({ id: vehicle.id, updatedAt: vehicle.updatedAt, sourcePrice: vehicle.sourcePrice })), before);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await engine.close(); }
});

test('failed sitemap reads are retryable failures and missing scope never invokes the loader', async () => {
  let loads = 0;
  const app = express();
  app.use('/missing', createSeoRouter({ scope: () => null, load: async () => { loads++; return { vehicles: [] }; } }));
  app.use('/broken', createSeoRouter({ scope: () => ({ dealerId: 'fictional', origin: 'https://a.example.test', demo: false }), load: async () => { throw new Error('never-return-database-error'); } }));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
  try {
    const base = `http://127.0.0.1:${address.port}`;
    const missing = await fetch(`${base}/missing/sitemap.xml`); assert.equal(missing.status, 404); assert.equal(loads, 0);
    assert.equal(await (await fetch(`${base}/missing/robots.txt`)).text(), 'User-agent: *\nDisallow: /\n');
    const failed = await fetch(`${base}/broken/sitemap.xml`); assert.equal(failed.status, 503); assert.equal(failed.headers.get('retry-after'), '60');
    assert.ok(!(await failed.text()).includes('never-return'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
