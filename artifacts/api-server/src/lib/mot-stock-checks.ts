import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  vehicleRegistration,
  type MotHistory,
  type StaffMotCheckStatus,
} from "@workspace/vehicle-meta";
import type { Logger } from "pino";
import { MotError, normaliseMotRegistration } from "./mot-history";
import { motService } from "./mot-storage";
import { currentDealerId, multiTenantEnabled } from "./tenant-context";
import { forEachActiveDealer } from "./tenant-jobs";
import { serviceLifecycle, startLifecycleWorker } from "./service-lifecycle";

type Sql = { query(text: string, values?: any[]): Promise<{ rows: any[] }> };
type SqlPool = Sql & { connect(): Promise<Sql & { release(): void }> };
type CurrentCar = {
  id: string;
  plate: string | null;
  vrm: string | null;
  registration: string | null;
};
export type StockMotJob = {
  dealerId: string;
  vehicleId: string;
  registration: string;
  leaseToken: string;
  attempts: number;
};
const CURRENT =
  "inventory_status IN ('available','reserved') AND source_status='live' AND archived_at IS NULL";
const iso = (v: unknown) =>
  v == null ? null : new Date(String(v)).toISOString();
const registrationOf = (car: CurrentCar) => {
  try {
    return normaliseMotRegistration(vehicleRegistration(car));
  } catch {
    return null;
  }
};
export function stockMotConfigured() {
  return [
    "DVSA_MOT_CLIENT_ID",
    "DVSA_MOT_CLIENT_SECRET",
    "DVSA_MOT_API_KEY",
    "DVSA_MOT_TOKEN_URL",
  ].every((key) => Boolean(process.env[key]?.trim()));
}
function freshHistory(
  value: unknown,
  registration: string,
  now: number,
): value is MotHistory {
  if (!value || typeof value !== "object") return false;
  const h = value as MotHistory,
    checked = Date.parse(h.checkedAt);
  return (
    h.registration === registration &&
    Array.isArray(h.tests) &&
    Number.isFinite(checked) &&
    checked <= now &&
    checked > now - 86_400_000
  );
}

/** No customer/stock write methods: only the shared public MOT cache and queue metadata. */
export function createStockMotRepository(
  database: SqlPool = pool,
  configured = stockMotConfigured,
) {
  async function transaction<T>(work: (client: Sql) => Promise<T>) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async function current(client: Sql, dealerId: string) {
    const rows = (
      await client.query(
        `SELECT id,plate,vrm,registration FROM vehicles WHERE dealer_id=$1 AND ${CURRENT}`,
        [dealerId],
      )
    ).rows as CurrentCar[];
    const cars = rows.map((car) => ({
      ...car,
      normalisedRegistration: registrationOf(car),
    }));
    const registrations = [
      ...new Set(
        cars.flatMap((c) =>
          c.normalisedRegistration ? [c.normalisedRegistration] : [],
        ),
      ),
    ];
    const caches = registrations.length
      ? (
          await client.query(
            "SELECT registration,data FROM mot_history_cache WHERE registration=ANY($1::text[]) AND expires_at>now()",
            [registrations],
          )
        ).rows
      : [];
    const now = Date.now();
    const cached = new Map(
      caches
        .filter((c) => freshHistory(c.data, c.registration, now))
        .map((c) => [String(c.registration), c.data as MotHistory]),
    );
    return { cars, cached };
  }
  async function refreshRuns(client: Sql, dealerId: string) {
    // Removed/missing/invalid cars count as skipped, never successful checks.
    await client.query(
      `WITH counts AS (
      SELECT r.id,count(*) FILTER(WHERE j.status='completed')::int AS checked,
        count(*) FILTER(WHERE j.status='failed')::int AS failed,
        count(*) FILTER(WHERE j.status IN ('queued','running'))::int AS pending,
        count(*) FILTER(WHERE j.status='running')::int AS running
      FROM mot_stock_check_runs r LEFT JOIN mot_stock_checks j ON j.run_id=r.id AND j.dealer_id=r.dealer_id
      WHERE r.dealer_id=$1 AND r.status IN ('queued','running') GROUP BY r.id
    ) UPDATE mot_stock_check_runs r SET checked=c.checked,failed=c.failed,
      skipped=greatest(0,r.total-c.checked-c.failed-c.pending),
      status=CASE WHEN c.pending=0 THEN CASE WHEN c.failed>0 THEN 'completed_with_errors' ELSE 'completed' END
        WHEN c.running>0 OR r.status='running' THEN 'running' ELSE 'queued' END,
      finished_at=CASE WHEN c.pending=0 THEN now() ELSE NULL END
      FROM counts c WHERE r.id=c.id AND r.dealer_id=$1`,
      [dealerId],
    );
  }
  async function reconcile(client: Sql, dealerId: string) {
    const { cars, cached } = await current(client, dealerId);
    const jobs = new Map(
      (
        await client.query(
          "SELECT * FROM mot_stock_checks WHERE dealer_id=$1",
          [dealerId],
        )
      ).rows.map((j) => [String(j.vehicle_id), j]),
    );
    const validIds: string[] = [];
    const changes: Record<string, unknown>[] = [];
    for (const car of cars) {
      const registration = car.normalisedRegistration;
      if (!registration) continue;
      validIds.push(car.id);
      const old = jobs.get(car.id),
        history = cached.get(registration);
      const same = old?.registration === registration;
      if (
        same &&
        (history
          ? old.status === "completed"
          : ["queued", "running"].includes(old.status) ||
            (["completed", "failed"].includes(old.status) &&
              new Date(old.next_attempt_at).getTime() > Date.now()))
      )
        continue;
      changes.push({
        vehicle_id: car.id,
        registration,
        status: history ? "completed" : "queued",
        checked_at: history?.checkedAt ?? null,
        next_attempt_at: history
          ? new Date(Date.parse(history.checkedAt) + 86_400_000).toISOString()
          : new Date().toISOString(),
      });
    }
    if (changes.length)
      await client.query(
        `INSERT INTO mot_stock_checks(dealer_id,vehicle_id,registration,status,checked_at,next_attempt_at)
      SELECT $1,x.vehicle_id,x.registration,x.status,x.checked_at,x.next_attempt_at FROM jsonb_to_recordset($2::jsonb)
        AS x(vehicle_id uuid,registration text,status text,checked_at timestamptz,next_attempt_at timestamptz)
      ON CONFLICT(dealer_id,vehicle_id) DO UPDATE SET registration=excluded.registration,status=excluded.status,
        checked_at=excluded.checked_at,next_attempt_at=excluded.next_attempt_at,attempts=0,error_code=NULL,
        lease_token=NULL,lease_until=NULL,updated_at=now()`,
        [dealerId, JSON.stringify(changes)],
      );
    await client.query(
      "UPDATE mot_stock_checks SET status='skipped',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE dealer_id=$1 AND status IN ('queued','running') AND NOT(vehicle_id=ANY($2::uuid[]))",
      [dealerId, validIds],
    );
    await refreshRuns(client, dealerId);
    return { cars, cached };
  }
  async function discover(dealerId: string) {
    await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `stock-mot-dealer:${dealerId}`,
      ]);
      await reconcile(client, dealerId);
    });
  }
  async function status(dealerId: string): Promise<StaffMotCheckStatus> {
    const { cars, cached } = await current(database, dealerId);
    const jobs = new Map(
      (
        await database.query(
          "SELECT vehicle_id,registration,status FROM mot_stock_checks WHERE dealer_id=$1",
          [dealerId],
        )
      ).rows.map((j) => [String(j.vehicle_id), j]),
    );
    let checked = 0,
      pending = 0,
      failed = 0,
      missingRegistration = 0;
    for (const car of cars) {
      const registration = car.normalisedRegistration;
      if (!registration) {
        missingRegistration++;
        continue;
      }
      if (cached.has(registration)) {
        checked++;
        continue;
      }
      const job = jobs.get(car.id);
      if (job?.registration !== registration) continue;
      if (["queued", "running"].includes(job.status)) pending++;
      if (job.status === "failed") failed++;
    }
    const row = (
      await database.query(
        "SELECT * FROM mot_stock_check_runs WHERE dealer_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1",
        [dealerId],
      )
    ).rows[0];
    // Active counts are durable and refreshed after every result, including restarts.
    const run: StaffMotCheckStatus["run"] = row
      ? {
          id: row.id,
          status: row.status,
          total: row.total,
          checked: row.checked,
          failed: row.failed,
          skipped: row.skipped,
          pending: Math.max(
            0,
            row.total - row.checked - row.failed - row.skipped,
          ),
          startedAt: iso(row.started_at)!,
          finishedAt: iso(row.finished_at),
        }
      : null;
    return {
      configured: configured(),
      automatic: true,
      current: {
        total: cars.length,
        checked,
        needsCheck: cars.length - checked - missingRegistration,
        pending,
        failed,
        missingRegistration,
      },
      run,
    };
  }
  async function start(dealerId: string) {
    if (!configured())
      throw new MotError(
        "not_configured",
        "MOT checks are not connected yet. Please check the integration in Settings.",
      );
    await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `stock-mot-dealer:${dealerId}`,
      ]);
      const { cars } = await reconcile(client, dealerId);
      const active = (
        await client.query(
          "SELECT id FROM mot_stock_check_runs WHERE dealer_id=$1 AND status IN ('queued','running')",
          [dealerId],
        )
      ).rows[0];
      if (active) return;
      const runId = randomUUID(),
        validIds = cars
          .filter((c) => c.normalisedRegistration)
          .map((c) => c.id);
      // Recent duplicate clicks join the just-finished run unless current stock needs work.
      const recent = (
        await client.query(
          "SELECT id FROM mot_stock_check_runs WHERE dealer_id=$1 AND finished_at>now()-interval '1 minute' AND total=$2 AND failed=0 ORDER BY started_at DESC LIMIT 1",
          [dealerId, cars.length],
        )
      ).rows[0];
      if (
        recent &&
        !(
          await client.query(
            "SELECT vehicle_id FROM mot_stock_checks WHERE dealer_id=$1 AND vehicle_id=ANY($2::uuid[]) AND status<>'completed' LIMIT 1",
            [dealerId, validIds],
          )
        ).rows.length
      )
        return;
      await client.query(
        "INSERT INTO mot_stock_check_runs(id,dealer_id,total) VALUES($1,$2,$3)",
        [runId, dealerId, cars.length],
      );
      await client.query(
        `UPDATE mot_stock_checks SET run_id=$3,status=CASE WHEN status IN ('completed','running') THEN status ELSE 'queued' END,
        attempts=CASE WHEN status='running' THEN attempts ELSE 0 END,error_code=NULL,
        next_attempt_at=CASE WHEN status='running' THEN next_attempt_at ELSE now() END,updated_at=now()
        WHERE dealer_id=$1 AND vehicle_id=ANY($2::uuid[])`,
        [dealerId, validIds, runId],
      );
      await refreshRuns(client, dealerId);
    });
    return status(dealerId);
  }
  async function claim(
    dealerIds: readonly string[],
  ): Promise<StockMotJob | null> {
    if (!dealerIds.length) return null;
    return transaction(async (client) => {
      // One durable running lease across all instances. Release the DB connection
      // before network work, including when operators use a one-connection pool.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('stock-mot-claim'))",
      );
      if (
        (
          await client.query(
            "SELECT 1 FROM mot_stock_checks WHERE status='running' AND lease_until>now() LIMIT 1",
          )
        ).rows.length
      )
        return null;
      const token = randomUUID();
      const row = (
        await client.query(
          `WITH candidate AS (
        SELECT j.dealer_id,j.vehicle_id FROM mot_stock_checks j JOIN vehicles v ON v.id=j.vehicle_id AND v.dealer_id=j.dealer_id
        WHERE j.dealer_id=ANY($1::text[]) AND v.inventory_status IN ('available','reserved') AND v.source_status='live' AND v.archived_at IS NULL
          AND ((j.status='queued' AND j.next_attempt_at<=now()) OR (j.status='running' AND j.lease_until<=now()))
        ORDER BY (j.checked_at IS NULL) DESC,v.first_seen_at DESC,j.next_attempt_at,j.vehicle_id FOR UPDATE OF j SKIP LOCKED LIMIT 1
      ) UPDATE mot_stock_checks j SET status='running',lease_token=$2,lease_until=now()+interval '2 minutes',updated_at=now()
        FROM candidate c WHERE j.dealer_id=c.dealer_id AND j.vehicle_id=c.vehicle_id RETURNING j.*`,
          [[...dealerIds], token],
        )
      ).rows[0];
      if (!row) return null;
      await refreshRuns(client, row.dealer_id);
      return {
        dealerId: row.dealer_id,
        vehicleId: row.vehicle_id,
        registration: row.registration,
        leaseToken: token,
        attempts: row.attempts,
      };
    });
  }
  async function finish(
    job: StockMotJob,
    outcome: { history: MotHistory } | { code: MotError["code"] },
  ) {
    await transaction(async (client) => {
      // The dealer lock prevents discovery/start from reassigning an accepted item's lease.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `stock-mot-dealer:${job.dealerId}`,
      ]);
      const car = (
        await client.query(
          `SELECT id,plate,vrm,registration,(${CURRENT}) AS eligible FROM vehicles WHERE dealer_id=$1 AND id=$2 FOR UPDATE`,
          [job.dealerId, job.vehicleId],
        )
      ).rows[0];
      const owned = (
        await client.query(
          "SELECT 1 FROM mot_stock_checks WHERE dealer_id=$1 AND vehicle_id=$2 AND registration=$3 AND lease_token=$4 AND status='running' FOR UPDATE",
          [job.dealerId, job.vehicleId, job.registration, job.leaseToken],
        )
      ).rows.length;
      if (!owned) {
        await refreshRuns(client, job.dealerId);
        return;
      }
      let state = "skipped",
        code: string | null = null,
        attempts = job.attempts,
        checkedAt: string | null = null,
        retrySeconds = 86_400;
      if (car?.eligible && registrationOf(car) === job.registration) {
        if (
          "history" in outcome &&
          freshHistory(outcome.history, job.registration, Date.now())
        ) {
          state = "completed";
          checkedAt = outcome.history.checkedAt;
          await client.query(
            `INSERT INTO mot_history_cache(registration,data,expires_at) VALUES($1,$2::jsonb,$3)
            ON CONFLICT(registration) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at
              WHERE coalesce(mot_history_cache.data->>'checkedAt','')<=excluded.data->>'checkedAt'`,
            [
              job.registration,
              JSON.stringify(outcome.history),
              new Date(Date.parse(checkedAt) + 86_400_000),
            ],
          );
          retrySeconds = Math.max(
            1,
            Math.ceil((Date.parse(checkedAt) + 86_400_000 - Date.now()) / 1000),
          );
        } else {
          code = "code" in outcome ? outcome.code : "unavailable";
          // Busy quota reservations/cooldowns never exhaust retries. Other failures are bounded.
          attempts += code === "busy" ? 0 : 1;
          state =
            code === "busy" || (code === "unavailable" && attempts < 3)
              ? "queued"
              : "failed";
          retrySeconds =
            code === "busy"
              ? 60
              : state === "queued"
                ? attempts === 1
                  ? 60
                  : 300
                : 86_400;
        }
      }
      await client.query(
        `UPDATE mot_stock_checks SET status=$5,error_code=$6,attempts=$7,checked_at=$8,next_attempt_at=now()+$9*interval '1 second',
        lease_token=NULL,lease_until=NULL,updated_at=now() WHERE dealer_id=$1 AND vehicle_id=$2 AND registration=$3 AND lease_token=$4`,
        [
          job.dealerId,
          job.vehicleId,
          job.registration,
          job.leaseToken,
          state,
          code,
          attempts,
          checkedAt,
          retrySeconds,
        ],
      );
      await refreshRuns(client, job.dealerId);
    });
  }
  async function manualDealerIds(): Promise<string[]> {
    if (!multiTenantEnabled()) return [currentDealerId()];
    // Explicit staff requests also work for active demos; background discovery remains live-only.
    const rows = (
      await database.query(
        "SELECT DISTINCT r.dealer_id FROM mot_stock_check_runs r JOIN dealerships d ON d.id=r.dealer_id WHERE d.status='active' AND r.status IN ('queued','running')",
      )
    ).rows;
    return rows.map((row) => String(row.dealer_id));
  }
  return {
    discover,
    status,
    start,
    claim,
    finish,
    manualDealerIds,
  };
}
export const stockMotRepository = createStockMotRepository();

/** A fixed two-item tick shares the existing DVSA cache, request coalescing and durable quota. */
export async function processStockMotChecks(options: {
  dealerIds: readonly string[];
  repository?: Pick<
    ReturnType<typeof createStockMotRepository>,
    "claim" | "finish"
  >;
  service?: Pick<typeof motService, "lookup">;
  shouldStop?: () => boolean;
}) {
  const repository = options.repository ?? stockMotRepository,
    service = options.service ?? motService;
  for (let i = 0; i < 2; i++) {
    if (options.shouldStop?.()) break;
    const job = await repository.claim(options.dealerIds);
    if (!job) break;
    try {
      await repository.finish(job, {
        history: await service.lookup(job.registration),
      });
    } catch (error) {
      const code = error instanceof MotError ? error.code : "unavailable";
      await repository.finish(job, { code });
      // Provider cooldowns apply globally. Leave remaining stock for a later tick.
      if (code !== "not_found" && code !== "invalid_registration") break;
    }
  }
}
export function startStockMotWorker(log: Pick<Logger, "warn" | "info">) {
  const lastDiscovery = new Map<string, number>();
  return startLifecycleWorker({
    intervalMs: 5_000,
    enabled: stockMotConfigured,
    work: async () => {
      const dealerIds: string[] = [];
      await forEachActiveDealer(
        async () => {
          const dealerId = currentDealerId();
          dealerIds.push(dealerId);
          if (Date.now() - (lastDiscovery.get(dealerId) ?? 0) >= 30_000) {
            await stockMotRepository.discover(dealerId);
            lastDiscovery.set(dealerId, Date.now());
          }
        },
        { name: "mot-stock-checks" },
      );
      const manualDealerIds = await stockMotRepository.manualDealerIds();
      for (const dealerId of manualDealerIds)
        if (!dealerIds.includes(dealerId)) {
          // Manual demo runs must also notice a car removed or changed while queued.
          await stockMotRepository.discover(dealerId);
        }
      if (!serviceLifecycle.isDraining())
        await processStockMotChecks({
          dealerIds: [...new Set([...dealerIds, ...manualDealerIds])],
          shouldStop: () => serviceLifecycle.isDraining(),
        });
    },
    onError: () =>
      log.warn("MOT stock checks could not complete. Saved work will retry."),
  });
}
