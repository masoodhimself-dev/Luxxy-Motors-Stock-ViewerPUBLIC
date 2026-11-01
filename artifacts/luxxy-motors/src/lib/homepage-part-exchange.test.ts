import { beforeEach, describe, expect, it } from 'vitest';
import { prepareHomepagePartExchange } from './homepage-part-exchange';
import { partExchangeDraftKey, readPartExchangeDraft, savePartExchangeDraft } from './part-exchange-draft';

beforeEach(() => sessionStorage.clear());
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
});
