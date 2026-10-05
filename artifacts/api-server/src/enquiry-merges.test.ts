import assert from 'node:assert/strict';
import test from 'node:test';
import { EnquiryMergeError, parseEnquiryMergeInput, planEnquiryMerge, mergeCustomersNeedConfirmation, mergeAppointmentsOverlap, type MergeableEnquiry } from '@workspace/vehicle-meta';
import { PostgresChatStore } from './lib/dealer-chat-store';
import { emptyChatState } from './lib/dealer-chat';

const ids = Array.from({ length: 24 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const now = new Date('2026-10-05T12:00:00Z');
const staff = { id: 'synthetic-sales', name: 'Synthetic Sales' };
const row = (id: string, extra: Partial<MergeableEnquiry> = {}): MergeableEnquiry => ({ id, dealerId: 'synthetic-dealer', customerName: 'Synthetic Customer', email: 'customer@example.test', phone: '07700 900123', workspaceRevision: 0, appointmentRevision: 0, followUpRevision: 0, mergedIntoId: null, ...extra });
function input(records: MergeableEnquiry[], extra: Record<string, unknown> = {}, primaryId = records[0].id) {
  return parseEnquiryMergeInput({ recordIds: records.map(record => record.id), expectedRevisions: records.map(record => ({ id: record.id, workspaceRevision: record.workspaceRevision ?? 0, appointmentRevision: record.appointmentRevision ?? 0, followUpRevision: record.followUpRevision ?? 0 })), keepAppointmentIds: records.filter(record => record.appointmentAt && !record.appointmentCancelledAt).map(record => record.id), reason: 'Same customer discussing several vehicles', confirmDifferentCustomers: false, allowOverlappingAppointments: false, ...extra }, primaryId);
}
function rejects(work: () => unknown, status: number, message?: RegExp) {
  assert.throws(work, (error: unknown) => error instanceof EnquiryMergeError && error.status === status && (!message || message.test(error.message)));
}
test('merge links originals without mutating contact, vehicle, message, follow-up or token data', () => {
  const entries = [row(ids[0]), row(ids[1], { phone: '+44 (7700) 900123' })];
  const before = JSON.stringify(entries), plan = planEnquiryMerge(input(entries), entries, staff, now);
  assert.equal(JSON.stringify(entries), before);
  assert.equal(plan.primaryId, ids[0]); assert.deepEqual(plan.recordIds, [ids[0], ids[1]]);
  assert.deepEqual(plan.cancelledAppointmentIds, []);
  assert.equal(plan.updates[0].update.mergedIntoId, null); assert.equal(plan.updates[1].update.mergedIntoId, ids[0]);
  for (const change of plan.updates) {
    assert.equal(change.update.workspaceRevision, 1); assert.equal(change.update.mergedBy, staff.id);
    for (const field of ['phone', 'email', 'customerName', 'message', 'vehicleId', 'followUpAt', 'followUpRevision', 'manageTokenHash', 'status']) assert.equal(field in change.update, false);
  }
  assert.equal(plan.events.length, 2); assert.equal(plan.events[0].detail.note, 'Same customer discussing several vehicles'); assert.equal(plan.events[1].detail.staffId, staff.id); assert.equal(plan.events[1].occurredAt, now);
});
test('appointments remain on originals; explicit omissions cancel only chosen slots and invalidate their revisions', () => {
  const entries = [row(ids[0], { appointmentAt: '2026-10-08T10:00:00Z' }), row(ids[1], { appointmentAt: '2026-10-08T14:00:00Z', appointmentRevision: 4 }), row(ids[2], { appointmentAt: '2026-10-09T10:00:00Z', appointmentCancelledAt: '2026-10-01T00:00:00Z' })];
  const plan = planEnquiryMerge(input(entries, { keepAppointmentIds: [ids[0]] }), entries, staff, now);
  assert.deepEqual(plan.cancelledAppointmentIds, [ids[1]]);
  assert.equal('appointmentCancelledAt' in plan.updates[0].update, false);
  assert.equal(plan.updates[1].update.appointmentCancelledAt, now); assert.equal(plan.updates[1].update.appointmentRevision, 5); assert.equal(plan.updates[1].update.reminderStatus, 'not_scheduled');
  assert.equal('appointmentRevision' in plan.updates[2].update, false);
  assert.deepEqual(plan.events[0].detail.cancelledAppointmentIds, [ids[1]]);
  rejects(() => planEnquiryMerge(input(entries, { keepAppointmentIds: [ids[2]] }), entries, staff, now), 400);
  const past = [row(ids[0], { appointmentAt: '2020-01-01T10:00:00Z' }), row(ids[1])];
  assert.deepEqual(planEnquiryMerge(input(past), past, staff, now).cancelledAppointmentIds, [], 'historical appointments are kept unless explicitly omitted');
});
test('all revisions, complete groups and valid parents are required before any update', () => {
  const entries = [row(ids[0]), row(ids[1]), row(ids[2], { mergedIntoId: ids[1] })];
  const before = JSON.stringify(entries);
  rejects(() => planEnquiryMerge(input(entries.slice(0, 2)), entries, staff, now), 409, /every original/);
  const flattened = planEnquiryMerge(input(entries), entries, staff, now);
  assert.deepEqual(flattened.updates.map(change => change.update.mergedIntoId), [null, ids[0], ids[0]]);
  for (const field of ['workspaceRevision', 'appointmentRevision', 'followUpRevision'] as const) {
    const changed = entries.map(entry => ({ ...entry })); changed[1][field] = 1;
    rejects(() => planEnquiryMerge(input(entries), changed, staff, now), 409, /changed/);
  }
  rejects(() => planEnquiryMerge(input(entries, {}, ids[2]), entries, staff, now), 409, /main record/);
  rejects(() => planEnquiryMerge(input(entries), [entries[0], { ...entries[1], mergedIntoId: ids[3] }, entries[2]], staff, now), 409, /another or invalid/);
  rejects(() => planEnquiryMerge(input(entries), [entries[0], { ...entries[1], mergedIntoId: ids[2] }, entries[2]], staff, now), 409, /invalid case/);
  rejects(() => planEnquiryMerge(input(entries), entries.slice(0, 2), staff, now), 404);
  rejects(() => planEnquiryMerge(input(entries), entries.map(entry => entry.id === ids[1] ? { ...entry, dealerId: 'another-dealer' } : entry), staff, now), 404);
  assert.equal(JSON.stringify(entries), before);
});
test('contact and name differences require explicit staff confirmation; names alone never prove identity', () => {
  const a = row(ids[0], { email: null });
  for (const phone of ['+44 7700 900123', '00447700900123', '447700900123']) assert.equal(mergeCustomersNeedConfirmation([a, row(ids[1], { email: null, phone })]), false);
  const cases = [row(ids[1], { phone: '07700900999', email: 'other@example.test' }), row(ids[1], { phone: null, email: null }), row(ids[1], { customerName: 'Another Customer' })];
  for (const b of cases) {
    const entries = [a, b]; assert.equal(mergeCustomersNeedConfirmation(entries), true);
    rejects(() => planEnquiryMerge(input(entries), entries, staff, now), 409, /different customers/);
    assert.equal(planEnquiryMerge(input(entries, { confirmDifferentCustomers: true }), entries, staff, now).updates.length, 2);
  }
});
test('overlap includes buffers, allows touching endpoints and requires explicit override', () => {
  const entries = [row(ids[0], { appointmentAt: '2026-10-08T10:00:00Z', appointmentDurationMinutes: 30, appointmentBufferMinutes: 15 }), row(ids[1], { appointmentAt: '2026-10-08T10:30:00Z' })];
  assert.equal(mergeAppointmentsOverlap(entries), true);
  rejects(() => planEnquiryMerge(input(entries), entries, staff, now), 409, /overlap/);
  assert.deepEqual(planEnquiryMerge(input(entries, { allowOverlappingAppointments: true }), entries, staff, now).cancelledAppointmentIds, []);
  assert.equal(mergeAppointmentsOverlap([entries[0], { ...entries[1], appointmentAt: '2026-10-08T10:45:00Z' }]), false);
  assert.deepEqual(planEnquiryMerge(input(entries, { keepAppointmentIds: [ids[0]] }), entries, staff, now).cancelledAppointmentIds, [ids[1]]);
});
test('malformed IDs, duplicate selections, missing explicit appointments and revisions cannot form a plan', () => {
  const entries = [row(ids[0]), row(ids[1])];
  for (const extra of [{ recordIds: [ids[0]] }, { recordIds: [ids[0], ids[0]] }, { recordIds: [ids[0], 'bad-id'] }, { recordIds: ids }, { keepAppointmentIds: undefined }, { keepAppointmentIds: [ids[0], ids[0]] }, { expectedRevisions: [] }, { reason: ' ' }, { confirmDifferentCustomers: undefined }, { allowOverlappingAppointments: undefined }]) rejects(() => input(entries, extra), 400);
  for (const field of ['workspaceRevision', 'appointmentRevision', 'followUpRevision']) for (const value of [-1, 0.5, undefined]) rejects(() => input(entries, { expectedRevisions: entries.map(entry => ({ id: entry.id, workspaceRevision: 0, appointmentRevision: 0, followUpRevision: 0, [field]: value })) }), 400);
});

test('production chat contact changes invalidate a reviewed merge and preserve existing case membership', async () => {
  const existing = { ...row(ids[1], { mergedIntoId: ids[0], workspaceRevision: 4 }), message: 'Existing enquiry transcript' };
  const entries = [row(ids[0]), existing, row(ids[2])], reviewed = input(entries);
  const client = { release() {}, async query(sql: string, params: any[] = []) {
    if (sql.startsWith('SELECT state')) return { rows: [{ state: emptyChatState() }] };
    if (sql.startsWith('INSERT INTO enquiries')) {
      // Interpret the update expression on the existing fixture, rather than contacting a database.
      const update = sql.slice(sql.indexOf('DO UPDATE SET'), sql.indexOf('WHERE enquiries.dealer_id'));
      const revisionChange = /workspace_revision\s*=\s*enquiries\.workspace_revision\s*\+\s*(\d+)/.exec(update);
      if (revisionChange) existing.workspaceRevision = (existing.workspaceRevision ?? 0) + Number(revisionChange[1]);
      Object.assign(existing, { customerName: params[8], email: params[9], phone: params[10], message: params[12] });
      assert.doesNotMatch(update, /merged_into_id\s*=/, 'chat never reassigns the case');
    }
    return { rows: [] };
  } };
  const store = new PostgresChatStore({ ...client, connect: async () => client });
  await store.transaction('synthetic-dealer', tx => tx.saveEnquiry({ id: existing.id, reference: 'SYN-CHAT', name: 'Different synthetic customer', email: 'changed@example.test', phone: '07700900999', message: 'Updated customer transcript', callbackRequested: false, vehicle: null, createdAt: now.toISOString() }));
  assert.equal(existing.workspaceRevision, 5); assert.equal(existing.mergedIntoId, ids[0]); assert.equal(existing.message, 'Updated customer transcript');
  rejects(() => planEnquiryMerge(reviewed, entries, staff, now), 409, /changed/);
});
