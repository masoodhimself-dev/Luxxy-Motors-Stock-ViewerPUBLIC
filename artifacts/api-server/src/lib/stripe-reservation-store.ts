import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { pool } from '@workspace/db';
import { vehicleRegistrationLabel } from '@workspace/vehicle-meta';
import { assertReservableVehicle, onlineReservationSettings, parseOnlineReservationInput, reservationRequestFingerprint, ReservationError, type ReservationVehicle } from './online-reservations';
import { recordStripeReservationDeposit, recordStripeReservationRefund, type SaleWorkspaceReadClient, type SaleWorkspaceDatabase } from './sale-workspace-store';
import { assertStripeReady, createStripeCheckoutSession, readStripeCheckoutSession, readStripePaymentIntentMetadata, StripeCheckoutPreparationError, validatePaidCheckout, type StripeEvent } from './stripe-payments';
import type { StripeSettings } from './dealer-integrations-store';
import { siteUrl } from './enquiry-links';
export const stripeReservationKind = 'online_stripe_reservation';
export type StripeReservationRecord = {
  id: string; dealerId: string; reference: string; vehicleId: string; vehicleTitle: string; vehicleRegistration?: string;
  depositPence: number; expectedPricePence: number; amountReceivedPence: number; amountRefundedPence: number;
  paymentStatus: 'pending' | 'confirmed' | 'test_confirmed' | 'refund_pending' | 'refund_failed' | 'partially_refunded' | 'refunded' | 'cancelled'; status: 'awaiting_payment' | 'reserved' | 'cancelled' | 'expired' | 'refunded';
  mode: 'test' | 'live'; createdAt: string; expiresAt: string; idempotencyKey: string; requestFingerprint: string;
  customerName: string; email: string; phone: string; terms: string; termsAccepted: true;
  sessionId?: string; checkoutUrl?: string; paymentIntentId?: string; eventIds: string[]; saleId?: string;
  checkoutUrls?: { success: string; cancel: string }; credentialFingerprint?: string; checkoutAttemptCount?: number; needsReview?: boolean; lastCheckoutCheckAt?: string;
  providerRefunds?: Record<string, { amountPence: number; status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled'; eventCreated: number; eventId: string }>;
  refundHistoryComplete?: boolean; refundRevision?: number;
  notifications?: Record<string, { status: 'sent' | 'failed'; providerId?: string; attemptedAt: string; amountPence?: number; revision?: number }>;
  partExchange?: { registration: string; mileage: number };
};
export function stripeReservationView(record: StripeReservationRecord) { return { id: record.id, reference: record.reference, vehicleId: record.vehicleId, vehicleTitle: record.vehicleTitle, vehicleRegistration: record.vehicleRegistration, depositPence: record.depositPence, amountReceivedPence: record.amountReceivedPence, amountRefundedPence: record.amountRefundedPence, paymentStatus: record.paymentStatus, status: record.status, createdAt: record.createdAt, expiresAt: record.expiresAt, saleId: record.saleId, mode: record.mode, needsReview: record.needsReview ?? false }; }
export function stripeStatusToken(record: Pick<StripeReservationRecord, 'dealerId' | 'id' | 'idempotencyKey'>) { return createHash('sha256').update(`stripe-reservation-status:${record.dealerId}:${record.id}:${record.idempotencyKey}`).digest('hex'); }
type Client = SaleWorkspaceReadClient;
export type StripeReservationServices = { database?: SaleWorkspaceDatabase; transport?: typeof fetch; refundRecorder?: typeof recordStripeReservationRefund };
async function transaction<T>(run: (client: Client) => Promise<T>, database: SaleWorkspaceDatabase = pool): Promise<T> { const client = await database.connect(); try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }
async function dealerLock(client: Client, dealerId: string) { await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-workspace:${dealerId}`]); }
async function vehicleLock(client: Client, vehicleId: string) { await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-vehicle:${vehicleId}`]); }
async function readRecord(client: Client, dealerId: string, id: string): Promise<{ eventId: string; record: StripeReservationRecord } | undefined> { const result = await client.query("SELECT e.id, e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND l.id=$2::uuid AND e.payload->>'kind'=$3 LIMIT 1 FOR UPDATE OF e", [dealerId, id, stripeReservationKind]); const row = result.rows[0]; if (!row) return undefined; const record = row.reservation as StripeReservationRecord; if (record.id !== id || record.dealerId !== dealerId) throw new ReservationError('Reservation data is inconsistent.', 409); return { eventId: row.id, record }; }
async function writeRecord(client: Client, eventId: string, record: StripeReservationRecord) { await client.query("UPDATE lead_events SET payload = jsonb_set(payload, '{reservation}', $2::jsonb) WHERE id=$1::uuid", [eventId, JSON.stringify(record)]); }
async function activity(client: Client, record: StripeReservationRecord, body: string, extra: Record<string, unknown> = {}) { await client.query("INSERT INTO lead_events (lead_id,type,actor_type,body,payload) VALUES ($1::uuid,'note_added','system',$2,$3::jsonb)", [record.id, body, JSON.stringify({ kind: 'stripe_reservation_activity', reservationId: record.id, ...extra })]); }
async function competingSale(client: Client, dealerId: string, vehicleId: string) { const rows = await client.query("SELECT id FROM sales WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND status IN ('draft','ready','signing','signed','completed') UNION ALL SELECT id FROM sale_workspace WHERE dealer_id=$1 AND state#>>'{draft,vehicleId}'=$2::text AND state#>>'{lifecycle,status}' IN ('reserved','sold') LIMIT 1", [dealerId, vehicleId]); return rows.rows.length > 0; }
export async function createStripeReservation(raw: unknown, dealerId: string, settings: StripeSettings, services: StripeReservationServices = {}) {
  assertStripeReady(settings);
  const origin = new URL(siteUrl('/'));
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || settings.mode === 'live' && origin.protocol !== 'https:') throw new ReservationError('The payment return address is not configured safely.', 503);
  const database = services.database ?? pool, runTransaction = <T>(run: (client: Client) => Promise<T>) => transaction(run, database);
  const input = parseOnlineReservationInput(raw), fingerprint = reservationRequestFingerprint(input);
  const created = await runTransaction(async client => {
    await dealerLock(client, dealerId); await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`stripe-request:${dealerId}:${input.idempotencyKey}`]);
    const prior = await client.query("SELECT e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND e.payload->>'kind'=$2 AND e.payload->'reservation'->>'idempotencyKey'=$3 LIMIT 1", [dealerId, stripeReservationKind, input.idempotencyKey]);
    if (prior.rows[0]) { const record = prior.rows[0].reservation as StripeReservationRecord; if (record.requestFingerprint !== fingerprint || record.mode !== settings.mode) throw new ReservationError('This reservation request was already used with different details.', 409); if (record.status !== 'awaiting_payment') throw new ReservationError('This reservation is already completed or closed. Please contact the dealership.', 409); return { record, replayed: true }; }
    const configured = await client.query('SELECT config FROM dealer_settings WHERE dealer_id=$1 FOR SHARE', [dealerId]);
    const policy = onlineReservationSettings(configured.rows[0]?.config?.onlineReservation);
    if (!policy.enabled || !policy.terms) throw new ReservationError('Online reservations are currently switched off. Please contact the dealership.', 409);
    await vehicleLock(client, input.vehicleId);
    const result = await client.query('SELECT * FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [dealerId, input.vehicleId]); const row = result.rows[0];
    const vehicle: ReservationVehicle | undefined = row ? { id: row.id, dealerId: row.dealer_id, source: row.source, inventoryStatus: row.inventory_status, sourceStatus: row.source_status, missingCount: row.missing_count, currency: row.currency, sourcePrice: row.source_price, websitePriceOverride: row.website_price_override, title: row.title, websiteTitleOverride: row.website_title_override, make: row.make, model: row.model, registration: row.registration, registrationBand: row.registration_band, plate: row.plate, vrm: row.vrm, year: row.year } : undefined;
    const threshold = Number(process.env.STOCK_MISSING_HIDE_THRESHOLD ?? 2);
    assertReservableVehicle(vehicle, input, policy, { dealerId, missingHideThreshold: Number.isFinite(threshold) ? threshold : 2 });
    const competing = await client.query("SELECT id FROM leads WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND stage IN ('reserved','sale_agreed','collected') LIMIT 1", [dealerId, input.vehicleId]);
    if (competing.rows.length || await competingSale(client, dealerId, input.vehicleId)) throw new ReservationError('This car is already being purchased or reserved.', 409);
    const id = randomUUID(), now = new Date();
    const record: StripeReservationRecord = { id, dealerId, reference: `RSV-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`, vehicleId: vehicle.id, vehicleTitle: vehicle.websiteTitleOverride || vehicle.title || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle', vehicleRegistration: vehicleRegistrationLabel(vehicle) ?? undefined, depositPence: policy.depositPence, expectedPricePence: input.expectedPricePence, amountReceivedPence: 0, amountRefundedPence: 0, paymentStatus: 'pending', status: 'awaiting_payment', mode: settings.mode, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 31 * 60_000).toISOString(), idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint, customerName: input.customerName, email: input.email, phone: input.phone, terms: policy.terms, termsAccepted: true, eventIds: [], ...(input.partExchange ? { partExchange: input.partExchange } : {}) };
    record.checkoutUrls = { success: siteUrl(`/reserve/payment-return?reference=${encodeURIComponent(record.reference)}&token=${stripeStatusToken(record)}`), cancel: siteUrl(`/vehicle/${encodeURIComponent(record.vehicleId)}?reservation=cancelled`) };
    record.credentialFingerprint = createHash('sha256').update(settings.secretKey).digest('hex');
    await client.query("UPDATE vehicles SET inventory_status='reserved', updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid AND inventory_status='available'", [dealerId, vehicle.id]);
    await client.query("INSERT INTO leads (id,dealer_id,vehicle_id,vehicle_title,vehicle_registration,vehicle_price,stage,source,customer_name,email,phone,preferred_contact,summary,next_action,next_action_due_at) VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,'reserved','website_form',$7,$8,$9,'email',$10,$11,$12)", [id, dealerId, vehicle.id, record.vehicleTitle, record.vehicleRegistration ?? null, input.expectedPricePence / 100, input.customerName, input.email, input.phone, 'Stripe reservation awaiting payment. No deposit has been received.', 'Await signed payment confirmation before recording a deposit.', record.expiresAt]);
    await client.query("INSERT INTO lead_events (lead_id,type,actor_type,body,payload) VALUES ($1::uuid,'note_added','system',$2,$3::jsonb)", [id, 'Vehicle temporarily held while the customer completes Stripe checkout. No payment received.', JSON.stringify({ kind: stripeReservationKind, reservation: record })]);
    return { record, replayed: false };
  });
  if (!created.record.checkoutUrl) {
    const checkout = await prepareCheckout(created.record, settings, services);
    created.record = await runTransaction(async client => { await dealerLock(client, dealerId); const current = await readRecord(client, dealerId, created.record.id); if (!current) throw new ReservationError('Reservation not found.', 404); if (current.record.sessionId && current.record.sessionId !== checkout.id) throw new ReservationError('The checkout session has changed.', 409); current.record.sessionId = checkout.id; current.record.checkoutUrl = checkout.url; await writeRecord(client, current.eventId, current.record); return current.record; });
  }
  return { reservation: stripeReservationView(created.record), checkoutUrl: created.record.checkoutUrl!, replayed: created.replayed };
}
async function prepareCheckout(record: StripeReservationRecord, settings: StripeSettings, services: StripeReservationServices = {}) {
  const database = services.database ?? pool, runTransaction = <T>(run: (client: Client) => Promise<T>) => transaction(run, database);
  if (record.credentialFingerprint !== createHash('sha256').update(settings.secretKey).digest('hex')) throw new ReservationError('The payment account changed while this checkout was being prepared. Contact the dealership to review the hold.', 409);
  const urls = record.checkoutUrls;
  if (!urls) throw new ReservationError('The saved checkout details need staff review.', 409);
  const attemptNumber = await runTransaction(async client => { await dealerLock(client, record.dealerId); const current = await readRecord(client, record.dealerId, record.id); if (!current) throw new ReservationError('Reservation not found.', 404); current.record.checkoutAttemptCount = (current.record.checkoutAttemptCount ?? 0) + 1; await writeRecord(client, current.eventId, current.record); return current.record.checkoutAttemptCount; });
  try { return await createStripeCheckoutSession(settings, record, urls, services.transport ?? fetch); }
  catch (error) {
    if (error instanceof StripeCheckoutPreparationError) await runTransaction(async client => { await dealerLock(client, record.dealerId); await vehicleLock(client, record.vehicleId); const current = await readRecord(client, record.dealerId, record.id); if (!current) return; if (error.recoveredSessionId) { current.record.sessionId = error.recoveredSessionId; await writeRecord(client, current.eventId, current.record); } else if (error.definitiveFailure && (attemptNumber === 1 || error.failureParam === 'expires_at' && Date.now() - Date.parse(record.createdAt) <= 23 * 60 * 60_000)) await releaseHold(client, current.eventId, current.record, 'cancelled'); });
    throw error;
  }
}
export async function listStripeReservations(dealerId: string, database: SaleWorkspaceDatabase = pool) { const result = await database.query("SELECT e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND e.payload->>'kind'=$2 ORDER BY l.created_at DESC LIMIT 500", [dealerId, stripeReservationKind]); return result.rows.map(row => row.reservation as StripeReservationRecord); }
export async function readCustomerStripeStatus(dealerId: string, reference: string, token: string, database: SaleWorkspaceDatabase = pool) {
  if (!/^RSV-[A-F0-9]{12}$/.test(reference) || !/^[a-f0-9]{64}$/.test(token)) throw new ReservationError('This payment status link is unavailable.', 404);
  const result = await database.query("SELECT e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND e.payload->>'kind'=$2 AND e.payload->'reservation'->>'reference'=$3 LIMIT 1", [dealerId, stripeReservationKind, reference]);
  const record = result.rows[0]?.reservation as StripeReservationRecord | undefined;
  if (!record || record.dealerId !== dealerId || record.reference !== reference || !timingSafeEqual(Buffer.from(stripeStatusToken(record), 'hex'), Buffer.from(token, 'hex'))) throw new ReservationError('This payment status link is unavailable.', 404);
  const { saleId: _saleId, ...view } = stripeReservationView(record); return view;
}
async function releaseHold(client: Client, eventId: string, record: StripeReservationRecord, state: 'expired' | 'cancelled') {
  if (record.status !== 'awaiting_payment' || record.amountReceivedPence !== 0) return;
  const competing = await client.query("SELECT id FROM leads WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND id<>$3::uuid AND stage IN ('reserved','sale_agreed','collected') LIMIT 1", [record.dealerId, record.vehicleId, record.id]);
  if (competing.rows.length || await competingSale(client, record.dealerId, record.vehicleId)) throw new ReservationError('This reservation is linked to another sale or hold. Review it before releasing stock.', 409);
  record.status = state; record.paymentStatus = 'cancelled'; record.needsReview = false;
  await client.query("UPDATE vehicles SET inventory_status='available',updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid AND inventory_status='reserved'", [record.dealerId, record.vehicleId]);
  await client.query("UPDATE leads SET stage='qualifying',next_action=$3,updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid AND stage='reserved'", [record.dealerId, record.id, `Online payment ${state}. Contact the customer; no deposit was recorded.`]);
  await writeRecord(client, eventId, record); await activity(client, record, `Stripe reservation ${state}. No payment or refund recorded; vehicle hold released.`);
}
/** Signed provider statuses determine returned money; charge.amount_refunded alone can include an unfinished refund. */
export function reconcileStripeRefundEvent(event: StripeEvent, record: StripeReservationRecord) {
  const object = event.data.object, charge = event.type === 'charge.refunded';
  if (!record.paymentIntentId || object.payment_intent !== record.paymentIntentId || object.currency !== 'gbp' || record.amountReceivedPence <= 0 || charge && (object.amount !== record.depositPence || !Number.isSafeInteger(object.amount_refunded) || object.amount_refunded < 0 || object.amount_refunded > record.amountReceivedPence)) throw new ReservationError('The refund does not match the confirmed reservation deposit.', 409);
  const objects: Record<string, any>[] = charge && Array.isArray(object.refunds?.data) ? object.refunds.data : charge ? [] : [object];
  const statuses = ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const;
  for (const refund of objects) {
    if (!/^re_[A-Za-z0-9]+$/.test(refund.id ?? '') || !Number.isSafeInteger(refund.amount) || refund.amount <= 0 || refund.amount > record.amountReceivedPence || refund.currency !== 'gbp' || refund.payment_intent !== record.paymentIntentId || !statuses.includes(refund.status) || event.type === 'refund.failed' && refund.status !== 'failed') throw new ReservationError('The refund status does not match the confirmed reservation deposit.', 409);
    const prior = record.providerRefunds?.[refund.id];
    if (prior && prior.amountPence !== refund.amount) throw new ReservationError('The refund amount changed for an existing provider reference.', 409);
  }
  const next = { ...(record.providerRefunds ?? {}) };
  const rank: Record<string, number> = { pending: 0, requires_action: 0, succeeded: 1, failed: 2, canceled: 2 };
  for (const refund of objects) {
    const prior = next[refund.id];
    // Same-second delivery order must not restore an obsolete succeeded status after a failure.
    if (prior && (event.created < prior.eventCreated || event.created === prior.eventCreated && rank[refund.status] < rank[prior.status])) continue;
    next[refund.id] = { amountPence: refund.amount, status: refund.status, eventCreated: event.created, eventId: event.id };
  }
  const succeededPence = Object.values(next).filter(refund => refund.status === 'succeeded').reduce((sum, refund) => sum + refund.amountPence, 0);
  if (!Number.isSafeInteger(succeededPence) || succeededPence > record.amountReceivedPence) throw new ReservationError('The succeeded refunds exceed the confirmed deposit.', 409);
  let complete = record.refundHistoryComplete ?? record.amountRefundedPence === 0;
  if (charge) complete = Array.isArray(object.refunds?.data) && object.refunds.has_more === false;
  record.providerRefunds = next; record.refundHistoryComplete = complete;
  return { succeededPence, complete, failed: succeededPence < record.amountReceivedPence && Object.values(next).some(refund => ['failed', 'canceled'].includes(refund.status)), pending: Object.values(next).some(refund => ['pending', 'requires_action'].includes(refund.status)) };
}
export async function processStripeReservationEvent(event: StripeEvent, dealerId: string, settings: StripeSettings, services: StripeReservationServices = {}): Promise<StripeReservationRecord | undefined> {
  const database = services.database ?? pool, runTransaction = <T>(run: (client: Client) => Promise<T>) => transaction(run, database);
  if (event.livemode !== (settings.mode === 'live')) throw new ReservationError('Webhook payment mode does not match this dealership.', 409);
  const refundEvent = ['charge.refunded', 'refund.created', 'refund.updated', 'refund.failed'].includes(event.type);
  const supported = ['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_failed']; if (!supported.includes(event.type) && !refundEvent) return undefined;
  const object = event.data.object; let id = object.metadata?.reservation_id ?? object.client_reference_id;
  if (refundEvent && !id) {
    const match = await database.query("SELECT e.payload->'reservation'->>'id' AS id FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND e.payload->>'kind'=$2 AND e.payload->'reservation'->>'paymentIntentId'=$3 LIMIT 1", [dealerId, stripeReservationKind, object.payment_intent]); id = match.rows[0]?.id;
    if (!id && settings.mode === 'live' && /^pi_[A-Za-z0-9]+$/.test(object.payment_intent ?? '')) {
      const metadata = await readStripePaymentIntentMetadata(settings, object.payment_intent, services.transport ?? fetch);
      if (metadata.dealerId === dealerId && typeof metadata.reservationId === 'string') id = metadata.reservationId;
    }
  }
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return undefined;
  return runTransaction(async client => {
    await dealerLock(client, dealerId); const first = await readRecord(client, dealerId, id); if (!first) return undefined; await vehicleLock(client, first.record.vehicleId); const current = await readRecord(client, dealerId, id); if (!current) return undefined; const record = current.record;
    if (record.mode !== settings.mode) throw new ReservationError('The reservation payment mode changed.', 409);
    if (record.eventIds.includes(event.id)) return record;
    if (event.type === 'checkout.session.completed') {
      const paid = validatePaidCheckout(event, record);
      if (record.paymentIntentId && record.paymentIntentId !== paid.paymentIntentId) throw new ReservationError('A different payment is already linked to this reservation.', 409);
      if (record.paymentIntentId === paid.paymentIntentId && ['confirmed', 'test_confirmed', 'refund_pending', 'refund_failed', 'partially_refunded', 'refunded'].includes(record.paymentStatus)) { record.eventIds.push(event.id); await writeRecord(client, current.eventId, record); return record; }
      if (!['awaiting_payment', 'reserved'].includes(record.status)) throw new ReservationError('Payment arrived after this vehicle hold closed. Staff must reconcile the payment before changing stock.', 409);
      const vehicle = await client.query('SELECT inventory_status FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [dealerId, record.vehicleId]);
      if (vehicle.rows[0]?.inventory_status !== 'reserved') throw new ReservationError('This vehicle is no longer held for the reservation. Review the payment before changing stock.', 409);
      if (record.mode === 'live') {
        const sale = await recordStripeReservationDeposit({ dealerId, reservationId: record.id, vehicleId: record.vehicleId, customerName: record.customerName, email: record.email, phone: record.phone, vehicleTitle: record.vehicleTitle, vehicleRegistration: record.vehicleRegistration, expectedPricePence: record.expectedPricePence, amountPence: paid.amountPence, currency: 'gbp', paymentIntentId: paid.paymentIntentId, eventId: event.id }, client);
        record.saleId = sale.id; record.amountReceivedPence = paid.amountPence; record.paymentStatus = 'confirmed'; record.status = 'reserved'; record.paymentIntentId = paid.paymentIntentId; record.sessionId = paid.sessionId; record.needsReview = false; record.refundHistoryComplete = true;
        await client.query("UPDATE leads SET summary=$3,next_action=$4,updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid", [dealerId, record.id, 'Stripe reservation deposit confirmed. Linked sale and receipt created.', 'Contact the buyer and arrange the remaining balance and handover.']);
        await activity(client, record, 'Stripe deposit verified. Confirmed payment and receipt recorded in the linked sale.', { eventId: event.id, amountPence: paid.amountPence, saleId: sale.id });
      } else {
        // Sandbox success is never a real payment, receipt, or outstanding-balance reduction.
        record.paymentStatus = 'test_confirmed'; record.amountReceivedPence = 0; record.paymentIntentId = paid.paymentIntentId; record.sessionId = paid.sessionId;
        await releaseHold(client, current.eventId, { ...record, status: 'awaiting_payment', amountReceivedPence: 0 }, 'cancelled');
        record.status = 'cancelled';
        await activity(client, record, 'Stripe test payment verified. No real money received, no financial receipt created and temporary vehicle hold released.', { eventId: event.id, testAmountPence: paid.amountPence, amountReceivedPence: 0 });
      }
    } else if (refundEvent) {
      if (record.mode === 'test') { record.eventIds.push(event.id); await writeRecord(client, current.eventId, record); return record; }
      if (!record.paymentIntentId || record.amountReceivedPence <= 0) throw new ReservationError('The refund is awaiting its signed deposit confirmation. Retry this event after payment confirmation.', 409);
      const refund = reconcileStripeRefundEvent(event, record);
      if (refund.complete && refund.succeededPence !== record.amountRefundedPence) {
        await (services.refundRecorder ?? recordStripeReservationRefund)({ dealerId, reservationId: record.id, paymentIntentId: record.paymentIntentId!, eventId: event.id, amountRefundedPence: refund.succeededPence }, client);
        record.amountRefundedPence = refund.succeededPence; record.refundRevision = (record.refundRevision ?? 0) + 1;
      }
      record.needsReview = refund.failed || !refund.complete;
      record.paymentStatus = record.needsReview ? 'refund_failed' : refund.pending ? 'refund_pending' : record.amountRefundedPence === record.amountReceivedPence ? 'refunded' : record.amountRefundedPence > 0 ? 'partially_refunded' : 'confirmed';
      record.status = record.paymentStatus === 'refunded' ? 'refunded' : 'reserved';
      await client.query('UPDATE leads SET next_action=$3,updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid', [dealerId, record.id, record.needsReview ? 'A Stripe refund failed or its history is incomplete. Reconcile the provider refund before releasing the vehicle.' : refund.pending ? 'Refund awaiting provider confirmation. Keep the vehicle held until the sale is reviewed.' : 'Confirmed refund recorded. Review the sale before releasing the vehicle.']);
      await activity(client, record, record.needsReview ? 'Stripe refund requires staff review. Only succeeded refunds are reflected in confirmed finances; vehicle release remains blocked.' : refund.pending ? 'Stripe refund is pending. No pending amount was booked as money returned.' : 'Succeeded Stripe refund reconciled with the linked sale. Staff must review the sale before releasing the vehicle.', { eventId: event.id, amountRefundedPence: record.amountRefundedPence });
    } else {
      if (record.sessionId && object.id !== record.sessionId || object.metadata?.dealer_id !== dealerId || object.metadata?.reservation_id !== record.id) throw new ReservationError('The checkout event does not match the reservation.', 409);
      if (object.payment_status === 'paid' || event.type === 'checkout.session.expired' && object.status !== 'expired') throw new ReservationError('The checkout cannot be released until its payment status is reconciled.', 409);
      await releaseHold(client, current.eventId, record, event.type === 'checkout.session.expired' ? 'expired' : 'cancelled');
    }
    record.eventIds.push(event.id); await writeRecord(client, current.eventId, record); return record;
  });
}
/** A provider-confirmed expiration releases stock; uncertainty leaves the hold intact. */
export async function expireAbandonedStripeReservations(dealerId: string, settings: StripeSettings, services: StripeReservationServices = {}): Promise<number> {
  const database = services.database ?? pool, runTransaction = <T>(run: (client: Client) => Promise<T>) => transaction(run, database);
  // Filter before paging so newer paid reservations cannot hide an older abandoned hold.
  const selected = await database.query("SELECT e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND e.payload->>'kind'=$2 AND e.payload->'reservation'->>'status'='awaiting_payment' AND e.payload->'reservation'->>'mode'=$3 AND (e.payload->'reservation'->>'expiresAt')::timestamptz <= $4::timestamptz ORDER BY COALESCE(e.payload->'reservation'->>'lastCheckoutCheckAt', e.payload->'reservation'->>'createdAt') ASC, (e.payload->'reservation'->>'expiresAt')::timestamptz ASC LIMIT 100", [dealerId, stripeReservationKind, settings.mode, new Date(Date.now()).toISOString()]);
  const due = selected.rows.map(row => row.reservation as StripeReservationRecord); let released = 0;
  for (const record of due) { try {
    await flagStripeHoldForReview(record, database, false);
    if (!record.sessionId) {
      // Recover an ambiguous create with its original provider idempotency parameters while Stripe retains the result.
      if (Date.now() - Date.parse(record.createdAt) > 23 * 60 * 60_000 || record.credentialFingerprint !== createHash('sha256').update(settings.secretKey).digest('hex')) { await flagStripeHoldForReview(record, database); continue; }
      const recovered = await prepareCheckout(record, settings, services); record.sessionId = recovered.id;
      await runTransaction(async client => { await dealerLock(client, dealerId); const current = await readRecord(client, dealerId, record.id); if (current) { current.record.sessionId = recovered.id; await writeRecord(client, current.eventId, current.record); } });
    }
    const session = await readStripeCheckoutSession(settings, record.sessionId, services.transport ?? fetch);
    if (session.payment_status === 'paid' || session.status === 'complete') { await flagStripeHoldForReview(record, database); continue; }
    if (session.status !== 'expired') continue;
    await runTransaction(async client => { await dealerLock(client, dealerId); await vehicleLock(client, record.vehicleId); const current = await readRecord(client, dealerId, record.id); if (current?.record.status === 'awaiting_payment') { await releaseHold(client, current.eventId, current.record, 'expired'); released++; } });
  } catch { await flagStripeHoldForReview(record, database); /* Keep uncertain payments held until a signed webhook or a later status check. */ } }
  return released;
}
async function flagStripeHoldForReview(record: StripeReservationRecord, database: SaleWorkspaceDatabase = pool, review = true) { await transaction(async client => { await dealerLock(client, record.dealerId); const current = await readRecord(client, record.dealerId, record.id); if (!current || current.record.status !== 'awaiting_payment') return; const newlyFlagged = review && !current.record.needsReview; current.record.lastCheckoutCheckAt = new Date(Date.now()).toISOString(); if (review) current.record.needsReview = true; await writeRecord(client, current.eventId, current.record); if (!newlyFlagged) return; await client.query('UPDATE leads SET next_action=$3,updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid', [record.dealerId, record.id, 'Checkout status is uncertain. Review this reservation in Stripe before releasing the car or recording payment.']); await activity(client, current.record, 'Checkout recovery requires staff review. No payment assumed and vehicle hold retained.'); }, database); }
export async function recordStripeNotification(dealerId: string, id: string, kind: string, result: { status: 'sent' | 'failed'; providerId?: string; amountPence?: number; revision?: number }) { return transaction(async client => { await dealerLock(client, dealerId); const current = await readRecord(client, dealerId, id); if (!current) return; (current.record.notifications ??= {})[kind] = { ...result, attemptedAt: new Date().toISOString() }; await writeRecord(client, current.eventId, current.record); }); }
