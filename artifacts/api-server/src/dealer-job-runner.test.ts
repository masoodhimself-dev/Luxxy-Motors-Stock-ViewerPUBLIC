import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createDealerJobLimiter, createDealerJobSweepGuard, runDealerJobBatch, tenantJobConcurrency, type DealerJobSummary } from './lib/dealer-job-runner';
import { currentTenant, type TenantContext } from './lib/tenant-context';

const tenants = (count: number): TenantContext[] => Array.from({ length: count }, (_, i) => ({
  dealerId: `fixture-${i}`, canonicalOrigin: `https://fixture-${i}.example.test`,
  platform: i % 2 ? 'autotrader' : 'cazoo', retailerId: `retailer-${i}`,
  sourceUrl: `https://source.example.test/${i}`,
}));

test('background concurrency defaults conservatively and never accepts an unbounded setting', () => {
  for (const value of ['', '0', '-1', '1.5', 'NaN', 'Infinity', null, 3]) assert.equal(tenantJobConcurrency(value), 2);
  const previous = process.env.TENANT_JOB_CONCURRENCY;
  try { delete process.env.TENANT_JOB_CONCURRENCY; assert.equal(tenantJobConcurrency(), 2); }
  finally { if (previous === undefined) delete process.env.TENANT_JOB_CONCURRENCY; else process.env.TENANT_JOB_CONCURRENCY = previous; }
  assert.equal(tenantJobConcurrency('1'), 1);
  assert.equal(tenantJobConcurrency('2'), 2);
  assert.equal(tenantJobConcurrency('4'), 4);
  assert.equal(tenantJobConcurrency('200'), 4);
});

for (const size of [100, 200]) test(`${size} dealers retain their full context across awaits with at most two active jobs`, async () => {
  const fixtures = tenants(size), seen = new Set<string>();
  let active = 0, maximum = 0;
  const summary = await runDealerJobBatch(fixtures, async () => {
    const before = currentTenant()!;
    active++; maximum = Math.max(maximum, active);
    await setImmediate();
    assert.deepEqual(currentTenant(), before);
    assert.equal(before.retailerId, `retailer-${before.dealerId.replace('fixture-', '')}`);
    assert.ok(!seen.has(before.dealerId)); seen.add(before.dealerId);
    active--;
  }, { concurrency: 2 });
  assert.equal(maximum, 2); assert.equal(seen.size, size);
  assert.equal(summary.completed, size); assert.equal(summary.failed, 0);
  assert.equal(summary.maxActive, 2); assert.equal(currentTenant(), undefined);
});

test('one failed dealer does not stop later dealers and demo work is excluded', async () => {
  const fixtures = tenants(8); fixtures[2]!.demo = true;
  let summary: DealerJobSummary | undefined;
  const seen: string[] = [];
  await assert.rejects(runDealerJobBatch(fixtures, async () => {
    const id = currentTenant()!.dealerId; seen.push(id); await setImmediate();
    if (id === 'fixture-0' || id === 'fixture-5') throw new Error('synthetic private failure');
  }, { concurrency: 2, onComplete: value => { summary = value; } }), AggregateError);
  assert.equal(seen.length, 7); assert.ok(!seen.includes('fixture-2')); assert.ok(seen.includes('fixture-7'));
  assert.equal(summary!.failed, 2); assert.equal(summary!.completed, 5); assert.equal(summary!.excludedDemos, 1);
  assert.equal(currentTenant(), undefined);
  assert.equal((await runDealerJobBatch([{ ...fixtures[0]!, demo: true }], async () => assert.fail('demo ran'))).dealers, 0);
});

test('simultaneous sweeps share one global limit, queued work is FIFO and rejected jobs release slots', async () => {
  const limiter = createDealerJobLimiter(() => 2);
  let active = 0, maximum = 0;
  const work = async () => { active++; maximum = Math.max(maximum, active); await setImmediate(); active--; };
  await Promise.all([runDealerJobBatch(tenants(100), work, { concurrency: 4, execute: limiter }), runDealerJobBatch(tenants(100), work, { concurrency: 4, execute: limiter })]);
  assert.equal(maximum, 2); assert.deepEqual(limiter.snapshot(), { active: 0, queued: 0 });
  const serial = createDealerJobLimiter(() => 1), order: number[] = [];
  const results = await Promise.allSettled([0, 1, 2].map(n => serial(async () => { order.push(n); if (n === 0) throw Error('fixture'); return n; })));
  await setImmediate();
  assert.equal(results[0]!.status, 'rejected'); assert.deepEqual(order, [0, 1, 2]);
  assert.deepEqual(serial.snapshot(), { active: 0, queued: 0 });
});

test('duplicate ticks join a named sweep; a finished or failed sweep can run again', async () => {
  const guard = createDealerJobSweepGuard();
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = guard('reminders', async () => { calls++; await gate; });
  const duplicate = guard('reminders', async () => { calls++; });
  assert.equal(first, duplicate); await setImmediate(); assert.equal(calls, 1);
  release(); await first;
  await assert.rejects(guard('reminders', async () => { calls++; throw Error('fixture'); }));
  await guard('reminders', async () => { calls++; });
  assert.equal(calls, 3);
});
