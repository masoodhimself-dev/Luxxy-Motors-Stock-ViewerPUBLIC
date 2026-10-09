import { currentDealerId, multiTenantEnabled, runWithTenant } from "./tenant-context";
import type { Logger } from 'pino';
import { dealerIntegrationsStore } from './dealer-integrations-store';
import { expireAbandonedStripeReservations } from './stripe-reservation-store';
let running = false;
export function startStripeReservationWorker(log: Logger) {
  const tick = async () => {
    if (running) return; running = true;
    const check = async () => { try { const settings = (await dealerIntegrationsStore.readPrivate()).stripe; if (settings.enabled) await expireAbandonedStripeReservations(currentDealerId(), settings); } catch { log.warn('Reservation expiry could not be checked. Existing holds remain protected.'); } };
    try {
      if (!multiTenantEnabled()) await check();
      else { const { db, dealershipsTable } = await import('@workspace/db'); const { eq } = await import('drizzle-orm');
        for (const dealer of await db.select().from(dealershipsTable).where(eq(dealershipsTable.status, 'active'))) await runWithTenant({ dealerId: dealer.id, canonicalOrigin: dealer.canonicalOrigin, platform: dealer.stockPlatform, retailerId: dealer.retailerId, sourceUrl: dealer.sourceUrl }, check);
      }
    } catch { log.warn("Shared reservation expiry is unavailable; check registry and migration setup. Existing holds remain protected."); } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 60_000); timer.unref(); void tick(); return () => clearInterval(timer);
}
