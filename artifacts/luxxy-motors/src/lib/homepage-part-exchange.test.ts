import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHomepagePartExchangeLookup, prepareHomepagePartExchange, readHomepagePartExchangeLookup, readHomepagePartExchangeRegistration, retainHomepagePartExchangeLookup } from './homepage-part-exchange';
import type { PartExchangeMotDetailsResult } from './part-exchange-lookup';
import { partExchangeDraftKey, readPartExchangeDraft, savePartExchangeDraft } from './part-exchange-draft';

beforeEach(() => { sessionStorage.clear(); clearHomepagePartExchangeLookup(); document.querySelector('meta[name="luxxy-canonical-origin"]')?.remove(); window.history.replaceState({}, '', '/'); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.querySelector('meta[name="luxxy-canonical-origin"]')?.remove(); });
const details = (): PartExchangeMotDetailsResult => ({ registration: 'YS67LMK', vehicle: { make: 'MERCEDES-BENZ', model: 'A-CLASS', registrationDate: '2017-09-01' }, mileage: '88000', mot: { dueDate: '2027-10-01', firstTest: false, lastPassedDate: '2026-10-02', lastTestDate: '2026-10-02', latestTestResult: 'PASSED', checkedAt: '2026-11-01T10:00:00Z' } });
describe('homepage part-exchange handoff', () => {
  it('only prepares a normalised valid registration, without claiming a lookup', () => {
    expect(prepareHomepagePartExchange(' yS67 lmk ')).toBe(true);
    const draft = readPartExchangeDraft(partExchangeDraftKey());
    expect(draft?.details.registration).toBe('YS67LMK');
    expect(draft?.details.makeModel).toBe('');
    expect(draft?.details.mileage).toBe('');
    expect(draft?.autofill).toBeUndefined();
    expect(draft).not.toHaveProperty('gate');
  });
  it('leaves a prior draft untouched for an incomplete or invalid plate', () => {
    prepareHomepagePartExchange('YS67LMK');
    const before = sessionStorage.getItem(partExchangeDraftKey());
    expect(prepareHomepagePartExchange('YS')).toBe(false);
    expect(prepareHomepagePartExchange('<script>')).toBe(false);
    expect(sessionStorage.getItem(partExchangeDraftKey())).toBe(before);
  });
  it('preserves contacts, selected stock and wording while invalidating another car’s answers', () => {
    prepareHomepagePartExchange('YS67LMK');
    const draft = readPartExchangeDraft(partExchangeDraftKey())!;
    savePartExchangeDraft(partExchangeDraftKey(), { ...draft, details: { ...draft.details, makeModel: 'Mercedes-Benz A-Class', mileage: '88000', keys: '2 keys', name: 'Alex', email: 'alex@example.test' }, vehicleId: 'selected-car', autofill: { registration: 'YS67LMK', mileage: '88000' }, message: { text: 'My own wording', source: 'previous car details', edited: true } });
    prepareHomepagePartExchange('LD72MHM');
    const next = readPartExchangeDraft(partExchangeDraftKey())!;
    expect(next.details).toMatchObject({ registration: 'LD72MHM', name: 'Alex', email: 'alex@example.test', makeModel: '', mileage: '', keys: '' });
    expect(next.vehicleId).toBe('selected-car');
    expect(next.message?.text).toBe('My own wording');
    expect(next.autofill).toBeUndefined();
  });
  it('retains the same car’s manually entered answers', () => {
    prepareHomepagePartExchange('YS67LMK');
    const draft = readPartExchangeDraft(partExchangeDraftKey())!;
    savePartExchangeDraft(partExchangeDraftKey(), { ...draft, details: { ...draft.details, makeModel: 'My Mercedes', mileage: '89000' }, autofill: { registration: 'YS67LMK', manualMakeModel: true, manualMileage: true } });
    prepareHomepagePartExchange('ys67 lmk');
    expect(readPartExchangeDraft(partExchangeDraftKey())?.details).toMatchObject({ makeModel: 'My Mercedes', mileage: '89000' });
  });
  it('carries a cloned result through repeated reads without storing MOT facts or a verification gate', () => {
    prepareHomepagePartExchange('YS67LMK');
    const result = details(); retainHomepagePartExchangeLookup(result);
    result.vehicle.make = 'Changed outside';
    const first = readHomepagePartExchangeLookup('ys67 lmk')!;
    expect(first.vehicle.make).toBe('MERCEDES-BENZ'); first.vehicle.make = 'Changed caller';
    expect(readHomepagePartExchangeLookup('YS67LMK')?.vehicle.make).toBe('MERCEDES-BENZ');
    expect(readHomepagePartExchangeLookup('LD72MHM')).toBeNull();
    expect(sessionStorage.getItem(partExchangeDraftKey())).not.toContain('checkedAt');
    expect(readPartExchangeDraft(partExchangeDraftKey())).not.toHaveProperty('gate');
  });
  it('expires a lookup after five minutes and rejects clock rollback', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
    retainHomepagePartExchangeLookup(details()); vi.advanceTimersByTime(300_001);
    expect(readHomepagePartExchangeLookup('YS67LMK')).toBeNull(); expect(readHomepagePartExchangeRegistration()).toBeNull();
    retainHomepagePartExchangeLookup(details()); vi.setSystemTime(new Date('2026-11-01T09:00:00Z'));
    expect(readHomepagePartExchangeLookup('YS67LMK')).toBeNull();
  });
  it('rejects a handoff after the same preview origin resolves to another dealership', () => {
    const meta = document.createElement('meta'); meta.name = 'luxxy-canonical-origin'; meta.setAttribute('data-page-meta', ''); meta.content = 'https://multichoicemotors.co.uk'; document.head.appendChild(meta);
    retainHomepagePartExchangeLookup(details());
    expect(readHomepagePartExchangeLookup('YS67LMK')).not.toBeNull();
    meta.content = 'https://shore-drive-limited.co.uk';
    expect(readHomepagePartExchangeLookup('YS67LMK')).toBeNull();
    meta.content = 'https://multichoicemotors.co.uk'; expect(readHomepagePartExchangeLookup('YS67LMK')).toBeNull();
  });
  it('carries registration and fresh lookup in memory when private browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('Blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Blocked'); });
    expect(prepareHomepagePartExchange('YS67LMK')).toBe(true);
    expect(readHomepagePartExchangeRegistration()).toBe('YS67LMK');
    retainHomepagePartExchangeLookup(details());
    expect(readHomepagePartExchangeLookup('YS67LMK')?.mileage).toBe('88000');
    clearHomepagePartExchangeLookup(); expect(readHomepagePartExchangeRegistration()).toBeNull();
  });
  it('invalidates another registration’s fresh result when preparing a different car', () => {
    retainHomepagePartExchangeLookup(details()); prepareHomepagePartExchange('LD72MHM');
    expect(readHomepagePartExchangeLookup('YS67LMK')).toBeNull(); expect(readHomepagePartExchangeRegistration()).toBe('LD72MHM');
  });
});
