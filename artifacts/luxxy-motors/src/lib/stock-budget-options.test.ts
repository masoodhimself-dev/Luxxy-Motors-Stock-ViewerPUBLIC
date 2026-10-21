import { describe, expect, it } from 'vitest';
import { stockBudgetOptions } from './stock-budget-options';

describe('showroom budget choices', () => {
  it('fits affordable stock instead of listing irrelevant luxury budgets', () => {
    expect(stockBudgetOptions([{price: 1_795}, {price: 7_995}])).toEqual([2_500, 5_000, 7_500, 10_000]);
    expect(stockBudgetOptions([{price: 3_875}, {price: 18_995}])).toEqual([5_000, 10_000, 15_000, 20_000]);
  });
  it('covers the most expensive car and keeps a custom URL budget, including zero', () => {
    expect(stockBudgetOptions([{price: 18_995}], '12345')).toContain(12_345);
    expect(stockBudgetOptions([{price: 18_995}], '0')).toContain(0);
    expect(stockBudgetOptions([{price: 501_000}]).at(-1)).toBeGreaterThanOrEqual(501_000);
  });
  it('ignores invalid prices and invalid selected values without producing huge lists', () => {
    expect(stockBudgetOptions([{price: null}, {price: NaN}, {price: -1}], 'invalid')).toEqual([5_000, 10_000, 15_000, 20_000, 25_000, 30_000]);
    expect(stockBudgetOptions([{price: 10_000_000}])).toHaveLength(1);
    expect(stockBudgetOptions([{price: 10_000}], '-5')).not.toContain(-5);
  });
});
