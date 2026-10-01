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
