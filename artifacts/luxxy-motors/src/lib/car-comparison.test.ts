import { describe, expect, it } from 'vitest';
import type { MotHistory } from '@workspace/vehicle-meta';
import type { Car } from './stock-context';
import { comparisonRows, comparisonRowDiffers, currentComparisonIds } from './car-comparison';

const now = new Date('2026-11-06T12:00:00Z');
const car = (id: string, values: Partial<Car> = {}) => ({ id, title: `Car ${id}`, images: [], ...values } as Car);
const history = (values: Partial<MotHistory> = {}) => ({ registration: 'AB12CDE', checkedAt: now.toISOString(), tests: [
  { completedDate: '2026-10-02', result: 'PASSED', expiryDate: '2027-10-01', odometerValue: '40000', odometerUnit: 'mi', defects: [] },
], ...values } as MotHistory);

describe('car comparisons', () => {
  it('uses exact supplied prices, mileage and specifications, keeping unknowns blank', () => {
    const rows = comparisonRows([car('a', { price: 9500, priceType: 'Plus VAT', mileage: 132000, fuel: 'Petrol Hybrid', transmission: 'Automatic', engineSize: '3.5L' }), car('b')]);
    expect(rows.find(row => row.key === 'price')?.values).toEqual(['£9,500 (Plus VAT)', null]);
    expect(rows.find(row => row.key === 'mileage')?.values).toEqual(['132,000 miles', null]);
    expect(rows.find(row => row.key === 'engine')?.values).toEqual(['3.5L', null]);
    expect(rows.find(row => row.key === 'mot')?.values).toEqual([null, null]);
  });

  it('keeps equipment qualifications intact and never turns a missing feature into No', () => {
    const rows = comparisonRows([car('a', { features: ['Bluetooth', 'Heated seats not working', 'Camera optional'] }), car('b', { features: [' bluetooth ', 'Parking sensors'] })]);
    expect(rows.find(row => row.key === 'feature:bluetooth')?.values).toEqual(['Listed', 'Listed']);
    expect(rows.find(row => row.label === 'Heated seats not working')?.values).toEqual(['Listed', null]);
    expect(rows.find(row => row.label === 'Camera optional')?.values).toEqual(['Listed', null]);
    expect(rows.some(row => row.values.includes('No'))).toBe(false);
  });

  it('shows only a fresh matching MOT expiry, rejecting advert dates, old checks and later failures', () => {
    const cars = ['a', 'b', 'c', 'd'].map(id => car(id, { registration: 'AB12CDE', motExpiry: '2030-01-01' }));
    const rows = comparisonRows(cars, {
      a: history(),
      b: history({ checkedAt: '2026-11-01T12:00:00Z' }),
      c: history({ registration: 'XY99ZZZ' }),
      d: history({ tests: [...history().tests, { ...history().tests[0], completedDate: '2026-11-01', result: 'FAILED', expiryDate: null }] }),
    }, now);
    expect(rows.find(row => row.key === 'mot')?.values).toEqual(['1 October 2027', null, null, null]);
  });

  it('compares normalised text without hiding a known versus unknown difference', () => {
    expect(comparisonRowDiffers({ key: 'fuel', label: 'Fuel', values: ['Petrol', ' petrol '] })).toBe(false);
    expect(comparisonRowDiffers({ key: 'mot', label: 'MOT', values: [null, null] })).toBe(false);
    expect(comparisonRowDiffers({ key: 'fuel', label: 'Fuel', values: ['Petrol', null] })).toBe(true);
  });

  it('removes duplicates and unavailable selections before keeping up to three cars', () => {
    expect(currentComparisonIds(['gone', 'b', 'b', 'a', 'c', 'd'], ['a', 'b', 'c', 'd'].map(id => car(id)))).toEqual(['b', 'a', 'c']);
  });
});
