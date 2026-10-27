import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db, vehicleChangesTable, type Vehicle } from "@workspace/db";
import { dealerIntegrationsStore } from "./dealer-integrations-store";
type Query = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
const effectiveStockPrice = (
  vehicle: Pick<Vehicle, "websitePriceOverride" | "sourcePrice">,
) => vehicle.websitePriceOverride ?? vehicle.sourcePrice;
async function activeStockPlatform(transaction?: unknown) {
  return (await dealerIntegrationsStore.readStockConnection(transaction))
    .connection.platform;
}
function stockChangeVisible(
  vehicle: Vehicle,
  threshold: number,
  platform: string,
) {
  return (
    vehicle.sourceStatus === "live" &&
    vehicle.source === platform &&
    !vehicle.archivedAt &&
    ["available", "reserved"].includes(vehicle.inventoryStatus) &&
    vehicle.missingCount < threshold &&
    !(vehicle.priceReviewRequired && effectiveStockPrice(vehicle) == null)
  );
}
/** Keep factual price history; stock changes no longer create outreach tasks. */
export async function recordPublishedStockPrice(
  query: Query,
  before: Vehicle,
  after: Vehicle,
  _changeKey: string,
  now = new Date(),
  threshold = 2,
  importRunId?: string,
  platform?: string,
) {
  const activePlatform = platform ?? (await activeStockPlatform(query)),
    previousPrice = effectiveStockPrice(before),
    currentPrice = effectiveStockPrice(after);
  const currencyChanged = before.currency !== after.currency;
  if (currencyChanged) {
    await query.insert(vehicleChangesTable).values({
      vehicleId: after.id,
      importRunId,
      fieldName: "websitePublishedPrice",
      oldValue: previousPrice,
      newValue: null,
      changedAt: now,
      auditMetadata: {
        reason: "Public price currency changed",
        dealerId: after.dealerId,
        fromCurrency: before.currency,
        toCurrency: after.currency,
      },
    });
    return;
  }
  if (
    previousPrice === currentPrice ||
    before.currency !== "GBP" ||
    after.currency !== "GBP" ||
    !stockChangeVisible(before, threshold, activePlatform) ||
    !stockChangeVisible(after, threshold, activePlatform)
  )
    return;
  await query.insert(vehicleChangesTable).values({
    vehicleId: after.id,
    importRunId,
    fieldName: "websitePublishedPrice",
    oldValue: previousPrice,
    newValue: currentPrice,
    changedAt: now,
    auditMetadata: {
      reason: "Effective published price changed",
      dealerId: after.dealerId,
      fromCurrency: before.currency,
      toCurrency: after.currency,
    },
  });
}
export async function recordMissingStockHistory(
  query: Query,
  vehicles: Vehicle[],
  runId: string,
  now = new Date(),
) {
  const fresh = vehicles.filter(
    (v) =>
      !v.archivedAt &&
      ["available", "reserved"].includes(v.inventoryStatus) &&
      v.sourceStatus === "live" &&
      v.missingCount === 0,
  );
  if (fresh.length)
    await query.insert(vehicleChangesTable).values(
      fresh.map((vehicle) => ({
        vehicleId: vehicle.id,
        importRunId: runId,
        fieldName: "sourceStatus",
        oldValue: "live",
        newValue: "missing",
        changedAt: now,
        auditMetadata: {
          reason: "Absent from a complete validated stock snapshot",
          dealerId: vehicle.dealerId,
        },
      })),
    );
}
export async function recordReappearedStockHistory(
  query: Query,
  dealerId: string,
  vehicleIds: string[],
  now = new Date(),
  importRunId?: string,
) {
  if (vehicleIds.length)
    await query.insert(vehicleChangesTable).values(
      vehicleIds.map((vehicleId) => ({
        vehicleId,
        importRunId,
        fieldName: "sourceStatus",
        oldValue: "missing",
        newValue: "live",
        changedAt: now,
        auditMetadata: {
          reason: "Reappeared in a complete validated stock snapshot",
          dealerId,
        },
      })),
    );
}
export async function publicPriceReductions(
  vehicles: Vehicle[],
  now = new Date(),
  platform?: string,
) {
  const activePlatform = platform ?? (await activeStockPlatform());
  const result = new Map<
    string,
    {
      previousPrice: number;
      currentPrice: number;
      reduction: number;
      detectedAt: string;
      expiresAt: string;
    }
  >();
  if (!vehicles.length) return result;
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const changes = await db
    .selectDistinctOn([vehicleChangesTable.vehicleId], {
      vehicleId: vehicleChangesTable.vehicleId,
      oldValue: vehicleChangesTable.oldValue,
      newValue: vehicleChangesTable.newValue,
      changedAt: vehicleChangesTable.changedAt,
      auditMetadata: vehicleChangesTable.auditMetadata,
    })
    .from(vehicleChangesTable)
    .where(
      and(
        inArray(
          vehicleChangesTable.vehicleId,
          vehicles.map((v) => v.id),
        ),
        eq(vehicleChangesTable.fieldName, "websitePublishedPrice"),
        gt(vehicleChangesTable.changedAt, since),
      ),
    )
    .orderBy(
      vehicleChangesTable.vehicleId,
      desc(vehicleChangesTable.changedAt),
      desc(vehicleChangesTable.id),
    );
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  for (const change of changes) {
    const previousPrice = change.oldValue,
      currentPrice = change.newValue;
    if (
      byId.get(change.vehicleId)!.source !== activePlatform ||
      byId.get(change.vehicleId)!.currency !== "GBP" ||
      change.auditMetadata.fromCurrency !== "GBP" ||
      change.auditMetadata.toCurrency !== "GBP" ||
      typeof previousPrice !== "number" ||
      typeof currentPrice !== "number" ||
      currentPrice <= 0 ||
      previousPrice <= currentPrice ||
      effectiveStockPrice(byId.get(change.vehicleId)!) !== currentPrice
    )
      continue;
    result.set(change.vehicleId, {
      previousPrice,
      currentPrice,
      reduction: previousPrice - currentPrice,
      detectedAt: change.changedAt.toISOString(),
      expiresAt: new Date(
        change.changedAt.getTime() + 14 * 86_400_000,
      ).toISOString(),
    });
  }
  return result;
}
