import { currentDealerId } from "../lib/tenant-context";
import { Router, type IRouter, type Request, type Response } from 'express';
import { pool } from '@workspace/db';
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { requirePermission, requireStaff } from '../middlewares/staff-auth';
import { dealerIntegrationsStore, effectiveResendSettings } from '../lib/dealer-integrations-store';
import { dealerProfile } from '../lib/enquiry-notifications';
import { sendTemplatedEmail } from '../lib/email-provider';
import { ReservationError } from '../lib/online-reservations';
import { assertStripeReady, verifyStripeWebhook } from '../lib/stripe-payments';
import { createStripeReservation, listStripeReservations, processStripeReservationEvent, readCustomerStripeStatus, recordStripeNotification, stripeReservationView, type StripeReservationRecord } from '../lib/stripe-reservation-store';
const router: IRouter = Router();
const dealerId = () => currentDealerId();
function failure(error: unknown, _req: Request, res: Response) { res.status(error instanceof ReservationError ? error.status : 503).json({ error: error instanceof ReservationError ? error.message : 'The reservation payment service is unavailable. Please contact the dealership.' }); }
const attempts = new Map<string, { count: number; until: number }>();
const statusAttempts = new Map<string, { count: number; until: number }>();
function statusLimited(req: Request, res: Response) { const now = Date.now(); for (const [key, value] of statusAttempts) if (value.until <= now) statusAttempts.delete(key); const key = req.ip ?? 'unknown', value = statusAttempts.get(key) ?? { count: 0, until: now + 60_000 }; if (value.count >= 60 || statusAttempts.size >= 10_000 && !statusAttempts.has(key)) { res.set('Retry-After', '60').status(429).json({ error: 'Please wait before checking payment status again.' }); return true; } value.count++; statusAttempts.set(key, value); return false; }
function limited(req: Request, res: Response) { const now = Date.now(); for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key); const key = req.ip ?? 'unknown', value = attempts.get(key) ?? { count: 0, until: now + 15 * 60_000 }; if (value.count >= 12 || attempts.size >= 10000 && !attempts.has(key)) { res.set('Retry-After', '900').status(429).json({ error: 'Too many payment attempts. Please wait before trying again.' }); return true; } value.count++; attempts.set(key, value); return false; }
export async function sendStripeReservationEmail(record: StripeReservationRecord, kind: 'reservation_confirmation' | 'reservation_payment' | 'reservation_refund') {
  if (kind === 'reservation_refund' && !['partially_refunded', 'refunded'].includes(record.paymentStatus)) return;
  if (record.notifications?.[kind]?.status === 'sent' && (kind !== 'reservation_refund' || record.notifications[kind]?.amountPence === record.amountRefundedPence && record.notifications[kind]?.revision === (record.refundRevision ?? 0))) return;
  const settings = await dealerIntegrationsStore.readPrivate(); if (!effectiveResendSettings(settings).enabled) return;
  const dealer = await dealerProfile(), money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
  const attachments: Array<{ filename: string; content: string }> = [];
  let documentNumber = '';
  if (record.saleId && kind !== 'reservation_confirmation') {
    const result = await pool.query('SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid', [record.dealerId, record.saleId]); const sale = result.rows[0]?.state as SaleWorkspaceRecord | undefined;
    const document = [...(sale?.documents ?? [])].reverse().find(item => kind === 'reservation_refund' ? item.type === 'receipt' && item.snapshot.payments.some(payment => payment.id === item.paymentId && payment.kind === 'refund') : item.type === 'receipt' && item.snapshot.payments.some(payment => payment.id === item.paymentId && payment.kind === 'deposit'));
    const archive = document && sale?.documentArchives?.[document.id];
    if (archive && document) { documentNumber = document.number; attachments.push({ filename: `${document.number.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf`, content: archive.content }); }
  }
  try {
    const providerId = await sendTemplatedEmail({ templateId: kind, to: record.email, variables: { dealer_name: dealer.identity.name, dealer_email: dealer.contact.email, dealer_phone: dealer.contact.phone, customer_name: record.customerName, customer_email: record.email, reference: record.reference, vehicle_title: record.vehicleTitle, vehicle_registration: record.vehicleRegistration, amount: money(record.depositPence), amount_received: money(record.amountReceivedPence), payment_status: record.paymentStatus, reservation_status: record.status, document_number: documentNumber, expires_at: new Date(record.expiresAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }) }, facts: [{ label: 'Reservation reference', value: record.reference }, { label: 'Vehicle', value: record.vehicleTitle }, { label: 'Reservation status', value: record.status.replaceAll('_', ' ') }, { label: 'Payment status', value: record.paymentStatus.replaceAll('_', ' ') }, { label: 'Requested deposit', value: money(record.depositPence) }, { label: 'Amount received', value: money(record.amountReceivedPence) }, { label: 'Amount refunded', value: money(record.amountRefundedPence) }, ...(record.mode === 'test' ? [{ label: 'Payment mode', value: 'Stripe test payment — no real funds received' }] : [])], idempotencyKey: `stripe-reservation-${record.id}-${kind}-${kind === 'reservation_refund' ? `${record.amountRefundedPence}-${record.refundRevision ?? 0}` : record.paymentIntentId ?? 'pending'}`, attachments });
    await recordStripeNotification(record.dealerId, record.id, kind, { status: 'sent', providerId, ...(kind === 'reservation_refund' ? { amountPence: record.amountRefundedPence, revision: record.refundRevision ?? 0 } : {}) });
  } catch { await recordStripeNotification(record.dealerId, record.id, kind, { status: 'failed', ...(kind === 'reservation_refund' ? { amountPence: record.amountRefundedPence, revision: record.refundRevision ?? 0 } : {}) }); }
}
router.get('/reservations/payment-readiness', async (_req, res) => { res.set('Cache-Control', 'no-store'); try { const config = (await dealerIntegrationsStore.readPrivate()).stripe; let enabled = false; try { assertStripeReady(config); enabled = true; } catch {} res.json({ enabled, mode: enabled ? config.mode : null, prepared: true }); } catch { res.json({ enabled: false, mode: null, prepared: true }); } });
router.post('/reservations/checkout', async (req, res) => { res.set('Cache-Control', 'no-store'); if (limited(req, res)) return; try { const settings = (await dealerIntegrationsStore.readPrivate()).stripe; assertStripeReady(settings); const created = await createStripeReservation(req.body, dealerId(), settings); const record = (await listStripeReservations(dealerId())).find(item => item.id === created.reservation.id); if (record) void sendStripeReservationEmail(record, 'reservation_confirmation').catch(() => {}); res.status(created.replayed ? 200 : 201).json(created); } catch (error) { failure(error, req, res); } });
router.post('/reservations/payment-status', async (req, res) => { res.set('Cache-Control', 'no-store'); if (statusLimited(req, res)) return; const reference = req.body?.reference, token = req.body?.token; if (typeof reference !== 'string' || typeof token !== 'string') { res.status(404).json({ error: 'This payment status link is unavailable.' }); return; } try { res.json({ reservation: await readCustomerStripeStatus(dealerId(), reference, token) }); } catch (error) { failure(error, req, res); } });
router.get('/staff/stripe-reservations', requireStaff, async (_req, res) => { res.set('Cache-Control', 'no-store'); try { res.json({ reservations: (await listStripeReservations(dealerId())).map(record => ({ ...stripeReservationView(record), customerName: record.customerName, email: record.email, phone: record.phone, notifications: record.notifications ?? {} })) }); } catch { res.status(503).json({ error: 'Stripe reservations could not be loaded.' }); } });
router.post('/staff/stripe-reservations/:id/email', requireStaff, requirePermission('sales.manage'), async (req, res) => { res.set('Cache-Control', 'no-store'); try { const record = (await listStripeReservations(dealerId())).find(item => item.id === req.params.id); if (!record) throw new ReservationError('Reservation not found.', 404); const kind = record.amountRefundedPence > 0 ? 'reservation_refund' : record.paymentStatus === 'confirmed' ? 'reservation_payment' : 'reservation_confirmation'; await sendStripeReservationEmail(record, kind); const latest = (await listStripeReservations(dealerId())).find(item => item.id === record.id); res.json({ delivery: latest?.notifications?.[kind] ?? { status: 'disabled' } }); } catch (error) { failure(error, req, res); } });
router.post('/reservations/stripe/webhook', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const settings = (await dealerIntegrationsStore.readPrivate()).stripe;
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) throw new ReservationError('The original webhook body is required.', 400);
    const event = verifyStripeWebhook(raw, req.get('stripe-signature'), settings.webhookSecret);
    const record = await processStripeReservationEvent(event, dealerId(), settings);
    if (record && record.mode === 'live' && ['checkout.session.completed', 'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed'].includes(event.type)) await sendStripeReservationEmail(record, event.type === 'checkout.session.completed' ? 'reservation_payment' : 'reservation_refund');
    res.json({ received: true });
  } catch (error) { failure(error, req, res); }
});
export default router;
