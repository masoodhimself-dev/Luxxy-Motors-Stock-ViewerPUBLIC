import {
  staffMotSummary,
  vehicleRegistration,
  type StaffCarChange,
  type StaffCarMeta,
  type StaffCarsFeed,
  type MotHistory,
} from "@workspace/vehicle-meta";
import type { Vehicle } from "@workspace/db";
import type { PublicVehicle } from "../routes/stock";
type SqlReader = {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
};
export const staffCarQueries = {
  latest:
    "SELECT id,source,received_at,created_at,status FROM stock_import_runs WHERE dealer_id=$1 AND status='completed' ORDER BY received_at DESC LIMIT 1",
  changes:
    "SELECT c.vehicle_id,c.field_name,c.old_value,c.new_value,c.changed_at FROM vehicle_changes c JOIN vehicles v ON v.id=c.vehicle_id WHERE v.dealer_id=$1 AND c.import_run_id=$2 ORDER BY c.changed_at DESC",
  cache:
    "SELECT registration,data FROM mot_history_cache WHERE registration=ANY($1::text[]) AND expires_at>now()",
  sales:
    "SELECT DISTINCT ON (state#>>'{draft,vehicleId}') id,reference,state#>>'{draft,vehicleId}' AS vehicle_id,coalesce(state#>>'{lifecycle,status}',CASE WHEN state->>'completedAt' IS NOT NULL THEN 'sold' ELSE 'draft' END) AS status FROM sale_workspace WHERE dealer_id=$1 AND coalesce(state#>>'{lifecycle,status}','')<>'released' ORDER BY state#>>'{draft,vehicleId}',updated_at DESC",
  connection: "SELECT enabled FROM cazoo_feed_authority WHERE dealer_id=$1",
  check:
    "SELECT c.received_at,c.status,c.error_code,EXISTS(SELECT 1 FROM stock_import_runs r WHERE r.dealer_id=c.dealer_id AND r.source='cazoo' AND r.status='completed' AND right(r.run_id,64)=c.file_hash) AS applied FROM cazoo_feed_checks c WHERE c.dealer_id=$1 ORDER BY c.received_at DESC LIMIT 1",
};
const iso = (v: unknown) => {
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
export function staffCarChanges(
  rows: any[],
  firstSeenAt: string,
  run: { created_at: unknown; received_at: unknown } | undefined,
): StaffCarChange[] {
  if (
    rows.some((row) => row.field_name === "vehicleAdded") ||
    (run && Date.parse(firstSeenAt) >= Date.parse(iso(run.created_at)!))
  )
    return [{ kind: "arrival", label: "New arrival", at: firstSeenAt }];
  const result: StaffCarChange[] = [];
  const price =
    rows.find((r) => r.field_name === "websitePublishedPrice") ??
    rows.find((r) => r.field_name === "sourcePrice");
  if (
    price &&
    typeof price.old_value === "number" &&
    typeof price.new_value === "number" &&
    price.old_value !== price.new_value
  )
    result.push({
      kind: "price",
      label:
        price.new_value < price.old_value ? "Price reduced" : "Price updated",
      before: price.old_value,
      after: price.new_value,
      at: iso(price.changed_at)!,
    });
  const photos = rows.find(
    (r) =>
      r.field_name === "sourceImages" &&
      JSON.stringify(r.old_value) !== JSON.stringify(r.new_value),
  );
  if (photos)
    result.push({
      kind: "photos",
      label: "Photos updated",
      at: iso(photos.changed_at)!,
    });
  if (
    !result.length &&
    rows.some(
      (r) =>
        ![
          "sourceStatus",
          "missingCount",
          "websitePublishedPrice",
          "sourcePrice",
        ].includes(r.field_name) &&
        JSON.stringify(r.old_value) !== JSON.stringify(r.new_value),
    )
  )
    result.push({
      kind: "details",
      label: "Details updated",
      at: iso(rows[0].changed_at)!,
    });
  return result;
}
/** Bounded aggregate reads only. No DVSA requests, per-car SQL, credential output or business writes. */
export async function readStaffCars(options: {
  dealerId: string;
  canManage: boolean;
  vehicles: Vehicle[];
  project: (rows: Vehicle[]) => Promise<PublicVehicle[]>;
  database: SqlReader;
  now?: Date;
}) {
  const { dealerId, canManage, vehicles, project, database } = options,
    now = options.now ?? new Date();
  const cars = await project(vehicles);
  const registrations = [
    ...new Set(
      vehicles
        .map((v) => vehicleRegistration(v).replace(/\s/g, "").toUpperCase())
        .filter(Boolean),
    ),
  ];
  const latest = (await database.query(staffCarQueries.latest, [dealerId]))
    .rows[0];
  const [changeResult, cacheResult, saleResult, connectionResult, checkResult] =
    await Promise.all([
      latest
        ? database.query(staffCarQueries.changes, [dealerId, latest.id])
        : Promise.resolve({ rows: [] }),
      registrations.length
        ? database.query(staffCarQueries.cache, [registrations])
        : Promise.resolve({ rows: [] }),
      canManage
        ? database.query(staffCarQueries.sales, [dealerId])
        : Promise.resolve({ rows: [] }),
      database.query(staffCarQueries.connection, [dealerId]),
      database.query(staffCarQueries.check, [dealerId]),
    ]);
  const histories = new Map<string, MotHistory>(
      cacheResult.rows.map((r) => [r.registration, r.data]),
    ),
    sales = new Map(saleResult.rows.map((r) => [r.vehicle_id, r]));
  const changes = new Map<string, any[]>();
  for (const row of changeResult.rows) {
    const group = changes.get(row.vehicle_id) ?? [];
    group.push(row);
    changes.set(row.vehicle_id, group);
  }
  const check = checkResult.rows[0],
    scheduled = connectionResult.rows[0]?.enabled === true;
  const feed: StaffCarsFeed = {
    source: scheduled
      ? "Official Cazoo CSV"
      : latest?.source === "cazoo"
        ? "Cazoo"
        : (latest?.source ?? vehicles[0]?.source) === "autotrader"
          ? "Auto Trader"
          : "Stock feed",
    receivedAt: iso(scheduled ? check?.received_at : latest?.received_at),
    appliedAt: iso(latest?.received_at),
    state:
      check &&
      scheduled &&
      (["failed", "blocked"].includes(check.status) || check.applied === false)
        ? "review"
        : latest
          ? now.getTime() -
              Date.parse(
                iso(scheduled ? check?.received_at : latest.received_at) ??
                  "invalid",
              ) >
            36 * 3600000
            ? "stale"
            : "current"
          : "unknown",
    scheduled,
  };
  return {
    feed,
    cars: cars.map((car, i) => {
      const v = vehicles[i],
        reg = vehicleRegistration(v).replace(/\s/g, "").toUpperCase(),
        sale = sales.get(v.id);
      const meta: StaffCarMeta = {
        source: v.source as "cazoo" | "autotrader",
        sourceStatus: v.sourceStatus,
        inventoryStatus: v.inventoryStatus,
        published:
          v.sourceStatus === "live" &&
          !v.archivedAt &&
          ["available", "reserved"].includes(v.inventoryStatus) &&
          !(
            v.priceReviewRequired &&
            v.sourcePrice == null &&
            v.websitePriceOverride == null
          ),
        firstSeenAt: iso(v.firstSeenAt)!,
        lastSeenAt: iso(v.lastSeenAt)!,
        archivedAt: iso(v.archivedAt),
        mot: staffMotSummary(histories.get(reg) ?? null, now),
        changes: staffCarChanges(
          scheduled && check?.status === "unchanged"
            ? []
            : (changes.get(v.id) ?? []),
          iso(v.firstSeenAt)!,
          scheduled && check?.status === "unchanged" ? undefined : latest,
        ),
        sale: sale
          ? { id: sale.id, reference: sale.reference, status: sale.status }
          : null,
      };
      return { ...car, staff: meta };
    }),
  };
}
