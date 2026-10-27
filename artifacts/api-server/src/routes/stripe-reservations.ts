/** Receive only signed historical payment/refund events. New online checkout is retired. */
import { Router, type Request } from 'express';
import { currentDealerId } from '../lib/tenant-context';
import { dealerIntegrationsStore } from '../lib/dealer-integrations-store';
import { ReservationError } from '../lib/historical-reservations';
import { verifyStripeWebhook } from '../lib/stripe-payments';
import { processStripeReservationEvent } from '../lib/stripe-reservation-store';
const router = Router();
router.post('/reservations/stripe/webhook', async (req, res) => {
  res.set('Cache-Control','no-store');
  try {
    const settings = (await dealerIntegrationsStore.readPrivate()).stripe;
    const raw = (req as Request & {rawBody?:Buffer}).rawBody;
    if (!raw) throw new ReservationError('The original webhook body is required.',400);
    const event = verifyStripeWebhook(raw,req.get('stripe-signature'),settings.webhookSecret);
    await processStripeReservationEvent(event,currentDealerId(),settings);
    res.json({received:true});
  } catch(error) { res.status(error instanceof ReservationError ? error.status : 503).json({error:error instanceof ReservationError ? error.message : 'Historical payment reconciliation could not be confirmed.'}); }
});
export default router;
