import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { communicationsPreview } from './communications';

async function call(path: string, method = 'GET', host = '127.0.0.1:4186', remoteAddress = '127.0.0.1') {
  const headers: Record<string, string> = {};
  let body = '';
  const req = { method, headers: { host }, socket: { remoteAddress } } as unknown as IncomingMessage;
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
    end(value: string) { body = value; },
  } as unknown as ServerResponse;
  const handled = await communicationsPreview(req, res, new URL(path, `http://${host}`));
  return { handled, status: res.statusCode, headers, data: JSON.parse(body) };
}

test('local preview reports device alerts as unconfigured without returning any push key', async () => {
  const result = await call('/api/staff/push');
  assert.equal(result.handled, true);
  assert.equal(result.status, 200);
  assert.equal(result.data.configured, false);
  assert.equal(result.data.publicKey, null);
  assert.deepEqual(result.data.subscriptions, []);
  assert.equal(result.data.preferences.reminderMinutes, 30);
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('local preview cannot subscribe, send a test, edit preferences or revoke real devices', async () => {
  for (const [path, method] of [
    ['/api/staff/push/subscriptions', 'POST'],
    ['/api/staff/push/test', 'POST'],
    ['/api/staff/push/preferences', 'PUT'],
    ['/api/staff/push/subscriptions/fictional-device', 'DELETE'],
  ]) {
    const result = await call(path, method);
    assert.equal(result.handled, true);
    assert.equal(result.status, 503);
    assert.match(result.data.error, /local preview cannot send/);
  }
});

test('preview push settings reject remote clients and non-loopback hosts', async () => {
  assert.equal((await call('/api/staff/push', 'GET', 'dealer.example')).status, 403);
  assert.equal((await call('/api/staff/push', 'GET', '127.0.0.1:4186', '192.168.1.20')).status, 403);
});
