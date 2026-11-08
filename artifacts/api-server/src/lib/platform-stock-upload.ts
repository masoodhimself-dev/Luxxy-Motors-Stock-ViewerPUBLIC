import { db, dealerDemosTable, dealershipsTable } from '@workspace/db';
import { eq, sql } from 'drizzle-orm';

export const platformStockUploadLimit = 5 * 1024 * 1024;
export const platformStockUploadTooLarge = 'Choose a stock JSON file of 5 MB or less.';

export async function readPlatformStockUploadTarget(dealerId: string, executor: Pick<typeof db, 'select'> = db, lock = false) {
  const query = executor.select({
    id: dealershipsTable.id,
    canonicalOrigin: dealershipsTable.canonicalOrigin,
    stockPlatform: dealershipsTable.stockPlatform,
    retailerId: dealershipsTable.retailerId,
    sourceUrl: dealershipsTable.sourceUrl,
    status: dealershipsTable.status,
    demoExpiresAt: dealerDemosTable.expiresAt,
    demoConvertedAt: dealerDemosTable.convertedAt,
    officialCazoo: sql<boolean>`exists(select 1 from cazoo_feed_authority where dealer_id=${dealershipsTable.id} and ${dealershipsTable.stockPlatform}='cazoo')`,
  }).from(dealershipsTable).leftJoin(dealerDemosTable, eq(dealerDemosTable.dealerId, dealershipsTable.id)).where(eq(dealershipsTable.id, dealerId));
  // Demo conversion takes the demo row before the stock lock. Lock only the
  // dealership here, after the stock lock, so an upload can never deadlock
  // with conversion or write after it commits.
  const [target] = lock ? await query.for('share', { of: dealershipsTable }) : await query;
  return target;
}

type UploadTarget = NonNullable<Awaited<ReturnType<typeof readPlatformStockUploadTarget>>>;
export function platformStockUploadBlock(target: UploadTarget, now = Date.now()) {
  if (target.demoConvertedAt || (target.status !== 'draft' && !(target.status === 'active' && target.demoExpiresAt))) {
    return 'Stock upload is available only for private drafts and active demonstrations.';
  }
  if (target.demoExpiresAt && target.demoExpiresAt.getTime() <= now) return 'Extend this demonstration before uploading stock.';
  if (target.officialCazoo) return 'This dealership uses the official Cazoo CSV connection. JSON uploads are disabled.';
  return null;
}
