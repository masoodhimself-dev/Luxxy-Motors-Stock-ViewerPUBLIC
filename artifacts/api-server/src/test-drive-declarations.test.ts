import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import { engine, pool } from './test/tenant-test-db';
import { runWithTenant } from './lib/tenant-context';
import { PostgresTestDriveDeclarations, TestDriveDeclarationError, testDriveStatement, testDriveStatementHash, testDriveStatementVersion } from './lib/test-drive-declarations';
import { isPrivateTestDriveDeclarationPath, privateRequestLogUrl } from './middlewares/private-capability';

process.env.MULTI_TENANT_ENABLED = 'true';
const dealer = (id = 'declaration-a') => ({ dealerId: id, canonicalOrigin: `https://${id}.example.test`, platform: 'autotrader' as const, retailerId: id, sourceUrl: 'https://www.autotrader.co.uk/fictional', kind: 'website' as const });
const a = dealer(), b = dealer('declaration-b'), enquiryId = randomUUID(), vehicleId = randomUUID();
const inDealer = <T>(work: () => T, tenant = a) => runWithTenant(tenant, work);
const service = new PostgresTestDriveDeclarations(pool);
const acceptance = () => ({ requestId: randomUUID(), signerName: 'Example Driver', accepted: true, statementVersion: testDriveStatementVersion, statementHash: testDriveStatementHash });
let expectedAppointmentRevision = 0;
const issue = (token = 'a'.repeat(64)) => ({ requestId: randomUUID(), token, expectedAppointmentRevision, expectedVehicleId: vehicleId, expiresHours: 48 });

test('declarations preserve exact signed text, tenant boundaries, stale-booking checks and safe retries', async () => {
  for (const path of ['/api/test-drive-declarations', '/api/test-drive-declarations/private-token', '/API/TEST-DRIVE-DECLARATIONS/private-token/', `/api/staff/enquiries/${enquiryId}/test-drive-declarations`, `/api/staff/enquiries/${enquiryId}/test-drive-declarations/declaration-id/revoke`, `/api/staff/enquiries/${enquiryId}/test-drive-declarations/declaration-id/checks`]) assert.equal(isPrivateTestDriveDeclarationPath(path), true, path);
  for (const path of ['/api/test-drive-declarations-export/private-token', '/api/staff/enquiries/id/test-drive-declarations-export', '/api/staff/enquiries/id/workspace', '/api/stock/imports/dealer/grok', '/test-drive-declaration/private-token']) assert.equal(isPrivateTestDriveDeclarationPath(path), false, path);
  for (const file of (await readdir('../../lib/db/drizzle')).filter(value => /^\d+.*\.sql$/.test(value)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  for (const tenant of [a, b]) {
    await engine.query("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$1,'active',$2,'autotrader',$1,$3)", [tenant.dealerId, tenant.canonicalOrigin, tenant.sourceUrl]);
    await engine.query('INSERT INTO dealer_settings(dealer_id,config) VALUES($1,$2::jsonb)', [tenant.dealerId, JSON.stringify({ identity: { name: tenant.dealerId } })]);
  }
  await engine.query("INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price,plate) VALUES($1,$2,'autotrader','fictional-ad','Example vehicle',5000,'AB20 XYZ')", [vehicleId, a.dealerId]);
  await engine.query("INSERT INTO enquiries(id,dealer_id,vehicle_id,type,customer_name,email,phone,message,appointment_at,appointment_status,appointment_duration_minutes) VALUES($1,$2,$3,'viewing','PRIVATE CUSTOMER','private@example.invalid','PRIVATE PHONE','PRIVATE HISTORY',now()+interval '1 day','confirmed',30)", [enquiryId, a.dealerId, vehicleId]);
  try {
    const create = issue(), created = await inDealer(() => service.create(enquiryId, create, 'staff-a'));
    assert.equal(created.replayed, false); assert.equal(created.declaration.status, 'pending');
    assert.equal(created.url, `${a.canonicalOrigin}/test-drive-declaration/${create.token}`);
    const stored = (await engine.query<any>('SELECT * FROM test_drive_declarations WHERE id=$1', [created.declaration.id])).rows[0];
    assert.equal(stored.statement, testDriveStatement); assert.equal(stored.statement_hash, testDriveStatementHash);
    assert.ok(!JSON.stringify(stored).includes(create.token));
    assert.equal((await inDealer(() => service.create(enquiryId, create, 'staff-a'))).replayed, true);
    await assert.rejects(inDealer(() => service.create(enquiryId, { ...create, expiresHours: 24 }, 'staff-a')), /different declaration details/);
    const publicView = await inDealer(() => service.read(create.token));
    assert.equal(publicView.vehicle.registration, 'AB20 XYZ');
    assert.doesNotMatch(JSON.stringify(publicView), /PRIVATE|private@example|signerName|enquiryReference|customerName|token_hash/);
    await assert.rejects(inDealer(() => service.read(create.token), b), (error: unknown) => error instanceof TestDriveDeclarationError && error.status === 404);
    await assert.rejects(inDealer(() => service.list(enquiryId), b), /not found/);
    await assert.rejects(inDealer(() => service.create(enquiryId, issue('b'.repeat(64)), 'staff-b'), b), /not found/);
    await assert.rejects(inDealer(() => service.accept(create.token, { ...acceptance(), accepted: false })));
    await assert.rejects(inDealer(() => service.accept(create.token, { ...acceptance(), statementHash: '0'.repeat(64) })), /declaration changed/);
    const signedBody = acceptance(), signed = await inDealer(() => service.accept(create.token, signedBody));
    assert.equal(signed.replayed, false); assert.equal(signed.status, 'signed');
    const repeated = await inDealer(() => service.accept(create.token, signedBody));
    assert.equal(repeated.replayed, true); assert.equal(repeated.signedAt, signed.signedAt);
    await assert.rejects(inDealer(() => service.accept(create.token, { ...signedBody, signerName: 'Different person' })), /already been signed/);
    const history = await inDealer(() => service.list(enquiryId));
    assert.equal(history.declarations[0].signerName, 'Example Driver');
    assert.equal(history.declarations[0].statement, testDriveStatement);
    assert.equal(history.declarations[0].staffChecks.licenceChecked, false);
    await engine.query("UPDATE vehicles SET inventory_status='reserved' WHERE id=$1", [vehicleId]);
    assert.equal((await inDealer(() => service.read(create.token))).status, 'signed');
    const checks = await inDealer(() => service.checks(enquiryId, created.declaration.id, { expectedRevision: 1, licenceChecked: true, insuranceChecked: true }, 'staff-a'));
    assert.equal(checks.declaration.staffChecks.insuranceChecked, true);
    await assert.rejects(inDealer(() => service.checks(enquiryId, created.declaration.id, { expectedRevision: 1, licenceChecked: true, insuranceChecked: false }, 'staff-a')), /changed/);

    // Expiring the access link must not invalidate an early signature for the
    // same appointment or prevent staff recording their pre-drive checks.
    await engine.query("UPDATE test_drive_declarations SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1", [created.declaration.id]);
    const expiredAccess = (await inDealer(() => service.list(enquiryId))).declarations[0];
    assert.equal(expiredAccess.status, 'signed'); assert.equal(expiredAccess.current, true);
    assert.equal((await inDealer(() => service.checks(enquiryId, created.declaration.id, { expectedRevision: 2, licenceChecked: true, insuranceChecked: true }, 'staff-a'))).declaration.current, true);
    await assert.rejects(inDealer(() => service.read(create.token)), /expired or withdrawn/);

    await engine.query('UPDATE enquiries SET appointment_revision=appointment_revision+1,appointment_at=appointment_at+interval \'1 day\' WHERE id=$1', [enquiryId]);
    expectedAppointmentRevision = 1;
    const beforeStaleCreate = (await inDealer(() => service.list(enquiryId))).declarations.length;
    await assert.rejects(inDealer(() => service.create(enquiryId, { ...issue('f'.repeat(64)), expectedAppointmentRevision: 0 }, 'staff-a')), /Refresh the booking/);
    await assert.rejects(inDealer(() => service.create(enquiryId, { ...issue('f'.repeat(64)), expectedVehicleId: randomUUID() }, 'staff-a')), /Refresh the booking/);
    assert.equal((await inDealer(() => service.list(enquiryId))).declarations.length, beforeStaleCreate);
    // An exact retry of an already-created request is still a replay, even
    // after the booking changed; it must not create a second declaration.
    assert.equal((await inDealer(() => service.create(enquiryId, create, 'staff-a'))).replayed, true);
    await assert.rejects(inDealer(() => service.read(create.token)), /appointment or car details changed/);
    const next = issue('b'.repeat(64)), second = await inDealer(() => service.create(enquiryId, next, 'staff-a'));
    const oldSignature = (await inDealer(() => service.list(enquiryId))).declarations.find(row => row.id === created.declaration.id)!;
    assert.equal(oldSignature.status, 'signed'); assert.equal(oldSignature.current, false); assert.equal(oldSignature.signedAt, signed.signedAt);
    assert.equal(oldSignature.statement, testDriveStatement); assert.equal(oldSignature.signerName, 'Example Driver');
    await assert.rejects(inDealer(() => service.checks(enquiryId, created.declaration.id, { expectedRevision: 2, licenceChecked: true, insuranceChecked: true }, 'staff-a')), /appointment or car details changed/);
    await engine.query("UPDATE test_drive_declarations SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1", [created.declaration.id]);
    assert.equal((await inDealer(() => service.list(enquiryId))).declarations.find(row => row.id === created.declaration.id)?.status, 'signed');
    assert.equal(second.declaration.staffChecks.insuranceChecked, false);
    await engine.query("UPDATE vehicles SET plate='CHANGED' WHERE id=$1", [vehicleId]);
    await assert.rejects(inDealer(() => service.accept(next.token, acceptance())), /appointment or car details changed/);
    const anotherCar = randomUUID();
    await engine.query("INSERT INTO vehicles(id,dealer_id,source,advert_id,title,source_price) VALUES($1,$2,'autotrader','second-ad','Another car',6000)", [anotherCar, a.dealerId]);
    await engine.query('UPDATE enquiries SET vehicle_id=$2 WHERE id=$1', [enquiryId, anotherCar]);
    await assert.rejects(inDealer(() => service.read(next.token)), /appointment or car details changed/);
    await engine.query('UPDATE enquiries SET vehicle_id=$2 WHERE id=$1', [enquiryId, vehicleId]);
    const third = issue('c'.repeat(64)), thirdCreated = await inDealer(() => service.create(enquiryId, third, 'staff-a'));
    await inDealer(() => service.revoke(enquiryId, thirdCreated.declaration.id, 'staff-a'));
    await assert.rejects(inDealer(() => service.read(third.token)), /expired or withdrawn/);
    const fourth = issue('d'.repeat(64)), fourthCreated = await inDealer(() => service.create(enquiryId, fourth, 'staff-a'));
    await engine.query("UPDATE test_drive_declarations SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1", [fourthCreated.declaration.id]);
    await assert.rejects(inDealer(() => service.accept(fourth.token, acceptance())), /expired or withdrawn/);
    await engine.query('UPDATE enquiries SET appointment_cancelled_at=now() WHERE id=$1', [enquiryId]);
    await assert.rejects(inDealer(() => service.create(enquiryId, issue('e'.repeat(64)), 'staff-a')), /confirmed, active appointment/);
    await engine.query('UPDATE enquiries SET appointment_cancelled_at=NULL WHERE id=$1', [enquiryId]);

    // Real route: anonymous read/sign, staff role protection, origin validation and limits.
    const { createTestDriveDeclarationsRouter } = await import('./routes/test-drive-declarations');
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { if (req.get('x-test-role')) req.staff = { authUserId: 'staff-a', name: 'Staff', email: null, role: req.get('x-test-role') as 'owner' }; inDealer(next, req.get('x-dealer') === b.dealerId ? b : a); });
    app.use('/api', createTestDriveDeclarationsRouter(service));
    const server = createServer(app); await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<Response> => new Promise((resolve, reject) => {
      const req = httpRequest(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { host: 'declaration-a.example.test', 'content-type': 'application/json', ...headers } }, response => { let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => resolve(new Response(text || null, { status: response.statusCode, headers: { 'cache-control': String(response.headers['cache-control'] || ''), 'referrer-policy': String(response.headers['referrer-policy'] || ''), 'x-robots-tag': String(response.headers['x-robots-tag'] || ''), 'retry-after': String(response.headers['retry-after'] || '') } }))); });
      req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
    });
    try {
      const staffPath = `/staff/enquiries/${enquiryId}/test-drive-declarations`;
      assert.equal((await request(staffPath)).status, 401);
      assert.equal((await request(staffPath, 'POST', issue('e'.repeat(64)), { 'x-test-role': 'accounts' })).status, 403);
      assert.equal((await request(staffPath, 'POST', issue('e'.repeat(64)), { 'x-test-role': 'owner', origin: 'https://evil.example.test' })).status, 403);
      const fifth = issue('e'.repeat(64)), createdResponse = await request(staffPath, 'POST', fifth, { 'x-test-role': 'owner', origin: a.canonicalOrigin });
      assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
      assert.equal((await request(staffPath, 'POST', fifth, { 'x-test-role': 'owner' })).status, 200);
      const publicPath = `/test-drive-declarations/${fifth.token}`, response = await request(publicPath);
      assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/); assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.match(response.headers.get('x-robots-tag')!, /noindex/);
      assert.equal((await response.json() as any).signingEnabled, true);
      await engine.query("INSERT INTO dealer_feature_overrides(dealer_id,feature_key,mode,reason,updated_by) VALUES($1,'testDriveDeclarations','disabled','Fixture pause','staff-a')", [a.dealerId]);
      const paused = await request(publicPath); assert.equal(paused.status, 200); assert.equal((await paused.json() as any).signingEnabled, false);
      assert.equal((await request(publicPath, 'POST', acceptance(), { origin: a.canonicalOrigin })).status, 403);
      await engine.query("DELETE FROM dealer_feature_overrides WHERE dealer_id=$1 AND feature_key='testDriveDeclarations'", [a.dealerId]);
      assert.equal((await request(publicPath, 'GET', undefined, { 'x-dealer': b.dealerId })).status, 404);
      assert.equal((await request(publicPath, 'POST', acceptance(), { origin: 'https://evil.example.test' })).status, 403);
      const accept = acceptance(); assert.equal((await request(publicPath, 'POST', accept, { origin: a.canonicalOrigin })).status, 200);
      assert.equal((await (await request(publicPath, 'POST', accept)).json() as any).replayed, true);
      await engine.query("INSERT INTO dealer_feature_overrides(dealer_id,feature_key,mode,reason,updated_by) VALUES($1,'testDriveDeclarations','disabled','Fixture pause','staff-a')", [a.dealerId]);
      const signedWhilePaused = await request(publicPath); assert.equal(signedWhilePaused.status, 200);
      const savedWhilePaused = await signedWhilePaused.json() as any; assert.equal(savedWhilePaused.status, 'signed'); assert.equal(savedWhilePaused.signingEnabled, false);
      await engine.query("DELETE FROM dealer_feature_overrides WHERE dealer_id=$1 AND feature_key='testDriveDeclarations'", [a.dealerId]);
      assert.ok(!privateRequestLogUrl(`/api${publicPath}`)!.includes(fifth.token));
      assert.ok(!privateRequestLogUrl(`/test-drive-declaration/${fifth.token}`)!.includes(fifth.token));
      let limited = false;
      for (let i = 0; i < 25; i++) if ((await request(publicPath, 'POST', accept)).status === 429) { limited = true; break; }
      assert.equal(limited, true);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  } finally { await engine.close(); }
});
