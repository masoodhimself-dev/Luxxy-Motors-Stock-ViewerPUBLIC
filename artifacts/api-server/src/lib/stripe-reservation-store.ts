/** Compatibility only for signed events relating to already-issued historical payment sessions. */
import { pool } from '@workspace/db';
import { ReservationError } from './historical-reservations';
import { recordStripeReservationDeposit, recordStripeReservationRefund, type SaleWorkspaceReadClient, type SaleWorkspaceDatabase } from './sale-workspace-store';
import { readStripePaymentIntentMetadata, validatePaidCheckout, type StripeEvent } from './stripe-payments';
import type { StripeSettings } from './dealer-integrations-store';
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
type Client = SaleWorkspaceReadClient;
export type StripeReservationServices = { database?: SaleWorkspaceDatabase; transport?: typeof fetch; refundRecorder?: typeof recordStripeReservationRefund };
async function transaction<T>(run: (client: Client) => Promise<T>, database: SaleWorkspaceDatabase = pool): Promise<T> { const client = await database.connect(); try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }
async function dealerLock(client: Client, dealerId: string) { await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-workspace:${dealerId}`]); }
async function vehicleLock(client: Client, vehicleId: string) { await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-vehicle:${vehicleId}`]); }
async function readRecord(client: Client, dealerId: string, id: string): Promise<{ eventId: string; record: StripeReservationRecord } | undefined> { const result = await client.query("SELECT e.id, e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND l.id=$2::uuid AND e.payload->>'kind'=$3 LIMIT 1 FOR UPDATE OF e", [dealerId, id, stripeReservationKind]); const row = result.rows[0]; if (!row) return undefined; const record = row.reservation as StripeReservationRecord; if (record.id !== id || record.dealerId !== dealerId) throw new ReservationError('Reservation data is inconsistent.', 409); return { eventId: row.id, record }; }
async function writeRecord(client: Client, eventId: string, record: StripeReservationRecord) { await client.query("UPDATE lead_events SET payload = jsonb_set(payload, '{reservation}', $2::jsonb) WHERE id=$1::uuid", [eventId, JSON.stringify(record)]); }
async function activity(client: Client, record: StripeReservationRecord, body: string, extra: Record<string, unknown> = {}) { await client.query("INSERT INTO lead_events (lead_id,type,actor_type,body,payload) VALUES ($1::uuid,'note_added','system',$2,$3::jsonb)", [record.id, body, JSON.stringify({ kind: 'stripe_reservation_activity', reservationId: record.id, ...extra })]); }
async function competingSale(client: Client, dealerId: string, vehicleId: string) { const rows = await client.query("SELECT id FROM sales WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND status IN ('draft','ready','signing','signed','completed') UNION ALL SELECT id FROM sale_workspace WHERE dealer_id=$1 AND state#>>'{draft,vehicleId}'=$2::text AND state#>>'{lifecycle,status}' IN ('reserved','sold') LIMIT 1", [dealerId, vehicleId]); return rows.rows.length > 0; }
export async function listStripeReservations(dealerId: string, database: SaleWorkspaceDatabase = pool) { const result = await database.query("SELECT e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND e.payload->>'kind'=$2 ORDER BY l.created_at DESC LIMIT 500", [dealerId, stripeReservationKind]); return result.rows.map(row => row.reservation as StripeReservationRecord); }
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
