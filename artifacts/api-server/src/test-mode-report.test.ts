import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readTestModeReport } from './lib/test-mode-report';

test('reports only test session enquiries and isolated sales, with appropriate date and cancellation rules', async () => {
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE sales_test_enquiries (session_id uuid, vehicle_id uuid, vehicle_title text, created_at timestamptz, appointment_at timestamptz, appointment_status text);
      CREATE TABLE sale_workspace (dealer_id text, state jsonb, updated_at timestamptz);`);
    const session='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002', car='00000000-0000-4000-8000-000000000003';
    await db.query(`INSERT INTO sales_test_enquiries VALUES
      ($1,$3,'Ford Focus','2026-10-26T12:00:00Z','2026-10-26T13:00:00Z','confirmed'),
      ($1,$3,'Ford Focus','2026-10-26T12:00:00Z','2026-10-26T14:00:00Z','cancelled'),
      ($1,$3,'Ford Focus','2026-10-26T12:00:00Z','2026-10-26T14:30:00Z','pending'),
      ($2,$3,'Other session','2026-10-26T12:00:00Z','2026-10-26T15:00:00Z','confirmed')`,[session,other,car]);
    await db.exec(`INSERT INTO sale_workspace VALUES ('sandbox', '{"completedAt":"2026-10-26T12:00:00Z","lifecycle":{"status":"sold"}}', '2026-10-26T12:00:00Z'), ('real-dealer', '{"completedAt":"2026-10-26T12:00:00Z"}', '2026-10-26T12:00:00Z')`);
    const result=await readTestModeReport(db,session,'sandbox','30d',true,new Date('2026-10-27T12:00:00Z'));
    assert.deepEqual(result.enquiries,{received:3,newNow:3});
    assert.deepEqual(result.bookings,{scheduled:1,pending:1});
    assert.deepEqual(result.sales,{completed:1});
    assert.deepEqual(result.popularVehicles,[{vehicleId:car,title:'Ford Focus',enquiries:3}]);
    assert.equal((await readTestModeReport(db,session,'sandbox','90d',false)).sales,null);
    await db.exec(`INSERT INTO sale_workspace VALUES ('sandbox', '{"completedAt":"invalid"}', '2026-10-26T12:00:00Z')`);
    assert.deepEqual((await readTestModeReport(db,session,'sandbox','30d',true,new Date('2026-10-27T12:00:00Z'))).sales,{completed:null});
  } finally { await db.close(); }
});
