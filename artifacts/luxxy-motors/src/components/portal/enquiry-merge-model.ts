import type { Enquiry } from '@workspace/api-client-react';
import { activeMergeAppointment, mergeAppointmentsOverlap, mergeCustomersNeedConfirmation } from '@workspace/vehicle-meta';

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
