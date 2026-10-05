import { describe, expect, it } from 'vitest';
import type { Enquiry } from '@workspace/api-client-react';
import { callbackTiming, isOutstandingCallback, sortCallbacks } from './enquiry-callback-model';

const entry = (fields: Partial<Enquiry>) => ({ id: 'record', status: 'new', source: 'phone', createdAt: '2026-10-05T07:00:00Z', followUpAt: null, followUpCompletedAt: null, ...fields }) as Enquiry;

describe('callback queue eligibility and due times', () => {
  it('keeps structured website requests without a time and outstanding staff tasks, excluding completed work and message text matches', () => {
    expect(isOutstandingCallback(entry({ source: 'website_callback', callOutcome: 'callback_requested' }))).toBe(true);
    expect(isOutstandingCallback(entry({ followUpAt: '2026-10-05T15:00:00Z' }))).toBe(true);
    expect(isOutstandingCallback(entry({ source: 'website', message: 'Please callback', callOutcome: 'callback_requested' }))).toBe(false);
    expect(isOutstandingCallback(entry({ source: 'website_callback', callOutcome: 'information_given' }))).toBe(false);
    expect(isOutstandingCallback(entry({ source: 'website_callback', callOutcome: 'callback_requested', followUpAt: '2026-10-05T08:00:00Z', followUpCompletedAt: '2026-10-05T09:00:00Z' }))).toBe(false);
    expect(isOutstandingCallback(entry({ source: 'website_callback', callOutcome: 'callback_requested', status: 'closed' }))).toBe(false);
  });

  it('distinguishes overdue now and later today using the actual timestamp', () => {
    const now = Date.parse('2026-10-05T10:00:00Z');
    expect(callbackTiming(entry({ followUpAt: '2026-10-05T09:59:59Z' }), now)).toBe('overdue');
    expect(callbackTiming(entry({ followUpAt: '2026-10-05T10:00:00Z' }), now)).toBe('overdue');
    expect(callbackTiming(entry({ followUpAt: '2026-10-05T10:00:01Z' }), now)).toBe('upcoming');
    expect(callbackTiming(entry({ followUpAt: '2026-10-05T15:00:00+01:00' }), now)).toBe('upcoming');
    expect(callbackTiming(entry({ followUpAt: 'invalid' }), now)).toBe('unscheduled');
  });

  it('surfaces requests needing a time, then sorts timed tasks chronologically', () => {
    const records = [entry({ id: 'later', followUpAt: '2026-10-05T15:00:00Z' }), entry({ id: 'unscheduled' }), entry({ id: 'overdue', followUpAt: '2026-10-05T08:00:00Z' })];
    expect(records.sort(sortCallbacks).map(record => record.id)).toEqual(['unscheduled', 'overdue', 'later']);
  });
});
