import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import type { SaleWorkspaceDatabase } from './lib/sale-workspace-store';
import type { StripeSettings } from './lib/dealer-integrations-store';
import type { StripeReservationRecord } from './lib/stripe-reservation-store';
import {
  createStripeReservation, expireAbandonedStripeReservations, processStripeReservationEvent, readCustomerStripeStatus,
} from './lib/stripe-reservation-store';
import type { StripeEvent } from './lib/stripe-payments';
import { runWithTenant } from './lib/tenant-context';

const dealerId = 'example-dealer';
const site = 'https://example.test';
const tenant = { dealerId, canonicalOrigin: site, platform: 'cazoo' as const, retailerId: '1', sourceUrl: site };
const terms = 'Test terms. This reservation is fully refundable.';
const settings: StripeSettings = { enabled: true, mode: 'live', publishableKey: '', secretKey: 'rk_live_syntheticTestOnly', webhookSecret: 'whsec_syntheticTestOnly' };
const sessionId = 'cs_live_synthetic';
const paymentIntent = 'pi_synthetic';

async function fixture() {
  const engine = new PGlite();
  await engine.exec(`
    CREATE TABLE vehicles (id uuid primary key, dealer_id text, source text, inventory_status text, source_status text,
      archived_at timestamptz, missing_count int, currency text, source_price int, website_price_override int,
      title text, registration text, audit_metadata jsonb, updated_at timestamptz);
    CREATE TABLE leads (id uuid primary key, dealer_id text, vehicle_id uuid, vehicle_title text,
      vehicle_registration text, vehicle_price numeric, stage text, source text, customer_name text, email text,
      phone text, preferred_contact text, summary text, next_action text, next_action_due_at timestamptz,
      created_at timestamptz DEFAULT now(), updated_at timestamptz);
    CREATE TABLE lead_events (id uuid DEFAULT gen_random_uuid() primary key, lead_id uuid, type text, actor_type text, body text, payload jsonb);
    CREATE TABLE sales (id uuid, dealer_id text, vehicle_id uuid, status text);
    CREATE TABLE sale_workspace (id uuid, dealer_id text, state jsonb);
  `);
  const vehicleId = randomUUID();
  await engine.query("INSERT INTO vehicles (id,dealer_id,source,inventory_status,source_status,missing_count,currency,source_price,title,registration,audit_metadata) VALUES ($1,$2,'cazoo','available','live',0,'GBP',15900,'Example car','AB22 CDE','{\"existing\":true}')", [vehicleId, dealerId]);
  const query: SaleWorkspaceDatabase['query'] = (sql, params) => engine.query(sql, params);
  const database: SaleWorkspaceDatabase = { query, connect: async () => ({ query, release() {} }) };
  const input = { vehicleId, idempotencyKey: randomUUID(), customerName: 'Test Buyer', email: 'buyer@example.test', phone: '07700900123', expectedPricePence: 1_590_000, expectedDepositPence: 9_900, terms, termsAccepted: true };
  function checkout(transport: typeof fetch, override = {}, stripe = settings) {
    return runWithTenant(tenant, () => createStripeReservation({ ...input, ...override }, dealerId, stripe, { terms }, { database, transport, readStockPlatform: async () => 'cazoo' }));
  }
  async function current() {
    const result = await engine.query<{ reservation: StripeReservationRecord }>("SELECT payload->'reservation' AS reservation FROM lead_events WHERE payload->>'kind'='online_stripe_reservation'");
    return result.rows[0]?.reservation;
  }
  async function vehicle() {
    return (await engine.query<{ inventory_status: string; audit_metadata: Record<string, unknown> }>('SELECT inventory_status,audit_metadata FROM vehicles WHERE id=$1', [vehicleId])).rows[0]!;
  }
  async function expireAtPast() {
    await engine.query("UPDATE lead_events SET payload=jsonb_set(payload,'{reservation,expiresAt}',to_jsonb($1::text)) WHERE payload->>'kind'='online_stripe_reservation'", [new Date(Date.now() - 1000).toISOString()]);
  }
  return { engine, database, input, checkout, current, vehicle, expireAtPast };
}

const checkoutResponse = () => new Response(JSON.stringify({ id: sessionId, url: 'https://checkout.stripe.com/c/pay/synthetic', livemode: true }));
const openCheckout: typeof fetch = async () => checkoutResponse();
function checkoutObject(record: StripeReservationRecord, status: 'complete' | 'expired') {
  return { id: sessionId, livemode: true, mode: 'payment', status, payment_status: status === 'complete' ? 'paid' : 'unpaid',
    amount_total: 9_900, currency: 'gbp', payment_intent: status === 'complete' ? paymentIntent : null,
    client_reference_id: record.id, metadata: { dealer_id: dealerId, reservation_id: record.id, vehicle_id: record.vehicleId } };
}
function providerEvent(type: string, object: Record<string, unknown>, created = 1): StripeEvent {
  return { id: `evt_${randomUUID().replaceAll('-', '')}`, type, livemode: true, created, data: { object } };
}

test('checkout validates current terms and stock and creates exactly one idempotent £99 hold', async () => {
  const f = await fixture();
  try {
    let providerCalls = 0;
    const transport: typeof fetch = async (url, init) => {
      providerCalls++;
      assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('line_items[0][price_data][unit_amount]'), '9900');
      assert.equal(body.get('line_items[0][price_data][currency]'), 'gbp');
      assert.equal(body.get('payment_intent_data[metadata][dealer_id]'), dealerId);
      assert.equal(body.get('metadata[vehicle_id]'), f.input.vehicleId);
      const success = new URL(body.get('success_url')!);
      assert.equal(success.pathname, '/reservation-payment');
      assert.equal(success.search, '');
      assert.match(success.hash, /token=[a-f0-9]{64}$/);
      assert.match(body.get('cancel_url')!, /&cancelled=1$/);
      return checkoutResponse();
    };
    await assert.rejects(f.checkout(transport, { expectedDepositPence: 9000 }), /terms have changed/);
    await assert.rejects(f.checkout(transport, { terms: 'Stale terms' }), /terms have changed/);
    await assert.rejects(f.checkout(transport, { expectedPricePence: 1_490_000 }), /price has changed/);
    await assert.rejects(f.checkout(transport, {}, { ...settings, enabled: false }), /setup is being completed/);
    await f.engine.query('UPDATE vehicles SET archived_at=now()');
    await assert.rejects(f.checkout(transport), /no longer available/);
    await f.engine.query('UPDATE vehicles SET archived_at=NULL');
    assert.equal(providerCalls, 0);
    const created = await f.checkout(transport);
    const retry = await f.checkout(transport);
    assert.equal(created.replayed, false);
    assert.equal(retry.replayed, true);
    assert.equal(retry.checkoutUrl, created.checkoutUrl);
    assert.equal(providerCalls, 1);
    assert.equal(created.reservation.amountReceivedPence, 0);
    assert.equal(created.reservation.status, 'awaiting_payment');
    assert.deepEqual(await f.vehicle(), { inventory_status: 'reserved', audit_metadata: { existing: true, onlineStripeReservationId: created.reservation.id } });
    await assert.rejects(f.checkout(transport, { customerName: 'Another Buyer' }), /different details/);
    await assert.rejects(f.checkout(transport, { idempotencyKey: randomUUID() }), /no longer available/);

    const record = (await f.current())!;
    const capability = new URLSearchParams(new URL(record.checkoutUrls!.success).hash.slice(1)).get('token')!;
    const status = await readCustomerStripeStatus(dealerId, record.reference, capability, f.database);
    assert.deepEqual(status, created.reservation);
    for (const secret of [record.email, record.customerName, record.phone, record.idempotencyKey, sessionId, capability]) {
      assert.equal(JSON.stringify(status).includes(secret), false);
    }
    await assert.rejects(readCustomerStripeStatus('other-dealer', record.reference, capability, f.database), /unavailable/);
    await assert.rejects(readCustomerStripeStatus(dealerId, record.reference, 'f'.repeat(64), f.database), /unavailable/);
  } finally { await f.engine.close(); }
});

test('first definite failure releases its hold, but an ambiguous retry cannot release it without provider evidence', async () => {
  const f = await fixture();
  try {
    const rejection: typeof fetch = async () => new Response('{}', { status: 400 });
    await assert.rejects(f.checkout(rejection), /could not prepare checkout/);
    assert.equal((await f.current())?.status, 'cancelled');
    assert.deepEqual(await f.vehicle(), { inventory_status: 'available', audit_metadata: { existing: true } });
    const nextKey = randomUUID();
    let originalBody: string | undefined;
    let originalKey: string | undefined;
    const lostResponse: typeof fetch = async (_url, init) => {
      originalBody = String(init?.body);
      originalKey = new Headers(init?.headers).get('Idempotency-Key') ?? undefined;
      throw new Error('Response lost');
    };
    await assert.rejects(f.checkout(lostResponse, { idempotencyKey: nextKey }), /could not be reached/);
    const retry: typeof fetch = async (_url, init) => {
      assert.equal(String(init?.body), originalBody);
      assert.equal(new Headers(init?.headers).get('Idempotency-Key'), originalKey);
      return rejection(_url, init);
    };
    await assert.rejects(f.checkout(retry, { idempotencyKey: nextKey }), /could not prepare checkout/);
    assert.equal((await f.vehicle()).inventory_status, 'reserved');
  } finally { await f.engine.close(); }
});

test('expiry recovers the original Stripe session and clears only its own verified unpaid hold', async () => {
  const f = await fixture();
  try {
    let originalBody: string | undefined;
    let originalKey: string | undefined;
    const lostResponse: typeof fetch = async (_url, init) => {
      originalBody = String(init?.body);
      originalKey = new Headers(init?.headers).get('Idempotency-Key') ?? undefined;
      throw new Error('Response lost');
    };
    await assert.rejects(f.checkout(lostResponse), /could not be reached/);
    // Move the database's due selection forward without changing the Checkout request fields.
    const futureDueQuery: SaleWorkspaceDatabase['query'] = (sql, params) => f.database.query(sql,
      sql.includes("->>'expiresAt')::timestamptz <=") ? [...params!.slice(0, 4), new Date(Date.now() + 32 * 60_000).toISOString()] : params);
    const database = { ...f.database, query: futureDueQuery };
    const record = (await f.current())!;
    const recover: typeof fetch = async (url, init) => {
      if (init?.method === 'POST') {
        assert.equal(String(init.body), originalBody);
        assert.equal(new Headers(init.headers).get('Idempotency-Key'), originalKey);
        return checkoutResponse();
      }
      assert.equal(url, `https://api.stripe.com/v1/checkout/sessions/${sessionId}`);
      return new Response(JSON.stringify(checkoutObject(record, 'expired')));
    };
    assert.equal(await expireAbandonedStripeReservations(dealerId, settings, { database, transport: recover }), 1);
    assert.equal((await f.current())?.status, 'expired');
    assert.deepEqual(await f.vehicle(), { inventory_status: 'available', audit_metadata: { existing: true } });
  } finally { await f.engine.close(); }
});

test('Stripe paid status without a signed completion never writes money or releases the hold', async () => {
  const f = await fixture();
  try {
    await f.checkout(openCheckout);
    await f.expireAtPast();
    const record = (await f.current())!;
    const paid = async () => new Response(JSON.stringify(checkoutObject(record, 'complete')));
    assert.equal(await expireAbandonedStripeReservations(dealerId, settings, { database: f.database, transport: paid }), 0);
    assert.equal((await f.current())?.needsReview, true);
    assert.equal((await f.current())?.amountReceivedPence, 0);
    assert.equal((await f.vehicle()).inventory_status, 'reserved');
  } finally { await f.engine.close(); }
});

test('a signed payment confirms one deposit and only a succeeded refund books the full £99', async () => {
  const f = await fixture();
  try {
    await f.checkout(openCheckout);
    const record = (await f.current())!;
    const received: number[] = [];
    const refunded: number[] = [];
    const services = {
      database: f.database,
      channel: 'public-v1' as const,
      depositRecorder: async (input: { amountPence: number }) => {
        received.push(input.amountPence);
        return { id: randomUUID() } as SaleWorkspaceRecord;
      },
      refundRecorder: async (input: { amountRefundedPence: number }) => {
        refunded.push(input.amountRefundedPence);
        return {} as SaleWorkspaceRecord;
      },
    };
    const event = providerEvent('checkout.session.completed', checkoutObject(record, 'complete'));
    await assert.rejects(processStripeReservationEvent({ ...event, data: { object: { ...event.data.object, amount_total: 9_899 } } }, dealerId, settings, services), /does not match/);
    assert.equal(await processStripeReservationEvent(event, dealerId, settings, { ...services, channel: 'historical' }), undefined);
    assert.deepEqual(received, []);
    await processStripeReservationEvent(event, dealerId, settings, services);
    await processStripeReservationEvent(event, dealerId, settings, services);
    await processStripeReservationEvent(providerEvent('checkout.session.completed', event.data.object), dealerId, settings, services);
    assert.deepEqual(received, [9_900]);
    assert.equal((await f.current())?.paymentStatus, 'confirmed');
    assert.deepEqual(await f.vehicle(), { inventory_status: 'reserved', audit_metadata: { existing: true } });
    const refund = { id: 're_synthetic', currency: 'gbp', payment_intent: paymentIntent, amount: 9_900 };
    await processStripeReservationEvent(providerEvent('refund.created', { ...refund, status: 'pending' }, 2), dealerId, settings, services);
    assert.equal((await f.current())?.paymentStatus, 'refund_pending');
    assert.deepEqual(refunded, []);
    await processStripeReservationEvent(providerEvent('refund.updated', { ...refund, status: 'succeeded' }, 3), dealerId, settings, services);
    await processStripeReservationEvent(providerEvent('charge.refunded', { currency: 'gbp', payment_intent: paymentIntent, amount: 9_900, amount_refunded: 9_900 }, 4), dealerId, settings, services);
    assert.deepEqual(refunded, [9_900]);
    assert.equal((await f.current())?.paymentStatus, 'refunded');
    assert.equal((await f.vehicle()).inventory_status, 'reserved');
  } finally { await f.engine.close(); }
});

test('a verified payment with a changed hold is flagged for review and never claims the other reservation', async () => {
  const f = await fixture();
  try {
    await f.checkout(openCheckout);
    const record = (await f.current())!;
    await f.engine.query("UPDATE vehicles SET audit_metadata=jsonb_build_object('onlineStripeReservationId',$1::text)", ['someone-else']);
    const event = providerEvent('checkout.session.completed', checkoutObject(record, 'complete'));
    const services = { database: f.database, channel: 'public-v1' as const, depositRecorder: async () => { throw new Error('Must not write a deposit against another hold'); } };
    await processStripeReservationEvent(event, dealerId, settings, services);
    assert.equal((await f.current())?.needsReview, true);
    assert.equal((await f.current())?.amountReceivedPence, 0);
    assert.deepEqual(await f.vehicle(), { inventory_status: 'reserved', audit_metadata: { onlineStripeReservationId: 'someone-else' } });
  } finally { await f.engine.close(); }
});

async function seedHistoricPayment(f: Awaited<ReturnType<typeof fixture>>) {
  await f.engine.query('INSERT INTO sale_workspace(id,dealer_id,state) VALUES($1::uuid,$2,$3::jsonb)', [randomUUID(), dealerId,
    JSON.stringify({ draft: { vehicleId: f.input.vehicleId }, payments: [{ id: randomUUID(), status: 'confirmed', signedAmountPence: 50000 }] })]);
}

test('a historical paid draft blocks public checkout before contacting Stripe', async () => {
  const f = await fixture();
  try {
    await seedHistoricPayment(f);
    let attempts = 0;
    await assert.rejects(f.checkout(async () => { attempts++; return checkoutResponse(); }), /already being purchased or reserved/);
    assert.equal(attempts, 0);
    assert.equal(await f.current(), undefined);
    assert.equal((await f.vehicle()).inventory_status, 'available');
  } finally { await f.engine.close(); }
});

test('a paid checkout with a newly found historical sale requires verified full refund before releasing its hold', async () => {
  const f = await fixture();
  try {
    await f.checkout(openCheckout);
    const record = (await f.current())!;
    await seedHistoricPayment(f);
    await assert.rejects(f.checkout(openCheckout), /already being purchased or reserved/);
    const services = { database: f.database, channel: 'public-v1' as const,
      depositRecorder: async () => { throw new Error('Must not allocate the conflicting payment'); },
      refundRecorder: async () => { throw new Error('Must not book the unallocated refund in a sale ledger'); },
    };
    const process = (event: StripeEvent) => processStripeReservationEvent(event, dealerId, settings, services);
    const completion = providerEvent('checkout.session.completed', checkoutObject(record, 'complete'));
    await process(completion);
    await process(completion);
    await process(providerEvent('checkout.session.completed', completion.data.object));
    assert.equal((await f.current())?.needsReview, true);
    assert.deepEqual((await f.current())?.stockConflictPayment, { paymentIntentId: paymentIntent, amountPence: 9900 });
    assert.equal((await f.current())?.amountReceivedPence, 0);
    assert.equal((await f.current())?.saleId, undefined);
    await assert.rejects(f.checkout(openCheckout), /checkout has closed/i);
    await process(providerEvent('checkout.session.expired', checkoutObject(record, 'expired')));
    assert.equal((await f.vehicle()).audit_metadata.onlineStripeReservationId, record.id);
    const firstRefund = providerEvent('refund.updated', { id: 're_fixtureFirst', currency:'gbp', payment_intent:paymentIntent, amount:5000, status:'succeeded' }, 2);
    await process(firstRefund);
    assert.equal((await f.vehicle()).audit_metadata.onlineStripeReservationId, record.id);
    assert.equal((await f.current())?.needsReview, true);
    const finalRefund = providerEvent('refund.updated', { id: 're_fixtureFinal', currency:'gbp', payment_intent:paymentIntent, amount:4900, status:'succeeded' }, 3);
    await process(finalRefund);
    await process(finalRefund);
    await process(providerEvent('refund.updated', finalRefund.data.object, 4));
    assert.equal((await f.current())?.paymentStatus, 'refunded');
    assert.equal((await f.current())?.amountRefundedPence, 9900);
    assert.equal((await f.current())?.needsReview, false);
    assert.equal((await f.current())?.saleId, undefined);
    assert.deepEqual(await f.vehicle(), { inventory_status: 'available', audit_metadata: { existing: true } });
  } finally { await f.engine.close(); }
});

test('a verified refund for a conflicting payment preserves a different checkout hold', async () => {
  const f = await fixture();
  try {
    await f.checkout(openCheckout);
    const record = (await f.current())!;
    await seedHistoricPayment(f);
    const services = { database: f.database, channel:'public-v1' as const };
    await processStripeReservationEvent(providerEvent('checkout.session.completed', checkoutObject(record, 'complete')), dealerId, settings, services);
    await f.engine.query("UPDATE vehicles SET audit_metadata=jsonb_build_object('onlineStripeReservationId','different-checkout')");
    const refund = providerEvent('refund.updated', { id:'re_fixtureFull', currency:'gbp', payment_intent:paymentIntent, amount:9900, status:'succeeded' }, 2);
    const result = await processStripeReservationEvent(refund, dealerId, settings, services);
    assert.equal(result?.amountRefundedPence, 9900);
    assert.equal(result?.saleId, undefined);
    assert.deepEqual(await f.vehicle(), { inventory_status:'reserved', audit_metadata:{ onlineStripeReservationId:'different-checkout' } });
  } finally { await f.engine.close(); }
});
