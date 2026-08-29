import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  stockImportRunsTable,
  vehicleImagesTable,
  vehiclesTable,
  type TenantContext,
  type VehicleImage,
} from "@workspace/db";

/**
 * Every operation requires a tenant context. Public routes use the explicit
 * Luxxy compatibility context; future callers cannot accidentally perform an
 * unscoped stock read.
 */
export function tenantStockRepository(context: TenantContext) {
  return {
    listVehicles() {
      return db.select().from(vehiclesTable).where(and(
        eq(vehiclesTable.tenantDealerId, context.dealerId),
        eq(vehiclesTable.dealerId, context.legacyDealerId),
        eq(vehiclesTable.source, context.source),
      )).orderBy(vehiclesTable.advertId);
    },
    findVehicle(id: string) {
      return db.select().from(vehiclesTable).where(and(
        eq(vehiclesTable.id, id),
        eq(vehiclesTable.tenantDealerId, context.dealerId),
        eq(vehiclesTable.dealerId, context.legacyDealerId),
        eq(vehiclesTable.source, context.source),
      )).limit(1);
    },
    async activeImages(vehicleIds: string[]): Promise<VehicleImage[]> {
      if (!vehicleIds.length) return [];
      return db.select().from(vehicleImagesTable).where(and(
        eq(vehicleImagesTable.tenantDealerId, context.dealerId),
        inArray(vehicleImagesTable.vehicleId, vehicleIds),
        eq(vehicleImagesTable.isActive, true),
      )).orderBy(vehicleImagesTable.sortOrder);
    },
    latestCompletedRun() {
      return db.select().from(stockImportRunsTable).where(and(
        eq(stockImportRunsTable.tenantDealerId, context.dealerId),
        eq(stockImportRunsTable.dealerId, context.legacyDealerId),
        eq(stockImportRunsTable.source, context.source),
        eq(stockImportRunsTable.status, "completed"),
      )).orderBy(desc(stockImportRunsTable.receivedAt)).limit(1);
    },
  };
}