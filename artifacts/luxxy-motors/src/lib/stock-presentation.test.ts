import {describe, expect, it} from 'vitest';
import {arrivalTime, stockHighlights, shortTrim, stockRegistrationYear} from './stock-presentation';
import type {Car} from './stock-context';
describe('stock presentation from supplied data', () => {
  it('does not treat an import timestamp as an arrival date', () => {
    expect(arrivalTime({scrapedAt:'2026-09-25'} as unknown as Car)).toBeNull();
    expect(arrivalTime({listedAt:'invalid'} as unknown as Car)).toBeNull();
    expect(arrivalTime({listedAt:'2026-09-25'} as unknown as Car)).toBe(Date.parse('2026-09-25'));
  });
  it('keeps at most two explicit useful equipment features and excludes negatives', () => {
    expect(stockHighlights({features:['No parking sensors', 'Heated seats', 'Heated seats', 'Apple CarPlay', 'Panoramic roof']} as unknown as Car)).toEqual(['Heated seats','Apple CarPlay']);
    expect(stockHighlights({description:'Possibly has heated seats'} as unknown as Car)).toEqual([]);
  });
  it('shortens emissions and door wording without changing the source', () => {
    const car = {variant:'Titanium Euro 6 (s/s) 5dr'} as Car;
    expect(shortTrim(car)).toBe('Titanium');
    expect(car.variant).toBe('Titanium Euro 6 (s/s) 5dr');
  });
});

it('formats a full supplied registration band without repeating the year', () => {
  expect(stockRegistrationYear({year:2018, registrationBand:'2018 (68 reg)'} as Car)).toBe('2018 (68 reg)');
  expect(stockRegistrationYear({year:2018, registrationBand:'68'} as Car)).toBe('2018 (68 reg)');
});
