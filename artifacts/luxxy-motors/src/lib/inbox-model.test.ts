import { describe, expect, it } from 'vitest';
import type { Enquiry } from '@workspace/api-client-react';
import type { InboxEnquiry } from './enquiry-reply-attention';
import { inboxCaseState, inboxFilter, inboxFolderEntries, inboxLastActivity, inboxMatches, inboxRelativeTime, inboxState, isAiEnquiry } from './inbox-model';

const now = Date.parse('2026-11-02T12:00:00Z');
const record = (id = 'enquiry', changes: Partial<InboxEnquiry> = {}): InboxEnquiry => ({
  id, reference: `ENQ-${id}`, dealerId: 'dealer', type: 'general', source: 'website', status: 'new',
  customerName: 'Éllie Smith', vehicleId: 'audi', vehicleTitle: 'Audi A5', vehicleRegistration: 'MW62 VLP',
  email: 'ellie@example.com', phone: '07700 900123', message: 'Would you accept a part exchange?',
  events: [], createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', ...changes,
} as Enquiry);

describe('AI and archived Inbox folders',()=>{
  it('uses actual automated provider metadata, never source alone or an ordinary AI draft',()=>{
    const connected=record('automated',{source:'cazoo',aiProvider:'cazoo',aiDraftStatus:'ready'});
    const sourceOnly=record('source-only',{source:'cazoo'});
    const manual=record('manual',{source:'website'});
    const all=[connected,sourceOnly,manual];
    expect(isAiEnquiry(connected)).toBe(true);
    expect(isAiEnquiry(sourceOnly)).toBe(false);
    expect(inboxFolderEntries(all,'ai')).toEqual([connected]);
    expect(inboxFolderEntries(all,'enquiries')).toEqual([sourceOnly,manual]);
  });
  it('keeps archived records searchable in Archive and out of every active filter',()=>{
    const archived=record('archived',{archivedAt:'2026-11-01T12:00:00Z',archiveDeleteAt:'2026-12-01T12:00:00Z',pendingEmailReplies:1,appointmentAt:'2026-11-03T10:00:00Z'});
    const active=record('active');
    for(const filter of ['needs-you','all','done','test-drives'] as const) expect(inboxFilter([archived,active],filter,'',now)).not.toContain(archived);
    expect(inboxFilter([archived,active],'archive','ENQ-archived',now)).toEqual([archived]);
    expect(inboxFolderEntries([archived,active],'archive')).toEqual([archived]);
    expect(inboxState(archived,now).label).toBe('Archived');
  });
  it('keeps explicitly linked automatic and manual records in one case and folder',()=>{
    const parent=record('parent');
    const child=record('child',{mergedIntoId:parent.id,source:'cazoo',aiProvider:'cazoo',aiDraftStatus:'failed'});
    expect(inboxFolderEntries([parent,child],'ai')).toEqual([parent,child]);
    expect(inboxFilter(inboxFolderEntries([parent,child],'ai'),'all','',now)).toEqual([parent]);
    expect(inboxFolderEntries([parent,child],'enquiries')).toEqual([]);
  });
});

describe('simplified Inbox status', () => {
  it('shows new requests and received replies as needing a person, never AI handling', () => {
    expect(inboxState(record(), now)).toMatchObject({ key: 'needs-you', label: 'Needs you', source: 'Website' });
    expect(inboxState(record('closed', { status: 'closed', pendingEmailReplies: 1, staffEmailSent: true }), now))
      .toMatchObject({ key: 'needs-you', detail: 'Customer replied' });
    expect(inboxState(record('review', { status: 'closed', emailRepliesToReview: 1 }), now))
      .toMatchObject({ key: 'needs-you', detail: 'Email needs review', nextAction: 'Review incoming email' });
    expect(inboxState(record('cazoo', { source: 'cazoo' }), now).source).toBe('Cazoo');
    expect(inboxState(record('phone', { source: 'phone_ad_hoc' }), now).source).toBe('Phone');
  });

  it('distinguishes waiting for a customer from a finished case', () => {
    expect(inboxState(record('reply', { staffEmailSent: true }), now)).toMatchObject({ key: 'waiting', label: 'Waiting' });
    expect(inboxState(record('contacted', { status: 'contacted' }), now).key).toBe('waiting');
    for (const changes of [{ status: 'closed' as const }, { callOutcome: 'not_interested' },
      { callOutcome: 'information_given' }, { attendance: 'completed' as const },
      { appointmentCancelledAt: '2026-11-01T11:00:00Z' }]) {
      expect(inboxState(record('done', changes), now)).toMatchObject({ key: 'done', label: 'Done' });
    }
  });

  it('keeps future confirmed bookings active, including a closed case with a retained booking', () => {
    const booking = record('booking', { type: 'viewing', status: 'closed',
      appointmentAt: '2026-11-03T10:00:00Z', appointmentStatus: 'confirmed' });
    expect(inboxState(booking, now)).toMatchObject({ key: 'booked', label: 'Booked', tone: 'success' });
    expect(inboxFilter([booking], 'done', '', now)).toEqual([]);
    expect(inboxState({ ...booking, appointmentStatus: 'pending' }, now).key).toBe('needs-you');
    expect(inboxState({ ...booking, pendingEmailReplies: 1 }, now).key).toBe('needs-you');
  });

  it('requires visit outcomes instead of guessing attendance, while future follow-ups wait', () => {
    const booking = record('booking', { appointmentAt: '2026-11-02T10:00:00Z', appointmentStatus: 'confirmed' });
    expect(inboxState(booking, now)).toMatchObject({ key: 'needs-you', detail: 'Check visit outcome' });
    expect(inboxState({ ...booking, attendance: 'arrived' }, now).key).toBe('needs-you');
    expect(inboxState({ ...booking, attendance: 'no_show' }, now).key).toBe('needs-you');
    expect(inboxState(record('followup', { followUpAt: '2026-11-03T10:00:00Z' }), now).key).toBe('waiting');
    expect(inboxState(record('due', { status: 'closed', followUpAt: '2026-11-02T10:00:00Z' }), now).key).toBe('needs-you');
    expect(inboxState(record('later-today', { followUpAt: '2026-11-02T16:00:00Z' }), now).key).toBe('needs-you');
  });

  it('does not suppress new requests because a date field is invalid', () => {
    expect(inboxState(record('invalid', { appointmentAt: 'broken', followUpAt: 'broken' }), now).key).toBe('needs-you');
  });
});

describe('Inbox activity and search', () => {
  it('uses actual latest activity and excludes future appointment and follow-up dates', () => {
    const entry = record('active', { appointmentAt: '2026-12-01T10:00:00Z', followUpAt: '2026-12-02T10:00:00Z',
      updatedAt: '2026-11-01T12:00:00Z', events: [{ id: 'reply', occurredAt: '2026-11-02T11:55:00Z' }] as Enquiry['events'] });
    expect(inboxLastActivity(entry)).toBe('2026-11-02T11:55:00Z');
    expect(inboxLastActivity(record('invalid', { createdAt: 'broken', updatedAt: '' }))).toBeNull();
  });

  it('formats elapsed time at minute, hour and day boundaries and handles invalid dates', () => {
    expect(inboxRelativeTime('2026-11-02T11:59:50Z', now)).toBe('Just now');
    expect(inboxRelativeTime('2026-11-02T11:55:00Z', now)).toBe('5m ago');
    expect(inboxRelativeTime(new Date('2026-11-02T10:00:00Z'), now)).toBe('2h ago');
    expect(inboxRelativeTime('2026-11-01T12:00:00Z', now)).toBe('1d ago');
    expect(inboxRelativeTime('2026-10-19T12:00:00Z', now)).toBe('2w ago');
    expect(inboxRelativeTime('2026-11-03T12:00:00Z', now)).toBe('Just now');
    expect(inboxRelativeTime('broken', now)).toBe('—');
    expect(inboxRelativeTime(null, now)).toBe('—');
  });

  it('matches names, spaced number plates, phone numbers and request words in any order', () => {
    const entry = record();
    for (const query of ['Ellie Audi', 'MW62VLP', '07700900123', 'exchange Audi', ' ellie@example.com ', '']) {
      expect(inboxMatches(entry, query), query).toBe(true);
    }
    expect(inboxMatches(entry, 'BMW')).toBe(false);
    expect(inboxMatches({ ...entry, latestReplyText: 'Can I visit on Friday?' }, 'Friday Audi')).toBe(true);
    expect(inboxMatches(entry, '+44 7700 900123')).toBe(true);
    expect(inboxMatches({ ...entry, phone: '+44 7700 900123' }, 'Ellie 07700 900123')).toBe(true);
  });
});

describe('Inbox filters and explicit merged cases', () => {
  it('retains website, Cazoo and phone enquiries while Test drives includes booking history', () => {
    const website = record('website');
    const cazoo = record('cazoo', { source: 'cazoo' });
    const phone = record('phone', { source: 'phone' });
    const cancelled = record('cancelled', { type: 'viewing', appointmentAt: '2026-10-30T10:00:00Z', appointmentCancelledAt: '2026-10-29T10:00:00Z' });
    const future = record('future', { appointmentAt: '2026-11-03T10:00:00Z', appointmentStatus: 'confirmed' });
    const all = [website, cazoo, phone, cancelled, future];
    expect(inboxFilter(all, 'needs-you', '', now)).toEqual([website, cazoo, phone]);
    expect(inboxFilter(all, 'test-drives', '', now)).toEqual([cancelled, future]);
    expect(inboxFilter(all, 'done', '', now)).toEqual([cancelled]);
    expect(inboxFilter(all, 'all', 'Cazoo', now)).toEqual([cazoo]);
    expect(all).toEqual([website, cazoo, phone, cancelled, future]);
  });

  it('surfaces a reply on a merged original and searches that original without duplicate rows', () => {
    const main = record('main', { status: 'closed' });
    const child = record('child', { mergedIntoId: main.id, source: 'cazoo', vehicleTitle: 'Toyota Yaris',
      pendingEmailReplies: 1, updatedAt: '2026-11-02T11:50:00Z' });
    const unrelated = record('unrelated', { status: 'closed' });
    const all = [main, child, unrelated];
    expect(inboxCaseState(main, all, now)).toMatchObject({ key: 'needs-you', source: 'Cazoo' });
    expect(inboxFilter(all, 'needs-you', 'Toyota', now)).toEqual([main]);
    expect(inboxFilter(all, 'needs-you', 'ENQ-main Toyota', now)).toEqual([main]);
    expect(inboxFilter(all, 'done', '', now)).toEqual([unrelated]);
    expect(inboxFilter(all, 'all', '', now)).toEqual([main, unrelated]);
    expect(main.status).toBe('closed');
  });

  it('does not merge shared contacts and keeps broken merge links visible', () => {
    const first = record('first');
    const second = record('second');
    const broken = record('broken', { mergedIntoId: 'missing' });
    expect(inboxFilter([first, second, broken], 'all', '', now)).toEqual([first, second, broken]);
  });

  it('orders attention by existing task priority, then latest actual activity', () => {
    const replied = record('customer-reply', { pendingEmailReplies: 1 });
    const overdue = record('overdue', { followUpAt: '2026-11-01T12:00:00Z' });
    const old = record('old');
    const recent = record('recent', { updatedAt: '2026-11-02T11:00:00Z' });
    const waiting = record('waiting', { status: 'contacted', updatedAt: '2026-11-02T11:59:00Z' });
    expect(inboxFilter([old, waiting, recent, overdue, replied], 'all', '', now))
      .toEqual([replied, overdue, recent, old, waiting]);
  });
});
