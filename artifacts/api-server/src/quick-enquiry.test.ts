import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer, request } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { db, engine, dealershipsTable, vehiclesTable, enquiriesTable } from './test/tenant-test-db';
import { runWithTenant } from './lib/tenant-context';
import { requireStaffOperationAccess } from './middlewares/staff-auth';
import enquiries from './routes/enquiries';
import { processDueNotifications } from './lib/enquiry-notifications';
import { quickEnquiryCapture } from './lib/quick-enquiry-capture';

process.env.MULTI_TENANT_ENABLED = 'true';
test('quick enquiry capture stays actionable, tenant-scoped and silent, including notification recovery', async () => {
  for (const file of (await readdir('../../lib/db/drizzle')).filter(file => /^\d.*\.sql$/.test(file)).sort()) await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, 'utf8'));
  const carA = randomUUID(), carB = randomUUID();
  for (const [id, car] of [['quick-a', carA], ['quick-b', carB]]) {
    await db.insert(dealershipsTable).values({ id, name: 'Fictional quick capture dealer', status: 'active', canonicalOrigin: `https://${id}.example.test`, stockPlatform: 'autotrader', retailerId: id, sourceUrl: 'https://www.autotrader.co.uk/example' });
    await db.insert(vehiclesTable).values({ id: car, dealerId: id, source: 'autotrader', advertId: id, title: 'Fictional stock car', sourcePrice: 5000 });
  }
  const tenant = { dealerId: 'quick-a', canonicalOrigin: 'https://quick-a.example.test', platform: 'autotrader' as const, retailerId: 'quick-a', sourceUrl: 'https://www.autotrader.co.uk/example' };
  const log = { error() {}, warn() {}, info() {}, debug() {} } as any;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    req.log = log;
    const role = req.get('x-test-role');
    if (role === 'owner' || role === 'accounts') req.staff = { authUserId: 'fictional-staff', role, name: 'Fictional staff', email: null };
    runWithTenant(tenant, next);
  });
  app.use('/api', requireStaffOperationAccess, enquiries);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch; let outboundRequests = 0;
  globalThis.fetch = async () => { outboundRequests++; throw new Error('Outbound requests are forbidden in this fictional test.'); };
  const body = { type: 'general', vehicleId: null, customerName: 'Fictional caller', phone: '07700 900123', email: 'fictional@example.test', preferredContact: 'phone', message: 'Asked about a car', appointmentAt: null };
  function call(path: string, input: object, role = 'owner') {
    return new Promise<{ status: number; data: any }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: `/api${path}`, headers: { 'Content-Type': 'application/json', 'X-Enquiry-Capture': 'quick', ...(role ? { 'X-Test-Role': role } : {}) } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode!, data: JSON.parse(Buffer.concat(chunks).toString()) }));
      }); req.on('error', reject); req.end(JSON.stringify(input));
    });
  }
  try {
    assert.equal((await call('/staff/enquiries', body, '')).status, 401);
    assert.equal((await call('/staff/enquiries', body, 'accounts')).status, 403);
    assert.equal((await call('/enquiries', body)).status, 400);
    assert.equal((await call('/staff/enquiries', { ...body, type: 'viewing', appointmentAt: '2026-12-01T10:00:00Z', vehicleId: carA })).status, 400);
    assert.equal((await call('/staff/enquiries', { ...body, followUpAt: '2026-12-01T10:00:00Z' })).status, 400);
    assert.equal((await call('/staff/enquiries', { ...body, phone: 'invalid' })).status, 400);
    assert.equal((await call('/staff/enquiries', { ...body, vehicleId: carB })).status, 404);
    const general = await call('/staff/enquiries', body);
    assert.equal(general.status, 201); assert.equal(general.data.status, 'new'); assert.equal(general.data.phone, '07700900123');
    assert.equal(general.data.customerNotificationStatus, 'not_sent'); assert.equal(general.data.dealerNotificationStatus, 'not_sent'); assert.equal(general.data.callOutcome, null);
    const linked = await call('/staff/enquiries', { ...body, vehicleId: carA, assignedToId: 'fictional-staff' });
    assert.equal(linked.status, 201); assert.equal(linked.data.vehicleId, carA); assert.equal(linked.data.assignedToId, 'fictional-staff');
    await runWithTenant(tenant, () => processDueNotifications(log));
    assert.equal(outboundRequests, 0);
    assert.equal((await engine.query<{ count: number }>('SELECT count(*)::int AS count FROM email_outbox')).rows[0].count, 0);
    const records = await db.select().from(enquiriesTable);
    assert.equal(records.length, 2); assert.ok(records.every(record => record.dealerId === 'quick-a' && record.status === 'new' && record.customerNotificationStatus === 'not_sent' && record.dealerNotificationStatus === 'not_sent'));
  } finally {
    globalThis.fetch = originalFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await engine.close();
  }
});

test('quick capture is opt-in and cannot turn the full booking workflow into a silent shortcut', () => {
  assert.equal(quickEnquiryCapture(undefined, true, { type: 'viewing' }).quick, false);
  assert.ok(quickEnquiryCapture('quick', false, { type: 'general' }).error);
  assert.ok(quickEnquiryCapture('other', true, { type: 'general' }).error);
  for (const extra of [{ appointmentAt: new Date() }, { adHocVehicle: { title: 'Car' } }, { allowOutsideHours: true }, { allowDoubleBooking: true }]) assert.ok(quickEnquiryCapture('quick', true, { type: 'general', ...extra }).error);
});
