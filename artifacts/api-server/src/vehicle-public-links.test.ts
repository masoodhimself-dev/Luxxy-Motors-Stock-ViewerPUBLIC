import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import express from 'express';
import { eq } from 'drizzle-orm';
import { vehicleDetailPath, vehicleSharePath, vehicleMatchesPath, vehicleCodeFromPath } from '@workspace/vehicle-meta';
import { engine, db, dealershipsTable, vehiclesTable, vehiclePublicLinksTable } from './test/tenant-test-db';
import { runWithTenant, type TenantContext } from './lib/tenant-context';
import { findPublicVehicleByPath, listPublicStockSitemapEntries } from './routes/stock';
import { publicVehicleDetailPath } from './lib/public-vehicle-links';
import { serveFrontend } from './lib/serve-frontend';
import { dealerSitemapXml } from './lib/seo-crawl';

process.env.NODE_ENV = 'test';
process.env.MULTI_TENANT_ENABLED = 'true';
process.env.LOG_LEVEL = 'fatal';

test('link helpers use published codes, clean names, and safe legacy fallbacks', () => {
  const car = { id: randomUUID(), make: 'Mercedes-Benz', model: 'A Class', sourceExtras: { publicVehicleCode: 'a1b2c3d4' } };
  assert.equal(vehicleDetailPath(car), '/cars/mercedes-benz-a-class-a1b2c3d4');
  assert.equal(vehicleSharePath(car), '/s/a1b2c3d4');
  assert.ok(vehicleMatchesPath(car, '/cars/old-name-a1b2c3d4'));
  assert.ok(vehicleMatchesPath(car, vehicleSharePath(car)));
  assert.ok(vehicleMatchesPath(car, `/vehicle/${car.id}`));
  assert.equal(vehicleDetailPath({ ...car, make: '</script>', model: '', title: '' }), '/cars/script-a1b2c3d4');
  for (const path of ['/cars/ford-a1b2c3d4/extra', '/s/a1b2c3d4/extra', '/s/%2e%2e', '//evil.test/s/a1b2c3d4']) assert.equal(vehicleCodeFromPath(path), null);
  assert.equal(vehicleDetailPath({ ...car, sourceExtras: { publicVehicleCode: '../bad' } }), `/vehicle/${car.id}`);
});

test('persistent links backfill once, allocate automatically, stay tenant-bound and redirect old paths', async () => {
  const migrations = (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  for (const file of migrations.filter(name => !name.startsWith('0083_'))) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  const a: TenantContext = { dealerId: 'links-a', canonicalOrigin: 'https://a.example.test', platform: 'autotrader', retailerId: 'links-a', sourceUrl: 'https://www.autotrader.co.uk/fictional' };
  const b = { ...a, dealerId: 'links-b', canonicalOrigin: 'https://b.example.test', retailerId: 'links-b' };
  await db.insert(dealershipsTable).values([a, b].map(tenant => ({ id: tenant.dealerId, name: tenant.dealerId, status: 'active' as const, canonicalOrigin: tenant.canonicalOrigin, stockPlatform: tenant.platform, retailerId: tenant.retailerId, sourceUrl: tenant.sourceUrl })));
  const oldId = randomUUID();
  await db.insert(vehiclesTable).values({ id: oldId, dealerId: a.dealerId, source: 'autotrader', advertId: 'old', make: 'Lexus', model: 'RX', title: 'Lexus RX', sourcePrice: 9500 });
  const migration = await readFile('../../lib/db/drizzle/0083_vehicle_public_links.sql', 'utf8');
  await engine.exec(migration);
  const [oldLink] = await db.select().from(vehiclePublicLinksTable).where(eq(vehiclePublicLinksTable.vehicleId, oldId));
  assert.match(oldLink.code, /^[a-z0-9]{8}$/);
  await engine.exec(migration);
  assert.equal((await db.select().from(vehiclePublicLinksTable)).length, 1);
  const otherId = randomUUID(), hiddenId = randomUUID(), deletedId = randomUUID();
  await db.insert(vehiclesTable).values([
    { id: otherId, dealerId: b.dealerId, source: 'autotrader', advertId: 'new', make: 'Ford', model: 'Focus', sourcePrice: 5000 },
    { id: hiddenId, dealerId: a.dealerId, source: 'autotrader', advertId: 'hidden', inventoryStatus: 'hidden', sourcePrice: 4000 },
    { id: deletedId, dealerId: a.dealerId, source: 'autotrader', advertId: 'deleted', sourcePrice: 4000 },
  ]);
  const links = await db.select().from(vehiclePublicLinksTable);
  assert.equal(links.length, 4); assert.equal(new Set(links.map(link => link.code)).size, 4);
  const codeFor = (id: string) => links.find(link => link.vehicleId === id)!.code;
  const lookup = (path: string, tenant = a) => runWithTenant(tenant, () => findPublicVehicleByPath(path));
  const car = await lookup(`/s/${oldLink.code}`); assert.equal(car?.id, oldId);
  const canonical = vehicleDetailPath(car!); assert.equal(canonical, `/cars/lexus-rx-${oldLink.code}`);
  assert.equal(await runWithTenant(a, () => publicVehicleDetailPath(car!)), canonical);
  assert.equal(await runWithTenant(a, () => db.transaction(tx => publicVehicleDetailPath(car!, tx as unknown as NonNullable<Parameters<typeof publicVehicleDetailPath>[1]>))), canonical, 'email validation can resolve links inside its existing transaction');
  assert.equal(await lookup(`/s/${oldLink.code}`, b), null);
  assert.equal(await lookup(`/s/${codeFor(otherId)}`), null);
  assert.equal(await lookup(`/s/${codeFor(hiddenId)}`), null);
  await db.delete(vehiclesTable).where(eq(vehiclesTable.id, deletedId));
  assert.equal(await lookup(`/s/${codeFor(deletedId)}`), null);
  assert.equal((await db.select().from(vehiclePublicLinksTable).where(eq(vehiclePublicLinksTable.code, codeFor(deletedId))))[0].vehicleId, null);
  const xml = await runWithTenant(a, async () => dealerSitemapXml(a.canonicalOrigin, { vehicles: await listPublicStockSitemapEntries() }));
  assert.ok(xml.includes(canonical)); assert.ok(!xml.includes('/vehicle/')); assert.ok(!xml.includes(codeFor(hiddenId))); assert.ok(!xml.includes(codeFor(otherId)));

  const dir = await mkdtemp(join(tmpdir(), 'vehicle-links-'));
  await writeFile(join(dir, 'index.html'), '<html><head><title>Shell</title></head><body><div id="root"></div></body></html>');
  const app = express();
  app.use((req, _res, next) => runWithTenant(req.get('x-test-tenant') === 'b' ? b : a, next));
  serveFrontend(app, dir, { loadPageData: async (path) => ({ settings: { identity: { name: 'Test Motors' } }, vehicle: await findPublicVehicleByPath(path) }) });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const path of [`/vehicle/${oldId}`, `/s/${oldLink.code}`, `/cars/older-label-${oldLink.code}`]) {
      const response = await fetch(`${base}${path}?source=whatsapp`, { redirect: 'manual' });
      assert.equal(response.status, 301); assert.equal(response.headers.get('location'), canonical + '?source=whatsapp');
    }
    const response = await fetch(base + canonical), html = await response.text();
    assert.equal(response.status, 200); assert.ok(html.includes(`https://a.example.test${canonical}`)); assert.match(html, /og:image|og:title/); assert.match(html, /application\/ld\+json/); assert.match(html, /9,500/);
    const crossTenant = await fetch(base + canonical, { headers: { 'x-test-tenant': 'b' } });
    assert.equal(crossTenant.status, 404); assert.doesNotMatch(await crossTenant.text(), /Lexus|9,500/);
    await db.update(vehiclesTable).set({ model: 'RX 450h' }).where(eq(vehiclesTable.id, oldId));
    const changed = await fetch(base + canonical, { redirect: 'manual' });
    assert.equal(changed.status, 301); assert.equal(changed.headers.get('location'), `/cars/lexus-rx-450h-${oldLink.code}`);
    await db.update(vehiclesTable).set({ make: null, model: null, websiteTitleOverride: 'Lexus RX Special Edition' }).where(eq(vehiclesTable.id, oldId));
    const changedCar = await lookup(`/s/${oldLink.code}`);
    const changedMap = await runWithTenant(a, async () => dealerSitemapXml(a.canonicalOrigin, { vehicles: await listPublicStockSitemapEntries() }));
    assert.ok(changedMap.includes(vehicleDetailPath(changedCar!)));
    assert.ok(changedMap.includes(`/cars/lexus-rx-special-edition-${oldLink.code}`));
    await db.update(vehiclesTable).set({ inventoryStatus: 'sold' }).where(eq(vehiclesTable.id, oldId));
    assert.equal((await fetch(`${base}/s/${oldLink.code}`, { redirect: 'manual' })).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); await engine.close();
  }
});
