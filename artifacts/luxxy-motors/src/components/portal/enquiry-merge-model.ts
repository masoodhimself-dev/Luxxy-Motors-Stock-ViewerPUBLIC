import type { Enquiry } from '@workspace/api-client-react';
import { activeMergeAppointment, assessCustomerContact, mergeAppointmentsOverlap, mergeCustomersNeedConfirmation, type CustomerContactMatch } from '@workspace/vehicle-meta';

export type MergeRecord = Enquiry & { mergedIntoId?: string | null };
export const hasActiveAppointment = activeMergeAppointment;

export function mergeRoot(entry: MergeRecord, entries: MergeRecord[]): MergeRecord | null {
  let current = entry;
  const visited = new Set<string>();
  while (current.mergedIntoId) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    const parent = entries.find(item => item.id === current.mergedIntoId);
    if (!parent) return null;
    current = parent;
  }
  return current;
}

export function mergeGroup(primary: MergeRecord, entries: MergeRecord[]) {
  const root = mergeRoot(primary, entries);
  return root ? entries.filter(item => mergeRoot(item, entries)?.id === root.id) : [];
}

export const differingMergeContacts = mergeCustomersNeedConfirmation;

/** A matching original surfaces its case, but every original still needs review. Nothing is preselected. */
export function mergeContactSuggestion(primary: readonly Enquiry[], candidate: readonly Enquiry[]): CustomerContactMatch {
  const pairs = primary.flatMap(left => candidate.map(right => assessCustomerContact(left, right)));
  const matches = pairs.filter(pair => pair.matchedBy.length);
  if (!matches.length) return { status: 'none', matchedBy: [], issues: [], label: 'Manual selection — no exact contact match' };
  const matchedBy = [...new Set(matches.flatMap(match => match.matchedBy))].sort() as CustomerContactMatch['matchedBy'];
  const issues = [...new Set(matches.flatMap(match => match.issues))];
  if (pairs.some(pair => pair.status === 'none')) issues.push('Some linked originals do not share these contact details.');
  return { status: issues.length ? 'review' : 'exact', matchedBy, issues, label: `Same ${matchedBy.join(' and ')}` };
}

export const mergeSuggestionRank = (match: CustomerContactMatch) => (match.status === 'exact' ? 20 : match.status === 'review' ? 10 : 0) + match.matchedBy.length;

export function overlappingMergeAppointments(entries: Enquiry[]) {
  const appointments = entries.filter(hasActiveAppointment);
  return appointments.flatMap((entry, index) => appointments.slice(index + 1).filter(other => mergeAppointmentsOverlap([entry, other])).map(other => [entry, other] as const));
}

export function mergeRequest(records: Enquiry[], keepAppointmentIds: string[], reason: string, confirmDifferentCustomers: boolean, allowOverlappingAppointments: boolean) {
  return {
    recordIds: records.map(entry => entry.id),
    expectedRevisions: records.map(entry => ({ id: entry.id, workspaceRevision: entry.workspaceRevision ?? 0, appointmentRevision: entry.appointmentRevision ?? 0, followUpRevision: entry.followUpRevision ?? 0 })),
    keepAppointmentIds,
    reason: reason.trim(),
    confirmDifferentCustomers,
    allowOverlappingAppointments,
  };
}
