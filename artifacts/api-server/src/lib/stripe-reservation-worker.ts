import type { Logger } from 'pino';
import { dealerIntegrationsStore } from './dealer-integrations-store';
import { expireAbandonedStripeReservations } from './stripe-reservation-store';
let running = false;
export function startStripeReservationWorker(log: Logger) {
  const tick = async () => { if (running) return; running = true; try { const settings = (await dealerIntegrationsStore.readPrivate()).stripe; if (settings.enabled) await expireAbandonedStripeReservations(process.env.STOCK_DEALER_ID ?? 'luxxy-motors', settings); } catch { log.warn('Reservation expiry could not be checked. Existing holds remain protected.'); } finally { running = false; } };
  const timer = setInterval(() => { void tick(); }, 60_000); timer.unref(); void tick(); return () => clearInterval(timer);
}
