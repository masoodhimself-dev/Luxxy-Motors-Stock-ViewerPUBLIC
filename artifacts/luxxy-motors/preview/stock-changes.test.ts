import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stockChangesPreview } from './stock-changes';
import { previewStock } from './stock';

const car = previewStock.cars.find(car => car.price)!;
const entries = [{ id: 'phone-only-test', vehicleId: car.id, customerName: 'TEST Phone only', email: '', phone: '07700900123', status: 'new' }];
async function call(path: string, method = 'GET', input?: unknown, origin?: string, enabled = true) {
  const req = Readable.from(input === undefined ? [] : [JSON.stringify(input)]) as unknown as IncomingMessage;
  req.method = method; req.headers = { host: '127.0.0.1:4220', ...(origin ? { origin } : {}) };
  Object.defineProperty(req, 'socket', { value: { remoteAddress: '127.0.0.1' } });
  let output = '';
  const res = { statusCode: 200, setHeader() {}, end(value: string) { output = value; } } as unknown as ServerResponse;
  const handled = await stockChangesPreview(req, res, new URL(path, 'http://127.0.0.1:4220'), { enabled, readEnquiries: async () => entries as any });
  return { handled, status: res.statusCode, body: JSON.parse(output) };
}

test('local price task supports phone-only customers, revisions, outcomes and reminder preferences without delivery', async () => {
  const disabled = await call('/api/staff/stock-change-tasks', 'GET', undefined, undefined, false);
  assert.deepEqual(disabled.body.tasks, []);
  const initial = await call('/api/staff/stock-change-tasks');
  assert.equal(initial.body.tasks.length, 1);
  const task = initial.body.tasks[0];
  assert.equal(task.affectedCustomers[0].email, '');
  assert.equal(task.affectedCustomers[0].phone, '07700900123');
  assert.equal(task.affectedCustomers[0].outcome.status, 'pending');
  assert.equal((await call(`/api/staff/stock-change-tasks/${task.id}`, 'PATCH', { expectedRevision: 0, action: 'reviewed' })).status, 409);
  const path = `/api/staff/stock-change-tasks/${task.id}/customers/phone-only-test`;
  const follow = await call(path, 'PATCH', { expectedRevision: 0, expectedCustomerRevision: 0, action: 'follow_up', followUpAt: '2099-10-26T10:00:00Z' });
  assert.equal(follow.status, 200); assert.equal(follow.body.affectedCustomers[0].outcome.status, 'follow_up');
  const raised = await call('/api/staff/stock-change-settings', 'PUT', { minimumReduction: 600, contactIntervalDays: 7, revision: 0 });
  assert.equal(raised.status, 200);
  assert.equal((await call('/api/staff/stock-change-tasks')).body.tasks[0].affectedCustomers[0].outcome.status, 'follow_up');
  assert.equal((await call('/api/staff/stock-change-settings', 'PUT', { minimumReduction: 100, contactIntervalDays: 7, revision: raised.body.revision })).status, 200);
  assert.equal((await call(path, 'PATCH', { expectedRevision: 0, expectedCustomerRevision: 0, action: 'contacted', channel: 'call' })).status, 409);
  const done = await call(path, 'PATCH', { expectedRevision: 0, expectedCustomerRevision: 1, action: 'contacted', channel: 'call' });
  assert.equal(done.body.affectedCustomers[0].outcome.status, 'contacted');
  assert.equal(done.body.affectedCustomers[0].outreach.reason, 'recently_contacted');
  const preferences = await call('/api/staff/stock-change-settings');
  assert.equal(preferences.body.minimumReduction, 100);
  const saved = await call('/api/staff/stock-change-settings', 'PUT', { ...preferences.body, minimumReduction: 1000 });
  assert.equal(saved.status, 200);
  assert.equal((await call('/api/staff/stock-change-settings', 'PUT', preferences.body)).status, 409);
  assert.equal((await call('/api/staff/stock-change-tasks')).body.tasks.length, 0);
  assert.equal((await call(`/api/staff/stock-change-tasks/${task.id}`)).body.affectedCustomers[0].outreach.reason, 'below_minimum_reduction');
  assert.equal((await call('/api/staff/stock-change-settings', 'GET', undefined, 'https://outside.example')).status, 403);
});
