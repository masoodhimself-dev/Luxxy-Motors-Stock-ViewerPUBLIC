import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import { engine } from './test/tenant-test-db';
import dealerSettings, { defaultSettings } from './routes/dealer-settings';
import stripeReservations from './routes/stripe-reservations';
import { publicReservationTerms } from './lib/public-reservation-config';
import { runWithTenant, type TenantContext } from './lib/tenant-context';

test('the dealer can pause new public checkouts without changing website settings or payment verification', async () => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.MULTICHOICE_RESERVATIONS_ENABLED = 'true';
  process.env.MULTICHOICE_RESERVATION_STRIPE_KEY = 'rk_live_FictionalKey';
  process.env.MULTICHOICE_RESERVATION_STRIPE_WEBHOOK_SECRET = 'whsec_FictionalSigningSecret';

  const migrations = (await readdir('../../lib/db/drizzle')).filter(name => /^\d.*\.sql$/.test(name)).sort();
  for (const name of migrations) await engine.exec(await readFile('../../lib/db/drizzle/' + name, 'utf8'));

  const dealer: TenantContext = {
    dealerId: 'reservation-fixture', canonicalOrigin: 'https://multichoicemotors.co.uk',
    platform: 'cazoo', retailerId: 'fixture', sourceUrl: 'https://example.test', kind: 'website',
  };
  const otherDealer = { ...dealer, dealerId: 'other-reservation-fixture', canonicalOrigin: 'https://other.example.test' };
  await engine.query('INSERT INTO dealer_settings(dealer_id, config) VALUES ($1, $2::jsonb), ($3, $2::jsonb)',
    [dealer.dealerId, JSON.stringify(defaultSettings), otherDealer.dealerId]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get('x-test-role');
    if (role === 'owner' || role === 'salesperson') req.staff = { authUserId: 'fixture-staff', name: 'Fixture staff', email: null, role };
    runWithTenant(req.get('x-test-dealer') === 'other' ? otherDealer : dealer, next);
  });
  app.use(dealerSettings, stripeReservations);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const call = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        method, headers: { 'content-type': 'application/json', origin: dealer.canonicalOrigin, 'x-test-role': 'owner', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const settings = '/staff/reservations/settings';
    const readiness = '/reservations/payment-readiness';
    const activeReadiness = { enabled: true, depositPence: 9900, terms: publicReservationTerms };
    const checkout = '/reservations/checkout';
    assert.deepEqual(await (await call(settings)).json(), { enabled: false, supported: true, paymentReady: true });
    assert.deepEqual(await (await call(readiness)).json(), { enabled: false });
    assert.equal((await call(checkout, 'POST', {})).status, 503);
    assert.equal((await call(settings, 'PUT', { enabled: true }, { 'x-test-role': 'salesperson' })).status, 403);
    assert.equal((await call(settings, 'PUT', { enabled: true }, { origin: otherDealer.canonicalOrigin })).status, 403);
    assert.equal((await call(settings, 'PUT', { enabled: 'true' })).status, 400);

    const on = await call(settings, 'PUT', { enabled: true });
    assert.equal(on.status, 200, await on.clone().text());
    assert.deepEqual(await on.json(), { enabled: true, supported: true, paymentReady: true });
    assert.deepEqual(await (await call(readiness)).json(), activeReadiness);
    assert.equal((await call(checkout, 'POST', {})).status, 400);
    assert.deepEqual(await (await call(settings, 'GET', undefined, { 'x-test-dealer': 'other' })).json(), {
      enabled: false, supported: false, paymentReady: false,
    });
    assert.deepEqual(await (await call(readiness, 'GET', undefined, { 'x-test-dealer': 'other' })).json(), { enabled: false });

    const publicSettings = await call('/dealer-settings');
    const config = await publicSettings.json();
    assert.ok(config && typeof config === 'object');
    assert.equal(Object.hasOwn(config, 'publicOnlineReservations'), false);
    const published = await call('/dealer-settings', 'PATCH', defaultSettings, {
      'if-match': publicSettings.headers.get('etag') ?? '',
    });
    assert.equal(published.status, 200, await published.clone().text());
    assert.deepEqual(await (await call(readiness)).json(), activeReadiness);

    const off = await call(settings, 'PUT', { enabled: false });
    assert.equal(off.status, 200, await off.clone().text());
    assert.deepEqual(await off.json(), { enabled: false, supported: true, paymentReady: true });
    assert.deepEqual(await (await call(readiness)).json(), { enabled: false });
    assert.equal((await call(checkout, 'POST', {})).status, 503);
    // The webhook still reaches signature verification instead of an availability error.
    assert.equal((await call('/reservations/stripe/live-webhook', 'POST', {})).status, 400);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await engine.close();
  }
});
