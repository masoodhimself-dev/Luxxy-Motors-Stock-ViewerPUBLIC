import { currentTenant } from './tenant-context';
import type { StripeSettings } from './dealer-integrations-store';

const reservationOrigin = 'https://multichoicemotors.co.uk';

export const publicReservationTerms = 'Paying £99 reserves this car once your payment is confirmed. If you buy the car, the £99 goes towards the price. To cancel before completing the purchase, contact Multi Choice Motors. We’ll refund the full £99 to your original payment method.';
export { publicReservationDepositPence } from './stripe-reservation-policy';

/** Keep the provider available for existing payments when new checkouts are switched off. */
export function publicReservationStripeSettings(
  tenant = currentTenant(),
  env: NodeJS.ProcessEnv = process.env,
): StripeSettings | undefined {
  if (!tenant || tenant.demo || tenant.kind === 'import' ||
      tenant.canonicalOrigin.replace(/\/$/, '') !== reservationOrigin) return undefined;
  const secretKey = env.MULTICHOICE_RESERVATION_STRIPE_KEY?.trim() ?? '';
  const webhookSecret = env.MULTICHOICE_RESERVATION_STRIPE_WEBHOOK_SECRET?.trim() ?? '';
  if (!/^(?:sk|rk)_live_[A-Za-z0-9]{8,}$/.test(secretKey) || !/^whsec_[A-Za-z0-9]{8,}$/.test(webhookSecret)) {
    return undefined;
  }
  return { enabled: true, mode: 'live', secretKey, webhookSecret, publishableKey: '' };
}

export function publicReservationCheckoutSettings(
  tenant = currentTenant(),
  env: NodeJS.ProcessEnv = process.env,
) {
  return env.MULTICHOICE_RESERVATIONS_ENABLED === 'true'
    ? publicReservationStripeSettings(tenant, env)
    : undefined;
}
