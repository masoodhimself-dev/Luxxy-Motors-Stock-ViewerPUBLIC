import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { relationshipsPreview, readPreviewRelationships } from './relationships.ts';

function request(extra: { method?: string; remote?: string; host?: string; origin?: string; staff?: string } = {}): IncomingMessage {
  return { method: extra.method ?? 'GET', socket: { remoteAddress: extra.remote ?? '127.0.0.1' },
    headers: { host: extra.host ?? 'localhost:3007', ...(extra.origin ? { origin: extra.origin } : {}), ...(extra.staff ? { 'x-preview-staff-id': extra.staff } : {}) } } as IncomingMessage;
}
function response() {
  const headers = new Map<string, string>();
  const state = { status: 0, body: '' };
  const res = { statusCode: 0, setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    end(value: string) { state.status = this.statusCode; state.body = value; } } as unknown as ServerResponse;
  return { res, headers, state };
}

test('preview customer history requires the authorised network, same origin, and an active staff identity before reading data', async () => {
  let reads = 0;
  const read = async () => { reads++; return { generatedAt: '2026-10-05T10:00:00.000Z', vehicles: [], customers: [] }; };
  const directory = async () => [{ id: 'preview-alex', name: 'Alex' }, { id: 'preview-jamie', name: 'Jamie' }];
  for (const options of [{ remote: '203.0.113.5' }, { host: 'foreign.test' }, { origin: 'https://foreign.test' }, { staff: 'disabled-staff' }]) {
    const result = response();
    assert.equal(await relationshipsPreview(request(options), result.res, new URL('http://localhost/api/staff/relationships'), read, directory), true);
    assert.equal(result.state.status, 'staff' in options ? 401 : 403); assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  assert.equal(reads, 0);
  const signedIn = response();
  await relationshipsPreview(request({ staff: 'preview-jamie' }), signedIn.res, new URL('http://localhost/api/staff/relationships'), read, directory);
  assert.equal(signedIn.state.status, 200); assert.equal(reads, 1);
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const rejected = response();
    await relationshipsPreview(request({ method }), rejected.res, new URL('http://localhost/api/staff/relationships'), read, directory);
    assert.equal(rejected.state.status, 405); assert.equal(rejected.headers.get('allow'), 'GET');
  }
  assert.equal(reads, 1);
});

test('unrelated paths fall through and read failures do not disclose private local details', async () => {
  const result = response(); let reads = 0;
  const read = async () => { reads++; throw new Error('/private/path contains secret-api-token'); };
  const directory = async () => [{ id: 'preview-alex', name: 'Alex' }];
  assert.equal(await relationshipsPreview(request(), result.res, new URL('http://localhost/api/stock'), read, directory), false);
  assert.equal(reads, 0);
  assert.equal(await relationshipsPreview(request(), result.res, new URL('http://localhost/api/staff/relationships'), read, directory), true);
  assert.equal(result.state.status, 500); assert.equal(result.state.body.includes('secret-api-token'), false);
});

test('the live preview reader aggregates existing atomic stores without leaking private state', async () => {
  const result = await readPreviewRelationships();
  assert.ok(Number.isFinite(Date.parse(result.generatedAt)));
  assert.ok(result.vehicles.length > 0);
  const text = JSON.stringify(result);
  for (const field of ['manageTokenHash', 'documentArchives', 'credentialFingerprint', 'idempotencyKey', 'checkoutUrl', 'tokenHash', 'providerPayments']) assert.equal(text.includes(`"${field}"`), false, field);
});
