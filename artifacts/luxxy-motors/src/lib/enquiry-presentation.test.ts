import { describe, expect, it } from 'vitest';
import type { Enquiry } from '@workspace/api-client-react';
import { enquiryRequestText, enquiryPresentation, enquiryPurpose, sortEnquiriesByPriority } from './enquiry-presentation';

const now = Date.parse('2026-10-20T10:00:00Z');
function entry(changes: Partial<Enquiry> = {}): Enquiry {
  return {
    id: 'enquiry', type: 'general', source: 'website', status: 'new', customerName: 'Alex',
    vehicleId: 'car', vehicleTitle: 'Toyota Yaris', phone: '07700900123', email: 'alex@example.com',
    events: [], createdAt: '2026-10-19T09:00:00Z', ...changes,
  } as Enquiry;
}

describe('staff enquiry presentation', () => {
  it('explains the original request without using message guesses', () => {
    expect(enquiryPurpose(entry({ type: 'part_exchange' }))).toBe('Part exchange');
    expect(enquiryPurpose(entry({ type: 'viewing' }))).toBe('Test drive');
    expect(enquiryPurpose(entry({ type: 'warranty' }))).toBe('Warranty');
    expect(enquiryPurpose(entry({ type: 'delivery' }))).toBe('Delivery');
    expect(enquiryPurpose(entry())).toBe('Vehicle enquiry');
    expect(enquiryPurpose(entry({ vehicleId: null, vehicleTitle: null }))).toBe('General enquiry');
    expect(enquiryPurpose(entry({ source: 'website_callback' }))).toBe('Callback request');
    expect(enquiryPresentation(entry({ message: 'URGENT PLEASE CALL' }), now).priority).toBe(6);
  });

  it('puts overdue explicit tasks first, including tasks retained on closed cases', () => {
    const result = enquiryPresentation(entry({ status: 'closed', followUpAt: '2026-10-20T09:00:00Z', followUpNote: 'Check the service book' }), now);
    expect(result).toMatchObject({ state: 'Follow-up overdue', tone: 'danger', priority: 0, action: 'follow_up', reason: 'Check the service book' });
  });

  it('does not turn a completed follow-up into another required reply', () => {
    expect(enquiryPresentation(entry({ followUpAt: '2026-10-19T09:00:00Z', followUpCompletedAt: '2026-10-19T10:00:00Z' }), now)).toMatchObject({ state: 'Follow-up done', action: 'none' });
  });

  it('requires appointment review while approval is pending', () => {
    expect(enquiryPresentation(entry({ type: 'viewing', appointmentAt: '2026-10-21T10:00:00Z', appointmentStatus: 'pending', followUpAt: '2026-10-22T10:00:00Z' }), now)).toMatchObject({ state: 'Needs approval', action: 'appointment', priority: 1 });
  });

  it('does not treat cancelled, completed or missed visits as pending approval', () => {
    const visit = { appointmentAt: '2026-10-19T10:00:00Z', appointmentStatus: 'pending' as const };
    expect(enquiryPresentation(entry({ ...visit, appointmentCancelledAt: '2026-10-19T11:00:00Z' }), now).state).toBe('Visit cancelled');
    expect(enquiryPresentation(entry({ ...visit, attendance: 'completed' }), now).state).toBe('Visit completed');
    expect(enquiryPresentation(entry({ ...visit, attendance: 'no_show' }), now).state).toBe('Missed visit');
  });

  it('shows arrival and a past appointment without guessing a no-show', () => {
    const visit = { appointmentAt: '2026-10-20T09:00:00Z', appointmentStatus: 'confirmed' as const };
    expect(enquiryPresentation(entry({ ...visit, attendance: 'arrived' }), now).state).toBe('Customer arrived');
    expect(enquiryPresentation(entry({ ...visit, attendance: 'scheduled' }), now)).toMatchObject({ state: 'Check visit outcome', action: 'update' });
  });

  it('uses UK calendar days around British Summer Time for upcoming work', () => {
    const lateEvening = Date.parse('2026-10-20T23:15:00Z'); // 00:15 on Wednesday in London
    expect(enquiryPresentation(entry({ followUpAt: '2026-10-21T09:00:00Z' }), lateEvening).state).toBe('Follow-up today');
    expect(enquiryPresentation(entry({ appointmentAt: '2026-10-21T09:00:00Z' }), lateEvening).state).toBe('Test drive today');
  });

  it('distinguishes confirmed future appointments from follow-ups', () => {
    expect(enquiryPresentation(entry({ appointmentAt: '2026-10-21T10:00:00Z', appointmentStatus: 'confirmed' }), now).state).toBe('Upcoming test drive');
    expect(enquiryPresentation(entry({ followUpAt: '2026-10-22T10:00:00Z' }), now).state).toBe('Follow-up scheduled');
  });

  it('retains scheduled follow-ups after a cancelled or completed visit', () => {
    expect(enquiryPresentation(entry({ appointmentCancelledAt: '2026-10-19T11:00:00Z', followUpAt: '2026-10-22T10:00:00Z' }), now).state).toBe('Follow-up scheduled');
    expect(enquiryPresentation(entry({ attendance: 'completed', followUpAt: '2026-10-22T10:00:00Z' }), now).state).toBe('Follow-up scheduled');
    expect(enquiryPresentation(entry({ status: 'closed', followUpAt: '2026-10-22T10:00:00Z' }), now).state).toBe('Follow-up scheduled');
  });

  it('does not require a reply for closed, not interested or information-given cases', () => {
    for (const changes of [{ status: 'closed' as const }, { callOutcome: 'not_interested' }, { callOutcome: 'information_given' }]) {
      expect(enquiryPresentation(entry(changes), now).action).toBe('none');
    }
    expect(enquiryPresentation(entry({ status: 'contacted' }), now).action).toBe('conversation');
  });

  it('identifies website callbacks without a time and an unsuccessful call', () => {
    expect(enquiryPresentation(entry({ source: 'website_callback', callOutcome: 'callback_requested' }), now)).toMatchObject({ state: 'Callback requested', action: 'follow_up' });
    expect(enquiryPresentation(entry({ callOutcome: 'no_answer' }), now)).toMatchObject({ state: 'No answer', action: 'follow_up' });
  });

  it('uses existing contact preference and safely handles missing contact data', () => {
    expect(enquiryPresentation(entry({ preferredContact: 'phone' }), now).nextAction).toBe('Call the customer');
    expect(enquiryPresentation(entry({ preferredContact: 'email' }), now).nextAction).toBe('Email the customer');
    expect(enquiryPresentation(entry({ preferredContact: 'whatsapp' }), now).nextAction).toBe('WhatsApp the customer');
    expect(enquiryPresentation(entry({ preferredContact: 'phone', phone: null }), now).nextAction).toBe('Respond to the customer');
    expect(enquiryPresentation(entry({ phone: null, email: null }), now)).toMatchObject({ state: 'Contact details needed', action: 'update' });
  });

  it('ignores invalid timestamps rather than marking them overdue', () => {
    expect(enquiryPresentation(entry({ followUpAt: 'broken', appointmentAt: 'broken' }), now)).toMatchObject({ state: 'New enquiry', dueAt: null });
  });

  it('sorts due work first without changing the input or dropping tied records', () => {
    const fresh = entry({ id: 'fresh' });
    const secondFresh = entry({ id: 'second-fresh' });
    const late = entry({ id: 'late', followUpAt: '2026-10-20T08:00:00Z' });
    const earlier = entry({ id: 'earlier', followUpAt: '2026-10-20T07:00:00Z' });
    const done = entry({ id: 'done', status: 'closed' });
    const records = [fresh, done, secondFresh, late, earlier];
    expect(sortEnquiriesByPriority(records, now).map(record => record.id)).toEqual(['earlier', 'late', 'fresh', 'second-fresh', 'done']);
    expect(records).toEqual([fresh, done, secondFresh, late, earlier]);
  });
});

it('puts visitor words first for known website chat transcripts without changing the original', () => {
  const message = 'Showroom assistant: Welcome.\n\nVisitor: Is the car available?\n\nShowroom assistant: I can pass that on.\n\nVisitor: Please call me tomorrow.';
  const record = entry({ source: 'chat', message });
  expect(enquiryRequestText(record)).toBe('Is the car available?\n\nPlease call me tomorrow.');
  expect(record.message).toBe(message);
});
it('keeps unrecognised chat formatting and ordinary messages intact', () => {
  const message = 'Visitor: Question\n\nUnlabelled extra information';
  expect(enquiryRequestText(entry({ source: 'chat', message }))).toBe(message);
  expect(enquiryRequestText(entry({ source: 'website', message: 'Visitor: My exact words' }))).toBe('Visitor: My exact words');
});
