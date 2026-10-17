import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { db, engine, dealershipsTable, dealerDemosTable, enquiriesTable } from './test/tenant-test-db';
import { forEachActiveDealer, processJobStatus } from './lib/tenant-jobs';
import { processDueNotifications, notificationBatchSize } from './lib/enquiry-notifications';
import { currentDealerId, runWithTenant, type TenantContext } from './lib/tenant-context';

process.env.MULTI_TENANT_ENABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.TENANT_JOB_CONCURRENCY = '2';
process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString('base64');
process.env.SESSION_SECRET = 'fixture-only-management-links-not-a-real-secret';
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;
process.env.RESEND_ENABLED = 'false';
const log = { info() {}, warn() {}, error() {} } as unknown as Logger;
const tenant: TenantContext = { dealerId: 'fixture-0', canonicalOrigin: 'https://fixture-0.example.test', platform: 'autotrader', retailerId: 'ref-0', sourceUrl: 'https://source.example.test/0' };
let externalCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { externalCalls++; throw Error('External transport prohibited in this test'); };

test('isolated registry batches and notification backlog remain bounded and tenant-safe', async t => {
  try {
    const directory = join(process.cwd(), '../../lib/db/drizzle');
    for (const file of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join(directory, file), 'utf8'));
    await db.insert(dealershipsTable).values(Array.from({ length: 203 }, (_, i) => ({ id: `fixture-${i}`, name: `Fictional ${i}`, canonicalOrigin: `https://fixture-${i}.example.test`, stockPlatform: 'autotrader' as const, retailerId: `ref-${i}`, sourceUrl: `https://source.example.test/${i}`, status: i === 202 ? 'suspended' as const : 'active' as const })));
    await db.insert(dealerDemosTable).values([
      { dealerId: 'fixture-200', recipient: 'operator@example.test', expiresAt: new Date(Date.now() + 86400000), updatedBy: 'fixture' },
      { dealerId: 'fixture-201', convertedAt: new Date(), recipient: 'operator@example.test', expiresAt: new Date(Date.now() + 86400000), updatedBy: 'fixture' },
    ]);
    await t.test('200 real dealers plus a converted demo run, unconverted demo and suspended dealer do not', async () => {
      const seen = new Set<string>(); let active = 0, maximum = 0, release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const work = forEachActiveDealer(async () => { const id = currentDealerId(); active++; maximum = Math.max(maximum, active); await gate; await setImmediate(); assert.equal(currentDealerId(), id); seen.add(id); active--; }, { name: 'lead-backfill', log });
      // Coalescing is synchronous, including the database enumeration stage.
      assert.equal(forEachActiveDealer(async () => assert.fail('duplicate tick ran'), { name: 'lead-backfill', log }), work);
      await setImmediate(); release(); await work;
      assert.equal(seen.size, 201); assert.ok(!seen.has('fixture-200')); assert.ok(!seen.has('fixture-202')); assert.ok(seen.has('fixture-201')); assert.equal(maximum, 2);
      const status = processJobStatus(); assert.equal(status.activeDealerJobs, 0); assert.equal(status.queuedDealerJobs, 0);
      const sweep = status.sweeps.find(item => item.name === 'lead-backfill')!;
      assert.equal(sweep.completed, 201); assert.equal(sweep.excludedDemos, 1); assert.equal(sweep.state, 'completed');
      assert.ok(!JSON.stringify(status).includes('fixture-'));
      sweep.name = 'modified snapshot'; assert.notEqual(processJobStatus().sweeps[0]!.name, sweep.name);
    });
    await t.test('failed jobs finish the remaining dealers and operator metrics expose no failure contents', async () => {
      let completed = 0;
      await assert.rejects(forEachActiveDealer(async () => {
        if (currentDealerId() === 'fixture-0') throw Error('private@example.test fictional provider body');
        completed++;
      }, { name: 'retention', log }), AggregateError);
      assert.equal(completed, 200);
      const status = processJobStatus().sweeps.find(item => item.name === 'retention')!;
      assert.equal(status.state, 'failed'); assert.equal(status.failed, 1); assert.equal(status.completed, 200);
      assert.ok(!JSON.stringify(processJobStatus()).includes('private@example.test'));
    });
    await t.test('pending notifications process oldest50 then leave backlog for the next tick', async () => {
      const now = Date.now();
      const rows = await db.insert(enquiriesTable).values(Array.from({ length: notificationBatchSize + 3 }, (_, i) => ({ dealerId: tenant.dealerId, type: 'general' as const, customerName: 'Fictional customer', message: 'Fixture only', createdAt: new Date(now + i * 1000), customerNotificationStatus: 'pending', dealerNotificationStatus: 'not_sent' }))).returning();
      const [other] = await db.insert(enquiriesTable).values({ dealerId: 'fixture-1', type: 'general', customerName: 'Other fixture', message: 'No transport', customerNotificationStatus: 'pending' }).returning();
      await runWithTenant(tenant, () => processDueNotifications(log));
      let processed = await db.select().from(enquiriesTable).where(eq(enquiriesTable.dealerId, tenant.dealerId));
      assert.equal(processed.filter(row => row.customerNotificationAttemptedAt).length, notificationBatchSize);
      for (const row of rows.slice(notificationBatchSize)) assert.equal(processed.find(item => item.id === row.id)!.customerNotificationStatus, 'pending');
      assert.equal((await db.select().from(enquiriesTable).where(eq(enquiriesTable.id, other!.id)))[0]!.customerNotificationStatus, 'pending');
      await runWithTenant(tenant, () => processDueNotifications(log));
      processed = await db.select().from(enquiriesTable).where(eq(enquiriesTable.dealerId, tenant.dealerId));
      assert.equal(processed.filter(row => row.customerNotificationAttemptedAt).length, notificationBatchSize + 3);
    });
    await t.test('reminders use appointment order, skip fresh leases and expire past appointments without sending', async () => {
      const now = Date.now();
      // Legacy null statuses cannot be claimed; they must not starve confirmed appointments.
      const legacy = await db.insert(enquiriesTable).values(Array.from({ length: notificationBatchSize }, () => ({ dealerId: tenant.dealerId, type: 'viewing' as const, customerName: 'Legacy fixture', message: 'Unclaimable fixture', appointmentAt: new Date(now + 1800000), reminderStatus: 'pending' }))).returning();
      const rows = await db.insert(enquiriesTable).values(Array.from({ length: notificationBatchSize + 1 }, (_, i) => ({ dealerId: tenant.dealerId, type: 'viewing' as const, customerName: 'Fictional customer', message: 'Fixture only', appointmentStatus: 'confirmed' as const, appointmentAt: new Date(now + 3600000 + i * 60000), reminderStatus: 'pending' }))).returning();
      const [fresh, stale, expired] = await db.insert(enquiriesTable).values([
        { dealerId: tenant.dealerId, type: 'viewing', customerName: 'Fixture', message: 'Fresh lease', appointmentStatus: 'confirmed', appointmentAt: new Date(now + 10800000), reminderStatus: 'sending', reminderAttemptedAt: new Date(now) },
        { dealerId: tenant.dealerId, type: 'viewing', customerName: 'Fixture', message: 'Stale lease', appointmentStatus: 'confirmed', appointmentAt: new Date(now + 10800000), reminderStatus: 'sending', reminderAttemptedAt: new Date(now - 16 * 60000) },
        { dealerId: tenant.dealerId, type: 'viewing', customerName: 'Fixture', message: 'Expired', appointmentStatus: 'confirmed', appointmentAt: new Date(now - 60000), reminderStatus: 'pending' },
      ]).returning();
      await runWithTenant(tenant, () => processDueNotifications(log));
      let all = await db.select().from(enquiriesTable).where(eq(enquiriesTable.dealerId, tenant.dealerId));
      const row = (id: string) => all.find(item => item.id === id)!;
      assert.equal(rows.filter(item => row(item.id).reminderAttemptedAt).length, notificationBatchSize);
      assert.equal(row(rows.at(-1)!.id).reminderStatus, 'pending');
      assert.equal(row(fresh!.id).reminderStatus, 'sending'); assert.equal(row(expired!.id).reminderStatus, 'failed');
      await runWithTenant(tenant, () => processDueNotifications(log));
      all = await db.select().from(enquiriesTable).where(eq(enquiriesTable.dealerId, tenant.dealerId));
      assert.equal(row(rows.at(-1)!.id).reminderStatus, 'failed'); assert.equal(row(stale!.id).reminderStatus, 'failed'); assert.equal(row(fresh!.id).reminderStatus, 'sending');
      assert.ok(legacy.every(item => row(item.id).reminderStatus === 'pending' && row(item.id).reminderAttemptedAt === null));
      assert.equal(externalCalls, 0);
    });
  } finally { globalThis.fetch = originalFetch; await engine.close(); }
});
