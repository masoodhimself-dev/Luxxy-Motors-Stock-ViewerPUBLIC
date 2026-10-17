import { and, eq, isNull, sql } from "drizzle-orm";
import { db, stockImportRunsTable } from "@workspace/db";
import { stockPayloadHash } from "./stock-payload-hash";

type RetentionEnvironment = { STOCK_RAW_RETENTION_DAYS?: string };

/** Disabled unless an operator explicitly chooses at least seven whole days. */
export function stockSnapshotRetentionPolicy(env: RetentionEnvironment = process.env) {
  const raw = env.STOCK_RAW_RETENTION_DAYS?.trim();
  if (!raw || raw === "0") return { enabled: false as const, days: null, reason: "not_configured" };
  const days = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(days) || days < 7 || days > 3650) {
    return { enabled: false as const, days: null, reason: "invalid_configuration" };
  }
  return { enabled: true as const, days, reason: null };
}

/**
 * Remove only old successful raw payloads, never the run ledger or vehicle audit.
 * The latest two successful payloads per dealer/source always stay available.
 */
export async function compactCompletedStockSnapshots(dealerId: string, options: {
  now?: Date;
  env?: RetentionEnvironment;
  batchSize?: number;
  database?: Pick<typeof db, "transaction">;
} = {}) {
  const policy = stockSnapshotRetentionPolicy(options.env);
  const summary = { enabled: policy.enabled, retentionDays: policy.days, compacted: 0, hashBackfilled: 0, rawBytesRemoved: 0, integritySkipped: 0, busy: false, reason: policy.reason };
  if (!policy.enabled) return summary;
  if (!dealerId.trim()) throw new Error("A dealership is required for snapshot retention.");
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("A valid retention timestamp is required.");
  const batchSize = options.batchSize ?? 10;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) throw new Error("Choose a snapshot retention batch from 1 to 25.");
  const cutoff = new Date(now.getTime() - policy.days * 86_400_000);
  return (options.database ?? db).transaction(async tx => {
    // Share the importer lock; maintenance skips rather than holding up imports.
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${`stock-import:${dealerId}`})) AS acquired`);
    if (!lock.rows[0]?.acquired) return { ...summary, busy: true };
    const result = await tx.execute(sql`
      WITH ranked AS (
        SELECT id, row_number() OVER (PARTITION BY source ORDER BY scraped_at DESC, received_at DESC, id DESC) AS position
        FROM stock_import_runs WHERE dealer_id = ${dealerId} AND status = 'completed'
      )
      SELECT r.id, r.raw_snapshot, r.payload_hash
      FROM stock_import_runs r JOIN ranked keep ON keep.id = r.id
      WHERE r.dealer_id = ${dealerId} AND r.status = 'completed' AND keep.position > 2
        AND r.received_at < ${cutoff} AND r.updated_at < ${cutoff}
        AND r.raw_snapshot IS NOT NULL AND r.raw_snapshot_compacted_at IS NULL
      ORDER BY r.received_at, r.id LIMIT ${batchSize}
      FOR UPDATE OF r SKIP LOCKED`);
    for (const row of result.rows) {
      const calculated = stockPayloadHash(row.raw_snapshot);
      if (row.payload_hash != null && row.payload_hash !== calculated) {
        summary.integritySkipped++;
        continue;
      }
      const updated = await tx.update(stockImportRunsTable).set({
        payloadHash: calculated,
        rawSnapshot: null,
        rawSnapshotCompactedAt: now,
        // updated_at is the original import finish time used by audit timing.
        updatedAt: sql`${stockImportRunsTable.updatedAt}`,
      }).where(and(eq(stockImportRunsTable.id, String(row.id)), eq(stockImportRunsTable.dealerId, dealerId), eq(stockImportRunsTable.status, "completed"), isNull(stockImportRunsTable.rawSnapshotCompactedAt))).returning({ id: stockImportRunsTable.id });
      if (!updated.length) continue;
      summary.compacted++;
      if (!row.payload_hash) summary.hashBackfilled++;
      // Logical JSON bytes removed, not a claim about Postgres physical disk savings.
      summary.rawBytesRemoved += Buffer.byteLength(JSON.stringify(row.raw_snapshot));
    }
    return summary;
  });
}
