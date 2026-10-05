import { isUKNumberPlate } from './registration.ts';

/** Read-only staff history. Inputs may contain private fields; output is built from an explicit whitelist. */
export type RelationshipCounts = { enquiries: number; appointments: number; reservations: number; sales: number };
export type RelationshipActivity = {
  id: string; kind: 'enquiry' | 'appointment' | 'follow_up' | 'reservation' | 'sale' | 'payment' | 'document' | 'note' | 'chat';
  recordType: 'enquiry' | 'reservation' | 'sale'; recordId: string; reference: string;
  title: string; description: string; status: string; occurredAt: string;
  vehicleId: string | null; customerId: string; amountPence: number | null; url: string;
  caseId?: string;
};
export type RelationshipVehicle = {
  id: string; title: string; registration: string | null; pricePence: number | null; imageUrl: string | null;
  status: string; lastActivityAt: string | null; customerIds: string[]; counts: RelationshipCounts; activities: RelationshipActivity[];
};
export type RelationshipCustomer = {
  id: string; name: string; email: string | null; phone: string | null; matchingNote: string;
  vehicleIds: string[]; recordKeys: string[]; lastActivityAt: string | null; counts: RelationshipCounts; activities: RelationshipActivity[];
};
export type DealerRelationships = { generatedAt: string; vehicles: RelationshipVehicle[]; customers: RelationshipCustomer[] };
type Time = string | Date | null;
export type RelationshipVehicleSource = {
  id: string; title?: string | null; registration?: string | null; pricePence?: number | null;
  imageUrl?: string | null; status?: string | null;
};
type VehicleSnapshot = {
  vehicleId?: string | null; vehicleTitle?: string | null; vehicleRegistration?: string | null;
  vehiclePrice?: number | null; vehiclePricePence?: number | null; vehicleUrl?: string | null;
};
export type RelationshipEnquirySource = VehicleSnapshot & {
  id: string; reference?: string | null; customerName: string; email?: string | null; phone?: string | null;
  type?: string | null; status?: string | null; message?: string | null; staffNote?: string | null;
  callOutcome?: string | null; attendance?: string | null; createdAt?: Time; updatedAt?: Time;
  appointmentAt?: Time; appointmentStatus?: string | null; appointmentCancelledAt?: Time;
  followUpAt?: Time; followUpNote?: string | null; followUpCompletedAt?: Time;
  mergedIntoId?: string | null;
};
export type RelationshipEnquiryEventSource = VehicleSnapshot & {
  id: string; enquiryId: string | null; kind: string; summary?: string | null; occurredAt?: Time;
  note?: string | null; staffName?: string | null;
};
export type RelationshipReservationSource = VehicleSnapshot & {
  id: string; reference: string; customerName: string; email?: string | null; phone?: string | null;
  status: string; paymentStatus: string; depositPence: number; expectedPricePence: number;
  amountReceivedPence: number; amountRefundedPence?: number; createdAt: Time; updatedAt?: Time;
  cancelledAt?: Time; saleId?: string; sourceEnquiryId?: string | null; mode?: string;
};
export type RelationshipReservationEventSource = {
  id: string; reservationId: string; type: string; description?: string | null; occurredAt?: Time;
};
export type RelationshipSaleSource = {
  id: string; reference: string; createdAt: string; updatedAt: string;
  draft: { customer: string; email: string; phone: string; vehicleId: string; vehicle: string; registration: string;
    price: string; notes: string; sourceEnquiryId?: string; sourceReservationId?: string; appointment?: { at: string; status: string } };
  lifecycle?: { status: string; changedAt: string };
  payments: Array<{ id: string; amountPence: number; signedAmountPence: number; method: string; date: string;
    reference: string; kind: string; status: string; recordedAt: string; reason?: string }>;
  documents: Array<{ id: string; number: string; type: string; title: string; issuedAt: string; paymentAmountPence?: number;
    snapshot?: { draft?: { vehicleId?: string; vehicle?: string; registration?: string; price?: string } } }>;
  events: Array<{ id: string; type: string; description: string; occurredAt: string }>;
};
export type DealerRelationshipSources = {
  vehicles: readonly RelationshipVehicleSource[]; enquiries: readonly RelationshipEnquirySource[];
  enquiryEvents?: readonly RelationshipEnquiryEventSource[]; reservations: readonly RelationshipReservationSource[];
  reservationEvents?: readonly RelationshipReservationEventSource[]; sales: readonly RelationshipSaleSource[]; generatedAt?: string;
  chats?: readonly RelationshipChatSource[];
};
export type RelationshipChatSource = VehicleSnapshot & {
  id: string; reference: string; enquiryId: string | null; status: string; createdAt?: Time; updatedAt?: Time;
  messages: readonly { id: string; authorRole: string; authorName: string; body: string; createdAt?: Time }[];
};

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const emailKey = (value: unknown) => {
  const email = clean(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};
const nameKey = (value: unknown) => clean(value).replace(/\s+/g, ' ').toLowerCase();
const phoneKey = (value: unknown) => {
  let phone = clean(value).replace(/[\s().\-/]/g, '');
  if (phone.startsWith('0044')) phone = `+44${phone.slice(4)}`;
  if (/^0\d{10}$/.test(phone)) phone = `+44${phone.slice(1)}`;
  return /^\+?\d{7,15}$/.test(phone) ? phone.replace(/^\+/, '') : '';
};
const money = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const pounds = (value: unknown) => {
  const text = clean(value).replace(/[£,\s]/g, '');
  return /^\d+(?:\.\d{1,2})?$/.test(text) ? money(Math.round(Number(text) * 100)) : null;
};
function iso(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
const stamp = (value: unknown, fallback?: unknown) => iso(value) ?? iso(fallback) ?? '';
const human = (value: string) => value.replace(/[_-]/g, ' ');
const unique = <T>(values: readonly T[]) => [...new Set(values)];
const chronological = (a: RelationshipActivity, b: RelationshipActivity) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id);
const emptyCounts = (): RelationshipCounts => ({ enquiries: 0, appointments: 0, reservations: 0, sales: 0 });
function counts(activities: readonly RelationshipActivity[]): RelationshipCounts {
  const result = emptyCounts();
  const kinds = { enquiry: 'enquiries', appointment: 'appointments', reservation: 'reservations', sale: 'sales' } as const;
  for (const [kind, field] of Object.entries(kinds)) result[field as keyof RelationshipCounts] = unique(activities.filter(a => a.kind === kind).map(a => `${a.recordType}:${kind === 'enquiry' ? a.caseId ?? a.recordId : a.recordId}`)).length;
  return result;
}
type ContactRecord = { key: string; type: RelationshipActivity['recordType']; id: string; name: string; email: string; phone: string; updatedAt: string; links: string[]; mergeLink?: string; mergePrimary?: boolean };

/** Conservative identity resolution: no name-only, visitor ID, fuzzy email, or partial-phone matching. */
function customersFor(records: ContactRecord[]) {
  const parent = records.map((_, index) => index);
  const groupMembers = records.map((_, index) => [index]);
  const groupEmails = records.map(record => new Set([emailKey(record.email)].filter(Boolean)));
  const reasons = records.map(() => new Set<string>());
  const warnings = records.map(() => new Set<string>());
  const byKey = new Map(records.map((record, index) => [record.key, index]));
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]));
  const members = (index: number) => groupMembers[root(index)];
  const join = (a: number, b: number, reason: string) => {
    let left = root(a), right = root(b);
    if (left === right) return;
    const emails = unique([...groupEmails[left], ...groupEmails[right]]);
    if (emails.length > 1 && reason !== 'explicit source links' && reason !== 'staff merge') {
      for (const i of [...members(left), ...members(right)]) warnings[i].add('Conflicting emails; records kept separate for staff review.');
      return;
    }
    if (emails.length > 1) for (const i of [...members(left), ...members(right)]) warnings[i].add(reason === 'staff merge' ? 'Staff merged records with different contact details; original details remain in the history.' : 'Explicit source link has changed email details; review the customer contact details.');
    if (groupMembers[left].length < groupMembers[right].length) [left, right] = [right, left];
    parent[right] = left;
    groupMembers[left].push(...groupMembers[right]); groupMembers[right] = [];
    groupEmails[left] = new Set(emails); groupEmails[right] = new Set();
    reasons[a].add(reason); reasons[b].add(reason);
  };
  for (let i = 0; i < records.length; i++) {
    const linked = records[i].mergeLink ? byKey.get(records[i].mergeLink!) : undefined;
    if (linked !== undefined) join(i, linked, 'staff merge');
  }
  for (let i = 0; i < records.length; i++) for (const key of records[i].links) {
    const linked = byKey.get(key);
    if (linked !== undefined) join(i, linked, 'explicit source links');
  }
  const byEmail = new Map<string, number[]>();
  for (let i = 0; i < records.length; i++) {
    const email = emailKey(records[i].email);
    if (!email) continue;
    byEmail.set(email, [...(byEmail.get(email) ?? []), i]);
  }
  for (const indices of byEmail.values()) {
    if (unique(indices.map(i => nameKey(records[i].name)).filter(Boolean)).length > 1) {
      if (unique(indices.map(root)).length > 1) for (const i of indices) warnings[i].add('Shared email with different customer names; records kept separate for staff review.');
      continue;
    }
    for (const i of indices.slice(1)) join(indices[0], i, 'exact email');
  }
  const byPhone = new Map<string, number[]>();
  records.forEach((record, i) => { const phone = phoneKey(record.phone); if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), i]); });
  for (const indices of byPhone.values()) {
    const emails = unique(indices.map(i => emailKey(records[i].email)).filter(Boolean));
    const names = unique(indices.map(i => nameKey(records[i].name)).filter(Boolean));
    if (emails.length > 1 || names.length > 1) {
      if (unique(indices.map(root)).length > 1) for (const i of indices) warnings[i].add('Shared phone with different contact details; records kept separate for staff review.');
      continue;
    }
    for (const i of indices.slice(1)) join(indices[0], i, 'exact phone');
  }
  const groups = new Map<number, number[]>();
  records.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));
  const customers: RelationshipCustomer[] = [];
  const contactIds = new Map<string, string>();
  for (const indices of groups.values()) {
    const group = indices.map(i => records[i]).sort((a, b) => Number(Boolean(b.mergePrimary)) - Number(Boolean(a.mergePrimary)) || b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key));
    const keys = group.map(r => r.key).sort();
    const id = `customer:${keys[0]}`;
    for (const key of keys) contactIds.set(key, id);
    const matched = unique(indices.flatMap(i => [...reasons[i]]));
    const review = unique(indices.flatMap(i => [...warnings[i]]));
    const matchingNote = [matched.length ? `Matched by ${matched.join(' and ')}.` : 'Separate record; no confirmed contact match.', ...review,
      !matched.length && !review.length ? 'Names and anonymous browsing are not used to combine customers.' : ''].filter(Boolean).join(' ');
    customers.push({ id, name: group.find(r => r.name)?.name || 'Customer name unavailable',
      email: group.find(r => emailKey(r.email))?.email || null, phone: group.find(r => phoneKey(r.phone))?.phone || null,
      matchingNote, vehicleIds: [], recordKeys: keys, lastActivityAt: null, counts: emptyCounts(), activities: [] });
  }
  return { customers, contactIds };
}

/** One deterministic history used by both production and the local staff preview. Never mutates its inputs. */
export function buildDealerRelationships(input: DealerRelationshipSources): DealerRelationships {
  const generatedAt = stamp(input.generatedAt ?? new Date().toISOString());
  // Each persisted record appears once even if a join or repeated legacy event yields duplicates.
  const enquiries = [...new Map(input.enquiries.map(e => [e.id, e])).values()];
  const enquiryById = new Map(enquiries.map(e => [e.id, e]));
  const mainEnquiryId = (id: string) => {
    const seen = new Set<string>();
    let current = enquiryById.get(id);
    while (current?.mergedIntoId) {
      if (seen.has(current.id)) return id;
      seen.add(current.id);
      const parent = enquiryById.get(current.mergedIntoId);
      if (!parent) return id;
      current = parent;
    }
    return current?.id ?? id;
  };
  const mainEnquiries = new Set(enquiries.filter(e => mainEnquiryId(e.id) !== e.id).map(e => mainEnquiryId(e.id)));
  const reservations = [...new Map(input.reservations.map(r => [r.id, r])).values()];
  const sales = [...new Map(input.sales.map(s => [s.id, s])).values()];
  const records: ContactRecord[] = [
    ...enquiries.map(e => ({ key: `enquiry:${e.id}`, type: 'enquiry' as const, id: e.id, name: clean(e.customerName), email: clean(e.email), phone: clean(e.phone), updatedAt: stamp(e.updatedAt, e.createdAt), links: [],
      ...(mainEnquiryId(e.id) !== e.id ? { mergeLink: `enquiry:${mainEnquiryId(e.id)}` } : {}), mergePrimary: mainEnquiries.has(e.id) })),
    ...reservations.map(r => ({ key: `reservation:${r.id}`, type: 'reservation' as const, id: r.id, name: clean(r.customerName), email: clean(r.email), phone: clean(r.phone), updatedAt: stamp(r.updatedAt, r.createdAt), links: [r.sourceEnquiryId ? `enquiry:${r.sourceEnquiryId}` : '', r.saleId ? `sale:${r.saleId}` : ''].filter(Boolean) })),
    ...sales.map(s => ({ key: `sale:${s.id}`, type: 'sale' as const, id: s.id, name: clean(s.draft.customer), email: clean(s.draft.email), phone: clean(s.draft.phone), updatedAt: stamp(s.updatedAt, s.createdAt), links: [s.draft.sourceEnquiryId ? `enquiry:${s.draft.sourceEnquiryId}` : '', s.draft.sourceReservationId ? `reservation:${s.draft.sourceReservationId}` : ''].filter(Boolean) })),
  ].sort((a, b) => a.key.localeCompare(b.key));
  const { customers, contactIds } = customersFor(records);
  const vehicles = new Map<string, RelationshipVehicle>();
  for (const source of input.vehicles) vehicles.set(source.id, {
    id: source.id, title: clean(source.title) || 'Vehicle details unavailable', registration: clean(source.registration) || null,
    pricePence: money(source.pricePence), imageUrl: clean(source.imageUrl) || null, status: clean(source.status) || 'unconfirmed',
    lastActivityAt: null, customerIds: [], counts: emptyCounts(), activities: [],
  });
  const snapshotVehicle = (source: VehicleSnapshot, recordKey: string): string | null => {
    let id = clean(source.vehicleId);
    if (!id && source.vehicleUrl) {
      try {
        const candidate = decodeURIComponent(source.vehicleUrl.match(/^(?:https?:\/\/[^/]+)?\/vehicle\/([^/?#]+)(?:[?#].*)?$/)?.[1] ?? '');
        if (vehicles.has(candidate)) id = candidate;
      } catch { /* Keep the stored snapshot when the old URL is invalid. */ }
    }
    const registration = clean(source.vehicleRegistration);
    const title = clean(source.vehicleTitle);
    if (!id && !registration && !title) return null;
    if (!id) {
      const plate = registration.toUpperCase().replace(/[\s-]/g, '');
      const samePlate = [...vehicles.values()].filter(v => v.registration?.toUpperCase().replace(/[\s-]/g, '') === plate);
      id = isUKNumberPlate(registration) && samePlate.length <= 1
        ? samePlate.length === 1 ? samePlate[0].id : `snapshot:registration:${plate}` : `snapshot:${recordKey}`;
    }
    if (!vehicles.has(id)) vehicles.set(id, { id, title: title || registration || 'Vehicle details unavailable', registration: registration || null,
      pricePence: money(source.vehiclePricePence) ?? (typeof source.vehiclePrice === 'number' && Number.isFinite(source.vehiclePrice) ? money(Math.round(source.vehiclePrice * 100)) : null),
      imageUrl: null, status: 'historical', lastActivityAt: null, customerIds: [], counts: emptyCounts(), activities: [] });
    return id;
  };
  // Seed identified historic vehicles before resolving detached snapshots by their full registration.
  for (const e of enquiries) if (e.vehicleId) snapshotVehicle(e, `enquiry:${e.id}`);
  for (const r of reservations) if (r.vehicleId) snapshotVehicle({ ...r, vehiclePricePence: r.expectedPricePence }, `reservation:${r.id}`);
  for (const s of sales) if (s.draft.vehicleId) snapshotVehicle({ vehicleId: s.draft.vehicleId, vehicleTitle: s.draft.vehicle, vehicleRegistration: s.draft.registration, vehiclePricePence: pounds(s.draft.price) }, `sale:${s.id}`);
  const activities = new Map<string, RelationshipActivity>();
  const add = (type: RelationshipActivity['recordType'], id: string, reference: string, activity: Omit<RelationshipActivity, 'recordType' | 'recordId' | 'reference' | 'customerId' | 'url'>) => {
    const customerId = contactIds.get(`${type}:${id}`);
    if (!customerId) return;
    const caseId = type === 'enquiry' ? mainEnquiryId(id) : id;
    activities.set(activity.id, { ...activity, recordType: type, recordId: id, reference,
      ...(type === 'enquiry' ? { caseId } : {}), customerId, url: `/portal?section=${type === 'sale' ? 'sales' : type === 'reservation' ? 'reservations' : 'enquiries'}&${type}Id=${encodeURIComponent(caseId)}` });
  };
  const enquiryVehicleIds = new Map<string, string | null>();
  for (const e of enquiries) {
    const key = `enquiry:${e.id}`, vehicleId = snapshotVehicle(e, key), reference = clean(e.reference) || `ENQ-${e.id}`;
    enquiryVehicleIds.set(e.id, vehicleId);
    const merged = mainEnquiryId(e.id) !== e.id;
    add('enquiry', e.id, reference, { id: `${key}:received`, kind: 'enquiry', title: `${human(e.type || 'general')} enquiry${merged ? ' · Merged original' : ''}`, description: clean(e.message), status: merged ? 'merged' : clean(e.status) || 'new', occurredAt: stamp(e.createdAt), vehicleId, amountPence: null });
    if (e.appointmentAt) add('enquiry', e.id, reference, { id: `${key}:appointment`, kind: 'appointment', title: 'Test drive appointment',
      description: `Scheduled for ${stamp(e.appointmentAt)}${e.attendance ? ` · ${human(e.attendance)}` : ''}`, status: e.appointmentCancelledAt ? 'cancelled' : clean(e.appointmentStatus) || 'confirmed', occurredAt: stamp(e.appointmentCancelledAt ?? e.updatedAt, e.createdAt), vehicleId, amountPence: null });
    if (e.followUpAt || e.followUpNote || e.followUpCompletedAt) add('enquiry', e.id, reference, { id: `${key}:follow-up`, kind: 'follow_up', title: 'Customer follow-up',
      description: [clean(e.followUpNote), e.followUpAt ? `Due ${stamp(e.followUpAt)}` : ''].filter(Boolean).join(' · '), status: e.followUpCompletedAt ? 'completed' : 'scheduled', occurredAt: stamp(e.followUpCompletedAt ?? e.updatedAt, e.createdAt), vehicleId, amountPence: null });
    if (clean(e.staffNote) || clean(e.callOutcome)) add('enquiry', e.id, reference, { id: `${key}:note`, kind: 'note', title: 'Staff note', description: [clean(e.staffNote), e.callOutcome ? `Call outcome: ${human(e.callOutcome)}` : ''].filter(Boolean).join(' · '), status: clean(e.status) || 'new', occurredAt: stamp(e.updatedAt, e.createdAt), vehicleId, amountPence: null });
  }
  for (const event of input.enquiryEvents ?? []) {
    // Unidentified call / WhatsApp taps never create customers or connect different customer records.
    const e = event.enquiryId ? enquiryById.get(event.enquiryId) : undefined;
    if (!e || event.kind === 'enquiry_received') continue;
    const vehicleId = snapshotVehicle(event, `enquiry:${e.id}:event:${event.id}`) ?? enquiryVehicleIds.get(e.id) ?? null;
    const appointment = event.kind.startsWith('viewing_');
    const note = event.kind === 'conversation_logged' || event.kind === 'records_merged' ? clean(event.note) : '';
    const discussion = note ? [clean(event.staffName), note].filter(Boolean).join(': ') : '';
    add('enquiry', e.id, clean(e.reference) || `ENQ-${e.id}`, { id: `enquiry-event:${event.id}`, kind: appointment ? 'appointment' : 'note',
      title: human(event.kind), description: [clean(event.summary), discussion].filter(Boolean).join('\n\n'), status: event.kind.endsWith('cancelled') ? 'cancelled' : clean(e.status) || 'recorded', occurredAt: stamp(event.occurredAt), vehicleId, amountPence: null });
  }
  for (const chat of input.chats ?? []) {
    const enquiry = chat.enquiryId ? enquiryById.get(chat.enquiryId) : undefined;
    if (!enquiry) continue;
    const vehicleId = snapshotVehicle(chat, `chat:${chat.id}`) ?? enquiryVehicleIds.get(enquiry.id) ?? null;
    const id = `chat:${chat.id}`;
    add('enquiry', enquiry.id, chat.reference, { id, kind: 'chat', title: 'Website conversation',
      description: chat.messages.map(message => `${message.authorRole === 'customer' ? 'Customer' : clean(message.authorName) || 'Showroom assistant'}: ${clean(message.body)}`).join('\n\n'),
      status: clean(chat.status) || 'recorded', occurredAt: stamp(chat.updatedAt, chat.createdAt), vehicleId, amountPence: null });
    const activity = activities.get(id);
    if (activity) activity.url = `/portal?section=chat&conversationId=${encodeURIComponent(chat.id)}`;
  }
  for (const r of reservations) {
    const key = `reservation:${r.id}`, vehicleId = snapshotVehicle({ ...r, vehiclePricePence: r.expectedPricePence }, key);
    add('reservation', r.id, r.reference, { id: `${key}:created`, kind: 'reservation', title: 'Online reservation',
      description: r.paymentStatus === 'simulated' ? 'Payment simulated; no money received.' : `Payment ${human(r.paymentStatus)}${r.mode === 'test' ? ' · Stripe test mode; no live money received.' : ''}`,
      status: r.status, occurredAt: stamp(r.createdAt), vehicleId, amountPence: money(r.depositPence) });
    if (r.cancelledAt) add('reservation', r.id, r.reference, { id: `${key}:cancelled`, kind: 'reservation', title: 'Reservation cancelled', description: 'Vehicle reservation released.', status: 'cancelled', occurredAt: stamp(r.cancelledAt), vehicleId, amountPence: null });
    // Stripe receipts are also in the sale ledger. Show only an unmatched remainder here.
    const linked = sales.filter(s => s.draft.sourceReservationId === r.id || s.id === r.saleId);
    const ledger = linked.flatMap(s => s.payments).filter(p => /^stripe$/i.test(p.method) && p.status === 'confirmed');
    const received = ledger.filter(p => p.signedAmountPence > 0).reduce((sum, p) => sum + p.signedAmountPence, 0);
    const refunded = -ledger.filter(p => p.signedAmountPence < 0).reduce((sum, p) => sum + p.signedAmountPence, 0);
    if (r.paymentStatus !== 'simulated' && r.amountReceivedPence > received) add('reservation', r.id, r.reference, { id: `${key}:payment`, kind: 'payment', title: r.mode === 'test' ? 'Stripe test payment' : 'Reservation deposit received', description: r.mode === 'test' ? 'Test transaction; no live money received.' : 'Confirmed online payment.', status: r.paymentStatus, occurredAt: stamp(r.updatedAt, r.createdAt), vehicleId, amountPence: money(r.amountReceivedPence - received) });
    if ((r.amountRefundedPence ?? 0) > refunded) add('reservation', r.id, r.reference, { id: `${key}:refund`, kind: 'payment', title: 'Reservation refund', description: r.mode === 'test' ? 'Stripe test refund; no live money returned.' : 'Confirmed online refund.', status: r.paymentStatus, occurredAt: stamp(r.updatedAt, r.createdAt), vehicleId, amountPence: money(-((r.amountRefundedPence ?? 0) - refunded)) });
  }
  const reservationById = new Map(reservations.map(r => [r.id, r]));
  for (const event of input.reservationEvents ?? []) {
    const r = reservationById.get(event.reservationId);
    if (!r) continue;
    add('reservation', r.id, r.reference, { id: `reservation-event:${event.id}`, kind: 'note', title: human(event.type), description: clean(event.description), status: r.status,
      occurredAt: stamp(event.occurredAt), vehicleId: snapshotVehicle(r, `reservation:${r.id}`), amountPence: null });
  }
  for (const s of sales) {
    const key = `sale:${s.id}`, draft = s.draft;
    const vehicleId = snapshotVehicle({ vehicleId: draft.vehicleId, vehicleTitle: draft.vehicle, vehicleRegistration: draft.registration, vehiclePricePence: pounds(draft.price) }, key);
    const status = s.lifecycle?.status || 'draft';
    if (vehicleId && (status === 'sold' || status === 'reserved' && vehicles.get(vehicleId)!.status !== 'sold')) vehicles.get(vehicleId)!.status = status;
    add('sale', s.id, s.reference, { id: `${key}:created`, kind: 'sale', title: 'Sale file', description: `${clean(draft.vehicle) || 'Vehicle sale'}${clean(draft.notes) ? ` · ${clean(draft.notes)}` : ''}`, status, occurredAt: stamp(s.createdAt), vehicleId, amountPence: pounds(draft.price) });
    if (draft.appointment && !enquiryById.get(draft.sourceEnquiryId ?? '')?.appointmentAt) add('sale', s.id, s.reference, { id: `${key}:appointment`, kind: 'appointment', title: 'Sale appointment', description: `Scheduled for ${stamp(draft.appointment.at)}`, status: draft.appointment.status, occurredAt: stamp(s.updatedAt, s.createdAt), vehicleId, amountPence: null });
    for (const p of s.payments) add('sale', s.id, s.reference, { id: `${key}:payment:${p.id}`, kind: 'payment', title: human(p.kind), description: [clean(p.method), clean(p.reference), clean(p.reason)].filter(Boolean).join(' · '), status: p.status, occurredAt: stamp(p.recordedAt, p.date), vehicleId, amountPence: money(p.signedAmountPence) ?? money(p.amountPence) });
    for (const d of s.documents) {
      const snapshot = d.snapshot?.draft;
      const sameSnapshot = snapshot && !snapshot.vehicleId && clean(snapshot.vehicle) === clean(draft.vehicle) && clean(snapshot.registration) === clean(draft.registration);
      const documentVehicle = sameSnapshot ? vehicleId : snapshot ? snapshotVehicle({ vehicleId: snapshot.vehicleId, vehicleTitle: snapshot.vehicle, vehicleRegistration: snapshot.registration, vehiclePricePence: pounds(snapshot.price) }, `${key}:document:${d.id}`) : null;
      add('sale', s.id, s.reference, { id: `${key}:document:${d.id}`, kind: 'document', title: clean(d.title) || human(d.type), description: d.number, status: 'issued', occurredAt: stamp(d.issuedAt), vehicleId: documentVehicle ?? vehicleId, amountPence: money(d.paymentAmountPence) });
    }
    for (const event of s.events) {
      // Ledger entries above already represent these events, with their actual amounts and document numbers.
      if (['sale-created', 'payment-recorded', 'document-issued'].includes(event.type)) continue;
      add('sale', s.id, s.reference, { id: `${key}:event:${event.id}`, kind: 'note', title: human(event.type), description: clean(event.description), status,
        occurredAt: stamp(event.occurredAt), vehicleId, amountPence: null });
    }
  }
  const customerById = new Map(customers.map(c => [c.id, c]));
  for (const activity of activities.values()) {
    customerById.get(activity.customerId)!.activities.push(activity);
    if (activity.vehicleId) vehicles.get(activity.vehicleId)?.activities.push(activity);
  }
  for (const customer of customers) {
    customer.activities.sort(chronological);
    customer.vehicleIds = unique(customer.activities.map(a => a.vehicleId).filter((id): id is string => !!id)).sort();
    customer.counts = counts(customer.activities); customer.lastActivityAt = customer.activities[0]?.occurredAt || null;
  }
  for (const vehicle of vehicles.values()) {
    vehicle.activities.sort(chronological); vehicle.customerIds = unique(vehicle.activities.map(a => a.customerId)).sort();
    vehicle.counts = counts(vehicle.activities); vehicle.lastActivityAt = vehicle.activities[0]?.occurredAt || null;
  }
  const recent = (a: { lastActivityAt: string | null; id: string }, b: { lastActivityAt: string | null; id: string }) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '') || a.id.localeCompare(b.id);
  return { generatedAt, vehicles: [...vehicles.values()].sort(recent), customers: customers.sort(recent) };
}
