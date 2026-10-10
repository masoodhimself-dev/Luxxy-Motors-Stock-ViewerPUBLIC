import { db, dealershipsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { multiTenantEnabled, runWithTenant } from './tenant-context';

/** Background work has no request context; enumerate active dealers explicitly. */
export async function forEachActiveDealer(job: () => Promise<unknown>): Promise<void> {
  if (!multiTenantEnabled()) { await job(); return; }
  const dealers = await db.select().from(dealershipsTable).where(eq(dealershipsTable.status, 'active'));
  const failures: Error[] = [];
  for (const dealer of dealers) {
    try {
      await runWithTenant({ dealerId: dealer.id, canonicalOrigin: dealer.canonicalOrigin, platform: dealer.stockPlatform, retailerId: dealer.retailerId, sourceUrl: dealer.sourceUrl }, job);
    } catch (cause) {
      failures.push(new Error(`Background job failed for dealership ${dealer.id}`, { cause }));
    }
  }
  // Process unaffected dealerships, then report failures to the caller's logger.
  if (failures.length) throw new AggregateError(failures, 'One or more dealership background jobs failed');
}
