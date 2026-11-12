import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { vehicleRegistrationLabel } from '@workspace/vehicle-meta';
import { pool } from '@workspace/db';
import { ReservationError } from './historical-reservations';
import { hasSaleWorkspaceStockClaim, recordStripeReservationDeposit, recordStripeReservationRefund, type SaleWorkspaceReadClient, type SaleWorkspaceDatabase } from './sale-workspace-store';
import { assertStripeReady, createStripeCheckoutSession, readStripeCheckoutSession, readStripePaymentIntentMetadata, StripeCheckoutPreparationError, validatePaidCheckout, type StripeEvent } from './stripe-payments';
import { dealerIntegrationsStore, type StripeSettings } from './dealer-integrations-store';
import { siteUrl } from './enquiry-links';
import { assertPublicStripeVehicle, parsePublicStripeReservation, publicReservationDepositPence, stripeReservationFingerprint, type ReservableStripeVehicle } from './stripe-reservation-policy';
export const stripeReservationKind = 'online_stripe_reservation';
const publicCheckoutChannel = 'public-v1';
const checkoutHoldMs = 31 * 60_000;
const checkoutRetryMs = 23 * 60 * 60_000;
export type StripeReservationRecord = {
  id: string; dealerId: string; reference: string; vehicleId: string; vehicleTitle: string; vehicleRegistration?: string;
  depositPence: number; expectedPricePence: number; amountReceivedPence: number; amountRefundedPence: number;
  paymentStatus: 'pending' | 'confirmed' | 'test_confirmed' | 'refund_pending' | 'refund_failed' | 'partially_refunded' | 'refunded' | 'cancelled'; status: 'awaiting_payment' | 'reserved' | 'cancelled' | 'expired' | 'refunded';
  mode: 'test' | 'live'; createdAt: string; expiresAt: string; idempotencyKey: string; requestFingerprint: string;
  customerName: string; email: string; phone: string; terms: string; termsAccepted: true;
  checkoutChannel?: typeof publicCheckoutChannel;
  sessionId?: string; checkoutUrl?: string; paymentIntentId?: string; eventIds: string[]; saleId?: string;
  checkoutUrls?: { success: string; cancel: string }; credentialFingerprint?: string; checkoutAttemptCount?: number; needsReview?: boolean; lastCheckoutCheckAt?: string;
  stockConflictPayment?: { paymentIntentId: string; amountPence: number };
  providerRefunds?: Record<string, { amountPence: number; status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled'; eventCreated: number; eventId: string }>;
  refundHistoryComplete?: boolean; refundRevision?: number;
  notifications?: Record<string, { status: 'sent' | 'failed'; providerId?: string; attemptedAt: string; amountPence?: number; revision?: number }>;
  partExchange?: { registration: string; mileage: number };
};
export function stripeReservationView(record: StripeReservationRecord) { return { id: record.id, reference: record.reference, vehicleId: record.vehicleId, vehicleTitle: record.vehicleTitle, vehicleRegistration: record.vehicleRegistration, depositPence: record.depositPence, amountReceivedPence: record.amountReceivedPence, amountRefundedPence: record.amountRefundedPence, paymentStatus: record.paymentStatus, status: record.status, createdAt: record.createdAt, expiresAt: record.expiresAt, saleId: record.saleId, mode: record.mode, needsReview: record.needsReview ?? false }; }
type Client = SaleWorkspaceReadClient;
export type StripeReservationServices = {
  database?: SaleWorkspaceDatabase;
  transport?: typeof fetch;
  depositRecorder?: typeof recordStripeReservationDeposit;
  refundRecorder?: typeof recordStripeReservationRefund;
  channel?: typeof publicCheckoutChannel | 'historical';
  readStockPlatform?: () => Promise<string>;
};
async function transaction<T>(run: (client: Client) => Promise<T>, database: SaleWorkspaceDatabase = pool): Promise<T> { const client = await database.connect(); try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }
async function dealerLock(client: Client, dealerId: string) { await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-workspace:${dealerId}`]); }
async function vehicleLock(client: Client, vehicleId: string) { await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sale-vehicle:${vehicleId}`]); }
async function readRecord(client: Client, dealerId: string, id: string): Promise<{ eventId: string; record: StripeReservationRecord } | undefined> { const result = await client.query("SELECT e.id, e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND l.id=$2::uuid AND e.payload->>'kind'=$3 LIMIT 1 FOR UPDATE OF e", [dealerId, id, stripeReservationKind]); const row = result.rows[0]; if (!row) return undefined; const record = row.reservation as StripeReservationRecord; if (record.id !== id || record.dealerId !== dealerId) throw new ReservationError('Reservation data is inconsistent.', 409); return { eventId: row.id, record }; }
async function writeRecord(client: Client, eventId: string, record: StripeReservationRecord) { await client.query("UPDATE lead_events SET payload = jsonb_set(payload, '{reservation}', $2::jsonb) WHERE id=$1::uuid", [eventId, JSON.stringify(record)]); }
async function activity(client: Client, record: StripeReservationRecord, body: string, extra: Record<string, unknown> = {}) { await client.query("INSERT INTO lead_events (lead_id,type,actor_type,body,payload) VALUES ($1::uuid,'note_added','system',$2,$3::jsonb)", [record.id, body, JSON.stringify({ kind: 'stripe_reservation_activity', reservationId: record.id, ...extra })]); }
async function competingSale(client: Client, dealerId: string, vehicleId: string, includeLegacyLedger = false) {
  const rows = await client.query("SELECT id FROM sales WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND status IN ('draft','ready','signing','signed','completed') LIMIT 1", [dealerId, vehicleId]);
  return rows.rows.length > 0 || await hasSaleWorkspaceStockClaim(client, dealerId, vehicleId, { includeLegacyLedger });
}
async function assertCheckoutHoldCanContinue(client: Client, record: StripeReservationRecord) {
  await vehicleLock(client, record.vehicleId);
  const vehicle = (await client.query('SELECT inventory_status,audit_metadata FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [record.dealerId, record.vehicleId])).rows[0];
  if (!vehicle || vehicle.inventory_status !== 'reserved' || vehicle.audit_metadata?.onlineStripeReservationId !== record.id
    || vehicle.audit_metadata?.saleWorkspaceId || await competingSale(client, record.dealerId, record.vehicleId, true)) {
    throw new ReservationError('This car is already being purchased or reserved.', 409);
  }
}
function stripeCredentialFingerprint(settings: StripeSettings) {
  return createHash('sha256').update(settings.secretKey).digest('hex');
}

function stripeStatusToken(record: Pick<StripeReservationRecord, 'dealerId' | 'id' | 'idempotencyKey'>) {
  return createHash('sha256').update(`stripe-reservation-status:${record.dealerId}:${record.id}:${record.idempotencyKey}`).digest('hex');
}

export async function createStripeReservation(
  raw: unknown,
  dealerId: string,
  settings: StripeSettings,
  policy: { terms: string },
  services: StripeReservationServices = {},
) {
  assertStripeReady(settings);
  const origin = new URL(siteUrl('/'));
  if (origin.protocol !== 'https:' || origin.username || origin.password) {
    throw new ReservationError('The payment return address is not configured safely.', 503);
  }
  const input = parsePublicStripeReservation(raw, policy.terms);
  const fingerprint = stripeReservationFingerprint(input);
  const stockPlatform = await (services.readStockPlatform ?? (async () => (await dealerIntegrationsStore.readStockConnection()).connection.platform))();
  const configuredThreshold = Number(process.env.STOCK_MISSING_HIDE_THRESHOLD);
  const threshold = Number.isFinite(configuredThreshold) && configuredThreshold >= 0 ? configuredThreshold : 2;
  const database = services.database ?? pool;
  const created = await transaction(async (client) => {
    await dealerLock(client, dealerId);
    const prior = await client.query(
      `SELECT e.payload->'reservation' AS reservation FROM lead_events e
       JOIN leads l ON l.id=e.lead_id
       WHERE l.dealer_id=$1 AND e.payload->>'kind'=$2
       AND e.payload->'reservation'->>'checkoutChannel'=$3
       AND e.payload->'reservation'->>'idempotencyKey'=$4 LIMIT 1`,
      [dealerId, stripeReservationKind, publicCheckoutChannel, input.idempotencyKey],
    );
    if (prior.rows[0]) {
      const record = prior.rows[0].reservation as StripeReservationRecord;
      if (record.requestFingerprint !== fingerprint || record.mode !== settings.mode) {
        throw new ReservationError('This reservation attempt used different details. Please start again.', 409);
      }
      if (record.status !== 'awaiting_payment' || record.stockConflictPayment || Date.parse(record.expiresAt) <= Date.now()) {
        throw new ReservationError('This checkout has closed. Refresh the page or contact the dealership.', 409);
      }
      if (record.credentialFingerprint !== stripeCredentialFingerprint(settings)) {
        throw new ReservationError('The payment account changed. Contact the dealership to review your reservation.', 409);
      }
      await assertCheckoutHoldCanContinue(client, record);
      return { record, replayed: true };
    }
    await vehicleLock(client, input.vehicleId);
    const vehicle = (await client.query('SELECT * FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [dealerId, input.vehicleId])).rows[0] as ReservableStripeVehicle | undefined;
    assertPublicStripeVehicle(vehicle, input, dealerId, stockPlatform, threshold);
    const competing = await client.query("SELECT id FROM leads WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND stage IN ('reserved','sale_agreed','collected') LIMIT 1", [dealerId, input.vehicleId]);
    if (competing.rows.length || await competingSale(client, dealerId, input.vehicleId, true)) {
      throw new ReservationError('This car is already being purchased or reserved.', 409);
    }

    const id = randomUUID();
    const now = new Date();
    const record: StripeReservationRecord = {
      id, dealerId, reference: `RSV-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      vehicleId: vehicle.id, vehicleTitle: vehicle.website_title_override || vehicle.title || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle',
      vehicleRegistration: vehicleRegistrationLabel({ registration: vehicle.registration, registrationBand: vehicle.registration_band, plate: vehicle.plate, vrm: vehicle.vrm, year: vehicle.year }) ?? undefined,
      depositPence: publicReservationDepositPence, expectedPricePence: input.expectedPricePence,
      amountReceivedPence: 0, amountRefundedPence: 0, paymentStatus: 'pending', status: 'awaiting_payment',
      mode: settings.mode, checkoutChannel: publicCheckoutChannel, createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + checkoutHoldMs).toISOString(), idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
      customerName: input.customerName, email: input.email, phone: input.phone, terms: policy.terms, termsAccepted: true,
      credentialFingerprint: stripeCredentialFingerprint(settings), eventIds: [],
    };
    const returnFragment = new URLSearchParams({ reference: record.reference, token: stripeStatusToken(record) });
    record.checkoutUrls = {
      success: siteUrl(`/reservation-payment#${returnFragment}`),
      cancel: siteUrl(`/reservation-payment#${returnFragment}&cancelled=1`),
    };
    await client.query(
      `UPDATE vehicles SET inventory_status='reserved',
       audit_metadata=coalesce(audit_metadata,'{}'::jsonb) || jsonb_build_object('onlineStripeReservationId',$3::text),updated_at=now()
       WHERE dealer_id=$1 AND id=$2::uuid AND inventory_status='available'`,
      [dealerId, vehicle.id, id],
    );
    await client.query(
      `INSERT INTO leads (id,dealer_id,vehicle_id,vehicle_title,vehicle_registration,vehicle_price,stage,source,customer_name,email,phone,preferred_contact,summary,next_action,next_action_due_at)
       VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,'reserved','website_form',$7,$8,$9,'email',$10,$11,$12)`,
      [id, dealerId, vehicle.id, record.vehicleTitle, record.vehicleRegistration ?? null, input.expectedPricePence / 100, input.customerName, input.email, input.phone,
        'Website reservation awaiting payment. No deposit received.', 'Await payment confirmation before recording a deposit.', record.expiresAt],
    );
    await client.query(
      "INSERT INTO lead_events (lead_id,type,actor_type,body,payload) VALUES ($1::uuid,'note_added','system',$2,$3::jsonb)",
      [id, 'Car temporarily held while the customer completes checkout. No payment received.', JSON.stringify({ kind: stripeReservationKind, reservation: record })],
    );
    return { record, replayed: false };
  }, database);

  const record = created.record.checkoutUrl ? created.record : await prepareCheckout(created.record, settings, services);
  if (!record.checkoutUrl || record.status !== 'awaiting_payment') {
    throw new ReservationError('This checkout has closed. Refresh the page or contact the dealership.', 409);
  }
  const { saleId: _saleId, ...reservation } = stripeReservationView(record);
  return { reservation, checkoutUrl: record.checkoutUrl, replayed: created.replayed };
}

async function prepareCheckout(record: StripeReservationRecord, settings: StripeSettings, services: StripeReservationServices) {
  const database = services.database ?? pool;
  const urls = record.checkoutUrls;
  if (!urls || record.credentialFingerprint !== stripeCredentialFingerprint(settings)) {
    throw new ReservationError('The saved checkout details need dealership review.', 409);
  }
  const attempt = await transaction(async (client) => {
    await dealerLock(client, record.dealerId);
    const current = await readRecord(client, record.dealerId, record.id);
    if (!current || current.record.status !== 'awaiting_payment' || current.record.stockConflictPayment) throw new ReservationError('This checkout has closed.', 409);
    await assertCheckoutHoldCanContinue(client, current.record);
    if (current.record.checkoutUrl) return { existing: current.record } as const;
    current.record.checkoutAttemptCount = (current.record.checkoutAttemptCount ?? 0) + 1;
    await writeRecord(client, current.eventId, current.record);
    return { number: current.record.checkoutAttemptCount } as const;
  }, database);
  if (attempt.existing) return attempt.existing;

  let session: Awaited<ReturnType<typeof createStripeCheckoutSession>>;
  try {
    session = await createStripeCheckoutSession(settings, record, urls, services.transport ?? fetch);
  } catch (error) {
    if (error instanceof StripeCheckoutPreparationError) {
      await transaction(async (client) => {
        await dealerLock(client, record.dealerId);
        await vehicleLock(client, record.vehicleId);
        const current = await readRecord(client, record.dealerId, record.id);
        if (!current || current.record.status !== 'awaiting_payment') return;
        if (error.recoveredSessionId && !current.record.sessionId) {
          current.record.sessionId = error.recoveredSessionId;
          await writeRecord(client, current.eventId, current.record);
        } else if (error.definitiveFailure && attempt.number === 1 && current.record.checkoutAttemptCount === 1 && !current.record.sessionId) {
          // An ambiguous or concurrent attempt may have reached Stripe. Keep that hold.
          await releaseHold(client, current.eventId, current.record, 'cancelled');
        }
      }, database);
    }
    throw error;
  }
  return transaction(async (client) => {
    await dealerLock(client, record.dealerId);
    const current = await readRecord(client, record.dealerId, record.id);
    if (!current || current.record.status !== 'awaiting_payment') throw new ReservationError('This checkout has closed.', 409);
    if (current.record.sessionId && current.record.sessionId !== session.id) {
      throw new ReservationError('The checkout provider returned a different session. Contact the dealership.', 409);
    }
    current.record.sessionId = session.id;
    current.record.checkoutUrl = session.url;
    await writeRecord(client, current.eventId, current.record);
    return current.record;
  }, database);
}

export async function readCustomerStripeStatus(dealerId: string, reference: string, token: string, database: SaleWorkspaceDatabase = pool) {
  if (!/^RSV-[A-F0-9]{12}$/.test(reference) || !/^[a-f0-9]{64}$/.test(token)) throw new ReservationError('This payment status link is unavailable.', 404);
  const result = await database.query(
    "SELECT e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND e.payload->>'kind'=$2 AND e.payload->'reservation'->>'reference'=$3 LIMIT 1",
    [dealerId, stripeReservationKind, reference],
  );
  const record = result.rows[0]?.reservation as StripeReservationRecord | undefined;
  if (!record || record.dealerId !== dealerId || record.reference !== reference || !timingSafeEqual(Buffer.from(stripeStatusToken(record), 'hex'), Buffer.from(token, 'hex'))) {
    throw new ReservationError('This payment status link is unavailable.', 404);
  }
  const { saleId: _saleId, ...view } = stripeReservationView(record);
  return view;
}

export async function listStripeReservations(dealerId: string, database: SaleWorkspaceDatabase = pool) { const result = await database.query("SELECT e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.dealer_id=$1 AND e.payload->>'kind'=$2 ORDER BY l.created_at DESC LIMIT 500", [dealerId, stripeReservationKind]); return result.rows.map(row => row.reservation as StripeReservationRecord); }
async function releaseHold(client: Client, eventId: string, record: StripeReservationRecord, state: 'expired' | 'cancelled') {
  if (record.status !== 'awaiting_payment' || record.amountReceivedPence !== 0 || record.stockConflictPayment) return;
  const competing = await client.query("SELECT id FROM leads WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND id<>$3::uuid AND stage IN ('reserved','sale_agreed','collected') LIMIT 1", [record.dealerId, record.vehicleId, record.id]);
  if (competing.rows.length || await competingSale(client, record.dealerId, record.vehicleId)) throw new ReservationError('This reservation is linked to another sale or hold. Review it before releasing stock.', 409);
  if (record.checkoutChannel === publicCheckoutChannel) {
    const released = await client.query(
      `UPDATE vehicles SET inventory_status='available',audit_metadata=audit_metadata-'onlineStripeReservationId',updated_at=now()
       WHERE dealer_id=$1 AND id=$2::uuid AND inventory_status='reserved' AND audit_metadata->>'onlineStripeReservationId'=$3
       AND audit_metadata->>'saleWorkspaceId' IS NULL RETURNING id`,
      [record.dealerId, record.vehicleId, record.id],
    );
    if (!released.rows.length) throw new ReservationError('This car is no longer held by this reservation. Contact the dealership to review it.', 409);
  } else {
    const vehicle = (await client.query('SELECT audit_metadata FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [record.dealerId, record.vehicleId])).rows[0];
    if (vehicle?.audit_metadata?.onlineStripeReservationId) {
      throw new ReservationError('This car belongs to another checkout hold.', 409);
    }
    await client.query("UPDATE vehicles SET inventory_status='available',updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid AND inventory_status='reserved'", [record.dealerId, record.vehicleId]);
  }
  record.status = state;
  record.paymentStatus = 'cancelled';
  record.needsReview = false;
  await client.query("UPDATE leads SET stage='qualifying',next_action=$3,next_action_due_at=NULL,updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid AND stage='reserved'", [record.dealerId, record.id, `Online payment ${state}. No deposit was recorded.`]);
  await writeRecord(client, eventId, record);
  await activity(client, record, `Stripe reservation ${state}. No payment or refund recorded; vehicle hold released.`);
  return true;
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

async function reconcileStockConflictRefund(client: Client, record: StripeReservationRecord, event: StripeEvent) {
  const payment = record.stockConflictPayment!;
  const providerRecord = { ...record, amountReceivedPence: payment.amountPence };
  const refund = reconcileStripeRefundEvent(event, providerRecord);
  record.providerRefunds = providerRecord.providerRefunds;
  record.refundHistoryComplete = refund.complete;
  const fullyRefunded = refund.complete && !refund.pending && refund.succeededPence === payment.amountPence;
  const alreadyRefunded = record.status === 'refunded' && record.paymentStatus === 'refunded';
  if (fullyRefunded) {
    if (alreadyRefunded) return;
    const leads = await client.query("SELECT id FROM leads WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND id<>$3::uuid AND stage IN ('reserved','sale_agreed','collected') LIMIT 1", [record.dealerId, record.vehicleId, record.id]);
    const explicitClaim = leads.rows.length > 0 || await competingSale(client, record.dealerId, record.vehicleId);
    // A fully refunded checkout can release only its own temporary marker.
    // Leave another explicit owner, a different hold, and non-reserved stock alone.
    await client.query(
      `UPDATE vehicles SET inventory_status=CASE
         WHEN inventory_status='reserved' AND audit_metadata->>'saleWorkspaceId' IS NULL AND NOT $4::boolean
           THEN 'available' ELSE inventory_status END,
         audit_metadata=audit_metadata-'onlineStripeReservationId',updated_at=now()
       WHERE dealer_id=$1 AND id=$2::uuid AND audit_metadata->>'onlineStripeReservationId'=$3`,
      [record.dealerId, record.vehicleId, record.id, explicitClaim],
    );
    record.status = 'refunded';
    record.paymentStatus = 'refunded';
    record.amountReceivedPence = payment.amountPence;
    record.amountRefundedPence = payment.amountPence;
    record.needsReview = false;
    await client.query("UPDATE leads SET stage='qualifying',next_action=$3,next_action_due_at=NULL,updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid AND stage='reserved'",
      [record.dealerId, record.id, 'Stripe confirmed the full refund of the conflicting checkout. No sale was created for this payment.']);
    await activity(client, record, 'Stripe confirmed the full refund of a payment held for stock review. Only this checkout’s temporary hold was cleared.', { eventId: event.id, amountRefundedPence: payment.amountPence });
  } else if (alreadyRefunded || refund.failed) {
    record.needsReview = true;
    record.paymentStatus = 'refund_failed';
    if (refund.complete && alreadyRefunded) record.amountRefundedPence = refund.succeededPence;
    await client.query('UPDATE leads SET next_action=$3,updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid',
      [record.dealerId, record.id, 'Check the conflicting checkout refund in Stripe before taking any further action.']);
  }
}

export async function processStripeReservationEvent(event: StripeEvent, dealerId: string, settings: StripeSettings, services: StripeReservationServices = {}): Promise<StripeReservationRecord | undefined> {
  const database = services.database ?? pool, runTransaction = <T>(run: (client: Client) => Promise<T>) => transaction(run, database);
  if (event.livemode !== (settings.mode === 'live')) throw new ReservationError('Webhook payment mode does not match this dealership.', 409);
  const refundEvent = ['charge.refunded', 'refund.created', 'refund.updated', 'refund.failed'].includes(event.type);
  // Recent Charge objects omit their refunds collection. New reservations use Refund events.
  if (services.channel === publicCheckoutChannel && event.type === 'charge.refunded') return undefined;
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
    const publicCheckout = record.checkoutChannel === publicCheckoutChannel;
    if (services.channel && (services.channel === publicCheckoutChannel) !== publicCheckout) return undefined;
    if (record.mode !== settings.mode) throw new ReservationError('The reservation payment mode changed.', 409);
    if (record.eventIds.includes(event.id)) return record;
    if (event.type === 'checkout.session.completed') {
      const paid = validatePaidCheckout(event, record);
      if (publicCheckout && object.metadata?.vehicle_id !== record.vehicleId) {
        throw new ReservationError('The payment confirmation does not match this car.', 409);
      }
      if (record.paymentIntentId && record.paymentIntentId !== paid.paymentIntentId) throw new ReservationError('A different payment is already linked to this reservation.', 409);
      if (record.paymentIntentId === paid.paymentIntentId && ['confirmed', 'test_confirmed', 'refund_pending', 'refund_failed', 'partially_refunded', 'refunded'].includes(record.paymentStatus)) { record.eventIds.push(event.id); await writeRecord(client, current.eventId, record); return record; }
      if (record.stockConflictPayment) {
        if (record.stockConflictPayment.paymentIntentId !== paid.paymentIntentId) throw new ReservationError('A different payment is already awaiting review.', 409);
        record.eventIds.push(event.id);
        await writeRecord(client, current.eventId, record);
        return record;
      }
      const vehicle = (await client.query('SELECT inventory_status,source_status,archived_at,audit_metadata FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [dealerId, record.vehicleId])).rows[0];
      const competingClaim = publicCheckout && record.mode === 'live' && vehicle?.inventory_status === 'reserved'
        && vehicle.audit_metadata?.onlineStripeReservationId === record.id
        && (Boolean(vehicle.audit_metadata.saleWorkspaceId) || await competingSale(client, dealerId, record.vehicleId, true));
      if (competingClaim) {
        record.stockConflictPayment = { paymentIntentId: paid.paymentIntentId, amountPence: paid.amountPence };
        record.paymentIntentId = paid.paymentIntentId;
        record.eventIds.push(event.id);
        record.needsReview = false;
        await flagReview(client, current.eventId, record, 'Stripe confirmed a payment for a car already linked to another buyer. Reconcile the £99 payment in Stripe before changing stock.', { eventId: event.id, ...record.stockConflictPayment });
        return record;
      }
      if (!['awaiting_payment', 'reserved'].includes(record.status) || vehicle?.inventory_status !== 'reserved' ||
          (publicCheckout ? vehicle.audit_metadata?.onlineStripeReservationId !== record.id : Boolean(vehicle.audit_metadata?.onlineStripeReservationId))) {
        const message = 'Stripe confirmed a payment but this car is no longer held by that checkout. Reconcile the payment in Stripe before changing stock.';
        if (publicCheckout) {
          record.eventIds.push(event.id);
          record.needsReview = false;
          await flagReview(client, current.eventId, record, message, { eventId: event.id, paymentIntentId: paid.paymentIntentId, amountPence: paid.amountPence });
          // Acknowledge after storing staff review rather than writing against another reservation.
          return record;
        }
        throw new ReservationError(message, 409);
      }
      if (record.mode === 'live') {
        const sale = await (services.depositRecorder ?? recordStripeReservationDeposit)({ dealerId, reservationId: record.id, vehicleId: record.vehicleId, customerName: record.customerName, email: record.email, phone: record.phone, vehicleTitle: record.vehicleTitle, vehicleRegistration: record.vehicleRegistration, expectedPricePence: record.expectedPricePence, amountPence: paid.amountPence, currency: 'gbp', paymentIntentId: paid.paymentIntentId, eventId: event.id }, client);
        record.saleId = sale.id; record.amountReceivedPence = paid.amountPence; record.paymentStatus = 'confirmed'; record.status = 'reserved'; record.paymentIntentId = paid.paymentIntentId; record.sessionId = paid.sessionId; record.needsReview = Boolean(publicCheckout && (vehicle.source_status !== 'live' || vehicle.archived_at != null)); record.refundHistoryComplete = true;
        if (publicCheckout) {
          await client.query("UPDATE vehicles SET audit_metadata=audit_metadata-'onlineStripeReservationId' WHERE dealer_id=$1 AND id=$2::uuid AND audit_metadata->>'onlineStripeReservationId'=$3", [dealerId, record.vehicleId, record.id]);
        }
        await client.query("UPDATE leads SET summary=$3,next_action=$4,next_action_due_at=NULL,updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid", [dealerId, record.id, 'Stripe reservation deposit confirmed. Linked sale and receipt created.', record.needsReview ? 'The car is no longer in the active stock feed. Review availability with the buyer or arrange a full refund.' : 'Contact the buyer and arrange the remaining balance and handover.']);
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
      if (record.stockConflictPayment) {
        await reconcileStockConflictRefund(client, record, event);
        record.eventIds.push(event.id);
        await writeRecord(client, current.eventId, record);
        return record;
      }
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
      if (publicCheckout && (!/^cs_[A-Za-z0-9_]+$/.test(object.id ?? '') || object.mode !== 'payment' ||
          object.client_reference_id !== record.id || object.metadata?.vehicle_id !== record.vehicleId ||
          object.payment_status !== 'unpaid' || object.status !== 'expired')) {
        throw new ReservationError('Checkout has not been confirmed expired and unpaid.', 409);
      }
      if (object.payment_status === 'paid' || event.type === 'checkout.session.expired' && object.status !== 'expired') throw new ReservationError('The checkout cannot be released until its payment status is reconciled.', 409);
      await releaseHold(client, current.eventId, record, event.type === 'checkout.session.expired' ? 'expired' : 'cancelled');
    }
    record.eventIds.push(event.id); await writeRecord(client, current.eventId, record); return record;
  });
}

async function flagReview(client: Client, eventId: string, record: StripeReservationRecord, message: string, extra?: Record<string, unknown>) {
  if (record.needsReview) return;
  record.needsReview = true;
  await writeRecord(client, eventId, record);
  await client.query('UPDATE leads SET next_action=$3,updated_at=now() WHERE dealer_id=$1 AND id=$2::uuid', [record.dealerId, record.id, message]);
  await activity(client, record, message, extra);
}

/** Release only a hold whose checkout never started or whose matching session Stripe confirms expired and unpaid. */
export async function expireAbandonedStripeReservations(dealerId: string, settings: StripeSettings, services: StripeReservationServices = {}) {
  const database = services.database ?? pool;
  const selected = await database.query(
    `SELECT e.payload->'reservation' AS reservation FROM lead_events e JOIN leads l ON l.id=e.lead_id
     WHERE l.dealer_id=$1 AND e.payload->>'kind'=$2
       AND e.payload->'reservation'->>'status'='awaiting_payment'
       AND e.payload->'reservation'->>'mode'=$3
       AND e.payload->'reservation'->>'checkoutChannel'=$4
       AND e.payload->'reservation'->'stockConflictPayment' IS NULL
       AND (e.payload->'reservation'->>'expiresAt')::timestamptz <= $5::timestamptz
     ORDER BY COALESCE(e.payload->'reservation'->>'lastCheckoutCheckAt', e.payload->'reservation'->>'createdAt') ASC
     LIMIT 10`,
    [dealerId, stripeReservationKind, settings.mode, publicCheckoutChannel, new Date().toISOString()],
  );
  let released = 0;
  for (const { reservation } of selected.rows) {
    const record = reservation as StripeReservationRecord;
    try {
      const checked = await transaction(async (client) => {
        await dealerLock(client, dealerId);
        await vehicleLock(client, record.vehicleId);
        const current = await readRecord(client, dealerId, record.id);
        if (!current || current.record.status !== 'awaiting_payment') return;
        if (!current.record.sessionId && !current.record.checkoutAttemptCount) {
          if (await releaseHold(client, current.eventId, current.record, 'expired')) released++;
          return;
        }
        current.record.lastCheckoutCheckAt = new Date().toISOString();
        await writeRecord(client, current.eventId, current.record);
        return current.record;
      }, database);
      if (!checked) continue;
      if (checked.credentialFingerprint !== stripeCredentialFingerprint(settings)) throw new Error('The Stripe account changed.');
      let sessionId = checked.sessionId;
      if (!sessionId && Date.now() - Date.parse(checked.createdAt) < checkoutRetryMs) {
        // The saved request and idempotency key are identical. A validation error from a retry
        // cannot prove the earlier request never reached Stripe, so the hold remains protected.
        sessionId = (await prepareCheckout(checked, settings, services)).sessionId;
      }
      if (!sessionId) throw new Error('Checkout session could not be recovered.');
      const session = await readStripeCheckoutSession(settings, sessionId, services.transport ?? fetch);
      if (session.status !== 'expired' || session.payment_status !== 'unpaid' || session.mode !== 'payment' ||
          session.metadata?.dealer_id !== dealerId || session.metadata?.reservation_id !== checked.id ||
          session.metadata?.vehicle_id !== checked.vehicleId || session.client_reference_id !== checked.id) {
        throw new Error('Checkout could not be confirmed expired and unpaid.');
      }
      const didRelease = await transaction(async (client) => {
        await dealerLock(client, dealerId);
        await vehicleLock(client, checked.vehicleId);
        const current = await readRecord(client, dealerId, checked.id);
        if (!current || current.record.sessionId !== sessionId) return false;
        return releaseHold(client, current.eventId, current.record, 'expired');
      }, database);
      if (didRelease) released++;
    } catch {
      await transaction(async (client) => {
        await dealerLock(client, dealerId);
        const current = await readRecord(client, dealerId, record.id);
        if (current?.record.status !== 'awaiting_payment') return;
        await flagReview(client, current.eventId, current.record, 'Checkout status is uncertain. Review the reservation in Stripe before releasing the car or recording payment.');
      }, database);
    }
  }
  return released;
}
