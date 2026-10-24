import { expect, it } from 'vitest';
import { priceReduction } from './price-reduction';
const detectedAt = '2026-10-01T12:02:44.242Z';
const start = Date.parse(detectedAt);
const car = { price: 3975, sourceExtras: { websitePriceReduction: { previousPrice: 4175, currentPrice: 3975, detectedAt } } };
it('shows the observed saving within fourteen days', () => {
  expect(priceReduction(car, start)).toEqual({previousPrice: 4175, saving: 200});
  expect(priceReduction(car, start + 14 * 86400000 - 1)).not.toBeNull();
});
it('expires at fourteen days and never shows future changes', () => {
  expect(priceReduction(car, start + 14 * 86400000)).toBeNull();
  expect(priceReduction(car, start - 1)).toBeNull();
});
it('hides the claim when price changes or evidence is absent', () => {
  expect(priceReduction({...car, price: 4200}, start)).toBeNull();
  expect(priceReduction({...car, sourceExtras: null}, start)).toBeNull();
  expect(priceReduction({...car, sourceExtras: {websitePriceReduction: {previousPrice: 2000, currentPrice: 3975, detectedAt}}}, start)).toBeNull();
});
it('honours an earlier server expiry without extending the fourteen-day window', () => {
  const value = car.sourceExtras.websitePriceReduction;
  const withExpiry = (expiresAt: unknown) => ({...car, sourceExtras: {websitePriceReduction: {...value, expiresAt}}});
  expect(priceReduction(withExpiry(new Date(start + 1000).toISOString()), start + 999)).not.toBeNull();
  expect(priceReduction(withExpiry(new Date(start + 1000).toISOString()), start + 1000)).toBeNull();
  expect(priceReduction(withExpiry('2099-01-01T00:00:00Z'), start + 14 * 86400000)).toBeNull();
  for (const expiry of ['not a date', detectedAt, new Date(start - 1).toISOString(), null, 5]) {
    expect(priceReduction(withExpiry(expiry), start)).toBeNull();
  }
});
it('does not relabel recorded GBP evidence as a different currency or accept malformed evidence', () => {
  expect(priceReduction({...car, currency: 'EUR'}, start)).toBeNull();
  expect(priceReduction({...car, currency: 'GBP'}, start)).not.toBeNull();
  expect(priceReduction({...car, sourceExtras: {websitePriceReduction: []}}, start)).toBeNull();
  expect(priceReduction({...car, sourceExtras: {websitePriceReduction: {...car.sourceExtras.websitePriceReduction, previousPrice: Infinity}}}, start)).toBeNull();
});
