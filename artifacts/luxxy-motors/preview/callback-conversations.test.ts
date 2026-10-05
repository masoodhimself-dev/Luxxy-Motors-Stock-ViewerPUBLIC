import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { showroomAvailability } from '@workspace/vehicle-meta';
import { handlePreviewBooking, reservationPreview, type BookingPreviewState } from './reservations';
import { operationsPreview } from './operations';
import { previewSettings } from './settings';
import { previewStock } from './stock';

const week = [{ days: 'Monday – Friday', times: '09:00 – 18:00' }, { days: 'Saturday', times: '09:00 – 17:00' }, { days: 'Sunday', times: 'Closed' }];
test('showroom callback times use London hours, exact closing boundaries and both DST transitions', () => {
  const open = showroomAvailability(week, new Date('2026-07-06T08:00:00Z'));
  assert.equal(open.state, 'open'); assert.equal(open.callbackAt?.toISOString(), '2026-07-06T08:00:00.000Z'); assert.equal(open.closesAt?.toISOString(), '2026-07-06T17:00:00.000Z');
  const closed = showroomAvailability(week, new Date('2026-07-06T17:00:00Z'));
  assert.equal(closed.state, 'closed'); assert.equal(closed.callbackAt?.toISOString(), '2026-07-07T08:00:00.000Z');
  assert.equal(closed.closesAt?.toISOString(), '2026-07-06T17:00:00.000Z');
  assert.equal(showroomAvailability(week, new Date('2026-03-28T18:00:00Z')).nextOpeningAt?.toISOString(), '2026-03-30T08:00:00.000Z');
  assert.equal(showroomAvailability(week, new Date('2026-10-24T18:00:00Z')).nextOpeningAt?.toISOString(), '2026-10-26T09:00:00.000Z');
  assert.equal(showroomAvailability([{ days: 'Mon-Fri', times: '9am-6pm' }, { days: 'Sat-Sun', times: 'Closed' }], new Date('2026-10-05T08:00:00Z')).state, 'open');
});
test('unknown, missing, sample, appointment-only and overlapping hours never invent a callback time', () => {
  const now = new Date('2026-10-05T10:00:00Z');
  for (const hours of [undefined, [], [{ days: 'Monday', times: 'By appointment' }], [{ days: 'Monday', times: '09:00 – 18:00 (sample)' }], [{ days: 'Monday', times: '09:00-18:00' }, { days: 'Monday', times: 'Closed' }]]) {
    const result = showroomAvailability(hours, now);
    assert.equal(result.state, 'unknown'); assert.equal(result.callbackAt, null);
  }
  assert.equal(showroomAvailability([{ days: 'Monday', times: 'Closed' }], now).callbackAt, null);
  assert.equal(showroomAvailability([{ days: 'Daily', times: 'Closed' }], now).callbackAt, null);
});
const callback = { vehicleId: previewStock.cars[0].id, type: 'general', customerName: 'Synthetic Callback', phone: '07700 900123', preferredContact: null, message: 'Please call about this car', appointmentAt: null, requestCallback: true };
async function call(state: BookingPreviewState, settings: typeof previewSettings, method: string, path: string, input?: object, staffId?: string) {
  const req = Readable.from(input ? [JSON.stringify(input)] : []) as IncomingMessage;
  req.method = method; req.headers = staffId ? { 'x-preview-staff-id': staffId } : {};
  const result = await handlePreviewBooking(req, new URL(path, 'http://localhost'), state, settings);
  assert.ok(result); return result as { status: number; data: any };
}
test('website callbacks require a phone, permit omitted email and preserve the correct car and no-time requests', async () => {
  const state: BookingPreviewState = { reservations: [] };
  const settings = { ...previewSettings, hours: week };
  const saved = (await call(state, settings, 'POST', '/api/enquiries', callback)).data;
  assert.equal(saved.email, null); assert.equal(saved.phone, '07700900123'); assert.equal(saved.preferredContact, 'phone'); assert.equal(saved.source, 'website_callback'); assert.equal(saved.callOutcome, 'callback_requested');
  assert.equal(saved.vehicleId, callback.vehicleId); assert.equal(saved.vehicleTitle, previewStock.cars[0].title); assert.equal(saved.assignedToId, null); assert.equal(saved.assignedToName, null); assert.ok(saved.followUpAt); assert.equal(saved.appointmentAt, null);
  const unknown = (await call(state, { ...settings, hours: [] }, 'POST', '/api/enquiries', { ...callback, email: null })).data;
  assert.equal(unknown.followUpAt, null); assert.equal(unknown.callOutcome, 'callback_requested');
  const before = JSON.stringify(state);
  for (const input of [{ ...callback, phone: null }, { ...callback, phone: 'abc123' }, { ...callback, email: 'invalid' }, { ...callback, customerName: '  ' }, { ...callback, type: 'viewing' }, { ...callback, appointmentAt: '2026-12-01T10:00:00Z' }]) await assert.rejects(call(state, settings, 'POST', '/api/enquiries', input));
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', { ...callback, email: null }), /public enquiry/);
  assert.equal(JSON.stringify(state), before);
});
test('staff conversations append dated authors and atomic outcomes/followups, preserving earlier notes and rejecting stale or foreign records', async () => {
  const state: BookingPreviewState = { reservations: [] };
  const settings = { ...previewSettings, hours: [] };
  const saved = (await call(state, settings, 'POST', '/api/enquiries', callback)).data;
  state.enquiries![0].staffNote = 'Keep the previous working note';
  const path = `/api/staff/enquiries/${saved.id}/conversations`;
  const next = new Date(Date.now() + 86_400_000).toISOString();
  const input = { expectedRevision: 0, expectedFollowUpRevision: 0, note: 'Discussed the service history.', callOutcome: 'callback_requested', followUpAt: next, followUpNote: 'Call with invoice details' };
  const logged = (await call(state, settings, 'POST', path, input, 'preview-jamie')).data;
  assert.equal(logged.workspaceRevision, 1); assert.equal(logged.followUpRevision, 1); assert.equal(logged.followUpAt, next); assert.equal(logged.followUpNote, input.followUpNote); assert.equal(logged.status, 'contacted'); assert.equal(logged.message, callback.message); assert.equal(logged.staffNote, 'Keep the previous working note');
  const event = logged.events.at(-1); assert.equal(event.kind, 'conversation_logged'); assert.equal(event.note, input.note); assert.equal(event.staffId, 'preview-jamie'); assert.equal(event.staffName, 'Jamie'); assert.ok(Number.isFinite(Date.parse(event.occurredAt))); assert.equal(event.callOutcome, input.callOutcome);
  const before = JSON.stringify(state);
  await assert.rejects(call(state, settings, 'POST', path, input), /changed/);
  await assert.rejects(call(state, settings, 'POST', path, { ...input, expectedRevision: 1, expectedFollowUpRevision: 1, followUpAt: '2020-01-01T09:00:00Z' }), /future/);
  await assert.rejects(call(state, settings, 'POST', path, { ...input, expectedRevision: 1, expectedFollowUpRevision: 1, note: '  ' }), /note/);
  await assert.rejects(call(state, settings, 'POST', path, input, 'unknown-staff'), /Sign in/);
  assert.equal(JSON.stringify(state), before);
  const second = (await call(state, settings, 'POST', path, { expectedRevision: 1, expectedFollowUpRevision: 1, note: 'Provided the invoice information.', callOutcome: 'information_given' })).data;
  assert.equal(second.events.length, logged.events.length + 1); assert.deepEqual(second.events.slice(0, logged.events.length), logged.events); assert.equal(second.followUpAt, next); assert.equal(second.followUpRevision, 1);
  state.enquiries![0].dealerId = 'another-dealer';
  await assert.rejects(call(state, settings, 'POST', path, { expectedRevision: 2, expectedFollowUpRevision: 1, note: 'Foreign edit', callOutcome: 'no_answer' }), /not found/);
});
test('durable isolated preview saves one concurrent conversation and denies anonymous/cross-origin requests', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'luxxy-callback-conversation-'));
  const stateFile = join(folder, 'bookings.json'); const operationsFile = join(folder, 'operations.json');
  const settings = { ...previewSettings, hours: [] };
  await writeFile(stateFile, JSON.stringify({ reservations: [], enquiries: [], settings }));
  const server = createServer((req, res) => { void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (await operationsPreview(req, res, url, { stateFile: operationsFile, readSettings: async () => settings as unknown as Record<string, unknown> })) return;
    if (await reservationPreview(req, res, url, { stateFile, readStaffDirectory: async () => [{ id: 'preview-alex', name: 'Alex' }, { id: 'preview-jamie', name: 'Jamie' }] })) return;
    res.statusCode = 404; res.end();
  })().catch(() => { res.statusCode = 500; res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, input: object, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
  try {
    const created = await post('/api/enquiries', callback); assert.equal(created.status, 201); const entry = await created.json();
    const path = `/api/staff/enquiries/${entry.id}/conversations`;
    const input = { expectedRevision: 0, expectedFollowUpRevision: 0, note: 'Synthetic durable conversation', callOutcome: 'information_given' };
    assert.equal((await post(path, input, { 'x-preview-staff-id': 'anonymous' })).status, 401);
    assert.equal((await post(path, input, { Origin: 'https://unrelated.example' })).status, 403);
    const concurrent = await Promise.all([post(path, input), post(path, { ...input, note: 'Competing conversation' })]);
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
    const persisted = JSON.parse(await readFile(stateFile, 'utf8')); assert.equal(persisted.enquiries[0].workspaceRevision, 1); assert.equal(persisted.enquiries[0].events.filter((event: { kind: string }) => event.kind === 'conversation_logged').length, 1);
    const reopened = await (await fetch(`${base}/api/enquiries`)).json(); assert.deepEqual(reopened[0].events, persisted.enquiries[0].events);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(folder, { recursive: true, force: true }); }
});
