import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discardPartExchangeDraft, partExchangeDraftKey, readPartExchangeDraft, savePartExchangeDraft, type PartExchangeDraft } from './part-exchange-draft';

const draft: PartExchangeDraft = {
  details: { registration: 'AB12 CDE', makeModel: '', mileage: '0', condition: '', conditionNotes: '', keys: '', v5: '', serviceHistory: '', name: 'Alex', phone: '07700900123', email: '' },
  vehicleId: 'car-a', delivery: 'website',
};
beforeEach(() => { sessionStorage.clear(); vi.useRealTimers(); });
describe('part exchange draft privacy and recovery', () => {
  it('restores zero mileage and optional empty fields only for the same vehicle context', () => {
    savePartExchangeDraft(partExchangeDraftKey('car-a'), draft);
    expect(readPartExchangeDraft(partExchangeDraftKey('car-a'))).toEqual(draft);
    expect(readPartExchangeDraft(partExchangeDraftKey('car-b'))).toBeNull();
    expect(readPartExchangeDraft(partExchangeDraftKey())).toBeNull();
  });
  it('expires answers after 30 minutes and removes discarded drafts', () => {
    vi.useFakeTimers();
    savePartExchangeDraft('test', draft);
    vi.advanceTimersByTime(30 * 60_000 + 1);
    expect(readPartExchangeDraft('test')).toBeNull();
    expect(sessionStorage.getItem('test')).toBeNull();
    savePartExchangeDraft('test', draft); discardPartExchangeDraft('test');
    expect(readPartExchangeDraft('test')).toBeNull();
    vi.useRealTimers();
  });
  it('refuses malformed or future-dated saved answers', () => {
    sessionStorage.setItem('test', JSON.stringify({ savedAt: Date.now() + 10000, data: draft }));
    expect(readPartExchangeDraft('test')).toBeNull();
    sessionStorage.setItem('test', JSON.stringify({ savedAt: Date.now(), data: { ...draft, details: { ...draft.details, phone: 123 } } }));
    expect(readPartExchangeDraft('test')).toBeNull();
  });
});
