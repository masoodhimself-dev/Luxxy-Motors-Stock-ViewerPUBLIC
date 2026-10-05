import { createHmac, timingSafeEqual } from 'node:crypto';
import { integrationReadiness, type StripeSettings } from './dealer-integrations-store';
import { ReservationError } from './online-reservations';
export type StripeCheckoutSnapshot = { id: string; dealerId: string; vehicleId: string; vehicleTitle: string; depositPence: number; email: string; expiresAt: string };
export type StripeEvent = { id: string; type: string; livemode: boolean; created: number; data: { object: Record<string, any> } };
export class StripeCheckoutPreparationError extends ReservationError { constructor(message: string, readonly definitiveFailure: boolean, readonly recoveredSessionId?: string, readonly failureParam?: string) { super(message, 503); } }
export function assertStripeReady(settings: StripeSettings) {
  if (!settings.enabled || !integrationReadiness({ stripe: settings, resend: { enabled: false, apiKey: '', from: '', replyTo: '' } }).stripe.ready) throw new ReservationError('Online payment setup is being completed. Please contact the dealership.', 503);
}
export async function createStripeCheckoutSession(settings: StripeSettings, snapshot: StripeCheckoutSnapshot, urls: { success: string; cancel: string }, transport: typeof fetch = fetch): Promise<{ id: string; url: string }> {
  assertStripeReady(settings);
  if (!Number.isSafeInteger(snapshot.depositPence) || snapshot.depositPence < 100) throw new ReservationError('Invalid reservation deposit.');
  for (const url of [urls.success, urls.cancel]) { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || (settings.mode === 'live' && parsed.protocol !== 'https:')) throw new ReservationError('The payment return address is not configured safely.', 503); }
  const params = new URLSearchParams({ mode: 'payment', 'payment_method_types[0]': 'card', client_reference_id: snapshot.id, customer_email: snapshot.email, success_url: urls.success, cancel_url: urls.cancel, expires_at: String(Math.floor(new Date(snapshot.expiresAt).getTime() / 1000)), 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'gbp', 'line_items[0][price_data][unit_amount]': String(snapshot.depositPence), 'line_items[0][price_data][product_data][name]': `Reservation deposit: ${snapshot.vehicleTitle}`.slice(0, 250), 'metadata[reservation_id]': snapshot.id, 'metadata[dealer_id]': snapshot.dealerId, 'metadata[vehicle_id]': snapshot.vehicleId, 'payment_intent_data[metadata][reservation_id]': snapshot.id, 'payment_intent_data[metadata][dealer_id]': snapshot.dealerId });
  let response: Response;
  try { response = await transport('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${settings.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `reservation-checkout-${snapshot.dealerId}-${snapshot.id}` }, body: params.toString() }); } catch { throw new ReservationError('The payment provider could not be reached. Please retry with the same reservation details.', 503); }
  if (!response.ok) { let parameter: string | undefined; try { const failed = await response.json() as { error?: { type?: string; param?: string } }; if (response.status === 400 && failed.error?.type === 'invalid_request_error' && failed.error.param === 'expires_at') parameter = 'expires_at'; } catch {} throw new StripeCheckoutPreparationError(`The payment provider could not prepare checkout (HTTP ${response.status}). Please contact the dealership.`, [400, 401, 403, 404].includes(response.status), undefined, parameter); }
  const result = await response.json() as { id?: string; url?: string; livemode?: boolean };
  const sessionId = /^cs_[A-Za-z0-9_]+$/.test(result.id ?? '') ? result.id : undefined;
  if (!sessionId || !result.url || result.livemode !== (settings.mode === 'live')) throw new StripeCheckoutPreparationError('The payment provider returned an invalid checkout session.', false, sessionId);
  let destination: URL; try { destination = new URL(result.url); } catch { throw new StripeCheckoutPreparationError('The payment provider returned an invalid checkout address.', false, sessionId); }
  if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com' || destination.username || destination.password) throw new StripeCheckoutPreparationError('The payment provider returned an invalid checkout address.', false, sessionId);
  return { id: sessionId, url: result.url };
}
/** Verify original UTF-8 bytes, with bounded replay tolerance. Never reconstruct parsed JSON. */
export function verifyStripeWebhook(rawBody: Buffer, signature: string | undefined, secret: string, now = Date.now()): StripeEvent {
  if (!secret.startsWith('whsec_') || !signature || rawBody.length > 1_000_000) throw new ReservationError('Invalid payment webhook signature.', 400);
  const parts = signature.split(',').map(part => part.split('='));
  const timestamp = parts.find(part => part[0] === 't')?.[1];
  const time = Number(timestamp);
  if (!timestamp || !/^\d+$/.test(timestamp) || !Number.isSafeInteger(time) || Math.abs(Math.floor(now / 1000) - time) > 300) throw new ReservationError('Invalid payment webhook signature.', 400);
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const valid = parts.filter(part => part[0] === 'v1').some(part => { const value = part[1] ?? ''; if (!/^[a-f0-9]{64}$/i.test(value)) return false; const provided = Buffer.from(value, 'hex'); return provided.length === expected.length && timingSafeEqual(provided, expected); });
  if (!valid) throw new ReservationError('Invalid payment webhook signature.', 400);
  let event: StripeEvent;
  try { event = JSON.parse(rawBody.toString('utf8')) as StripeEvent; } catch { throw new ReservationError('Invalid payment webhook body.'); }
  if (!/^evt_[A-Za-z0-9]+$/.test(event.id ?? '') || typeof event.type !== 'string' || typeof event.livemode !== 'boolean' || !Number.isSafeInteger(event.created) || !event.data?.object || typeof event.data.object !== 'object') throw new ReservationError('Invalid payment webhook body.');
  return event;
}
export function validatePaidCheckout(event: StripeEvent, hold: { id: string; dealerId: string; depositPence: number; sessionId?: string; mode: 'test' | 'live' }) {
  const session = event.data.object;
  if (event.type !== 'checkout.session.completed' || event.livemode !== (hold.mode === 'live') || !/^cs_[A-Za-z0-9_]+$/.test(session.id ?? '') || session.mode !== 'payment' || session.status !== 'complete' || session.payment_status !== 'paid' || session.amount_total !== hold.depositPence || session.currency !== 'gbp' || session.client_reference_id !== hold.id || session.metadata?.reservation_id !== hold.id || session.metadata?.dealer_id !== hold.dealerId || (hold.sessionId && session.id !== hold.sessionId) || !/^pi_[A-Za-z0-9]+$/.test(session.payment_intent ?? '')) throw new ReservationError('The payment confirmation does not match this reservation.', 409);
  return { paymentIntentId: session.payment_intent as string, sessionId: session.id as string, amountPence: session.amount_total as number };
}
export async function readStripeCheckoutSession(settings: StripeSettings, sessionId: string, transport: typeof fetch = fetch): Promise<Record<string, any>> {
  assertStripeReady(settings); if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new ReservationError('Invalid checkout session.');
  let response: Response; try { response = await transport(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${settings.secretKey}` }, signal: AbortSignal.timeout(15_000) }); } catch { throw new ReservationError('Payment status could not be checked.', 503); }
  if (!response.ok) throw new ReservationError('Payment status could not be checked.', 503);
  const result = await response.json() as Record<string, any>;
  if (result.id !== sessionId || result.livemode !== (settings.mode === 'live')) throw new ReservationError('Payment status does not match the saved checkout session.', 409);
  return result;
}
/** Resolve an out-of-order signed refund without exposing the PaymentIntent client secret. */
export async function readStripePaymentIntentMetadata(settings: StripeSettings, paymentIntentId: string, transport: typeof fetch = fetch) {
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId) || !new RegExp(`^sk_${settings.mode}_[A-Za-z0-9]{8,}$`).test(settings.secretKey)) throw new ReservationError('The refund payment account is unavailable.', 503);
  let response: Response;
  try { response = await transport(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, { headers: { Authorization: `Bearer ${settings.secretKey}` }, signal: AbortSignal.timeout(15_000) }); } catch { throw new ReservationError('The refund payment could not be checked.', 503); }
  if (!response.ok) throw new ReservationError('The refund payment could not be checked.', 503);
  const result = await response.json() as Record<string, any>;
  if (result.id !== paymentIntentId || result.livemode !== (settings.mode === 'live')) throw new ReservationError('The refund payment account does not match.', 409);
  return { dealerId: result.metadata?.dealer_id as unknown, reservationId: result.metadata?.reservation_id as unknown };
}
