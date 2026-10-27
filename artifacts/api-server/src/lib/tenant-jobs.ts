import { performance } from 'node:perf_hooks';
import type { Logger } from 'pino';
import { db, dealershipsTable, dealerDemosTable } from '@workspace/db';
import { eq, isNull } from 'drizzle-orm';
import { multiTenantEnabled, runWithTenant, type TenantContext } from './tenant-context';
import { serviceLifecycle } from './service-lifecycle';
import { createDealerJobLimiter, createDealerJobSweepGuard, runDealerJobBatch, tenantJobConcurrency, type DealerJobSummary } from './dealer-job-runner';

const execute = createDealerJobLimiter(tenantJobConcurrency);
const sweep = createDealerJobSweepGuard();
type TenantJobName = 'reminders' | 'staff-push' | 'retention' | 'lead-backfill';
type TenantJobOptions = { name?: TenantJobName; log?: Pick<Logger, 'info' | 'warn'> };
type SweepStatus = Omit<DealerJobSummary, 'concurrency'> & {
  name: string;
  state: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
};
const statuses = new Map<string, SweepStatus>();

/** Process-local counters only: no tenant identifiers, provider responses or errors. */
export function processJobStatus() {
  const snapshot = execute.snapshot();
  return {
    concurrency: tenantJobConcurrency(),
    activeDealerJobs: snapshot.active,
    queuedDealerJobs: snapshot.queued,
    sweeps: Array.from(statuses.values(), status => ({ ...status, durationMs: status.state === 'running' ? Math.max(0, Date.now() - Date.parse(status.startedAt)) : status.durationMs })),
  };
}

/** Background work enumerates active dealers explicitly and shares one process-wide bound. */
export function forEachActiveDealer(job: () => Promise<unknown>, options: TenantJobOptions = {}): Promise<void> {
  // Track the single accepted sweep, preserving the shared promise for duplicate ticks.
  return sweep(options.name, () => serviceLifecycle.track(async () => {
    const started = performance.now();
    const name = options.name ?? 'dealer-background-job';
    const status: SweepStatus = { name, state: 'running', startedAt: new Date().toISOString(), finishedAt: null, durationMs: 0, dealers: 0, completed: 0, failed: 0, excludedDemos: 0, maxActive: 0 };
    statuses.set(name, status);
    const report = (summary: DealerJobSummary) => {
      const { concurrency: _concurrency, ...counts } = summary;
      Object.assign(status, counts);
      const fields = { jobName: name, ...summary };
      if (summary.failed) options.log?.warn(fields, 'Dealership background sweep finished with failures');
      else options.log?.info(fields, 'Dealership background sweep completed');
    };
    try {
      if (!multiTenantEnabled()) {
        let completed = false;
        try { await execute(job); completed = true; }
        finally { report({ dealers: 1, completed: completed ? 1 : 0, failed: completed ? 0 : 1, excludedDemos: 0, concurrency: 1, maxActive: 1, durationMs: Math.round(performance.now() - started) }); }
        return;
      }
      const [dealers, demoRows] = await Promise.all([
        db.select({ id: dealershipsTable.id, canonicalOrigin: dealershipsTable.canonicalOrigin, stockPlatform: dealershipsTable.stockPlatform, retailerId: dealershipsTable.retailerId, sourceUrl: dealershipsTable.sourceUrl }).from(dealershipsTable).where(eq(dealershipsTable.status, 'active')),
        db.select({ id: dealerDemosTable.dealerId }).from(dealerDemosTable).where(isNull(dealerDemosTable.convertedAt)),
      ]);
      // Unconverted demonstrations require deliberate staff tests, never scheduled customer sends.
      const demos = new Set(demoRows.map(row => row.id));
      await runDealerJobBatch(dealers.map(dealer => ({ dealerId: dealer.id, canonicalOrigin: dealer.canonicalOrigin, platform: dealer.stockPlatform, retailerId: dealer.retailerId, sourceUrl: dealer.sourceUrl, demo: demos.has(dealer.id) })), job, { concurrency: tenantJobConcurrency(), execute, onComplete: report });
    } catch (error) {
      status.state = 'failed';
      throw error;
    } finally {
      if (status.state === 'running') status.state = 'completed';
      status.durationMs = Math.round(performance.now() - started);
      status.finishedAt = new Date().toISOString();
    }
  }));
}

/** Targeted durable jobs share the same process-wide dealer bound as sweeps. */
export function runBoundedDealerJob<T>(tenant: TenantContext, work: () => Promise<T>): Promise<T> {
  return serviceLifecycle.track(() => execute(() => runWithTenant(tenant, work)));
}
