import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readDealerReport } from './lib/dealer-reports';

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE enquiries (dealer_id text NOT NULL, type text NOT NULL, vehicle_id uuid, vehicle_title text, status text NOT NULL, merged_into_id uuid, created_at timestamptz NOT NULL, appointment_at timestamptz, appointment_status text, appointment_cancelled_at timestamptz);
    CREATE TABLE vehicles (dealer_id text NOT NULL, id uuid NOT NULL, title text);
    CREATE TABLE sale_workspace (dealer_id text NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL);`);
  return db;
}
// This in-memory database is deliberately disconnected from real dealerships.
test('dealer-scoped counts respect dates, mergers, appointment status and completed sales', async () => {
  const db = await fixture();
  try {
    const car = '00000000-0000-4000-8000-000000000001';
    const other = '00000000-0000-4000-8000-000000000002';
    const merged = '00000000-0000-4000-8000-000000000003';
    await db.query(`INSERT INTO vehicles VALUES ('a',$1,'Ford Focus'),('b',$1,'Other dealer'),('a',$2,'MG')`, [car,other]);
    await db.query(`INSERT INTO enquiries VALUES
      ('a','viewing',$1,'Old Ford','new',NULL,'2026-10-01T00:00:00Z','2026-10-05T00:00:00Z','confirmed',NULL),
      ('a','viewing',$1,'Old Ford','contacted',NULL,'2026-10-10T00:00:00Z','2026-10-08T00:00:00Z','pending',NULL),
      ('a','viewing',$2,'MG','new',NULL,'2026-10-15T00:00:00Z','2026-10-10T00:00:00Z','confirmed','2026-10-09T00:00:00Z'),
      ('a','viewing',$2,'MG','new',$3,'2026-10-16T00:00:00Z','2026-10-10T00:00:00Z','confirmed',NULL),
      ('a','general',NULL,NULL,'contacted',NULL,'2026-09-20T12:00:00Z',NULL,NULL,NULL),
      ('a','general',NULL,NULL,'contacted',NULL,'2026-09-20T11:59:59Z',NULL,NULL,NULL),
      ('a','viewing',NULL,NULL,'new',NULL,'2026-09-01T00:00:00Z','2026-10-16T00:00:00Z',NULL,NULL),
      ('a','general',$2,'MG','new',NULL,'2026-10-20T12:00:00Z','2026-10-16T00:00:00Z','confirmed',NULL),
      ('b','viewing',$1,'Not this dealer','new',NULL,'2026-10-10T00:00:00Z','2026-10-10T00:00:00Z','confirmed',NULL)`, [car,other,merged]);
    await db.query(`INSERT INTO sale_workspace VALUES
      ('a','{"completedAt":"2026-10-12T10:00:00.000Z","lifecycle":{"status":"sold"}}','2026-10-12'),
      ('a','{"completedAt":"2026-10-15T10:00:00.000Z","lifecycle":{"status":"released"}}','2026-10-15'),
      ('a','{"lifecycle":{"status":"sold"}}','2026-10-16'),
      ('a','{"completedAt":"2026-08-15T10:00:00.000Z"}','2026-10-16'),
      ('b','{"completedAt":"2026-10-12T10:00:00.000Z"}','2026-10-12')`);
    const report = await readDealerReport(db as any, 'a', '30d', true, new Date('2026-10-20T12:00:00Z'));
    assert.equal(report.from, '2026-09-20T12:00:00.000Z');
    assert.deepEqual(report.enquiries, { received: 5, newNow: 4 });
    assert.deepEqual(report.bookings, { scheduled: 3, pending: 1 });
    assert.deepEqual(report.sales, { completed: 1 });
    assert.deepEqual(report.popularVehicles, [{ vehicleId: car, title: 'Ford Focus', enquiries: 2 }, { vehicleId: other, title: 'MG', enquiries: 2 }]);
    assert.ok(!JSON.stringify(report).includes('Not this dealer'));
    const nonFinancial = await readDealerReport(db as any, 'a', '90d', false, new Date('2026-10-20T12:00:00Z'));
    assert.equal(nonFinancial.sales, null);
    assert.equal(nonFinancial.enquiries.received, 7);
    assert.deepEqual((await readDealerReport(db as any, 'unused', '30d', true, new Date('2026-10-20T12:00:00Z'))).sales, { completed: 0 });
  } finally { await db.close(); }
});

test('malformed recorded sale dates leave sales count unavailable without hiding other report data', async () => {
  const db = await fixture();
  try {
    await db.exec(`INSERT INTO sale_workspace VALUES ('a', '{"completedAt":"broken"}', '2026-10-15')`);
    const now = new Date('2026-10-20T12:00:00Z');
    const report = await readDealerReport(db as any, 'a', '30d', true, now);
    assert.deepEqual(report.sales, { completed: null });
    assert.deepEqual(report.enquiries, { received: 0, newNow: 0 });
    assert.equal((await readDealerReport(db as any, 'a', '30d', false, now)).sales, null);
  } finally { await db.close(); }
});
