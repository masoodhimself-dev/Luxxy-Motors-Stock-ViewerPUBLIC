import { enquiryGroup, enquiryRootRecords } from './enquiry-groups';
import { enquiryPresentation, enquiryPurpose, enquirySourceLabel } from './enquiry-presentation';
import type { InboxEnquiry } from './enquiry-reply-attention';
import { canonicalCustomerPhone } from '@workspace/vehicle-meta';

export type InboxFilter = 'needs-you' | 'all' | 'test-drives' | 'done' | 'archive';
export type InboxFolder = 'enquiries' | 'ai' | 'archive';
export type InboxStateKey = 'needs-you' | 'waiting' | 'booked' | 'done';
export type InboxState = {
  key: InboxStateKey;
  label: 'Needs you' | 'Waiting' | 'Booked' | 'Done' | 'Archived';
  tone: 'warning' | 'info' | 'success' | 'muted';
  /** The recorded task or outcome behind the simplified status. */
  detail: string;
  nextAction: string;
  purpose: string;
  source: string;
  priority: number;
};

const states = {
  'needs-you': { label: 'Needs you', tone: 'warning' },
  waiting: { label: 'Waiting', tone: 'info' },
  booked: { label: 'Booked', tone: 'success' },
  done: { label: 'Done', tone: 'muted' },
} as const;

const timestamp = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** Simplifies existing recorded work. It never infers that AI is handling a case. */
export function inboxState(entry: InboxEnquiry, now = Date.now()): InboxState {
  if (entry.archivedAt) return { key:'done', label:'Archived', tone:'muted', detail:'Archived', nextAction:'Restore enquiry', purpose:enquiryPurpose(entry), source:enquirySourceLabel(entry), priority:99 };
  const presentation = enquiryPresentation(entry, now);
  const appointment = timestamp(entry.appointmentAt);
  const followUp = !entry.followUpCompletedAt ? timestamp(entry.followUpAt) : null;
  const activeVisit = appointment !== null && !entry.appointmentCancelledAt
    && entry.attendance !== 'completed' && entry.attendance !== 'no_show';
  let key: InboxStateKey;

  // Incoming replies and outstanding work stay visible even on a closed case.
  if ((entry.pendingEmailReplies ?? 0) > 0 || (entry.emailRepliesToReview ?? 0) > 0
    || (['respond', 'update', 'conversation'].includes(presentation.action) && presentation.state !== 'Contacted')
    || (presentation.action === 'follow_up' && (followUp === null || presentation.state !== 'Follow-up scheduled'))
    || (activeVisit && entry.appointmentStatus === 'pending')) {
    key = 'needs-you';
  } else if (activeVisit && appointment > now) {
    key = 'booked';
  } else if (followUp !== null || presentation.state === 'Contacted' || presentation.state === 'Replied') {
    key = 'waiting';
  } else {
    key = 'done';
  }

  return {
    key, ...states[key], detail: (entry.emailRepliesToReview ?? 0) > 0 ? 'Email needs review' : presentation.state,
    nextAction: (entry.emailRepliesToReview ?? 0) > 0 ? 'Review incoming email' : presentation.nextAction, purpose: presentation.purpose,
    source: presentation.source, priority: presentation.priority,
  };
}

/** Only recorded provider automation belongs here; a Cazoo source or a manual AI draft is not enough. */
export function isAiEnquiry(entry: InboxEnquiry): boolean {
  return Boolean(entry.aiProvider && entry.aiDraftStatus && ['pending','generating','ready','failed'].includes(entry.aiDraftStatus));
}

/** Keep AI-assisted cases in the main queue and make them available as a focused view. */
export function inboxFolderEntries(entries: readonly InboxEnquiry[], folder: InboxFolder): InboxEnquiry[] {
  return entries.filter(entry => {
    const members = enquiryGroup(entry, entries) as InboxEnquiry[];
    const active = members.filter(member => !member.archivedAt);
    if (folder === 'archive') return active.length === 0;
    if (!active.length) return false;
    return folder === 'enquiries' || active.some(isAiEnquiry);
  });
}

/** A merged original can still carry a new reply or appointment of its own. */
export function inboxCaseState(entry: InboxEnquiry, all: readonly InboxEnquiry[], now = Date.now()): InboxState {
  const members = enquiryGroup(entry, all) as InboxEnquiry[];
  const rank: Record<InboxStateKey, number> = { 'needs-you': 0, booked: 1, waiting: 2, done: 3 };
  return members.map(member => inboxState(member, now))
    .sort((left, right) => rank[left.key] - rank[right.key] || left.priority - right.priority)[0]
    ?? inboxState(entry, now);
}

/** Latest recorded activity, excluding future appointments and follow-up deadlines. */
export function inboxLastActivity(entry: InboxEnquiry): string | null {
  const values = [entry.createdAt, entry.updatedAt, entry.mergedAt, entry.appointmentCancelledAt,
    entry.followUpCompletedAt, entry.customerNotificationSentAt, entry.dealerNotificationSentAt,
    entry.reminderSentAt, ...(entry.events ?? []).map(event => event.occurredAt)];
  let latest: { at: number; value: string } | null = null;
  for (const value of values) {
    const at = timestamp(value);
    if (at !== null && value && (!latest || at > latest.at)) latest = { at, value };
  }
  return latest?.value ?? null;
}

/** Compact elapsed times for list rows; invalid dates never become misleading ages. */
export function inboxRelativeTime(date: string | Date | null | undefined, now = Date.now()): string {
  const at = date instanceof Date ? date.getTime() : timestamp(date);
  if (at === null || !Number.isFinite(at) || !Number.isFinite(now)) return '—';
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const compact = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('en-GB').replace(/[^\p{L}\p{N}]/gu, '');

/** Names, references, cars and customer words can be searched in any order. */
export function inboxMatches(entry: InboxEnquiry, search: string): boolean {
  const terms = search.trim().split(/\s+/).map(compact).filter(Boolean);
  if (!terms.length) return true;
  const phone = canonicalCustomerPhone(entry.phone);
  const text = compact([entry.customerName, entry.reference, entry.email, entry.phone,
    phone, phone.startsWith('+44') ? `0${phone.slice(3)}` : null,
    entry.vehicleTitle, entry.vehicleRegistration, entry.message, entry.latestReplyText,
    entry.partExchangeRegistration, entry.staffNote, entry.followUpNote, entry.assignedToName,
    enquirySourceLabel(entry), enquiryPurpose(entry)].filter(Boolean).join(' '));
  return terms.every(term => text.includes(term));
}

/** One row per explicit combined case. Unrelated shared contact details are never merged. */
export function inboxFilter(entries: readonly InboxEnquiry[], filter: InboxFilter, search = '', now = Date.now()): InboxEnquiry[] {
  const roots = enquiryRootRecords(entries) as InboxEnquiry[];
  return roots.map((entry, index) => {
    const members = enquiryGroup(entry, entries) as InboxEnquiry[];
    const state = inboxCaseState(entry, entries, now);
    const latest = Math.max(...members.map(member => timestamp(inboxLastActivity(member)) ?? 0));
    return { entry, members, state, latest, index };
  }).filter(({ members, state }) => {
    if (filter === 'archive' ? members.some(member=>!member.archivedAt) : members.every(member=>Boolean(member.archivedAt))) return false;
    if (search.trim() && !search.trim().split(/\s+/).every(term => members.some(member => inboxMatches(member, term)))) return false;
    if (filter === 'needs-you') return state.key === 'needs-you';
    if (filter === 'done') return state.key === 'done';
    if (filter === 'test-drives') return members.some(member => member.type === 'viewing' || timestamp(member.appointmentAt) !== null);
    return true;
  }).sort((left, right) => {
    // Keep attention together, then use actual activity rather than future booking dates.
    const attention = Number(right.state.key === 'needs-you') - Number(left.state.key === 'needs-you');
    return attention || (left.state.key === 'needs-you' ? left.state.priority - right.state.priority : 0)
      || right.latest - left.latest || left.index - right.index;
  }).map(({ entry }) => entry);
}
