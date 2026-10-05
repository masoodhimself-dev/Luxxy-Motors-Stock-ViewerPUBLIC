import type { Enquiry } from '@workspace/api-client-react';

type GroupIndex = { primaries: Map<string, Enquiry>; groups: Map<string, Enquiry[]>; roots: Enquiry[] };
const indexes = new WeakMap<readonly Enquiry[], GroupIndex>();

/** Query results are immutable: index each result once, rather than rescanning every row during rendering. */
function indexFor(all: readonly Enquiry[]): GroupIndex {
  const cached = indexes.get(all);
  if (cached) return cached;
  const byId = new Map(all.map(record => [record.id, record]));
  const primaries = new Map<string, Enquiry>();
  for (const entry of all) {
    const seen = new Set<string>();
    let current = entry;
    while (current.mergedIntoId) {
      if (seen.has(current.id)) { current = entry; break; }
      seen.add(current.id);
      const parent = byId.get(current.mergedIntoId);
      if (!parent) { current = entry; break; }
      current = parent;
    }
    primaries.set(entry.id, current);
  }
  const groups = new Map<string, Enquiry[]>();
  for (const entry of all) {
    const primary = primaries.get(entry.id)!;
    const group = groups.get(primary.id) ?? [];
    group.push(entry);
    groups.set(primary.id, group);
  }
  for (const [id, group] of groups) group.sort((left, right) => left.id === id ? -1 : right.id === id ? 1 : left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const index = { primaries, groups, roots: all.filter(entry => primaries.get(entry.id)!.id === entry.id) };
  indexes.set(all, index);
  return index;
}

/** Resolve explicit staff merges only. Missing or circular links keep a record visible. */
export function primaryEnquiry(entry: Enquiry, all: readonly Enquiry[]): Enquiry {
  return indexFor(all).primaries.get(entry.id) ?? entry;
}

/** Originals stay intact; the main record is followed by its linked records. */
export function enquiryGroup(entry: Enquiry, all: readonly Enquiry[]): Enquiry[] {
  const primary = primaryEnquiry(entry, all);
  return indexFor(all).groups.get(primary.id) ?? [primary];
}

export function enquiryRootRecords(all: readonly Enquiry[]): Enquiry[] {
  return indexFor(all).roots;
}

/** A search for a source car, contact or reference still finds the combined case. */
export function enquiryGroupSearchText(entry: Enquiry, all: readonly Enquiry[]): string {
  return enquiryGroup(entry, all).flatMap(record => [record.customerName, record.reference, record.phone, record.email,
    record.vehicleTitle, record.vehicleRegistration, record.message, record.staffNote, record.followUpNote])
    .filter(Boolean).join(' ');
}
