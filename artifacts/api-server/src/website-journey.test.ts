import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import pino from 'pino';
import { engine, pool } from './test/tenant-test-db';
import { createWebsiteJourneyLimiter, parseWebsiteJourney, recordWebsiteJourney, websiteJourneyRange, websiteJourneyReport } from './lib/website-journey';
import { websiteJourneyRouter } from './routes/website-journey';
import { runWithTenant } from './lib/tenant-context';
import { isPrivateTestDriveDeclarationPath } from './middlewares/private-capability';

process.env.MULTI_TENANT_ENABLED = 'true';
const dealer = 'journey-fixture-a', other = 'journey-fixture-b';
const tenant = (id = dealer, demo = false) => ({ dealerId: id, canonicalOrigin: `https://${id}.example.test`, platform: 'cazoo' as const, retailerId: 'fixture', sourceUrl: 'https://example.test', kind: 'website' as const, demo });

test('journey requests accept only known stages and validate the bounded date range', () => {
  assert.equal(parseWebsiteJourney({ stage: 'vehicle' }), 'vehicle');
  for (const value of [null, [], 'vehicle', { stage: 'sold' }, { stage: 'enquiry', email: 'private@example.test' }, { stage: ['search'] }, { stage: 'vehicle', url: '/car/private' }])
    assert.throws(() => parseWebsiteJourney(value), /valid website event/);
  for (const range of [['2026-02-30', '2026-03-01'], ['2026-11-06', '2026-11-05'], ['2020-01-01', '2026-01-01'], [undefined, '2026-01-01']])
    assert.throws(() => websiteJourneyRange(range[0], range[1]), /valid reporting period/);
  assert.deepEqual(websiteJourneyRange('2026-11-01', '2026-11-30'), { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(isPrivateTestDriveDeclarationPath('/api/website-journey'), true);
});

test('short-lived limiter separates tenants and client connections, expires, and remains bounded', () => {
  let now = 1000;
  const allow = createWebsiteJourneyLimiter({ now: () => now, maximum: 2, lifetimeMs: 100, maxBuckets: 2 });
  assert.equal(allow(dealer, 'same-connection'), true); assert.equal(allow(dealer, 'same-connection'), true); assert.equal(allow(dealer, 'same-connection'), false);
  assert.equal(allow(other, 'same-connection'), true); assert.equal(allow(dealer, 'another-connection'), false);
  now = 1100; assert.equal(allow(dealer, 'another-connection'), true); assert.equal(allow(dealer, 'same-connection'), true);
});

test('aggregate events remain tenant isolated and HTTP collection cannot accept customer data', async t => {
  await engine.exec(await readFile('../../lib/db/drizzle/0088_website_journey_daily.sql', 'utf8'));
  await t.test('atomic counters retain only four aggregate columns and use the London calendar date', async () => {
    await Promise.all(Array.from({ length: 20 }, () => recordWebsiteJourney(pool, dealer, 'search', new Date('2026-11-06T10:00:00Z'))));
    await recordWebsiteJourney(pool, dealer, 'vehicle', new Date('2026-06-01T23:30:00Z'));
    await recordWebsiteJourney(pool, other, 'enquiry', new Date('2026-11-06T10:00:00Z'));
    const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='website_journey_daily' ORDER BY ordinal_position");
    assert.deepEqual(columns.rows.map(row => row.column_name), ['dealer_id', 'day', 'stage', 'event_count']);
    const report = await websiteJourneyReport(pool, dealer, '2026-11-05', '2026-11-07');
    assert.equal(report.totals.search, 20); assert.equal(report.totals.enquiry, 0); assert.equal(report.days.length, 3);
    assert.equal(report.days[0].search, 0); assert.equal(report.days[1].search, 20);
    assert.equal((await websiteJourneyReport(pool, dealer, '2026-06-02', '2026-06-02')).totals.vehicle, 1);
    assert.equal((await websiteJourneyReport(pool, other, '2026-11-06', '2026-11-06')).totals.enquiry, 1);
  });
  const app = express();
  app.set('env', 'test');
  app.use(express.json({ limit: '128b', strict: true }));
  app.use((req, _res, next) => {
    req.log = pino({ level: 'silent' });
    const role = req.get('x-test-role');
    if (role) req.staff = { authUserId: 'fixture-user', name: 'Fixture owner', email: null, role: role as 'owner' };
    runWithTenant(tenant(req.get('x-test-dealer') === other ? other : dealer, req.get('x-test-demo') === 'yes'), next);
  });
  app.use('/api', websiteJourneyRouter(pool));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const collect = (body: string, headers: Record<string, string> = {}) => fetch(`${base}/website-journey`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: tenant().canonicalOrigin, ...headers }, body });
  try {
    await t.test('same-origin collection records only valid events, honours privacy settings, and ignores demonstrations', async () => {
      assert.equal((await collect('{"stage":"vehicle"}')).status, 204);
      const before = (await pool.query('SELECT coalesce(sum(event_count),0)::int AS count FROM website_journey_daily')).rows[0].count;
      assert.equal((await collect('{"stage":"vehicle"}', { Origin: 'https://other.example.test' })).status, 403);
      assert.equal((await fetch(`${base}/website-journey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"stage":"vehicle"}' })).status, 403);
      assert.equal((await collect('{"stage":"vehicle","email":"private@example.test"}')).status, 400);
      assert.equal((await collect('{"stage":"vehicle"}', { DNT: '1' })).status, 204);
      assert.equal((await collect('{"stage":"vehicle"}', { 'Sec-GPC': '1' })).status, 204);
      assert.equal((await collect('{"stage":"vehicle"}', { 'x-test-demo': 'yes' })).status, 204);
      assert.equal((await pool.query('SELECT coalesce(sum(event_count),0)::int AS count FROM website_journey_daily')).rows[0].count, before);
      assert.equal((await collect(' '.repeat(140) + '{"stage":"vehicle"}')).status, 413);
    });
    await t.test('only the dealership owner can read bounded event reports', async () => {
      const url = `${base}/staff/website-journey?from=2026-11-01&to=2026-11-30`;
      assert.equal((await fetch(url)).status, 401);
      for (const role of ['salesperson', 'accounts']) assert.equal((await fetch(url, { headers: { 'x-test-role': role } })).status, 403);
      const response = await fetch(url, { headers: { 'x-test-role': 'owner' } }); assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control')!, /no-store/);
      const report = await response.json() as Awaited<ReturnType<typeof websiteJourneyReport>>; assert.equal(report.totals.search, 20); assert.equal(report.totals.enquiry, 0);
      assert.ok(!JSON.stringify(report).includes(other));
      const privateReport = await fetch(url, { headers: { 'x-test-role': 'owner', 'x-test-dealer': other } });
      assert.equal((await privateReport.json() as Awaited<ReturnType<typeof websiteJourneyReport>>).totals.enquiry, 1);
      assert.equal((await fetch(`${base}/staff/website-journey?from=2020-01-01&to=2026-11-30`, { headers: { 'x-test-role': 'owner' } })).status, 400);
    });
    await t.test('collection is rate limited without storing connection or visitor details', async () => {
      const statuses = [];
      for (let i = 0; i < 41; i++) statuses.push((await collect('{"stage":"search"}')).status);
      assert.ok(statuses.includes(429));
      const stored = await pool.query('SELECT * FROM website_journey_daily');
      assert.ok(stored.rows.every(row => Object.keys(row).length === 4));
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await engine.close();
  }
});
