import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Enquiry } from '@workspace/api-client-react';
import { reservationPreview, upsertPreviewChatEnquiry, type BookingPreviewState } from './reservations';
import { previewSettings } from './settings';
import { previewStock } from './stock';

const ids = Array.from({ length: 5 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const at = new Date(Math.ceil((Date.now() + 7 * 86_400_000) / 900_000) * 900_000).toISOString();
function enquiry(id: string, extra: Partial<Enquiry> = {}): Enquiry & { manageToken?: string } {
  return { id, dealerId: 'local-preview', reference: `SYN-${id.slice(-2)}`, customerName: 'Synthetic Customer', phone: '07700900123', email: 'customer@example.test', type: 'viewing', status: 'new', message: `Original message ${id}`, vehicleId: previewStock.cars[0].id, vehicleTitle: `Original vehicle ${id}`, vehicleRegistration: 'AB12 CDE', vehiclePrice: 5000, vehicleUrl: '/vehicle/sample', preferredContact: 'phone', appointmentAt: at, appointmentCancelledAt: null, appointmentStatus: 'confirmed', appointmentDurationMinutes: 30, appointmentBufferMinutes: 0, appointmentRevision: 0, workspaceRevision: 0, followUpRevision: 0, followUpAt: new Date(Date.now() + 86_400_000).toISOString(), followUpNote: `Original callback ${id}`, followUpCompletedAt: null, assignedToId: 'preview-jamie', assignedToName: 'Jamie', staffNote: `Original note ${id}`, attendance: 'scheduled', callOutcome: null, partExchangeRegistration: null, partExchangeMileage: null, partExchangeCondition: null, manageToken: `token-${id}`, managePath: `/viewing/token-${id}`, calendarIcs: null, customerNotificationStatus: 'not_sent', customerNotificationError: null, customerNotificationSentAt: null, dealerNotificationStatus: 'not_sent', dealerNotificationError: null, dealerNotificationSentAt: null, reminderStatus: 'scheduled', reminderError: null, reminderSentAt: null, source: 'website', createdAt: at, updatedAt: at, events: [{ id: `original-${id}`, kind: 'conversation_logged', actor: 'dealer', summary: 'Original dated discussion', note: `Prior discussion ${id}`, staffName: 'Jamie', vehicleId: null, vehicleTitle: null, vehicleUrl: null, occurredAt: at }], ...extra };
}
const mergeInput = (records: Enquiry[], keepAppointmentIds: string[]) => ({ recordIds: records.map(record => record.id), expectedRevisions: records.map(record => ({ id: record.id, workspaceRevision: record.workspaceRevision ?? 0, appointmentRevision: record.appointmentRevision ?? 0, followUpRevision: record.followUpRevision ?? 0 })), keepAppointmentIds, reason: 'Customer has related bookings and enquiries', confirmDifferentCustomers: false, allowOverlappingAppointments: false });

test('durable preview merges atomically, preserves original records, tokens and histories, and keeps originals editable', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'luxxy-enquiry-merges-')), stateFile = join(folder, 'bookings.json');
  const originals = [enquiry(ids[0]), enquiry(ids[1], { appointmentAt: new Date(Date.parse(at) + 3_600_000).toISOString() }), enquiry(ids[2]), enquiry(ids[3], { type: 'general', appointmentAt: null, source: 'chat' }), enquiry(ids[4], { type: 'general', appointmentAt: null, mergedIntoId: ids[3] })];
  await writeFile(stateFile, JSON.stringify({ reservations: [], settings: previewSettings, enquiries: originals } satisfies BookingPreviewState));
  // Exercise the real HTTP middleware without binding a socket or contacting any service.
  async function call(method: string, path: string, input?: object, headers: Record<string, string> = {}) {
    const req = Readable.from(input ? [JSON.stringify(input)] : []) as IncomingMessage;
    req.method = method; req.url = path; req.headers = { host: 'localhost', ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])) };
    req.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket'];
    let data: any;
    const res = { statusCode: 200, setHeader() {}, end(body: string) { data = JSON.parse(body); } } as unknown as ServerResponse;
    assert.equal(await reservationPreview(req, res, new URL(path, 'http://localhost'), { stateFile, readStaffDirectory: async () => [{ id: 'preview-alex', name: 'Alex' }, { id: 'preview-jamie', name: 'Jamie' }], readMergeStaff: async () => [{ id: 'preview-alex', name: 'Alex', role: 'owner' }, { id: 'preview-jamie', name: 'Jamie', role: 'salesperson' }, { id: 'synthetic-accounts', name: 'Accounts', role: 'accounts' }] }), true);
    return { status: res.statusCode, json: async () => data };
  }
  const post = (path: string, input: object, headers: Record<string, string> = {}) => call('POST', path, input, headers);
  const path = `/api/staff/enquiries/${ids[0]}/merge`, input = mergeInput(originals.slice(0, 3), ids.slice(0, 2));
  try {
    const before = await readFile(stateFile, 'utf8');
    assert.equal((await post(path, input, { 'x-preview-staff-id': 'anonymous' })).status, 401);
    assert.equal((await post(path, input, { 'x-preview-staff-id': 'synthetic-accounts' })).status, 403);
    assert.equal((await post(path, input, { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await post(path, { ...input, keepAppointmentIds: undefined })).status, 400);
    assert.equal(await readFile(stateFile, 'utf8'), before, 'rejections leave durable state untouched');
    const results = await Promise.all([post(path, input, { 'x-preview-staff-id': 'preview-jamie' }), post(path, input)]);
    assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
    const result = await results.find(response => response.status === 200)!.json();
    assert.deepEqual(result.cancelledAppointmentIds, [ids[2]]);
    const persisted = JSON.parse(await readFile(stateFile, 'utf8')) as BookingPreviewState;
    assert.equal(persisted.enquiries!.length, originals.length);
    for (let index = 0; index < 3; index++) {
      const saved = persisted.enquiries![index], original = originals[index];
      assert.equal(saved.mergedIntoId, index === 0 ? null : ids[0]); assert.equal(saved.workspaceRevision, 1);
      for (const key of ['customerName', 'email', 'phone', 'vehicleId', 'vehicleTitle', 'message', 'staffNote', 'followUpAt', 'followUpNote', 'followUpRevision', 'manageToken', 'appointmentAt'] as const) assert.equal(saved[key], original[key], `${key} stays on original ${index}`);
      assert.deepEqual(saved.events[0], original.events[0]); assert.equal(saved.events.length, 2); assert.equal(saved.events[1].kind, 'records_merged'); assert.equal(saved.events[1].note, input.reason);
      assert.deepEqual(saved.events[1].detail?.cancelledAppointmentIds, [ids[2]]);
    }
    assert.equal(persisted.enquiries![0].appointmentCancelledAt, null); assert.equal(persisted.enquiries![1].appointmentCancelledAt, null);
    assert.ok(persisted.enquiries![2].appointmentCancelledAt); assert.equal(persisted.enquiries![2].appointmentRevision, 1); assert.equal(persisted.enquiries![2].reminderStatus, 'not_scheduled');
    const listed = await (await call('GET', '/api/enquiries')).json() as Enquiry[];
    assert.equal(listed.length, originals.length, 'API returns originals so staff can inspect the complete case');
    assert.equal('manageToken' in listed[0], false); assert.equal(listed[2].calendarIcs, null);
    for (let index = 0; index < 3; index++) {
      const booking = await (await call('GET', `/api/viewings/token-${ids[index]}`)).json();
      assert.equal(booking.reference, originals[index].reference); assert.equal(booking.appointmentAt, originals[index].appointmentAt); assert.equal(booking.status, index === 2 ? 'cancelled' : 'booked');
    }
    const edit = await call('PATCH', `/api/staff/enquiries/${ids[1]}/workspace`, { expectedRevision: 1, staffNote: 'Original child remains editable' });
    assert.equal(edit.status, 200); const child = await edit.json(); assert.equal(child.mergedIntoId, ids[0]); assert.equal(child.staffNote, 'Original child remains editable'); assert.equal(child.workspaceRevision, 2);
    const updated = JSON.parse(await readFile(stateFile, 'utf8')) as BookingPreviewState;
    assert.equal((await post(path, mergeInput(updated.enquiries!.slice(0, 4), ids.slice(0, 2)))).status, 409, 'partial second case selection is rejected');
    const chat = updated.enquiries![3];
    await upsertPreviewChatEnquiry({ id: chat.id, reference: chat.reference, name: chat.customerName, email: chat.email, phone: chat.phone, message: 'Customer sent another chat message', vehicle: null, callbackRequested: false, createdAt: chat.createdAt }, { stateFile });
    assert.equal((await post(path, mergeInput(updated.enquiries!, ids.slice(0, 2)))).status, 409, 'customer chat changes invalidate a reviewed merge');
    const afterChat = JSON.parse(await readFile(stateFile, 'utf8')) as BookingPreviewState;
    assert.equal(afterChat.enquiries![3].workspaceRevision, 1); assert.equal(afterChat.enquiries![4].mergedIntoId, ids[3]);
    const status = await call('PATCH', `/api/enquiries/${ids[3]}/status`, { status: 'contacted' }); assert.equal(status.status, 200);
    assert.equal((await post(path, mergeInput(afterChat.enquiries!, ids.slice(0, 2)))).status, 409, 'status changes invalidate a reviewed merge');
    const afterStatus = JSON.parse(await readFile(stateFile, 'utf8')) as BookingPreviewState;
    const flatten = await post(path, mergeInput(afterStatus.enquiries!, ids.slice(0, 2))); assert.equal(flatten.status, 200);
    const final = JSON.parse(await readFile(stateFile, 'utf8')) as BookingPreviewState;
    assert.deepEqual(final.enquiries!.map(record => record.mergedIntoId), [null, ids[0], ids[0], ids[0], ids[0]]);
    assert.equal(final.enquiries![1].events[0].note, originals[1].events[0].note);
    assert.equal(final.enquiries![1].events.filter(event => event.kind === 'records_merged').length, 2);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
