import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { isUKNumberPlate, vehicleRegistration, type StaffTaxCheckStatus, type StaffTaxSummary } from '@workspace/vehicle-meta';
import type { Logger } from 'pino';
import { DvlaVehicleCheckError, lookupDvlaVehicle } from './dvla-vehicle-check';
import { startLifecycleWorker } from './service-lifecycle';
import { currentDealerId, currentTenant } from './tenant-context';
import { forEachActiveDealer } from './tenant-jobs';

type SqlReader = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type SqlPool = SqlReader & { connect(): Promise<SqlReader & { release(): void }> };
type RecordForCheck = { id: string; plate: string | null; vrm: string | null; registration: string | null };
type TaxRow = {
  vehicle_id: string;
  registration: string;
  tax_status: StaffTaxSummary['status'];
  due_date: string | null;
  checked_at: Date | string | null;
  next_attempt_at: Date | string;
  error_code: string | null;
};
type TaxJob = { dealer_id: string; vehicle_id: string; registration: string; lease_token: string };
type DvlaResult = Pick<Awaited<ReturnType<typeof lookupDvlaVehicle>>, 'registration' | 'checkedAt' | 'taxStatus' | 'taxDueDate'>;
const eligible = "source_status='live' AND archived_at IS NULL AND inventory_status IN ('available','reserved')";
const resultLifetimeMs = 86_400_000;
const discoveryIntervalMs = 30_000;

export const stockTaxConfigured = () => Boolean(process.env.DVLA_VES_API_KEY?.trim());

export function stockTaxRegistration(vehicle: RecordForCheck) {
  const registration = vehicleRegistration(vehicle);
  return isUKNumberPlate(registration) ? registration.replace(/[\s-]/g, '') : '';
}

export function stockTaxSummary(row: TaxRow | undefined, registration: string, now: Date): StaffTaxSummary | null {
  if (!row?.checked_at || row.registration !== registration) return null;
  const checkedAt = new Date(row.checked_at);
  const age = now.getTime() - checkedAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age >= resultLifetimeMs) return null;
  return { status: row.tax_status, dueDate: row.due_date, checkedAt: checkedAt.toISOString() };
}

export const stockTaxRowsQuery = `SELECT vehicle_id,registration,tax_status,due_date,checked_at,next_attempt_at,error_code
  FROM stock_tax_checks WHERE dealer_id=$1 AND vehicle_id=ANY($2::uuid[])`;

export function createStockTaxRepository(database: SqlPool = pool, configured = stockTaxConfigured) {
  async function transaction<T>(work: (client: SqlReader) => Promise<T>) {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function current(dealerId: string) {
    const { rows } = await database.query(
      `SELECT id,plate,vrm,registration FROM vehicles WHERE dealer_id=$1 AND ${eligible}`,
      [dealerId],
    );
    return (rows as RecordForCheck[]).map(car => ({ vehicle_id: car.id, registration: stockTaxRegistration(car) }));
  }

  async function discover(dealerId: string, manual = false) {
    const cars = (await current(dealerId)).filter(car => car.registration);
    await database.query(
      `INSERT INTO stock_tax_checks (dealer_id,vehicle_id,registration)
       SELECT $1,x.vehicle_id,x.registration FROM jsonb_to_recordset($2::jsonb) AS x(vehicle_id uuid,registration text)
       JOIN vehicles v ON v.id=x.vehicle_id AND v.dealer_id=$1 AND ${eligible}
       ON CONFLICT (dealer_id,vehicle_id) DO UPDATE
       SET registration=excluded.registration,tax_status=NULL,due_date=NULL,checked_at=NULL,error_code=NULL,
           next_attempt_at=now(),lease_token=NULL,lease_until=NULL
       WHERE stock_tax_checks.registration<>excluded.registration`,
      [dealerId, JSON.stringify(cars)],
    );
    if (manual) {
      // Allow refreshed results after a recent check while preserving failure backoff.
      await database.query(
        `UPDATE stock_tax_checks SET next_attempt_at=now() WHERE dealer_id=$1
         AND vehicle_id=ANY($2::uuid[]) AND checked_at<now()-interval '15 minutes'
         AND error_code IS NULL AND next_attempt_at>now() AND (lease_until IS NULL OR lease_until<=now())`,
        [dealerId, cars.map(car => car.vehicle_id)],
      );
    }
  }

  async function status(dealerId: string): Promise<StaffTaxCheckStatus> {
    const cars = await current(dealerId);
    const canCheck = configured() && !currentTenant()?.demo;
    const now = new Date();
    const { rows } = await database.query(stockTaxRowsQuery, [dealerId, cars.map(car => car.vehicle_id)]);
    const checks = new Map((rows as TaxRow[]).map(row => [row.vehicle_id, row]));
    const result = { total: cars.length, checked: 0, pending: 0, unavailable: 0, missingRegistration: 0 };
    for (const car of cars) {
      if (!car.registration) {
        result.missingRegistration++;
        continue;
      }
      const row = checks.get(car.vehicle_id);
      const matching = row?.registration === car.registration ? row : undefined;
      if (canCheck && (!matching || matching.error_code === 'busy' || new Date(matching.next_attempt_at) <= now)) result.pending++;
      else if (stockTaxSummary(matching, car.registration, now)?.status) result.checked++;
      else result.unavailable++;
    }
    return { configured: canCheck, current: result };
  }

  async function claim(dealerIds: readonly string[]): Promise<TaxJob | undefined> {
    if (!dealerIds.length) return undefined;
    return transaction(async client => {
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('stock-tax-worker')) AS acquired");
      if (!lock.rows[0]?.acquired) return undefined;
      const inFlight = await client.query('SELECT 1 FROM stock_tax_checks WHERE lease_until>now() LIMIT 1');
      if (inFlight.rows.length) return undefined;
      const { rows } = await client.query(
        `WITH next AS (
          SELECT t.dealer_id,t.vehicle_id,v.plate,v.vrm,v.registration AS stock_registration
          FROM stock_tax_checks t JOIN vehicles v ON v.id=t.vehicle_id AND v.dealer_id=t.dealer_id
          WHERE t.dealer_id=ANY($1::text[]) AND ${eligible} AND t.next_attempt_at<=now()
          ORDER BY t.next_attempt_at,t.dealer_id,t.vehicle_id LIMIT 1 FOR UPDATE OF t SKIP LOCKED
        ) UPDATE stock_tax_checks t SET lease_token=$2,lease_until=now()+interval '30 seconds'
          FROM next WHERE t.dealer_id=next.dealer_id AND t.vehicle_id=next.vehicle_id
          RETURNING t.dealer_id,t.vehicle_id,t.registration,t.lease_token,next.plate,next.vrm,next.stock_registration`,
        [dealerIds, randomUUID()],
      );
      const found = rows[0] as (TaxJob & { plate: string | null; vrm: string | null; stock_registration: string | null }) | undefined;
      if (!found) return;
      const registration = stockTaxRegistration({ id: found.vehicle_id, plate: found.plate, vrm: found.vrm, registration: found.stock_registration });
      if (registration === found.registration) return found;
      await client.query('DELETE FROM stock_tax_checks WHERE dealer_id=$1 AND vehicle_id=$2 AND lease_token=$3',
        [found.dealer_id, found.vehicle_id, found.lease_token]);
      return;
    });
  }

  async function finish(job: TaxJob, details: DvlaResult | undefined, errorCode: string | null, retrySeconds: number) {
    // A newer Vehicle File lookup or newly queued registration invalidates this lease.
    await database.query(
      `UPDATE stock_tax_checks SET
         tax_status=CASE WHEN $4::timestamptz IS NOT NULL THEN $5 ELSE tax_status END,
         due_date=CASE WHEN $4::timestamptz IS NOT NULL THEN $6 ELSE due_date END,
         checked_at=COALESCE($4::timestamptz,checked_at),
         next_attempt_at=now()+$7::int*interval '1 second', error_code=$8, lease_token=NULL,lease_until=NULL
       WHERE dealer_id=$1 AND vehicle_id=$2 AND lease_token=$3`,
      [job.dealer_id, job.vehicle_id, job.lease_token, details?.checkedAt ?? null, details?.taxStatus ?? null,
        details?.taxDueDate ?? null, retrySeconds, errorCode],
    );
  }

  async function recordVehicleResult(dealerId: string, vehicleId: string, details: DvlaResult) {
    return transaction(async client => {
      const { rows } = await client.query(
        `SELECT id,plate,vrm,registration FROM vehicles WHERE dealer_id=$1 AND id=$2 AND ${eligible} FOR SHARE`,
        [dealerId, vehicleId],
      );
      const car = rows[0] as RecordForCheck | undefined;
      if (!car || stockTaxRegistration(car) !== details.registration) return false;
      await client.query(
        `INSERT INTO stock_tax_checks (dealer_id,vehicle_id,registration,tax_status,due_date,checked_at,next_attempt_at,error_code)
         VALUES ($1,$2,$3,$4,$5,$6,$6::timestamptz+interval '24 hours',$7)
         ON CONFLICT (dealer_id,vehicle_id) DO UPDATE SET registration=excluded.registration,tax_status=excluded.tax_status,
           due_date=excluded.due_date,checked_at=excluded.checked_at,next_attempt_at=excluded.next_attempt_at,
           error_code=excluded.error_code,lease_token=NULL,lease_until=NULL
         WHERE stock_tax_checks.checked_at IS NULL OR stock_tax_checks.checked_at<=excluded.checked_at`,
        [dealerId, vehicleId, details.registration, details.taxStatus ?? null, details.taxDueDate ?? null,
          details.checkedAt, details.taxStatus ? null : 'no_status'],
      );
      return true;
    });
  }

  return { configured, discover, status, claim, finish, recordVehicleResult };
}

export const stockTaxRepository = createStockTaxRepository();

export function startStockTaxWorker(log: Pick<Logger, 'warn'>) {
  let dealerIds: string[] = [];
  let discoveredAt = 0;
  let resumeAt = 0;
  return startLifecycleWorker({
    intervalMs: 2000,
    enabled: stockTaxConfigured,
    work: async () => {
      if (Date.now() - discoveredAt >= discoveryIntervalMs) {
        const active: string[] = [];
        await forEachActiveDealer(async () => {
          const dealerId = currentDealerId();
          await stockTaxRepository.discover(dealerId);
          active.push(dealerId);
        }, { name: 'stock-tax-checks' });
        dealerIds = active;
        discoveredAt = Date.now();
      }
      if (Date.now() < resumeAt) return;
      const job = await stockTaxRepository.claim(dealerIds);
      if (!job) return;
      let details: DvlaResult | undefined;
      try {
        details = await lookupDvlaVehicle(job.registration);
      } catch (error) {
        const providerError = error instanceof DvlaVehicleCheckError ? error : null;
        const code = providerError?.code ?? 'unavailable';
        const missing = code === 'not_found' || code === 'invalid_registration';
        const retrySeconds = missing ? 86_400 : code === 'busy' ? (providerError?.retryAfter ?? 30) : 900;
        if (!missing) resumeAt = Date.now() + (code === 'busy' ? retrySeconds * 1000 : 60_000);
        await stockTaxRepository.finish(job, undefined, code, retrySeconds);
        return;
      }
      await stockTaxRepository.finish(job, details, details.taxStatus ? null : 'no_status', 86_400);
    },
    onError: () => log.warn('DVLA stock tax checks could not complete. Saved checks will retry.'),
  });
}
