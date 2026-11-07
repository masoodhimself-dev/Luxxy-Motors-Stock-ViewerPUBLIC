import { Router, type IRouter, type Request, type Response } from 'express';
import { currentDealerId } from '../lib/tenant-context';
import { dealerIntegrationsStore } from '../lib/dealer-integrations-store';
import { siteOrigin } from '../lib/enquiry-links';
import { ReservationError } from '../lib/historical-reservations';
import {
  publicReservationCheckoutSettings,
  publicReservationDepositPence,
  publicReservationStripeSettings,
  publicReservationTerms,
} from '../lib/public-reservation-config';
import { verifyStripeWebhook } from '../lib/stripe-payments';
import { readOnlineReservationPreference } from './dealer-settings';
import {
  createStripeReservation,
  processStripeReservationEvent,
  readCustomerStripeStatus,
} from '../lib/stripe-reservation-store';

const router: IRouter = Router();

function failure(error: unknown, req: Request, res: Response) {
  if (error instanceof ReservationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  req.log?.warn('A reservation payment operation could not be confirmed');
  res.status(503).json({ error: 'We could not confirm the payment status. Please contact the dealership before trying again.' });
}

function limitRequests(max: number, windowMs: number) {
  const attempts = new Map<string, { count: number; expiresAt: number }>();
  return (req: Request, res: Response) => {
    const now = Date.now();
    const key = `${currentDealerId()}:${req.ip ?? 'unknown'}`;
    let bucket = attempts.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      if (attempts.size >= 5000) {
        for (const [id, attempt] of attempts) {
          if (attempt.expiresAt <= now) attempts.delete(id);
        }
      }
      bucket = { count: 0, expiresAt: now + windowMs };
      if (attempts.size < 5000 || attempts.has(key)) attempts.set(key, bucket);
      else bucket.count = max;
    }
    if (++bucket.count <= max) return false;
    res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000))));
    res.status(429).json({ error: 'Too many reservation requests. Please try again shortly.' });
    return true;
  };
}
const checkoutLimited = limitRequests(5, 60_000);
const statusLimited = limitRequests(120, 60_000);

router.get('/reservations/payment-readiness', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const enabled = Boolean(publicReservationCheckoutSettings()) && (await readOnlineReservationPreference()).enabled;
    res.json(enabled
      ? { enabled: true, depositPence: publicReservationDepositPence, terms: publicReservationTerms }
      : { enabled: false });
  } catch (error) { failure(error, req, res); }
});

router.post('/reservations/checkout', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const settings = publicReservationCheckoutSettings();
    if (!settings) throw new ReservationError('Online reservations are currently unavailable.', 503);
    if (req.get('origin') !== siteOrigin() || !req.is('application/json')) {
      throw new ReservationError('Start your reservation from the dealership website.', 403);
    }
    if (checkoutLimited(req, res)) return;
    if (!(await readOnlineReservationPreference()).enabled) throw new ReservationError('Online reservations are currently unavailable.', 503);
    const result = await createStripeReservation(req.body, currentDealerId(), settings, { terms: publicReservationTerms });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { failure(error, req, res); }
});

router.post('/reservations/payment-status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (statusLimited(req, res)) return;
    const { reference, token } = req.body ?? {};
    if (typeof reference !== 'string' || typeof token !== 'string') {
      throw new ReservationError('This payment status link is unavailable.', 404);
    }
    res.json({ reservation: await readCustomerStripeStatus(currentDealerId(), reference, token) });
  } catch (error) { failure(error, req, res); }
});

async function handleWebhook(req: Request, res: Response, channel: 'public-v1' | 'historical') {
  res.set('Cache-Control', 'no-store');
  try {
    const settings = channel === 'public-v1'
      ? publicReservationStripeSettings()
      : (await dealerIntegrationsStore.readPrivate()).stripe;
    if (!settings) throw new ReservationError('This payment endpoint is unavailable.', 404);
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) throw new ReservationError('The original webhook body is required.', 400);
    const event = verifyStripeWebhook(raw, req.get('stripe-signature'), settings.webhookSecret);
    if (channel === 'public-v1' && event.type === 'charge.refunded') {
      res.json({ received: true });
      return;
    }
    await processStripeReservationEvent(event, currentDealerId(), settings, { channel });
    res.json({ received: true });
  } catch (error) { failure(error, req, res); }
}

router.post('/reservations/stripe/webhook', (req, res) => handleWebhook(req, res, 'historical'));
router.post('/reservations/stripe/live-webhook', (req, res) => handleWebhook(req, res, 'public-v1'));

export default router;
