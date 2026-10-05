import type { Enquiry } from '@workspace/api-client-react';

export function isOutstandingCallback(entry: Enquiry) {
  return Boolean((entry.followUpAt && !entry.followUpCompletedAt) || (entry.source === 'website_callback' && entry.status !== 'closed' && !entry.followUpCompletedAt && entry.callOutcome === 'callback_requested'));
}
export function callbackTiming(entry: Enquiry, now = Date.now()): 'overdue' | 'upcoming' | 'unscheduled' {
  const at = entry.followUpAt && !entry.followUpCompletedAt ? Date.parse(entry.followUpAt) : NaN;
  return Number.isFinite(at) ? at <= now ? 'overdue' : 'upcoming' : 'unscheduled';
}
export function sortCallbacks(a: Enquiry, b: Enquiry) {
  const aAt = a.followUpAt && !a.followUpCompletedAt ? Date.parse(a.followUpAt) : NaN;
  const bAt = b.followUpAt && !b.followUpCompletedAt ? Date.parse(b.followUpAt) : NaN;
  return (Number.isFinite(aAt) ? aAt : -Infinity) - (Number.isFinite(bAt) ? bAt : -Infinity) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id);
}
