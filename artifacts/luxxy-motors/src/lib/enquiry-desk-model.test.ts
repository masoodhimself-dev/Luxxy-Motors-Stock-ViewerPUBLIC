import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sameCustomer, deskMatches, readCallDraft, saveCallDraft, type CallDraft } from './enquiry-desk-model';
describe('staff customer matching', () => {
  it('matches UK phone formats or exact emails, never name alone or empty contact details', () => {
    expect(sameCustomer({ phone: '+44 7700 900123' }, { phone: '07700900123' })).toBe(true);
    expect(sameCustomer({ phone: '00447700900123' }, { phone: '07700900123' })).toBe(true);
    expect(sameCustomer({ email: ' Alex@Example.com ' }, { email: 'alex@example.com' })).toBe(true);
    expect(sameCustomer({}, {})).toBe(false);
    expect(sameCustomer({ phone: '07700' }, { phone: '07700900123' })).toBe(false);
    expect(deskMatches('AB19XYZ', ['Ford', 'AB19 XYZ'])).toBe(true);
  });
});
describe('staff browser draft recovery', () => {
  beforeEach(() => localStorage.clear());
  const draft: CallDraft = { vehicleMode: 'stock', carId: 'car', adHocTitle: '', adHocRegistration: '', adHocPrice: '', name: 'Alex', phone: '07700900123', email: '', message: 'Retain these notes', booking: false, time: '', followUp: false, followUpTime: '', followUpNote: '', manualTime: false, assignedToId: 'staff', outcome: 'information_given' };
  it('recovers a draft only under the same staff/dealer key and expires old records', () => {
    expect(saveCallDraft('dealer-a:staff-a', draft)).toBe(true);
    expect(readCallDraft('dealer-a:staff-a')).toEqual(draft);
    expect(readCallDraft('dealer-a:staff-b')).toBeNull();
    localStorage.setItem('old', JSON.stringify({ savedAt: Date.now() - 8 * 86400000, data: draft }));
    expect(readCallDraft('old')).toBeNull();
  });
  it('reports storage failures and ignores malformed data', () => {
    localStorage.setItem('broken', '{'); expect(readCallDraft('broken')).toBeNull();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(saveCallDraft('blocked', draft)).toBe(false); spy.mockRestore();
  });
});
