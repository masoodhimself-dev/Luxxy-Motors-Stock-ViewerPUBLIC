import { startLifecycleWorker } from './service-lifecycle';
import { resolve, join } from "node:path";
import { readdir, lstat, unlink } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { Logger } from "pino";
import { currentDealerId } from "./tenant-context";
import { forEachActiveDealer } from "./tenant-jobs";
import { compactCompletedStockSnapshots } from './stock-snapshot-retention';

export const retentionPolicy = {
  archiveDays: 7,
  abandonedDraftDays: 90,
  expiredUploadDays: 7,
  temporaryHours: 24,
  financialReviewYears: 7,
} as const;
const day = 86400000;
/** Large JSONB records use PostgreSQL TOAST compression; original financial records are never purged here. */
export async function retainDealerData(now = new Date()) {
  const dealer = currentDealerId();
  const configured = Number(process.env.STOCK_MISSING_HIDE_THRESHOLD ?? 2);
  const threshold =
    Number.isFinite(configured) && configured >= 0 ? configured : 2;
  return db.transaction(async (tx) => {
    // The same locks as imports and sales serialize eligibility changes against live stock/payments.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`stock-import:${dealer}`}))`,
    );
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`sale-workspace:${dealer}`}))`,
    );
    const eligible = sql`(inventory_status='sold' OR (inventory_status='available' AND source_status='missing' AND missing_count>=${threshold}))`;
    await tx.execute(
      sql`UPDATE vehicles SET retirement_started_at=NULL WHERE dealer_id=${dealer} AND archived_at IS NULL AND NOT ${eligible}`,
    );
    await tx.execute(
      sql`UPDATE vehicles SET retirement_started_at=${now} WHERE dealer_id=${dealer} AND archived_at IS NULL AND retirement_started_at IS NULL AND ${eligible}`,
    );
    const archived = await tx.execute(
      sql`UPDATE vehicles SET archived_at=${now},audit_metadata=coalesce(audit_metadata,'{}'::jsonb)||jsonb_build_object('retentionArchive',jsonb_build_object('reason',CASE WHEN inventory_status='sold' THEN 'sold' ELSE 'missing' END,'archivedAt',${now.toISOString()}::text,'originalInventoryStatus',inventory_status::text)) WHERE dealer_id=${dealer} AND archived_at IS NULL AND retirement_started_at<=${new Date(now.getTime() - retentionPolicy.archiveDays * day)} AND ${eligible} RETURNING id`,
    );
    // Only abandoned, unissued, non-financial drafts qualify. Never alter counters or original ledgers/PDFs.
    const drafts = await tx.execute(
      sql`DELETE FROM sale_workspace WHERE dealer_id=${dealer} AND id IN (SELECT id FROM sale_workspace WHERE dealer_id=${dealer} AND updated_at<${new Date(now.getTime() - retentionPolicy.abandonedDraftDays * day)} AND jsonb_typeof(state->'payments')='array' AND jsonb_array_length(state->'payments')=0 AND jsonb_typeof(state->'documents')='array' AND jsonb_array_length(state->'documents')=0 AND coalesce(state->'documentArchives','{}'::jsonb)='{}'::jsonb AND coalesce(state->'providerPayments','{}'::jsonb)='{}'::jsonb AND coalesce(state->'emailDeliveries','[]'::jsonb)='[]'::jsonb AND NOT state ? 'customerAccess' AND NOT state ? 'customerLinkEmail' AND NOT state ? 'completedAt' AND NOT state ? 'retentionHold' AND coalesce(state#>>'{lifecycle,status}','draft')='draft' AND coalesce(state#>>'{draft,sourceReservationId}','')='' AND coalesce(state#>>'{draft,sourceEnquiryId}','')='' AND coalesce(state#>>'{draft,deposit}','') IN ('','0','0.00') AND coalesce(state#>>'{draft,appointment,at}','')='' AND coalesce(state#>>'{draft,fulfilment,completedAt}','')='' AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.dealer_id=${dealer} AND l.vehicle_id::text=state#>>'{draft,vehicleId}' AND l.stage IN ('reserved','sale_agreed','collected')) AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.dealer_id=${dealer} AND v.id::text=state#>>'{draft,vehicleId}' AND (v.inventory_status IN ('reserved','sold') OR v.audit_metadata->>'saleWorkspaceId'=sale_workspace.id::text)) ORDER BY updated_at LIMIT 100) RETURNING id`,
    );
    const sessions = await tx.execute(
      sql`DELETE FROM vehicle_service_upload_sessions WHERE dealer_id=${dealer} AND expires_at<${new Date(now.getTime() - retentionPolicy.expiredUploadDays * day)} RETURNING id`,
    );
    return {
      archivedCars: archived.rows.length,
      abandonedDrafts: drafts.rows.length,
      expiredUploadSessions: sessions.rows.length,
    };
  });
}
/** Only stale files created by our atomic settings writer, never arbitrary OS temporary files. */
export async function cleanupRetentionTemporaryFiles(
  now = new Date(),
  directory = resolve(
    process.env.INTEGRATIONS_PRIVATE_DIR ?? ".private/dealer-integrations",
  ),
) {
  let removed = 0;
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw e;
  }
  for (const name of names) {
    if (!/^[a-f0-9]{24}\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) continue;
    const path = join(directory, name);
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (
      info.isFile() &&
      !info.isSymbolicLink() &&
      now.getTime() - info.mtimeMs >= retentionPolicy.temporaryHours * 3600000
    ) {
      await unlink(path);
      removed++;
    }
  }
  return removed;
}
export function startRetentionWorker(log: Logger) {
  return startLifecycleWorker({
    intervalMs: 3_600_000,
    work: async () => {
      await forEachActiveDealer(async () => {
        const counts = await retainDealerData();
        if (Object.values(counts).some(Boolean))
          log.info({ dealerId: currentDealerId(), ...counts }, 'Data retention completed');
        // This stock-only policy remains disabled until an operator opts in.
        const snapshots = await compactCompletedStockSnapshots(currentDealerId());
        if (snapshots.enabled && (snapshots.compacted || snapshots.hashBackfilled || snapshots.integritySkipped))
          log.info({ retentionDays: snapshots.retentionDays, compacted: snapshots.compacted, hashBackfilled: snapshots.hashBackfilled, rawBytesRemoved: snapshots.rawBytesRemoved, integritySkipped: snapshots.integritySkipped }, 'Stock snapshot retention completed');
      }, { name: 'retention', log });
      await cleanupRetentionTemporaryFiles();
    },
    onError: () => log.warn('Data retention did not complete; protected records remain retained.'),
  });
}
