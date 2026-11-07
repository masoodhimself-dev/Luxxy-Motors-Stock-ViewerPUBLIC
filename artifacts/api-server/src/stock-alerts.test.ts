import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import { eq } from 'drizzle-orm';
import { db, engine, stockAlertRateLimitsTable, stockAlertsTable } from './test/tenant-test-db';
import stockAlertsRouter from './routes/stock-alerts';
import { runWithTenant, type TenantContext } from './lib/tenant-context';

const localFetch = globalThis.fetch;
const tenant = (key: string): TenantContext => ({
  dealerId: key, canonicalOrigin: `https://${key}.example.test`,
  platform: 'autotrader', retailerId: key, sourceUrl: 'https://www.autotrader.co.uk/fictional',
  kind: 'website',
});
const a = tenant('alerts-a');
const b = tenant('alerts-b');
const emails: { text: string; to: string[] }[] = [];

test('stock alerts require confirmation, isolate dealers, preserve an active search until replacement and stop cleanly', async () => {
  process.env.NODE_ENV = 'test';
  process.env.MULTI_TENANT_ENABLED = 'false';
  process.env.STOCK_ALERT_TOKEN_SECRET = 'fictional-stock-alert-signing-only-for-isolated-tests';
  process.env.STOCK_ALERT_EMAIL_ENABLED = 'true';
  process.env.RESEND_ENABLED = 'true';
  process.env.RESEND_API_KEY = 're_fictional_stock_alert_test';
  process.env.RESEND_FROM_EMAIL = 'Dealer <stock@example.test>';
  const migrations = (await readdir('../../lib/db/drizzle')).filter(name => /^\d.*\.sql$/.test(name)).sort();
  for (const name of migrations) await engine.exec(await readFile('../../lib/db/drizzle/' + name, 'utf8'));

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.resend.com/emails');
    emails.push(JSON.parse(String(init?.body)));
    return Response.json({ id: `fixture-email-${emails.length}` });
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get('x-test-role');
    if (role === 'owner' || role === 'salesperson') req.staff = { authUserId: 'fictional-staff', email: null, name: null, role };
    runWithTenant(req.get('x-test-dealer') === 'b' ? b : a, next);
  });
  app.use(stockAlertsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const call = (path: string, body?: unknown, options: { method?: string; role?: string; dealer?: string; origin?: string } = {}) =>
    localFetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        ...(options.role ? { 'x-test-role': options.role } : {}),
        ...(options.dealer ? { 'x-test-dealer': options.dealer } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const readDemand = async (role: string, dealer?: string) => {
    const response = await call('/staff/stock-alerts', undefined, { role, dealer });
    assert.equal(response.status, 200);
    return await response.json() as { totalBuyers: number; searches: { label: string; buyers: number }[] };
  };
  const settingsPath = '/staff/stock-alerts/settings';
  const demandPath = '/staff/stock-alerts';
  const requestsPath = demandPath + '/requests';
  const readRequests = async (status: string, dealer?: string, page = 1) => {
    const response = await call(`${requestsPath}?status=${status}&page=${page}`, undefined, { role: 'salesperson', dealer });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return await response.json() as {
      items: { label: string; status: string; confirmedAt: string | null; expiresAt: string | null }[];
      page: number;
      hasMore: boolean;
    };
  };
  const buyer = 'driver@example.test';
  const criteria = { make: 'Toyota', maxPrice: '8000', transmission: 'Automatic' };
  const subscribe = (filters = criteria) => call('/stock-alerts', { email: buyer, filters });
  const lastToken = () => {
    const url = emails.at(-1)?.text.match(/https:\/\/[^\s]+\/stock-alerts\/confirm#[^\s]+/)?.[0];
    assert.ok(url);
    return new URLSearchParams(new URL(url).hash.slice(1)).get('token');
  };
  try {
    assert.equal((await call(demandPath)).status, 401);
    assert.equal((await call(requestsPath)).status, 401);
    assert.equal((await call(requestsPath + '?status=unknown', undefined, { role: 'owner' })).status, 400);
    assert.deepEqual(await (await call('/stock-alerts/status')).json(), { enabled: false });
    assert.equal((await call(settingsPath, { enabled: true }, { method: 'PUT', role: 'salesperson' })).status, 403);
    assert.equal((await call(settingsPath, { enabled: true }, { method: 'PUT', role: 'owner' })).status, 200);
    assert.equal((await call(settingsPath, { enabled: true }, { method: 'PUT', role: 'owner', dealer: 'b' })).status, 200);
    assert.deepEqual(await (await call('/stock-alerts/status')).json(), { enabled: true });
    assert.equal((await call('/stock-alerts', { email: buyer, filters: {} })).status, 400);
    assert.equal((await call('/stock-alerts', { email: buyer, filters: criteria }, { origin: b.canonicalOrigin })).status, 403);
    assert.equal((await subscribe()).status, 202);
    assert.equal((await subscribe()).status, 202);
    assert.equal(emails.length, 1);
    assert.deepEqual(emails[0].to, [buyer]);
    assert.equal((await readDemand('salesperson')).totalBuyers, 0);
    const pending = await readRequests('pending');
    assert.equal(pending.items.length, 1);
    assert.equal(pending.items[0].confirmedAt, null);
    assert.match(pending.items[0].label, /£8,000/);
    assert.ok(!JSON.stringify(pending).includes(buyer));
    assert.equal((await readRequests('all', 'b')).items.length, 0);
    const first = lastToken();
    assert.equal((await call('/stock-alerts/confirm', { token: first }, { dealer: 'b' })).status, 404);
    assert.equal((await call('/stock-alerts/confirm', { token: first })).status, 200);
    const demand = await readDemand('salesperson');
    assert.equal(demand.totalBuyers, 1);
    assert.equal(demand.searches[0].buyers, 1);
    assert.match(demand.searches[0].label, /£8,000/);
    assert.ok(!JSON.stringify(demand).includes(buyer));
    assert.equal((await readDemand('owner', 'b')).totalBuyers, 0);
    await db.update(stockAlertRateLimitsTable).set({ expiresAt: new Date(0) });
    assert.equal((await subscribe({ ...criteria, maxPrice: '10000' })).status, 202);
    assert.equal(emails.length, 2);
    const [before] = await db.select().from(stockAlertsTable);
    assert.equal(before.criteria.maxPrice, '8000');
    assert.match((await readRequests('active')).items[0].label, /£8,000/);
    assert.equal((await readRequests('pending')).items.length, 0);
    const next = lastToken();
    assert.notEqual(first, next);
    assert.equal((await call('/stock-alerts/confirm', { token: first })).status, 404);
    assert.equal((await call('/stock-alerts/confirm', { token: next })).status, 200);
    const [after] = await db.select().from(stockAlertsTable);
    assert.equal(after.criteria.maxPrice, '10000');
    assert.equal(after.expiresAt!.getTime() - after.confirmedAt!.getTime(), 60 * 24 * 60 * 60_000);

    const stopLink = emails.at(-1)?.text.match(/https:\/\/[^\s]+\/stock-alerts\/stop#[^\s]+/)?.[0];
    assert.ok(stopLink, 'buyers can stop an alert before the first digest');
    assert.match(emails.at(-1)!.text, /\/stock-alerts\/renew#/);
    const manage = new URLSearchParams(new URL(stopLink).hash.slice(1)).get('token');
    const day = 24 * 60 * 60_000;
    await db.update(stockAlertsTable).set({ expiresAt: new Date(Date.now() - day) }).where(eq(stockAlertsTable.id, after.id));
    assert.equal((await readRequests('expired')).items[0].status, 'expired');
    assert.equal((await call('/stock-alerts/renew', { token: manage })).status, 200);
    process.env.STOCK_ALERT_EMAIL_ENABLED = 'false';
    assert.equal((await call('/stock-alerts/stop', { token: manage })).status, 200);
    assert.equal((await call('/stock-alerts/stop', { token: manage })).status, 200);
    assert.equal((await readDemand('owner')).totalBuyers, 0);
    assert.equal((await readRequests('stopped')).items[0].status, 'stopped');

    await db.insert(stockAlertsTable).values(Array.from({ length: 26 }, (_, index) => ({
      dealerId: a.dealerId, email: `fixture-${index}@example.test`,
      criteria: { make: 'private-facet@example.test', search: 'private-keyword@example.test' },
      confirmedAt: new Date(), expiresAt: new Date(Date.now() + day),
    })));
    const firstPage = await readRequests('active');
    assert.equal(firstPage.items.length, 25);
    assert.equal(firstPage.hasMore, true);
    assert.equal((await readRequests('active', undefined, 2)).items.length, 1);
    assert.ok(!JSON.stringify(firstPage).includes('@example.test'));
    assert.match(firstPage.items[0].label, /Keyword search/);
  } finally {
    globalThis.fetch = localFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await engine.close();
  }
});
