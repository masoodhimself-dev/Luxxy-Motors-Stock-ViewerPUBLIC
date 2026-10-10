import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { engine, db, dealershipsTable, dealerDomainsTable, dealerImportKeysTable, vehiclesTable, dealerPrivateSettingsTable, portalUsersTable, dealerSettingsTable, enquiriesTable, leadsTable } from './test/tenant-test-db';
import { randomUUID } from "node:crypto";
import type { SaleWorkspaceDraft } from "@workspace/vehicle-meta";
import fixture from './test/fixtures/cazoo-stock.json';
import { currentDealerId, normaliseTenantHost, runWithTenant, type TenantContext } from './lib/tenant-context';
import { dealerIntegrationsStore } from './lib/dealer-integrations-store';
process.env.CLERK_TELEMETRY_DISABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'fatal';
process.env.MULTI_TENANT_ENABLED = 'true';
process.env.STOCK_IMPORT_API_HOST = 'imports.example.test';
process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64');
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_' + Buffer.from('clerk.example.test$').toString('base64');
process.env.CLERK_SECRET_KEY = 'sk_test_isolated_tenancy';
const a: TenantContext = { dealerId: 'dealer-a', canonicalOrigin: 'https://dealer-a.example.test', platform: 'cazoo', retailerId: 'retailer-a', sourceUrl: 'https://www.cazoo.co.uk/dealers/example-a/' };
const b: TenantContext = { dealerId: 'dealer-b', canonicalOrigin: 'https://dealer-b.example.test', platform: 'cazoo', retailerId: 'retailer-b', sourceUrl: 'https://www.cazoo.co.uk/dealers/example-b/' };
test('concurrent request contexts never share dealership identity', async () => {
  assert.throws(currentDealerId, /verified/);
  const values = await Promise.all([a,b,a,b].map((tenant,i) => runWithTenant(tenant, async () => { await new Promise(r => setTimeout(r, 5-i)); return currentDealerId(); })));
  assert.deepEqual(values, ['dealer-a','dealer-b','dealer-a','dealer-b']);
  assert.equal(normaliseTenantHost('Dealer-A.Example.Test:443'), 'dealer-a.example.test');
  for (const bad of ['good.test,evil.test','evil.test/path','a@evil.test','good.test?x']) assert.equal(normaliseTenantHost(bad), null);
});
test('PostgreSQL migrations and two-dealer HTTP imports, settings and vehicle lookups stay isolated', async () => {
  const directory = join(process.cwd(), '../../lib/db/drizzle');
  for (const file of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join(directory, file), 'utf8'));
  const { importSecretDigest } = await import('./middlewares/tenant');
  for (const [tenant,secret] of [[a,'fictional-key-a'],[b,'fictional-key-b']] as const) {
    await db.insert(dealershipsTable).values({ id: tenant.dealerId, name: tenant.dealerId, status: 'active', canonicalOrigin: tenant.canonicalOrigin, stockPlatform: tenant.platform, retailerId: tenant.retailerId, sourceUrl: tenant.sourceUrl });
    await db.insert(dealerDomainsTable).values({ hostname: new URL(tenant.canonicalOrigin).hostname, dealerId: tenant.dealerId, verified: true, verificationToken: 'fixture' });
    await db.insert(dealerImportKeysTable).values({ dealerId: tenant.dealerId, secretHash: importSecretDigest(secret) });
    await db.insert(portalUsersTable).values({ dealerId: tenant.dealerId, authUserId: 'user_same_identity', role: 'owner' });
  }
  const { defaultSettings, newDealerSettings } = await import('./routes/dealer-settings');
  const fresh = newDealerSettings('Fictional new dealer');
  assert.equal(fresh.identity.name, 'Fictional new dealer');
  assert.deepEqual(fresh.hours, []); assert.deepEqual(fresh.trustItems, []); assert.deepEqual(fresh.whyBuy, []);
  assert.equal(fresh.testDriveBooking.enabled, false);
  assert.ok(fresh.testDriveBooking.weeklyHours.every(day => !day.enabled));
  assert.equal(fresh.contact.phone, ''); assert.equal(fresh.onlineReservation.enabled, false);
  for (const tenant of [a,b]) await db.insert(dealerSettingsTable).values({ dealerId: tenant.dealerId, config: { ...defaultSettings, identity: { ...defaultSettings.identity, name: tenant.dealerId } } });
  const { default: app } = await import('./app');
  const server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing listener');
  const url = `http://127.0.0.1:${address.port}`;
  const request = (path: string, host: string, method = 'GET', body?: unknown, key?: string): Promise<Response> => new Promise((resolve, reject) => {
    const call = httpRequest(url + path, { method, headers: { host, 'Content-Type': 'application/json', ...(key ? { 'x-stock-import-secret': key } : {}) } }, response => {
      let data = ''; response.setEncoding('utf8'); response.on('data', chunk => { data += chunk; }); response.on('end', () => resolve(new Response(data || null, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })));
    }); call.on('error', reject); if (body) call.write(JSON.stringify(body)); call.end();
  });
  const snapshot = (tenant: TenantContext, id: string) => ({ ...fixture, runId: id, retailerId: tenant.retailerId, dealerName: tenant.dealerId, scrapedAt: new Date().toISOString() });
  try {
    assert.equal((await request('/api/stock', 'unknown.example.test')).status, 421);
    assert.equal((await request('/api/stock/imports/dealer-a/grok', 'imports.example.test', 'POST', snapshot(a,'bad-key'), 'fictional-key-b')).status, 403);
    assert.equal((await request('/api/stock/imports/dealer-a/grok', 'dealer-a.example.test', 'POST', snapshot(a,'bad-host'), 'fictional-key-a')).status, 421);
    const payloadA = snapshot(a,'run-a'), payloadB = snapshot(b,'run-b');
    assert.equal((await request('/api/stock/imports/dealer-a/grok', 'imports.example.test', 'POST', payloadA, 'fictional-key-a')).status, 201);
    assert.equal((await request('/api/stock/imports/dealer-b/grok', 'imports.example.test', 'POST', payloadB, 'fictional-key-b')).status, 201);
    assert.equal((await request('/api/stock/imports/dealer-a/grok', 'imports.example.test', 'POST', payloadA, 'fictional-key-a')).status, 200);
    const postA = (body: unknown, key = 'fictional-key-a') => request('/api/stock/imports/dealer-a/grok', 'imports.example.test', 'POST', body, key);
    const errorCheck = async (response: Response, expectedStatus: number, runId: string, code: string) => {
      assert.equal(response.status, expectedStatus, await response.clone().text());
      const body = await response.json() as { status: string; runId: string; errors: Array<{ code: string }> };
      assert.equal(body.runId, runId); assert.ok(body.errors.some(e => e.code === code));
    };
    await errorCheck(await postA(snapshot(a, 'invalid-secret'), 'unknown-key'), 401, 'invalid-secret', 'unauthorized');
    await errorCheck(await postA(snapshot(a, 'wrong-dealer'), 'fictional-key-b'), 403, 'wrong-dealer', 'dealer_credential_mismatch');
    await errorCheck(await postA({ ...snapshot(a, 'wrong-retailer'), retailerId: b.retailerId }), 422, 'wrong-retailer', 'retailer_not_allowed');
    await errorCheck(await postA({ ...snapshot(a, 'wrong-platform'), cars: fixture.cars.map(car => ({ ...car, sourceExtras: { ...car.sourceExtras, sourcePlatform: 'autotrader' } })) }), 422, 'wrong-platform', 'platform_mismatch');
    await errorCheck(await postA({ ...snapshot(a, 'incomplete'), complete: false }), 422, 'incomplete', 'incomplete_snapshot');
    await errorCheck(await postA({ ...payloadA, dealerName: 'Changed body' }), 409, payloadA.runId, 'run_id_conflict');
    const updated = { ...snapshot(a, 'newer-price'), scrapedAt: new Date(Date.now() + 1000).toISOString(), cars: fixture.cars.map(car => ({ ...car, price: 8995 })) };
    assert.equal((await postA(updated)).status, 201);
    const older = { ...snapshot(a, 'late-older'), scrapedAt: new Date(new Date(payloadA.scrapedAt).getTime() - 1000).toISOString() };
    await errorCheck(await postA(older), 409, 'late-older', 'superseded_snapshot');
    assert.equal((await db.select().from(vehiclesTable).where(eq(vehiclesTable.dealerId, a.dealerId)))[0].sourcePrice, 8995);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 48 * 3600000;
      const replay = await postA(payloadA); assert.equal(replay.status, 200);
      assert.equal((await replay.json() as { status: string }).status, 'replayed');
      await errorCheck(await postA({ ...payloadA, runId: 'stale-new-run' }), 422, 'stale-new-run', 'stale_snapshot');
    } finally { Date.now = realNow; }
    assert.equal((await db.select().from(vehiclesTable).where(eq(vehiclesTable.dealerId, a.dealerId)))[0].sourcePrice, 8995);
    const stockA = await request('/api/stock','dealer-a.example.test').then(r => r.json()) as { cars: Array<{ id: string }> };
    const stockB = await request('/api/stock','dealer-b.example.test').then(r => r.json()) as { cars: Array<{ id: string }> };
    assert.equal(stockA.cars.length,1); assert.equal(stockB.cars.length,1); assert.notEqual(stockA.cars[0].id,stockB.cars[0].id);
    assert.equal((await request('/api/vehicles/'+stockA.cars[0].id,'dealer-b.example.test')).status,404);
    assert.equal((await request('/api/vehicles/'+stockA.cars[0].id,'dealer-a.example.test')).status,200);
    const enquiry = { vehicleId: stockA.cars[0].id, type: 'general', customerName: 'Fictional buyer', email: 'buyer@example.test', phone: '07700900123', preferredContact: 'email', message: 'Test enquiry', appointmentAt: null };
    assert.equal((await request('/api/enquiries','dealer-b.example.test','POST',enquiry)).status,404);
    const submittedA = await request('/api/enquiries','dealer-a.example.test','POST',enquiry); assert.equal(submittedA.status,201,await submittedA.clone().text());
    const submittedB = await request('/api/enquiries','dealer-b.example.test','POST',{ ...enquiry, vehicleId: stockB.cars[0].id }); assert.equal(submittedB.status,201,await submittedB.clone().text());
    const entries = await db.select().from(enquiriesTable); assert.equal(entries.filter(e => e.dealerId === a.dealerId).length,1); assert.equal(entries.filter(e => e.dealerId === b.dealerId).length,1);
    const { dealerNotificationRecipient } = await import('./lib/enquiry-notifications');
    const oldRecipient = process.env.DEALER_NOTIFICATION_EMAIL;
    try {
      process.env.DEALER_NOTIFICATION_EMAIL = 'legacy@example.test';
      assert.equal(dealerNotificationRecipient('a@example.test'), 'a@example.test');
      assert.equal(dealerNotificationRecipient('b@example.test'), 'b@example.test');
      assert.equal(dealerNotificationRecipient(''), null);
      process.env.MULTI_TENANT_ENABLED = 'false';
      assert.equal(dealerNotificationRecipient('a@example.test'), 'legacy@example.test');
    } finally {
      process.env.MULTI_TENANT_ENABLED = 'true';
      if (oldRecipient === undefined) delete process.env.DEALER_NOTIFICATION_EMAIL;
      else process.env.DEALER_NOTIFICATION_EMAIL = oldRecipient;
    }
    const { forEachActiveDealer } = await import('./lib/tenant-jobs');
    const visited: string[] = [];
    await forEachActiveDealer(async () => { visited.push(currentDealerId()); });
    assert.deepEqual(visited.sort(), ['dealer-a', 'dealer-b']);
    const attempted: string[] = [];
    await assert.rejects(forEachActiveDealer(async () => {
      attempted.push(currentDealerId());
      if (currentDealerId() === a.dealerId) throw new Error('Fictional dealer-specific outage');
    }), AggregateError);
    assert.deepEqual(attempted.sort(), ['dealer-a', 'dealer-b']);

    const { backfillLeadsFromEnquiries } = await import('./lib/leads');
    const { logger } = await import('./lib/logger');
    // Leave B with an enquiry requiring backfill; A must not process it.
    await db.delete(leadsTable).where(eq(leadsTable.dealerId, b.dealerId));
    await runWithTenant(a, () => backfillLeadsFromEnquiries(logger));
    const carried = await db.select().from(leadsTable);
    assert.ok(carried.some(row => row.dealerId === a.dealerId));
    assert.ok(!carried.some(row => row.dealerId === b.dealerId));
    const brandingA = await request('/api/dealer-settings','dealer-a.example.test').then(r=>r.json()) as {identity:{name:string}};
    const brandingB = await request('/api/dealer-settings','dealer-b.example.test').then(r=>r.json()) as {identity:{name:string}};
    assert.equal(brandingA.identity.name,a.dealerId); assert.equal(brandingB.identity.name,b.dealerId);
    const { resolveStaffRow } = await import('./middlewares/staff-auth');
    assert.equal(await runWithTenant(a, () => resolveStaffRow({ authUserId: 'user_uninvited', email: 'other@example.test', name: 'Other' })), null);
    assert.equal((await runWithTenant(a, () => resolveStaffRow({ authUserId: 'user_same_identity', email: 'owner@example.test', name: 'Owner' })))?.dealerId, a.dealerId);
    await db.insert(portalUsersTable).values({ dealerId: a.dealerId, authUserId: 'user_a_only', role: 'salesperson' });
    assert.equal(await runWithTenant(b, () => resolveStaffRow({ authUserId: 'user_a_only', email: null, name: 'A only' })), null);
    const { siteOrigin } = await import('./lib/enquiry-links');
    assert.equal(runWithTenant(a, siteOrigin), a.canonicalOrigin); assert.equal(runWithTenant(b, siteOrigin), b.canonicalOrigin);
    await runWithTenant(a, () => dealerIntegrationsStore.updateSalesPaperwork({ expectedRevision: 0, saleTerms: 'DEALER A TERMS', reservationTerms: 'A ONLY' }));
    assert.equal((await runWithTenant(b, () => dealerIntegrationsStore.readSalesPaperwork())).saleTerms,'');
    const privateRows = await db.select().from(dealerPrivateSettingsTable); assert.equal(privateRows.length,1); assert.ok(!JSON.stringify(privateRows).includes('DEALER A TERMS'));
    const { PostgresSaleWorkspaceStore, readSaleWorkspaceAssets } = await import('./lib/sale-workspace-store');
    const { pool } = await import('./test/tenant-test-db');
    const storeA = new PostgresSaleWorkspaceStore(a.dealerId, (draft, client) => readSaleWorkspaceAssets(draft, a.dealerId, client), pool);
    const storeB = new PostgresSaleWorkspaceStore(b.dealerId, (draft, client) => readSaleWorkspaceAssets(draft, b.dealerId, client), pool);
    const draft: SaleWorkspaceDraft = { id: '', customer: 'Fictional buyer', email: 'buyer@example.test', phone: '07700900123', address: 'Fictional test address', vehicleId: stockA.cars[0].id, vehicle: 'Lexus IS', registration: '', price: '8995', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false };
    const created = await runWithTenant(a, () => storeA.mutate({ draft, requestId: randomUUID(), actor: 'Fixture A' }));
    await assert.rejects(storeB.get(created.sale.id), /not found/);
    const reserved = await runWithTenant(a, () => storeA.mutate({ id: created.sale.id, expectedRevision: created.sale.revision, requestId: randomUUID(), actor: 'Fixture A', command: { action: 'take-deposit', payment: { amount: '500', kind: 'deposit', status: 'confirmed', method: 'Bank transfer', date: '2026-10-09', reference: 'Fixture only' } } }));
    assert.equal(reserved.sale.lifecycle?.status,'reserved'); assert.ok(reserved.sale.documents.some(d=>d.type==='receipt'));
    const cars = await db.select().from(vehiclesTable); assert.equal(cars.find(c=>c.dealerId===a.dealerId)?.inventoryStatus,'reserved'); assert.equal(cars.find(c=>c.dealerId===b.dealerId)?.inventoryStatus,'available');
    assert.equal((await postA({ ...updated, runId: 'reserved-refresh', scrapedAt: new Date(Date.now() + 2000).toISOString() })).status, 201);
    assert.equal((await db.select().from(vehiclesTable).where(eq(vehiclesTable.dealerId, a.dealerId)))[0].inventoryStatus, 'reserved');
    const paid = await runWithTenant(a, () => storeA.mutate({ id: created.sale.id, expectedRevision: reserved.sale.revision, requestId: randomUUID(), actor: 'Fixture A', command: { action: 'payment', payment: { amount: '8495', kind: 'final-payment', status: 'confirmed', method: 'Bank transfer', date: '2026-10-09', reference: 'Fixture only' } } }));
    const sold = await runWithTenant(a, () => storeA.mutate({ id: created.sale.id, expectedRevision: paid.sale.revision, requestId: randomUUID(), actor: 'Fixture A', command: { action: 'complete-sale', acknowledge: true } }));
    assert.equal(sold.sale.lifecycle?.status,'sold'); assert.ok(sold.sale.documents.some(d=>d.type==='invoice')); assert.equal((await storeB.list()).length,0);
    assert.equal((await postA({ ...updated, runId: 'sold-refresh', scrapedAt: new Date(Date.now() + 3000).toISOString() })).status, 201);
    assert.equal((await db.select().from(vehiclesTable).where(eq(vehiclesTable.dealerId, a.dealerId)))[0].inventoryStatus, 'sold');
    assert.equal((await request('/api/stock', 'dealer-a.example.test').then(r => r.json()) as { cars: unknown[] }).cars.length, 0);
    assert.equal((await request('/api/stock', 'dealer-b.example.test').then(r => r.json()) as { cars: unknown[] }).cars.length, 1);
    await db.update(dealershipsTable).set({ status: 'suspended' }).where(eq(dealershipsTable.id,a.dealerId));
    assert.equal((await request('/api/stock','dealer-a.example.test')).status,421);
    assert.equal((await request('/api/stock','dealer-b.example.test')).status,200);
    assert.equal((await db.select().from(vehiclesTable)).length,2);
  } finally { await new Promise<void>(r => server.close(() => r())); await engine.close(); }
});
