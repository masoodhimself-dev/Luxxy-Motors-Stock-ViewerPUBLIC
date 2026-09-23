import { describe, expect, it } from 'vitest';
import type { Car } from './stock-context';
import { getSimilarCars } from './similar-cars';
const car = (id: string, extras: Partial<Car> = {}) => ({ id, make: 'Example', model: 'Tourer', bodyType: 'Estate', price: 20000, fuel: 'Petrol', transmission: 'Automatic', ...extras }) as Car;
describe('relevant alternatives', () => {
  it('does not recommend unrelated cars just because fuel and gearbox match', () => {
    expect(getSimilarCars(car('current'), [car('unrelated', { make: 'Other', model: 'Sport', bodyType: 'Coupe', price: 60000 })])).toEqual([]);
  });
  it('accepts the same model or a comparable body and budget, capped at three', () => {
    const candidates = [car('a'), car('b', { make: 'Other', model: 'Other' }), car('c'), car('d')];
    expect(getSimilarCars(car('current'), candidates)).toHaveLength(3);
    expect(getSimilarCars(car('current'), [candidates[1]])).toEqual([candidates[1]]);
  });
  it('excludes current, unavailable and removed stock', () => {
    expect(getSimilarCars(car('current'), [car('current'), car('sold', { inventoryStatus: 'sold' }), car('reserved', { inventoryStatus: 'reserved' }), car('removed', { sourceStatus: 'removed' })])).toEqual([]);
  });
});
