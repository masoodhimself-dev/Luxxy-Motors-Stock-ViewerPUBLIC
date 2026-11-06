import { db, vehiclePublicLinksTable } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { vehicleDetailPath, type PublicVehicleLink } from '@workspace/vehicle-meta';
import { currentDealerId } from './tenant-context';

/** Callers retain their existing visibility checks. This only formats the active dealer's URL. */
export async function publicVehicleDetailPath(vehicle: PublicVehicleLink & { websiteTitleOverride?: string | null }, executor: typeof db = db): Promise<string> {
  const [link] = await executor.select({ code: vehiclePublicLinksTable.code }).from(vehiclePublicLinksTable)
    .where(and(eq(vehiclePublicLinksTable.vehicleId, vehicle.id), eq(vehiclePublicLinksTable.dealerId, currentDealerId()))).limit(1);
  return vehicleDetailPath({ ...vehicle, title: vehicle.websiteTitleOverride ?? vehicle.title, sourceExtras: { publicVehicleCode: link?.code } });
}
