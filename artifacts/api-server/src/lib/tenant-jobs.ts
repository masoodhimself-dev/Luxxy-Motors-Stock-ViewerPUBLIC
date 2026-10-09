import { db, dealershipsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { multiTenantEnabled, runWithTenant } from './tenant-context';

/** Background work has no request context; enumerate active dealers explicitly. */
export async function forEachActiveDealer(job: () => Promise<unknown>): Promise<void> {
  if (!multiTenantEnabled()) { await job(); return; }
  const dealers = await db.select().from(dealershipsTable).where(eq(dealershipsTable.status, 'active'));
  for (const dealer of dealers) await runWithTenant({ dealerId: dealer.id, canonicalOrigin: dealer.canonicalOrigin, platform: dealer.stockPlatform, retailerId: dealer.retailerId, sourceUrl: dealer.sourceUrl }, job);
}
