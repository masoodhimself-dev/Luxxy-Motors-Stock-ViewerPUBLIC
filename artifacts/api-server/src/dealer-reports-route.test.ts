import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';

// No production connection, external request, or production credentials.
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.PORTAL_API_TOKEN = '';
const { pool } = await import('@workspace/db');
const { runWithTenant } = await import('./lib/tenant-context');
const { default: router } = await import('./routes/dealer-reports');

test('report route enforces staff access, dealership context and finance permission', async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE enquiries (dealer_id text NOT NULL, type text NOT NULL, vehicle_id uuid, vehicle_title text, status text NOT NULL, merged_into_id uuid, created_at timestamptz NOT NULL, appointment_at timestamptz, appointment_status text, appointment_cancelled_at timestamptz);
    CREATE TABLE vehicles (dealer_id text NOT NULL, id uuid NOT NULL, title text);
    CREATE TABLE sale_workspace (dealer_id text NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL);
    INSERT INTO enquiries VALUES ('dealer-a','general',null,null,'new',null,now(),null,null,null), ('dealer-b','general',null,null,'new',null,now(),null,null,null), ('dealer-b','general',null,null,'new',null,now(),null,null,null);
    INSERT INTO sale_workspace VALUES ('dealer-a',jsonb_build_object('completedAt',to_char(now() - interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS"Z"')),now());`);
  const originalQuery = pool.query;
  let queries = 0;
  (pool as any).query = async (sql: string, args: any[]) => { queries++; return db.query(sql, args); };
  const app = express();
  app.use((req, _res, next) => {
    const signedOut = Object.assign(() => ({ userId: null, sessionId: null, tokenType: 'session_token' }), { [Symbol.for('@clerk/express.auth')]: true });
    Object.assign(req, { auth: signedOut, log: { error() {} } });
    const role = req.get('x-test-role');
    if (role === 'owner' || role === 'salesperson' || role === 'accounts') req.staff = { authUserId: 'fictional', name: 'Fictional', email: null, role };
    runWithTenant({ dealerId: req.get('x-test-dealer') === 'dealer-b' ? 'dealer-b' : 'dealer-a', canonicalOrigin: 'https://example.test', platform: 'cazoo', retailerId: 'fictional', sourceUrl: 'https://example.test' }, next);
  });
  app.use('/api', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const port = (server.address() as { port: number }).port;
  const get = (suffix: string, role?: string, dealer?: string) => fetch(`http://127.0.0.1:${port}/api/dealer-reports${suffix}`, { headers: { ...(role ? { 'x-test-role': role } : {}), ...(dealer ? { 'x-test-dealer': dealer } : {}) } });
  try {
    const anonymous = await get(''); assert.equal(anonymous.status, 401); assert.equal(queries, 0);
    const bad = await get('?period=all', 'owner'); assert.equal(bad.status, 400); assert.equal(queries, 0);
    const wrongType = await get('?period=30d&period=90d', 'owner'); assert.equal(wrongType.status, 400); assert.equal(queries, 0);
    const salesperson = await get('', 'salesperson'); assert.equal(salesperson.status, 200); assert.equal(salesperson.headers.get('cache-control'), 'no-store');
    const salespersonBody = await salesperson.json() as any; assert.equal(salespersonBody.enquiries.received, 1); assert.equal(salespersonBody.sales, null);
    const owner = await (await get('?period=30d','owner')).json() as any; assert.deepEqual(owner.sales, { completed: 1 });
    const accounts = await (await get('?period=90d','accounts')).json() as any; assert.deepEqual(accounts.sales, { completed: 1 });
    const different = await (await get('', 'owner', 'dealer-b')).json() as any; assert.equal(different.enquiries.received, 2); assert.deepEqual(different.sales, { completed: 0 });
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    (pool as any).query = originalQuery; await db.close(); await pool.end();
  }
});
