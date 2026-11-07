import type { Logger } from 'pino';
import type { StripeSettings } from './dealer-integrations-store';
import { serviceLifecycle } from './service-lifecycle';
import { expireAbandonedStripeReservations } from './stripe-reservation-store';
import { currentDealerId } from './tenant-context';
import { forEachActiveDealer } from './tenant-jobs';

export function startStripeReservationWorker(
  log: Logger,
  resolve: (dealerId: string) => StripeSettings | undefined | Promise<StripeSettings | undefined>,
) {
  let running = false;
  let stopped = false;
  async function tick() {
    if (running || stopped || serviceLifecycle.isDraining()) return;
    running = true;
    try {
      await forEachActiveDealer(async () => {
        const dealerId = currentDealerId();
        const settings = await resolve(dealerId);
        if (settings) await expireAbandonedStripeReservations(dealerId, settings);
      }, { name: 'stripe-reservations', log });
    } catch {
      log.warn('Stripe hold recovery is unavailable. Existing holds remain protected.');
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
