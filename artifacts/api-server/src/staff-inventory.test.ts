import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, request } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, engine, dealershipsTable, dealerDomainsTable, vehiclesTable, portalUsersTable } from './test/tenant-test-db';
import { resolveTenant } from './middlewares/tenant';
import inventory from './routes/staff-inventory';
process.env.MULTI_TENANT_ENABLED = 'true';

test('core retains tenant-protected historical photo reads and removes every staff-stock mutation route', async () => {
  for (const file of (await readdir('../../lib/db/drizzle')).filter(file => /^\d+.*\.sql$/.test(file)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  const cars = { a: randomUUID(), b: randomUUID() }, photos = { a: randomUUID(), b: randomUUID() };
  for (const dealer of ['a', 'b'] as const) {
    await db.insert(dealershipsTable).values({ id: dealer, name: dealer, status: 'active', canonicalOrigin: `https://${dealer}.example.test`, stockPlatform: 'autotrader', retailerId: dealer, sourceUrl: 'https://www.autotrader.co.uk/example' });
    await db.insert(dealerDomainsTable).values({ hostname: `${dealer}.example.test`, dealerId: dealer, verified: true, verificationToken: 'fictional' });
    await db.insert(portalUsersTable).values({ dealerId: dealer, authUserId: `user_${dealer}`, role: 'owner', email: `${dealer}@example.test` });
    await db.insert(vehiclesTable).values({ id: cars[dealer], dealerId: dealer, source: 'autotrader', advertId: dealer, title: `Car ${dealer}`, inventoryStatus: 'available' });
    await engine.query("INSERT INTO vehicle_service_photos(id,vehicle_id,dealer_id,jpeg,byte_size,width,height,uploaded_by) VALUES($1,$2,$3,decode('ffd8ffd9','hex'),4,2,2,'fictional')", [photos[dealer], cars[dealer], dealer]);
  }
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.log = { warn() {}, error() {} } as any; next(); }); app.use(resolveTenant); app.use('/api', inventory);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port;
  function call(path: string, options: { method?: string; user?: string; host?: string } = {}) {
    return new Promise<{ status: number; body: Buffer; headers: Record<string, unknown> }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { Host: `${options.host ?? 'a'}.example.test`, ...(options.user === '' ? {} : { 'x-test-user': options.user ?? 'user_a' }) } }, res => { const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks), headers: res.headers })); }); req.on('error', reject); req.end();
    });
  }
  try {
    const own = `/api/staff/inventory/${cars.a}/photos/${photos.a}`;
    const read = await call(own); assert.equal(read.status, 200); assert.equal(read.body.toString('hex'), 'ffd8ffd9'); assert.equal(read.headers['cache-control'], 'no-store');
    assert.equal((await call(own, { user: '' })).status, 401);
    assert.equal((await call(own, { host: 'b', user: 'user_b' })).status, 404);
    assert.equal((await call(`/api/staff/inventory/${cars.a}/photos/${photos.b}`)).status, 404);
    for (const [path, method] of [
      ['/api/staff/inventory', 'GET'], [`/api/staff/inventory/${cars.a}`, 'GET'], [`/api/staff/inventory/${cars.a}/customers`, 'GET'],
      [`/api/staff/inventory/${cars.a}/preparation`, 'PUT'], [`/api/staff/inventory/${cars.a}/plate`, 'PUT'], [`/api/staff/inventory/${cars.a}/unreserve`, 'POST'], [`/api/staff/inventory/${cars.a}/upload-session`, 'POST'], [own, 'DELETE'], ['/api/service-book-upload', 'GET'], ['/api/service-book-upload', 'POST'],
    ]) assert.equal((await call(path, { method })).status, 404, `${method} ${path}`);
    const counts = await engine.query("SELECT (SELECT count(*) FROM vehicles)::int AS vehicles,(SELECT count(*) FROM vehicle_service_photos)::int AS photos,(SELECT count(*) FROM vehicle_service_upload_sessions)::int AS sessions");
    assert.deepEqual(counts.rows[0], { vehicles: 2, photos: 2, sessions: 0 });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await engine.close(); }
});
