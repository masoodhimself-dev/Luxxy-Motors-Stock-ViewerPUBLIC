import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { platformPreview, previewCapacitySnapshot } from './platform';

async function call(method = 'GET', host = '127.0.0.1:4186', remoteAddress = '127.0.0.1', origin?: string) {
  let output = '';
  const headers: Record<string, string> = {};
  const req = { method, headers: { host, origin }, socket: { remoteAddress } } as unknown as IncomingMessage;
  const res = { statusCode: 200, setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; }, end(value: string) { output = value; } } as unknown as ServerResponse;
  const handled = await platformPreview(req, res, new URL('/api/platform/capacity', `http://${host}`));
  return { handled, status: res.statusCode, data: JSON.parse(output), headers };
}

test('local capacity is a clearly fictional read-only sample with no provider calls', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network in local capacity'); });
  const sample = previewCapacitySnapshot(new Date('2026-10-17T14:00:00Z'));
  assert.equal(sample.scope, 'local_fixture');
  assert.equal(sample.localExample, true);
  assert.equal(sample.imports.dealerCount, 2);
  assert.equal(sample.imports.criticalCount, 1);
  assert.equal(sample.imports.missingConnectionCount, 1);
  assert.equal(sample.imports.dealers[0].freshness, 'fresh');
  assert.equal(sample.imports.dealers[1].ageSeconds, 15 * 3_600);
  const response = await call();
  assert.equal(response.handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.data.scope, 'local_fixture');
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal((await call('POST')).status, 409);
});

test('local capacity rejects remote access and untrusted origins', async () => {
  assert.equal((await call('GET', 'dealer.example')).status, 403);
  assert.equal((await call('GET', '127.0.0.1:4186', '192.168.1.10')).status, 403);
  assert.equal((await call('GET', '127.0.0.1:4186', '127.0.0.1', 'https://evil.example')).status, 403);
});
