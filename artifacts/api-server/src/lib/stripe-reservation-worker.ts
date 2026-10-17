import { currentDealerId } from './tenant-context';
import { forEachActiveDealer } from './tenant-jobs';
import type { Logger } from 'pino';
import { dealerIntegrationsStore } from './dealer-integrations-store';
import { expireAbandonedStripeReservations } from './stripe-reservation-store';
let running = false;
export function startStripeReservationWorker(log: Logger) {
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return; running = true;
    const check = async () => {
      const settings = (await dealerIntegrationsStore.readPrivate()).stripe;
      if (settings.enabled) await expireAbandonedStripeReservations(currentDealerId(), settings);
    };
    try {
      await forEachActiveDealer(check, { name: 'stripe-reservation', log });
    } catch { log.warn("Shared reservation expiry is unavailable; check registry and migration setup. Existing holds remain protected."); } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 60_000); timer.unref(); void tick(); return () => { stopped = true; clearInterval(timer); };
}
