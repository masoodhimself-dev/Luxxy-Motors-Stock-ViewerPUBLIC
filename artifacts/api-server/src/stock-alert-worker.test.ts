import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import {
  db, engine, dealershipsTable, dealerSettingsTable, stockAlertsTable,
  stockAlertDeliveriesTable, stockAlertSettingsTable, vehiclesTable,
} from './test/tenant-test-db';
import { dealerIntegrationsStore } from './lib/dealer-integrations-store';
import { processStockAlertDigests } from './lib/stock-alert-worker';
import { runWithTenant, type TenantContext } from './lib/tenant-context';

test('stock digests only send new, available matches and preserve their delivery identity on concurrent checks and retries', async () => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString('base64');
  process.env.STOCK_ALERT_EMAIL_ENABLED = 'true';
  process.env.STOCK_ALERT_TOKEN_SECRET = 'test-stock-alert-key-longer-than-32-characters';
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('External delivery is forbidden in this test'); };
  const dealer: TenantContext = {
    dealerId: 'stock-alert-dealer-a',
    canonicalOrigin: 'https://dealer-a.example.test',
    platform: 'autotrader',
    retailerId: 'fixture-a',
    sourceUrl: 'https://www.autotrader.co.uk/fixture-a',
  };
  const other: TenantContext = { ...dealer, dealerId: 'stock-alert-dealer-b', canonicalOrigin: 'https://dealer-b.example.test', retailerId: 'fixture-b' };
  const sent: { key: string | null; body: string }[] = [];
  let failNext = false;
  const transport: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    sent.push({ key: new Headers(init?.headers).get('idempotency-key'), body: String(init?.body) });
    if (failNext) {
      failNext = false;
      throw new Error('Provider acceptance is uncertain');
    }
    return Response.json({ id: 'fixture-delivery-' + sent.length });
  };

  try {
    for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d.*\.sql$/.test(name)).sort()) {
      await engine.exec(await readFile('../../lib/db/drizzle/' + file, 'utf8'));
    }
    for (const tenant of [dealer, other]) {
      await db.insert(dealershipsTable).values({
        id: tenant.dealerId, name: 'Fixture Showroom', status: 'active',
        canonicalOrigin: tenant.canonicalOrigin, stockPlatform: tenant.platform,
        retailerId: tenant.retailerId, sourceUrl: tenant.sourceUrl,
      });
      await db.insert(dealerSettingsTable).values({ dealerId: tenant.dealerId, config: { identity: { name: 'Fixture Showroom' } } });
      await db.insert(stockAlertSettingsTable).values({ dealerId: tenant.dealerId, enabled: true });
      await runWithTenant(tenant, () => dealerIntegrationsStore.update({
        expectedRevision: 0,
        resend: { enabled: true, apiKey: 're_fictional_' + tenant.retailerId, from: 'Showroom <stock@example.test>', replyTo: 'stock@example.test' },
      }));
    }
    const confirmedAt = new Date('2026-11-07T09:00:00Z');
    const dayOne = new Date('2026-11-08T09:00:00Z');
    const dayTwo = new Date('2026-11-09T09:00:00Z');
    const criteria = { make: 'toyota', transmission: 'automatic', maxPrice: '8000' };
    const [alert] = await db.insert(stockAlertsTable).values({
      dealerId: dealer.dealerId, email: 'buyer@example.test', criteria, requestedAt: confirmedAt, confirmedAt,
      expiresAt: new Date('2027-01-06T09:00:00Z'), nextCheckAt: dayOne,
    }).returning();
    await db.insert(stockAlertsTable).values({
      dealerId: dealer.dealerId, email: 'pending@example.test', criteria, requestedAt: confirmedAt,
      expiresAt: new Date('2027-01-06T09:00:00Z'), nextCheckAt: dayOne,
    });
    const addCar = async (tenant: TenantContext, model: string, firstSeenAt: string, extra: Partial<typeof vehiclesTable.$inferInsert> = {}) => {
      const [car] = await db.insert(vehiclesTable).values({
        dealerId: tenant.dealerId, source: tenant.platform, advertId: model,
        make: 'Toyota', model, title: 'Toyota ' + model, sourcePrice: 7000,
        transmission: 'Automatic', sourceHeroImage: 'https://images.example.test/car.jpg',
        firstSeenAt: new Date(firstSeenAt), ...extra,
      }).returning();
      return car;
    };
    const first = await addCar(dealer, 'Yaris', '2026-11-07T10:00:00Z');
    await addCar(dealer, 'Older', '2026-11-07T08:00:00Z');
    await addCar(dealer, 'Reserved', '2026-11-07T10:00:00Z', { inventoryStatus: 'reserved' });
    await addCar(dealer, 'Manual', '2026-11-07T10:00:00Z', { transmission: 'Manual' });
    await addCar(other, 'Other tenant', '2026-11-07T10:00:00Z');

    const check = (now: Date) => runWithTenant(dealer, () => processStockAlertDigests({ now, transport }));
    await Promise.all([check(dayOne), check(dayOne)]);
    assert.equal(sent.length, 1);
    const firstEmail = JSON.parse(sent[0].body);
    assert.deepEqual(firstEmail.to, ['buyer@example.test']);
    assert.match(firstEmail.html, /Toyota Yaris/);
    assert.match(firstEmail.html, /£7,000/);
    assert.match(firstEmail.html, /https:\/\/dealer-a.example.test\/stock-alerts\/stop#token=/);
    assert.doesNotMatch(firstEmail.html, /Toyota (Older|Reserved|Manual|Other tenant)/);
    const firstDelivery = (await db.select().from(stockAlertDeliveriesTable).where(eq(stockAlertDeliveriesTable.alertId, alert.id)))[0];
    assert.equal(firstDelivery.status, 'sent');
    assert.deepEqual(firstDelivery.vehicleIds, [first.id]);
    assert.equal(firstDelivery.payload, null);

    const second = await addCar(dealer, 'Corolla', '2026-11-08T10:00:00Z');
    failNext = true;
    await check(dayTwo);
    assert.equal(sent.length, 2);
    assert.match(sent[1].body, /Toyota Corolla/);
    assert.doesNotMatch(sent[1].body, /Toyota Yaris/);
    await check(new Date('2026-11-09T09:05:01Z'));
    assert.equal(sent.length, 3);
    assert.deepEqual(sent[2], sent[1]);
    const history = await db.select().from(stockAlertDeliveriesTable).where(eq(stockAlertDeliveriesTable.alertId, alert.id));
    assert.equal(history.length, 2);
    assert.deepEqual(history.find(row => row.digestDate === '2026-11-09')?.vehicleIds, [second.id]);
    assert.ok(history.every(row => row.status === 'sent' && row.payload === null));
  } finally {
    globalThis.fetch = before;
    await engine.close();
  }
});
