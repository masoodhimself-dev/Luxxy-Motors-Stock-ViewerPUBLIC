import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const outputPath = process.argv[2];
const comparePath = process.argv[3];
if (!outputPath) throw new Error("Usage: preservation:manifest <output.json> [baseline.json]");

try {
  const result = await db.execute(sql`
    select
      (select count(*)::int from vehicles) as vehicle_count,
      (select count(*)::int from vehicle_images) as image_count,
      (select count(*)::int from vehicle_changes) as change_count,
      (select count(*)::int from stock_import_runs) as run_count,
      (select count(*)::int from vehicles where inventory_status in ('available','reserved')
        and missing_count < 2 and not (price_review_required and source_price is null
        and website_price_override is null)) as public_vehicle_count,
      (select count(*)::int from vehicles where price_review_required
        and pending_source_price is not null) as pending_price_count,
      (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'dealerId', dealer_id,
        'source', source, 'advertId', advert_id, 'raw', raw_source_data)
        order by id), '[]'::jsonb) from vehicles) as vehicles,
      (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vehicleId', vehicle_id,
        'url', source_url, 'sortOrder', sort_order, 'hero', is_hero, 'raw', raw_source_data)
        order by vehicle_id, sort_order, id), '[]'::jsonb) from vehicle_images) as images,
      (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'vehicleId', vehicle_id,
        'runId', import_run_id, 'field', field_name, 'old', old_value, 'new', new_value)
        order by id), '[]'::jsonb) from vehicle_changes) as changes,
      (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'runId', run_id,
        'dealerId', dealer_id, 'source', source, 'raw', raw_snapshot)
        order by id), '[]'::jsonb) from stock_import_runs) as runs
  `);
  const row = result.rows[0] as Record<string, unknown>;
  const manifest = {
    version: 1,
    counts: {
      vehicles: row.vehicle_count,
      images: row.image_count,
      changes: row.change_count,
      runs: row.run_count,
      publicVehicles: row.public_vehicle_count,
      pendingPrices: row.pending_price_count,
    },
    hashes: {
      vehicles: digest(row.vehicles),
      images: digest(row.images),
      changes: digest(row.changes),
      runs: digest(row.runs),
    },
  };
  if (comparePath) {
    const baseline = JSON.parse(await readFile(comparePath, "utf8")) as unknown;
    if (stable(baseline) !== stable(manifest)) throw new Error(`Preservation manifest differs from ${comparePath}`);
  }
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Wrote non-secret preservation manifest to ${outputPath}.\n`);
} finally {
  await pool.end();
}