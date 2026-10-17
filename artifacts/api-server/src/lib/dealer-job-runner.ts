import { performance } from 'node:perf_hooks';
import { runWithTenant, type TenantContext } from './tenant-context';

export const defaultTenantJobConcurrency = 2;
export const maximumTenantJobConcurrency = 4;

/** Operators may lower the bound; invalid values never create an unbounded pool. */
export function tenantJobConcurrency(value: unknown = process.env.TENANT_JOB_CONCURRENCY): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return defaultTenantJobConcurrency;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) return defaultTenantJobConcurrency;
  return Math.min(maximumTenantJobConcurrency, count);
}

export type DealerJobSummary = {
  dealers: number;
  completed: number;
  failed: number;
  excludedDemos: number;
  concurrency: number;
  maxActive: number;
  durationMs: number;
};
export type DealerJobExecutor = <T>(work: () => Promise<T>) => Promise<T>;
export type DealerJobLimiter = DealerJobExecutor & { snapshot: () => { active: number; queued: number } };

/** A shared FIFO limit also bounds work when several different sweeps run at once. */
export function createDealerJobLimiter(readConcurrency: () => number): DealerJobLimiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  function drain() {
    const limit = Math.max(1, Math.min(maximumTenantJobConcurrency, Math.floor(readConcurrency()) || defaultTenantJobConcurrency));
    while (active < limit && waiting.length) {
      const start = waiting.shift()!;
      active++;
      start();
    }
  }
  const execute: DealerJobExecutor = <T>(work: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    waiting.push(() => {
      void Promise.resolve().then(work).then(resolve, reject).finally(() => {
        active--;
        drain();
      });
    });
    drain();
  });
  return Object.assign(execute, { snapshot: () => ({ active, queued: waiting.length }) });
}

/** Bounded lanes, not one promise per dealer. A failed dealer cannot stop the rest. */
export async function runDealerJobBatch(
  tenants: readonly TenantContext[],
  job: () => Promise<unknown>,
  options: { concurrency?: number; execute?: DealerJobExecutor; onComplete?: (summary: DealerJobSummary) => void } = {},
): Promise<DealerJobSummary> {
  const concurrency = Math.max(1, Math.min(maximumTenantJobConcurrency, Math.floor(options.concurrency ?? tenantJobConcurrency()) || defaultTenantJobConcurrency));
  const eligible = tenants.filter(tenant => !tenant.demo);
  const started = performance.now();
  const failures: Error[] = [];
  let next = 0, active = 0, maxActive = 0, completed = 0;
  const execute: DealerJobExecutor = options.execute ?? (work => work());
  async function lane() {
    while (next < eligible.length) {
      const tenant = eligible[next++]!;
      await execute(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await runWithTenant(tenant, job);
          completed++;
        } catch (cause) {
          failures.push(new Error(`Background job failed for dealership ${tenant.dealerId}`, { cause }));
        } finally { active--; }
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, eligible.length) }, () => lane()));
  const summary: DealerJobSummary = {
    dealers: eligible.length, completed, failed: failures.length,
    excludedDemos: tenants.length - eligible.length, concurrency, maxActive,
    durationMs: Math.round(performance.now() - started),
  };
  options.onComplete?.(summary);
  if (failures.length) throw new AggregateError(failures, 'One or more dealership background jobs failed');
  return summary;
}

/** Repeated ticks of one named sweep join its current run rather than starting again. */
export function createDealerJobSweepGuard() {
  const running = new Map<string, Promise<void>>();
  return (name: string | undefined, work: () => Promise<void>): Promise<void> => {
    if (!name) return work();
    const current = running.get(name);
    if (current) return current;
    const pending = Promise.resolve().then(work).finally(() => {
      if (running.get(name) === pending) running.delete(name);
    });
    running.set(name, pending);
    return pending;
  };
}
