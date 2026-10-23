import type { InboxEnquiry } from './enquiry-reply-attention';
import type { Enquiry } from '@workspace/api-client-react';

export type EnquiryAction = 'follow_up' | 'appointment' | 'conversation' | 'respond' | 'update' | 'none';
export type EnquiryTone = 'danger' | 'warning' | 'info' | 'success' | 'muted';
export type EnquiryPresentation = {
  purpose: string;
  source: string;
  state: string;
  tone: EnquiryTone;
  /** Smaller values come first. This is a display order, never a change to enquiry status. */
  priority: number;
  nextAction: string;
  reason: string;
  action: EnquiryAction;
  dueAt: string | null;
};

function timestamp(value: string | null | undefined): number | null {
  const result = value ? Date.parse(value) : NaN;
  return Number.isFinite(result) ? result : null;
}

function ukDate(value: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

/** Show the visitor's own words first for our known chat transcript format.
 * The full transcript remains unchanged in conversation history. Unknown formats
 * always fall back to the complete recorded message.
 */
export function enquiryRequestText(entry: Enquiry): string {
  const text = entry.message?.trim() || '';
  if (entry.source !== 'chat') return text;
  const blocks = text.split(/\n\s*\n/);
  if (!blocks.length || blocks.some(block => !/^(?:Visitor|Showroom assistant):/.test(block))) return text;
  const visitor = blocks.filter(block => block.startsWith('Visitor:')).map(block => block.slice('Visitor:'.length).trim()).filter(Boolean);
  return visitor.length ? visitor.join('\n\n') : text;
}

export function enquiryPurpose(entry: Enquiry): string {
  if (entry.source === 'sale_review') return 'Review request';
  if (entry.source === 'website_callback') return 'Callback request';
  switch (entry.type) {
    case 'viewing': return 'Test drive';
    case 'part_exchange': return 'Part exchange';
    case 'warranty': return 'Warranty';
    case 'delivery': return 'Delivery';
    default: return entry.vehicleId || entry.vehicleTitle ? 'Vehicle enquiry' : 'General enquiry';
  }
}

export function enquirySourceLabel(entry: Enquiry): string {
  switch (entry.source) {
    case 'sale_review': return 'Post-sale';
    case 'phone': return 'Phone';
    case 'phone_ad_hoc': return 'Phone';
    case 'website_callback': return 'Website callback';
    case 'website': return 'Website';
    case 'email': return 'Email';
    case 'chat': return 'Website chat';
    default: return 'Enquiry';
  }
}

/**
 * Explains existing recorded work, including explicit server reply attention. It does not infer customer intent,
 * appointment attendance or a required response from the original message text.
 * A closed case can still have an explicitly scheduled task: closing does not
 * cancel follow-ups or appointments in the existing API.
 */
export function enquiryPresentation(entry: InboxEnquiry, now = Date.now()): EnquiryPresentation {
  const common = { purpose: enquiryPurpose(entry), source: enquirySourceLabel(entry) };
  const present = (details: Omit<EnquiryPresentation, 'purpose' | 'source'>) => ({ ...common, ...details });
  const followUp = !entry.followUpCompletedAt ? timestamp(entry.followUpAt) : null;
  const appointment = !entry.appointmentCancelledAt ? timestamp(entry.appointmentAt) : null;
  const activeVisit = appointment !== null && entry.attendance !== 'completed' && entry.attendance !== 'no_show';

  if ((entry.pendingEmailReplies ?? 0) > 0) return present({
    state: entry.emailRepliesToReview ? 'Email needs review' : 'Customer replied', tone: entry.emailRepliesToReview ? 'warning' : 'info', priority: -1,
    nextAction: entry.emailRepliesToReview ? 'Review incoming email' : 'Reply to customer',
    reason: entry.emailRepliesToReview ? 'Check the sender before replying. Other scheduled work remains in place.' : 'Read the latest message and reply, or mark it handled. Other scheduled work remains in place.',
    action: 'respond', dueAt: null,
  });
  if (followUp !== null && followUp <= now) return present({
    state: 'Follow-up overdue', tone: 'danger', priority: 0,
    nextAction: 'Complete follow-up', reason: entry.followUpNote?.trim() || 'A scheduled follow-up is still outstanding.',
    action: 'follow_up', dueAt: entry.followUpAt!,
  });
  if (activeVisit && entry.appointmentStatus === 'pending') return present({
    state: 'Needs approval', tone: 'warning', priority: 1,
    nextAction: 'Review test drive', reason: 'The requested appointment has not been confirmed.',
    action: 'appointment', dueAt: entry.appointmentAt!,
  });
  if (activeVisit && entry.attendance === 'arrived') return present({
    state: 'Customer arrived', tone: 'info', priority: 2,
    nextAction: 'Prepare the test drive', reason: 'Arrival is recorded. Complete the visit when it finishes.',
    action: 'update', dueAt: entry.appointmentAt!,
  });
  if (followUp !== null && ukDate(followUp) === ukDate(now)) return present({
    state: 'Follow-up today', tone: 'warning', priority: 3,
    nextAction: 'Review follow-up', reason: entry.followUpNote?.trim() || 'A follow-up is scheduled for later today.',
    action: 'follow_up', dueAt: entry.followUpAt!,
  });
  if (activeVisit && appointment <= now) return present({
    state: 'Check visit outcome', tone: 'warning', priority: 4,
    nextAction: 'Update the visit', reason: 'The appointment time has passed. Check and record what happened.',
    action: 'update', dueAt: entry.appointmentAt!,
  });
  if (entry.status !== 'closed' && entry.source === 'website_callback' && entry.callOutcome === 'callback_requested' && !entry.followUpCompletedAt && followUp === null) return present({
    state: 'Callback requested', tone: 'warning', priority: 3,
    nextAction: 'Arrange the callback', reason: 'The customer requested a call, but no callback time is recorded.',
    action: 'follow_up', dueAt: null,
  });
  if (activeVisit) return present({
    state: ukDate(appointment) === ukDate(now) ? 'Test drive today' : 'Upcoming test drive',
    tone: 'info', priority: ukDate(appointment) === ukDate(now) ? 4 : 7,
    nextAction: 'Review test drive', reason: 'Check the confirmed appointment and car details before the visit.',
    action: 'appointment', dueAt: entry.appointmentAt!,
  });
  if (followUp !== null) return present({
    state: 'Follow-up scheduled', tone: 'info', priority: 7,
    nextAction: 'Review follow-up', reason: entry.followUpNote?.trim() || 'A future follow-up is already scheduled.',
    action: 'follow_up', dueAt: entry.followUpAt!,
  });
  if (entry.status === 'closed' || entry.callOutcome === 'not_interested') return present({
    state: entry.status === 'closed' ? 'Closed' : 'Not interested', tone: 'muted', priority: 10,
    nextAction: 'No further action', reason: entry.status === 'closed' ? 'This enquiry is closed.' : 'The latest recorded outcome is not interested.',
    action: 'none', dueAt: null,
  });
  if (entry.attendance === 'no_show' && !entry.appointmentCancelledAt) return present({
    state: 'Missed visit', tone: 'warning', priority: 5,
    nextAction: 'Review missed visit', reason: 'The customer was marked as not attending. Record any follow-up conversation.',
    action: 'conversation', dueAt: null,
  });
  if (entry.appointmentCancelledAt) return present({
    state: 'Visit cancelled', tone: 'muted', priority: 9,
    nextAction: 'No task scheduled', reason: 'The appointment is cancelled and no follow-up is scheduled.',
    action: 'none', dueAt: null,
  });
  if (entry.attendance === 'completed') return present({
    state: 'Visit completed', tone: 'success', priority: 9,
    nextAction: 'No task scheduled', reason: 'The visit is complete and no follow-up is scheduled.',
    action: 'none', dueAt: null,
  });
  if (entry.staffEmailSent && entry.status === 'new' && !entry.callOutcome) return present({
    state: 'Replied', tone: 'muted', priority: 9, nextAction: 'No task scheduled',
    reason: 'A staff email was submitted. No new customer reply or scheduled task is outstanding.', action: 'none', dueAt: null,
  });
  if (entry.callOutcome === 'information_given' || entry.followUpCompletedAt) return present({
    state: entry.followUpCompletedAt ? 'Follow-up done' : 'Information given', tone: 'success', priority: 9,
    nextAction: 'No task scheduled', reason: 'No appointment or outstanding follow-up is recorded.',
    action: 'none', dueAt: null,
  });
  if (entry.callOutcome === 'no_answer') return present({
    state: 'No answer', tone: 'warning', priority: 5,
    nextAction: 'Plan the next contact', reason: 'The last call was not answered. Choose whether and when to try again.',
    action: 'follow_up', dueAt: null,
  });
  if (entry.status === 'contacted') return present({
    state: 'Contacted', tone: 'muted', priority: 8,
    nextAction: 'Review the conversation', reason: 'Contact is recorded. Check the notes before choosing another step.',
    action: 'conversation', dueAt: null,
  });
  if (!entry.phone && !entry.email) return present({
    state: 'Contact details needed', tone: 'warning', priority: 6,
    nextAction: 'Check contact details', reason: 'No phone number or email address is recorded.',
    action: 'update', dueAt: null,
  });
  return present({
    state: 'New enquiry', tone: 'info', priority: 6,
    nextAction: entry.preferredContact === 'phone' && entry.phone ? 'Call the customer' : entry.preferredContact === 'email' && entry.email ? 'Email the customer' : entry.preferredContact === 'whatsapp' && entry.phone ? 'WhatsApp the customer' : 'Respond to the customer',
    reason: 'Read the enquiry, answer their questions and record the next step.',
    action: 'respond', dueAt: null,
  });
}

/** Does not mutate query results. Task order is stable for equal priorities. */
export function sortEnquiriesByPriority(entries: readonly Enquiry[], now = Date.now()): Enquiry[] {
  return entries.map((entry, index) => ({ entry, index, presentation: enquiryPresentation(entry, now) }))
    .sort((a, b) => a.presentation.priority - b.presentation.priority
      || (timestamp(a.presentation.dueAt) ?? Infinity) - (timestamp(b.presentation.dueAt) ?? Infinity)
      || a.index - b.index)
    .map(item => item.entry);
}
