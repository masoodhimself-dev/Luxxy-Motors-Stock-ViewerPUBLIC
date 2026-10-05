import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import type { SaleWorkspaceDatabase } from './lib/sale-workspace-store';
import type { StripeReservationRecord } from './lib/stripe-reservation-store';
// The injectable database below owns every query. The imported driver cannot target a real database.
const originalDatabase = process.env.DATABASE_URL, originalEnvironment = process.env.NODE_ENV, originalSite = process.env.PUBLIC_SITE_URL;
process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:9/luxxy_test_mock_only'; process.env.NODE_ENV = 'test'; process.env.PUBLIC_SITE_URL = 'http://127.0.0.1';
const { createStripeReservation, expireAbandonedStripeReservations, processStripeReservationEvent, readCustomerStripeStatus, stripeStatusToken } = await import('./lib/stripe-reservation-store');
after(() => { for (const [key, value] of [['DATABASE_URL', originalDatabase], ['NODE_ENV', originalEnvironment], ['PUBLIC_SITE_URL', originalSite]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const settings = { enabled: true, mode: 'test' as const, publishableKey: 'pk_test_syntheticRecoveryOnly', secretKey: 'sk_test_syntheticRecoveryOnly', webhookSecret: 'whsec_syntheticRecoveryOnly' };
const input = { vehicleId: '32c43a3c-ec67-4c21-9064-03de0a7f6282', idempotencyKey: '57c8aa55-8963-418d-a57c-8e74302ea67d', customerName: 'Example Buyer', email: 'buyer@example.test', phone: '07700900123', expectedPricePence: 1590000, expectedDepositPence: 10000, termsAccepted: true, terms: 'Example reservation terms agreed.' };
class MemoryDatabase implements SaleWorkspaceDatabase {
  record?: StripeReservationRecord;
  vehicleStatus = 'available'; leadStage = 'qualifying'; nextAction = ''; activities: string[] = []; selectionQueries: string[] = []; commits = 0; financialWrites = 0;
  async connect() { return { query: (sql: string, values?: any[]) => this.query(sql, values), release() {} }; }
  async query(sql: string, values: any[] = []): Promise<{ rows: Record<string, any>[] }> {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }; if (sql === 'COMMIT') { this.commits++; return { rows: [] }; }
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.startsWith('SELECT config FROM dealer_settings')) return { rows: [{ config: { onlineReservation: { enabled: true, depositPence: 10000, terms: input.terms } } }] };
    if (sql.startsWith('SELECT * FROM vehicles')) return { rows: [{ id: input.vehicleId, dealer_id: 'test-dealer', source: 'autotrader', inventory_status: this.vehicleStatus, source_status: 'live', missing_count: 0, currency: 'GBP', source_price: 15900, website_price_override: null, title: 'Example hatchback', registration: 'AB22 CDE' }] };
    if (sql.startsWith('SELECT inventory_status')) return { rows: [{ inventory_status: this.vehicleStatus }] };
    if (sql.startsWith('SELECT id FROM sales') || sql.startsWith('SELECT id FROM leads')) return { rows: [] };
    if (sql.startsWith('SELECT e.id')) return { rows: this.record && this.record.id === values[1] ? [{ id: '61f3ef6b-3c08-4e29-a349-0bd7a2722234', reservation: structuredClone(this.record) }] : [] };
    if (sql.startsWith("SELECT e.payload->'reservation'->>'id'")) return { rows: this.record && this.record.paymentIntentId === values[2] ? [{ id: this.record.id }] : [] };
    if (sql.startsWith("SELECT e.payload->'reservation'")) {
      this.selectionQueries.push(sql);
      const eligible = this.record && (!sql.includes('idempotencyKey') || this.record.idempotencyKey === values[2]) && (!sql.includes("->>'status'='awaiting_payment'") || this.record.status === 'awaiting_payment' && this.record.mode === values[2] && Date.parse(this.record.expiresAt) <= Date.parse(values[3]));
      return { rows: eligible ? [{ reservation: structuredClone(this.record) }] : [] };
    }
    if (sql.startsWith('UPDATE vehicles')) { this.vehicleStatus = sql.startsWith("UPDATE vehicles SET inventory_status='available'") ? 'available' : 'reserved'; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO leads')) { this.leadStage = 'reserved'; return { rows: [] }; }
    if (sql.startsWith('UPDATE leads')) { if (sql.includes("stage='qualifying'")) this.leadStage = 'qualifying'; this.nextAction = String(values[2] ?? ''); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO lead_events')) { const payload = JSON.parse(values[values.length - 1]); if (payload.kind === 'online_stripe_reservation') this.record = payload.reservation; else this.activities.push(values[1]); return { rows: [] }; }
    if (sql.startsWith('UPDATE lead_events')) { this.record = JSON.parse(values[1]); return { rows: [] }; }
    if (/INSERT INTO sale_workspace|UPDATE sale_workspace|sale_workspace_counters/.test(sql)) { this.financialWrites++; throw new Error('A test payment must not enter the financial ledger.'); }
    throw new Error('Unexpected query in memory database: ' + sql);
  }
}
const checkoutResponse = () => new Response(JSON.stringify({ id: 'cs_test_synthetic', url: 'https://checkout.stripe.com/c/pay/synthetic', livemode: false }));
test('disabled or unsafe payment configuration cannot create any temporary stock hold', async () => {
  const database = new MemoryDatabase();
  await assert.rejects(createStripeReservation(input, 'test-dealer', { ...settings, enabled: false }, { database }), /setup is being completed/);
  const live = { enabled: true, mode: 'live' as const, publishableKey: 'pk_live_syntheticRecoveryOnly', secretKey: 'sk_live_syntheticRecoveryOnly', webhookSecret: 'whsec_syntheticRecoveryOnly' };
  await assert.rejects(createStripeReservation(input, 'test-dealer', live, { database }), /return address/);
  assert.equal(database.record, undefined); assert.equal(database.vehicleStatus, 'available'); assert.equal(database.commits, 0);
});
test('a definite checkout rejection releases the committed temporary hold without a payment', async () => {
  const database = new MemoryDatabase();
  await assert.rejects(createStripeReservation(input, 'test-dealer', settings, { database, transport: async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', param: 'success_url' } }), { status: 400 }) }), /could not prepare/);
  assert.equal(database.record?.status, 'cancelled'); assert.equal(database.record?.amountReceivedPence, 0); assert.equal(database.vehicleStatus, 'available'); assert.equal(database.leadStage, 'qualifying'); assert.equal(database.financialWrites, 0); assert.ok(database.commits >= 2);
});
test('an ambiguous checkout response recovers the exact request and releases only a provider-confirmed expired session', async () => {
  const database = new MemoryDatabase(); let firstBody = '', calls = 0;
  const transport: typeof fetch = async (url, init) => { if (init?.method === 'POST') { calls++; if (calls === 1) { firstBody = String(init.body); throw new Error('Response lost after provider created session'); } assert.equal(String(init.body), firstBody); return checkoutResponse(); } assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions/cs_test_synthetic'); return new Response(JSON.stringify({ id: 'cs_test_synthetic', livemode: false, status: 'expired', payment_status: 'unpaid' })); };
  await assert.rejects(createStripeReservation(input, 'test-dealer', settings, { database, transport }), /could not be reached/); assert.equal(database.vehicleStatus, 'reserved'); assert.equal(database.record?.sessionId, undefined);
  const originalNow = Date.now; Date.now = () => originalNow() + 32 * 60_000;
  try { assert.equal(await expireAbandonedStripeReservations('test-dealer', settings, { database, transport }), 1); } finally { Date.now = originalNow; }
  assert.equal(database.record?.status, 'expired'); assert.equal(database.vehicleStatus, 'available'); assert.equal(database.record?.amountReceivedPence, 0); assert.equal(database.financialWrites, 0);
});
test('an uncertain or paid checkout remains held and is flagged for staff rather than silently releasing stock', async () => {
  const database = new MemoryDatabase();
  await createStripeReservation(input, 'test-dealer', settings, { database, transport: async () => checkoutResponse() });
  const originalNow = Date.now; Date.now = () => originalNow() + 32 * 60_000;
  try { await expireAbandonedStripeReservations('test-dealer', settings, { database, transport: async () => { throw new Error('Provider unavailable'); } }); assert.equal(database.record?.needsReview, true); assert.ok(database.nextAction.includes('Review')); assert.equal(database.vehicleStatus, 'reserved');
    await expireAbandonedStripeReservations('test-dealer', settings, { database, transport: async () => new Response(JSON.stringify({ id: 'cs_test_synthetic', livemode: false, status: 'complete', payment_status: 'paid' })) }); assert.equal(database.vehicleStatus, 'reserved'); assert.equal(database.record?.amountReceivedPence, 0);
  } finally { Date.now = originalNow; }
});
test('a paid session without a signed completion webhook is flagged on its first recovery check', async () => {
  const database = new MemoryDatabase(); await createStripeReservation(input, 'test-dealer', settings, { database, transport: async () => checkoutResponse() });
  database.record!.expiresAt = new Date(Date.now() - 1000).toISOString();
  await expireAbandonedStripeReservations('test-dealer', settings, { database, transport: async () => new Response(JSON.stringify({ id: 'cs_test_synthetic', livemode: false, status: 'complete', payment_status: 'paid' })) });
  assert.equal(database.record?.needsReview, true); assert.equal(database.record?.amountReceivedPence, 0); assert.equal(database.vehicleStatus, 'reserved'); assert.equal(database.financialWrites, 0); assert.ok(database.record?.lastCheckoutCheckAt);
});
test('expiry queries due holds before pagination rather than the newest completed staff records', async () => {
  const database = new MemoryDatabase(); await createStripeReservation(input, 'test-dealer', settings, { database, transport: async () => checkoutResponse() });
  database.record!.expiresAt = new Date(Date.now() - 1000).toISOString(); database.selectionQueries = [];
  assert.equal(await expireAbandonedStripeReservations('test-dealer', settings, { database, transport: async () => new Response(JSON.stringify({ id: 'cs_test_synthetic', livemode: false, status: 'expired', payment_status: 'unpaid' })) }), 1);
  const selection = database.selectionQueries[0]; assert.ok(selection.includes("->>'status'='awaiting_payment'")); assert.ok(selection.includes("->>'mode'=$3")); assert.ok(selection.includes("->>'expiresAt')::timestamptz <= $4")); assert.ok(selection.includes('lastCheckoutCheckAt')); assert.ok(!selection.includes('ORDER BY l.created_at DESC LIMIT 500')); assert.equal(database.vehicleStatus, 'available');
});
test('test Stripe confirmations and duplicate events never create a real payment or receipt', async () => {
  const database = new MemoryDatabase(); await createStripeReservation(input, 'test-dealer', settings, { database, transport: async () => checkoutResponse() }); const record = database.record!;
  const event = { id: 'evt_synthetic', type: 'checkout.session.completed', livemode: false, created: Math.floor(Date.now() / 1000), data: { object: { id: 'cs_test_synthetic', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 10000, currency: 'gbp', client_reference_id: record.id, metadata: { reservation_id: record.id, dealer_id: 'test-dealer' }, payment_intent: 'pi_synthetic' } } };
  const result = await processStripeReservationEvent(event, 'test-dealer', settings, { database }); assert.equal(result?.paymentStatus, 'test_confirmed'); assert.equal(result?.amountReceivedPence, 0); assert.equal(database.vehicleStatus, 'available'); assert.equal(database.financialWrites, 0);
  const activityCount = database.activities.length; await processStripeReservationEvent(event, 'test-dealer', settings, { database }); await processStripeReservationEvent({ ...event, id: 'evt_syntheticDuplicate' }, 'test-dealer', settings, { database }); assert.equal(database.activities.length, activityCount); assert.equal(database.financialWrites, 0); assert.equal(database.record?.paymentStatus, 'test_confirmed');
});
test('customer payment status requires the private capability and never exposes contact or provider secrets', async () => {
  const database = new MemoryDatabase(); await createStripeReservation(input, 'test-dealer', settings, { database, transport: async () => checkoutResponse() }); const record = database.record!, token = stripeStatusToken(record);
  const result = await readCustomerStripeStatus('test-dealer', record.reference, token, database); assert.equal(result.paymentStatus, 'pending'); assert.equal(result.amountReceivedPence, 0); const response = JSON.stringify(result);
  for (const value of [record.customerName, record.email, record.phone, record.idempotencyKey, record.sessionId!, settings.secretKey, token]) assert.ok(!response.includes(value));
  await assert.rejects(readCustomerStripeStatus('test-dealer', record.reference, 'a'.repeat(64), database), /unavailable/); await assert.rejects(readCustomerStripeStatus('another-dealer', record.reference, token, database), /unavailable/); await assert.rejects(readCustomerStripeStatus('test-dealer', 'RSV-000000000000', token, database), /unavailable/);
  const returnUrl = new URL(record.checkoutUrls!.success); assert.equal(returnUrl.searchParams.get('token'), token); assert.equal(returnUrl.pathname, '/reserve/payment-return'); assert.ok(!returnUrl.href.includes(record.idempotencyKey));
});
test('pending, succeeded and later failed refunds reconcile only confirmed returned money and ignore obsolete events', async () => {
  const database = new MemoryDatabase(); await createStripeReservation(input, 'test-dealer', settings, { database, transport: async () => checkoutResponse() });
  Object.assign(database.record!, { mode: 'live', paymentStatus: 'confirmed', status: 'reserved', amountReceivedPence: 10000, paymentIntentId: 'pi_synthetic', refundHistoryComplete: true });
  const liveSettings = { ...settings, mode: 'live' as const }, booked: number[] = [];
  const services = { database, refundRecorder: async (value: { amountRefundedPence: number }) => { booked.push(value.amountRefundedPence); return {} as any; } };
  const event = (id: string, type: string, status: string, created: number, refundId = 're_synthetic', amount = 4000) => ({ id, type, livemode: true, created, data: { object: { id: refundId, payment_intent: 'pi_synthetic', currency: 'gbp', amount, status } } });
  await processStripeReservationEvent(event('evt_pending', 'refund.created', 'pending', 100), 'test-dealer', liveSettings, services);
  assert.equal(database.record?.paymentStatus, 'refund_pending'); assert.equal(database.record?.amountRefundedPence, 0); assert.deepEqual(booked, []);
  await processStripeReservationEvent(event('evt_succeeded', 'refund.updated', 'succeeded', 101), 'test-dealer', liveSettings, services);
  assert.equal(database.record?.paymentStatus, 'partially_refunded'); assert.equal(database.record?.amountRefundedPence, 4000); assert.equal(database.record?.refundRevision, 1); assert.deepEqual(booked, [4000]);
  await processStripeReservationEvent(event('evt_failed', 'refund.failed', 'failed', 102), 'test-dealer', liveSettings, services);
  assert.equal(database.record?.paymentStatus, 'refund_failed'); assert.equal(database.record?.amountRefundedPence, 0); assert.equal(database.record?.refundRevision, 2); assert.equal(database.record?.needsReview, true); assert.equal(database.record?.status, 'reserved'); assert.deepEqual(booked, [4000, 0]);
  await processStripeReservationEvent(event('evt_obsolete', 'refund.updated', 'succeeded', 101), 'test-dealer', liveSettings, services);
  await processStripeReservationEvent(event('evt_sameSecond', 'refund.updated', 'succeeded', 102), 'test-dealer', liveSettings, services);
  assert.equal(database.record?.paymentStatus, 'refund_failed'); assert.deepEqual(booked, [4000, 0]);
  await processStripeReservationEvent(event('evt_retrySucceeded', 'refund.updated', 'succeeded', 103, 're_retry', 10000), 'test-dealer', liveSettings, services);
  assert.equal(database.record?.paymentStatus, 'refunded'); assert.equal(database.record?.amountRefundedPence, 10000); assert.equal(database.record?.refundRevision, 3); assert.equal(database.record?.needsReview, false); assert.deepEqual(booked, [4000, 0, 10000]); assert.equal(database.vehicleStatus, 'reserved');
});
test('a truncated charge refund list cannot confirm an incomplete cumulative refund history', async () => {
  const database = new MemoryDatabase(); await createStripeReservation(input, 'test-dealer', settings, { database, transport: async () => checkoutResponse() });
  Object.assign(database.record!, { mode: 'live', paymentStatus: 'confirmed', status: 'reserved', amountReceivedPence: 10000, paymentIntentId: 'pi_synthetic', refundHistoryComplete: true });
  const liveSettings = { ...settings, mode: 'live' as const }, booked: number[] = [];
  const services = { database, refundRecorder: async (value: { amountRefundedPence: number }) => { booked.push(value.amountRefundedPence); return {} as any; } };
  const refund = { id: 're_synthetic', payment_intent: 'pi_synthetic', currency: 'gbp', amount: 4000, status: 'succeeded' };
  const event = { id: 'evt_incomplete', type: 'charge.refunded', livemode: true, created: 100, data: { object: { id: 'ch_synthetic', payment_intent: 'pi_synthetic', currency: 'gbp', amount: 10000, amount_refunded: 4000, refunds: { has_more: true, data: [refund] } } } };
  await processStripeReservationEvent(event, 'test-dealer', liveSettings, services); assert.deepEqual(booked, []); assert.equal(database.record?.paymentStatus, 'refund_failed'); assert.equal(database.record?.needsReview, true);
  await processStripeReservationEvent({ ...event, id: 'evt_complete', created: 101, data: { object: { ...event.data.object, refunds: { has_more: false, data: [refund] } } } }, 'test-dealer', liveSettings, services);
  assert.deepEqual(booked, [4000]); assert.equal(database.record?.amountRefundedPence, 4000); assert.equal(database.record?.paymentStatus, 'partially_refunded'); assert.equal(database.record?.needsReview, false);
  await assert.rejects(processStripeReservationEvent({ ...event, id: 'evt_invalid', data: { object: { ...event.data.object, currency: 'usd' } } }, 'test-dealer', liveSettings, services), /does not match/);
});
test('a refund delivered before checkout confirmation retries without losing the signed event or recording premature money', async () => {
  const database = new MemoryDatabase(); await createStripeReservation(input, 'test-dealer', settings, { database, transport: async () => checkoutResponse() });
  database.record!.mode = 'live'; const record = database.record!, liveSettings = { ...settings, mode: 'live' as const, secretKey: 'sk_live_syntheticRecoveryOnly' }, booked: number[] = [];
  const event = { id: 'evt_earlyRefund', type: 'refund.created', livemode: true, created: 100, data: { object: { id: 're_synthetic', payment_intent: 'pi_synthetic', currency: 'gbp', amount: 4000, status: 'succeeded' } } };
  const services = { database, refundRecorder: async (value: { amountRefundedPence: number }) => { booked.push(value.amountRefundedPence); return {} as any; }, transport: (async (url: any) => { assert.equal(url, 'https://api.stripe.com/v1/payment_intents/pi_synthetic'); return new Response(JSON.stringify({ id: 'pi_synthetic', livemode: true, client_secret: 'NEVER_EXPOSE_THIS', metadata: { dealer_id: 'test-dealer', reservation_id: record.id } })); }) as typeof fetch };
  await assert.rejects(processStripeReservationEvent(event, 'test-dealer', liveSettings, services), /awaiting its signed deposit confirmation/);
  assert.deepEqual(booked, []); assert.equal(database.record?.amountReceivedPence, 0); assert.ok(!database.record?.eventIds.includes(event.id)); assert.equal(database.vehicleStatus, 'reserved');
  Object.assign(database.record!, { paymentStatus: 'confirmed', status: 'reserved', amountReceivedPence: 10000, paymentIntentId: 'pi_synthetic', refundHistoryComplete: true });
  await processStripeReservationEvent(event, 'test-dealer', liveSettings, services); assert.deepEqual(booked, [4000]); assert.equal(database.record?.paymentStatus, 'partially_refunded'); assert.ok(database.record?.eventIds.includes(event.id)); assert.ok(!JSON.stringify(database.record).includes('NEVER_EXPOSE_THIS'));
  const unrelated = { ...event, id: 'evt_unrelated', data: { object: { ...event.data.object, payment_intent: 'pi_unrelated' } } };
  assert.equal(await processStripeReservationEvent(unrelated, 'test-dealer', liveSettings, { ...services, transport: async () => new Response(JSON.stringify({ id: 'pi_unrelated', livemode: true, metadata: { dealer_id: 'other-dealer' } })) }), undefined); assert.deepEqual(booked, [4000]);
});
