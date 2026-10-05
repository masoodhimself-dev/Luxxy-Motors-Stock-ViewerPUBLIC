/** A merge links original enquiries into one staff case; it never copies customer data. */
export type EnquiryMergeRevision = { id: string; workspaceRevision: number; appointmentRevision: number; followUpRevision: number };
export type EnquiryMergeInput = {
  primaryId: string;
  recordIds: string[];
  expectedRevisions: EnquiryMergeRevision[];
  keepAppointmentIds: string[];
  reason: string;
  confirmDifferentCustomers: boolean;
  allowOverlappingAppointments: boolean;
};
export type MergeableEnquiry = {
  id: string;
  dealerId: string;
  customerName: string;
  email?: string | null;
  phone?: string | null;
  mergedIntoId?: string | null;
  workspaceRevision?: number;
  appointmentRevision?: number;
  followUpRevision?: number;
  appointmentAt?: Date | string | null;
  appointmentCancelledAt?: Date | string | null;
  appointmentDurationMinutes?: number | null;
  appointmentBufferMinutes?: number | null;
};
export class EnquiryMergeError extends Error {
  status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.status = status;
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function ids(value: unknown, min: number, max: number): value is string[] {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every(id => typeof id === 'string' && uuid.test(id)) && new Set(value).size === value.length;
}
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function parseEnquiryMergeInput(value: unknown, primaryId: string): EnquiryMergeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !uuid.test(primaryId)) throw new EnquiryMergeError('Check the records selected for merging.', 400);
  const input = value as Record<string, unknown>;
  if (!ids(input.recordIds, 2, 20) || !input.recordIds.includes(primaryId) || !ids(input.keepAppointmentIds, 0, 20)) throw new EnquiryMergeError('Select two to twenty records and explicitly choose the appointments to keep.', 400);
  if (typeof input.reason !== 'string' || input.reason.trim().length < 2 || input.reason.trim().length > 1000 || typeof input.confirmDifferentCustomers !== 'boolean' || typeof input.allowOverlappingAppointments !== 'boolean') throw new EnquiryMergeError('Add a merge reason and review the customer and appointment confirmations.', 400);
  if (!Array.isArray(input.expectedRevisions) || input.expectedRevisions.length !== input.recordIds.length) throw new EnquiryMergeError('Refresh the selected records before merging.', 400);
  const expectedRevisions: EnquiryMergeRevision[] = [];
  for (const item of input.expectedRevisions) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !input.recordIds.includes(item.id) || !revision(item.workspaceRevision) || !revision(item.appointmentRevision) || !revision(item.followUpRevision)) throw new EnquiryMergeError('Include current workspace, appointment and follow-up revisions for every selected record.', 400);
    expectedRevisions.push({ id: item.id, workspaceRevision: item.workspaceRevision, appointmentRevision: item.appointmentRevision, followUpRevision: item.followUpRevision });
  }
  if (new Set(expectedRevisions.map(item => item.id)).size !== input.recordIds.length) throw new EnquiryMergeError('Include each selected record revision exactly once.', 400);
  return { primaryId, recordIds: [...input.recordIds], expectedRevisions, keepAppointmentIds: [...input.keepAppointmentIds], reason: input.reason.trim(), confirmDifferentCustomers: input.confirmDifferentCustomers, allowOverlappingAppointments: input.allowOverlappingAppointments };
}
function canonicalPhone(value?: string | null) {
  let phone = (value ?? '').replace(/[\s().\-/]/g, '');
  if (!/^\+?\d{7,15}$/.test(phone)) return '';
  if (phone.startsWith('0044')) phone = `0${phone.slice(4)}`;
  else if (phone.startsWith('+44')) phone = `0${phone.slice(3)}`;
  else if (/^44\d{10}$/.test(phone)) phone = `0${phone.slice(2)}`;
  return phone;
}
function canonicalEmail(value?: string | null) { return (value ?? '').trim().toLowerCase(); }
function canonicalName(value: string) { return value.trim().toLowerCase().replace(/\s+/g, ' '); }
/** Same names alone do not establish customer identity. */
export function mergeCustomersNeedConfirmation(records: readonly MergeableEnquiry[]) {
  return records.some((record, index) => records.slice(index + 1).some(other => {
    const phone = canonicalPhone(record.phone), email = canonicalEmail(record.email);
    return canonicalName(record.customerName) !== canonicalName(other.customerName) || !((phone && phone === canonicalPhone(other.phone)) || (email && email === canonicalEmail(other.email)));
  }));
}
export function activeMergeAppointment(record: MergeableEnquiry) { return Boolean(record.appointmentAt && !record.appointmentCancelledAt); }
export function mergeAppointmentsOverlap(records: readonly MergeableEnquiry[]) {
  const kept = records.filter(activeMergeAppointment);
  return kept.some((record, index) => kept.slice(index + 1).some(other => {
    const start = new Date(record.appointmentAt!).getTime(), otherStart = new Date(other.appointmentAt!).getTime();
    const end = start + ((record.appointmentDurationMinutes ?? 30) + (record.appointmentBufferMinutes ?? 0)) * 60_000;
    const otherEnd = otherStart + ((other.appointmentDurationMinutes ?? 30) + (other.appointmentBufferMinutes ?? 0)) * 60_000;
    return start < otherEnd && otherStart < end;
  }));
}
/** Supply selected records AND all their existing group members, under the same write lock. */
export function planEnquiryMerge(input: EnquiryMergeInput, records: readonly MergeableEnquiry[], staff: { id: string; name: string }, now = new Date()) {
  // Revalidate even callers that construct a typed input without going through the HTTP parser.
  input = parseEnquiryMergeInput(input, input.primaryId);
  const selected = input.recordIds.map(id => records.find(record => record.id === id));
  if (selected.some(record => !record)) throw new EnquiryMergeError('A selected enquiry was not found in this dealership.', 404);
  const entries = selected as MergeableEnquiry[];
  if (new Set(entries.map(record => record.dealerId)).size !== 1) throw new EnquiryMergeError('A selected enquiry was not found in this dealership.', 404);
  const primary = entries.find(record => record.id === input.primaryId)!;
  if (primary.mergedIntoId) throw new EnquiryMergeError('Choose the main record of an existing case as the main record.', 409);
  for (const entry of entries) {
    if (entry.mergedIntoId) {
      const parent = entries.find(record => record.id === entry.mergedIntoId);
      if (!parent || parent.id === entry.id || parent.mergedIntoId) throw new EnquiryMergeError('The record belongs to another or invalid case. Refresh and select the complete case.', 409);
    }
    if (records.some(record => record.mergedIntoId === entry.id && !input.recordIds.includes(record.id))) throw new EnquiryMergeError('Include every original record from each selected case.', 409);
    const expected = input.expectedRevisions.find(item => item.id === entry.id)!;
    if (expected.workspaceRevision !== (entry.workspaceRevision ?? 0) || expected.appointmentRevision !== (entry.appointmentRevision ?? 0) || expected.followUpRevision !== (entry.followUpRevision ?? 0)) throw new EnquiryMergeError('An enquiry, appointment or follow-up changed. Refresh and review every selected record before merging.', 409);
  }
  if (entries.filter(entry => !entry.mergedIntoId).length < 2) throw new EnquiryMergeError('These records already belong to the same case.', 409);
  const active = entries.filter(activeMergeAppointment);
  if (input.keepAppointmentIds.some(id => !active.some(record => record.id === id))) throw new EnquiryMergeError('Choose appointments only from the active appointments in these records.', 400);
  if (active.some(record => !Number.isFinite(new Date(record.appointmentAt!).getTime()))) throw new EnquiryMergeError('An appointment has an invalid time. Review it before merging.', 409);
  if (mergeCustomersNeedConfirmation(entries) && !input.confirmDifferentCustomers) throw new EnquiryMergeError('These records may belong to different customers. Review and explicitly confirm this merge.', 409);
  const kept = active.filter(record => input.keepAppointmentIds.includes(record.id));
  if (mergeAppointmentsOverlap(kept) && !input.allowOverlappingAppointments) throw new EnquiryMergeError('The appointments you are keeping overlap. Review and explicitly confirm the overlap.', 409);
  const cancelledAppointmentIds = active.filter(record => !input.keepAppointmentIds.includes(record.id)).map(record => record.id);
  return {
    primaryId: input.primaryId, recordIds: [...input.recordIds], cancelledAppointmentIds,
    updates: entries.map(entry => ({ id: entry.id, update: {
      mergedIntoId: entry.id === input.primaryId ? null : input.primaryId, mergedAt: now, mergedBy: staff.id,
      workspaceRevision: (entry.workspaceRevision ?? 0) + 1, updatedAt: now,
      ...(cancelledAppointmentIds.includes(entry.id) ? { appointmentCancelledAt: now, appointmentRevision: (entry.appointmentRevision ?? 0) + 1, reminderStatus: 'not_scheduled', reminderError: null } : {}),
    } })),
    events: entries.map(entry => ({ enquiryId: entry.id,
      summary: entry.id === input.primaryId ? `${entries.length} records combined into this case by ${staff.name}` : `Record combined into case ${input.primaryId} by ${staff.name}`,
      detail: { note: input.reason, staffId: staff.id, staffName: staff.name, primaryId: input.primaryId, recordIds: [...input.recordIds], keepAppointmentIds: [...input.keepAppointmentIds], cancelledAppointmentIds: [...cancelledAppointmentIds], previousMergedIntoId: entry.mergedIntoId ?? null, confirmDifferentCustomers: input.confirmDifferentCustomers, allowOverlappingAppointments: input.allowOverlappingAppointments }, occurredAt: now,
    })),
  };
}
