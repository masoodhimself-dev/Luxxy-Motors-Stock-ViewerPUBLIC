import { sql, type SQL } from "drizzle-orm";
import type { Vehicle } from "@workspace/db";

type EventVehicle = Pick<Vehicle, "dealerId" | "id" | "inventoryStatus" | "sourceStatus" | "source" | "archivedAt" | "missingCount" | "currency" | "websitePriceOverride" | "sourcePrice" | "priceReviewRequired">;
export type VehicleWatchEventKind = "price_drop" | "reserved" | "available_again" | "sold";
export type VehicleWatchEventState = { kind: VehicleWatchEventKind; status: string; currentPrice: number | null; currentStatus?: string | null };
type Visibility = { activePlatform: string; missingThreshold?: number };
type Executor = { execute: (query: SQL) => Promise<unknown> };
export type VehicleWatchQuery = (query: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }>;

const price = (vehicle: EventVehicle) => vehicle.websitePriceOverride ?? vehicle.sourcePrice;
const publicStock = (vehicle: EventVehicle, options: Visibility) =>
  vehicle.source === options.activePlatform && !vehicle.archivedAt && vehicle.sourceStatus === "live" &&
  vehicle.missingCount < (options.missingThreshold ?? 2) &&
  !(vehicle.priceReviewRequired && price(vehicle) == null);

/** The event is evidence for a manual draft, never permission to send stale information. */
export function vehicleWatchEventIsCurrent(event: VehicleWatchEventState, vehicle: EventVehicle, options: Visibility) {
  if (event.status !== "open" || vehicle.source !== options.activePlatform || vehicle.archivedAt) return false;
  if (event.currentStatus && event.currentStatus !== vehicle.inventoryStatus) return false;
  if (event.kind === "sold") return vehicle.inventoryStatus === "sold";
  if (!publicStock(vehicle, options)) return false;
  if (event.kind === "reserved") return vehicle.inventoryStatus === "reserved";
  if (event.kind === "available_again") return vehicle.inventoryStatus === "available";
  return vehicle.inventoryStatus === "available" && vehicle.currency === "GBP" &&
    event.currentPrice != null && event.currentPrice > 0 && price(vehicle) === event.currentPrice;
}

/** Runs in the existing price-write transaction. It only creates staff-review candidates. */
export async function recordVehicleWatchPriceChange(
  executor: Executor, before: EventVehicle, after: EventVehicle, changeKey: string,
  now: Date, options: Visibility,
) {
  const previousPrice = price(before), currentPrice = price(after);
  if (previousPrice === currentPrice && before.currency === after.currency) return;
  const key = `price:${changeKey}`;
  await executor.execute(sql`UPDATE vehicle_watch_events SET status='superseded',revision=revision+1,updated_at=${now}
    WHERE dealer_id=${after.dealerId} AND vehicle_id=${after.id}::uuid AND kind='price_drop' AND status='open' AND change_key<>${key}`);
  // Availability messages do not quote a price by default, but staff may add
  // one. A price/currency edit invalidates their existing review hash too.
  await executor.execute(sql`UPDATE vehicle_watch_events SET current_price=${currentPrice},revision=revision+1,updated_at=${now}
    WHERE dealer_id=${after.dealerId} AND vehicle_id=${after.id}::uuid AND kind<>'price_drop' AND status='open'`);
  if (before.dealerId !== after.dealerId || before.id !== after.id ||
      before.currency !== "GBP" || after.currency !== "GBP" ||
      before.inventoryStatus !== "available" || after.inventoryStatus !== "available" ||
      !publicStock(before, options) || !publicStock(after, options) ||
      previousPrice == null || currentPrice == null || currentPrice <= 0 || previousPrice <= currentPrice) return;
  await executor.execute(sql`INSERT INTO vehicle_watch_events(dealer_id,vehicle_id,kind,change_key,previous_price,current_price,previous_status,current_status,occurred_at,created_at,updated_at)
    SELECT ${after.dealerId},${after.id}::uuid,'price_drop',${key},${previousPrice},${currentPrice},${before.inventoryStatus},${after.inventoryStatus},${now},${now},${now}
    WHERE EXISTS (SELECT 1 FROM vehicle_watches w WHERE w.dealer_id=${after.dealerId} AND w.vehicle_id=${after.id}::uuid AND w.status='active' AND w.email_verified_at IS NOT NULL AND w.email_verified_at<=${now})
      AND NOT EXISTS (SELECT 1 FROM vehicle_watch_settings s WHERE s.dealer_id=${after.dealerId} AND s.enabled=false)
    ON CONFLICT(dealer_id,change_key) DO NOTHING`);
}

/** Read-only protection for existing buyers, including legacy and current sales workflows. */
export async function vehicleWatchRecipientHasCommitment(
  query: VehicleWatchQuery, dealerId: string, vehicleId: string, email: string, phone?: string | null,
) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = phone?.replace(/\D/g, "").replace(/^00/, "").replace(/^0/, "44") || "";
  const result = await query(`WITH contacts AS (
      SELECT id,phone FROM enquiries WHERE dealer_id=$1 AND vehicle_id=$2::uuid AND lower(trim(email))=$3
    ), phones AS (
      SELECT regexp_replace(regexp_replace(regexp_replace(phone,'[^0-9]','','g'),'^00',''),'^0','44') AS phone FROM contacts WHERE nullif(phone,'') IS NOT NULL
      UNION SELECT $4 WHERE $4<>''
    ) SELECT 1 FROM sale_workspace s WHERE s.dealer_id=$1 AND s.state#>>'{draft,vehicleId}'=$2::text
    AND coalesce(s.state#>>'{lifecycle,status}','')<>'released'
    AND (lower(trim(s.state#>>'{draft,email}'))=$3 OR s.state#>>'{draft,sourceEnquiryId}' IN (SELECT id::text FROM contacts)
      OR regexp_replace(regexp_replace(regexp_replace(s.state#>>'{draft,phone}','[^0-9]','','g'),'^00',''),'^0','44') IN (SELECT phone FROM phones))
    UNION ALL SELECT 1 FROM leads l WHERE l.dealer_id=$1 AND l.vehicle_id=$2::uuid AND l.closed_at IS NULL AND (l.deposit_pence>0 OR l.stage IN ('reserved','sale_agreed','collected'))
    AND (lower(trim(l.email))=$3 OR regexp_replace(regexp_replace(regexp_replace(l.phone,'[^0-9]','','g'),'^00',''),'^0','44') IN (SELECT phone FROM phones)
      OR EXISTS (SELECT 1 FROM enquiries e WHERE e.dealer_id=l.dealer_id AND e.id=l.enquiry_id AND lower(trim(e.email))=$3))
    UNION ALL SELECT 1 FROM sales s JOIN customers c ON c.id=s.customer_id AND c.dealer_id=s.dealer_id
    WHERE s.dealer_id=$1 AND s.vehicle_id=$2::uuid AND s.status<>'cancelled'
    AND (lower(trim(c.email))=$3 OR regexp_replace(regexp_replace(regexp_replace(c.phone,'[^0-9]','','g'),'^00',''),'^0','44') IN (SELECT phone FROM phones)
      OR EXISTS (SELECT 1 FROM enquiries e WHERE e.dealer_id=s.dealer_id AND e.id=s.enquiry_id AND lower(trim(e.email))=$3)) LIMIT 1`,
    [dealerId, vehicleId, normalizedEmail, normalizedPhone]);
  return result.rows.length > 0;
}
