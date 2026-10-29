import { expect, it } from 'vitest';
import type { Car } from './stock-context';
import { vehicleSellingPoints } from './vehicle-selling-points';
it('keeps supplied ownership/service facts and removes subjective cost and mileage comparisons', () => {
  const car = { advertId: '1', owners: 1, fuel: 'Petrol', emissionClass: 'Euro 6', mileage: 1000, sourceExtras: { annualTax: '£20', insuranceGroup: '1', serviceHistory: 'Full service history', vehicleHighlights: [{ key: 'MileageLow', quantifier: 'LOW' }] } } as Car;
  expect(vehicleSellingPoints(car).map(point => point.text)).toEqual(['ULEZ compliant', '1 owner', 'Full service history']);
});
it('does not manufacture highlights when no relevant facts were supplied', () => {
  expect(vehicleSellingPoints({ advertId: '1', sourceExtras: null } as Car)).toEqual([]);
});

it('uses previous keepers only when the source explicitly describes that count',()=>{
 const car={owners:2,sourceExtras:{historyExtras:{ownersData:{label:'Previous owners',value:'1'}}}} as unknown as Car;
 expect(vehicleSellingPoints(car).map(point=>point.text)).toEqual(['1 previous keeper']);
});

it('adds factual small-engine highlights and trusts exact cc over rounded litres', () => {
  const point = (extra: Partial<Car>) => vehicleSellingPoints({ ...extra } as Car).find(p => p.id === 'engine');
  expect(point({ engineCC: 999 })?.text).toBe('999cc engine');
  expect(point({ engineCC: 998, engineSize: '1.0L' })?.text).toBe('998cc engine');
  expect(point({ engineSize: '1L' })?.text).toBe('1.0L engine');
  expect(point({ engineSize: '1.0 litres' })?.text).toBe('1.0L engine');
  expect(point({ engineSize: '999cc' })?.text).toBe('999cc engine');
  expect(point({ engineCC: 1001, engineSize: '1L' })).toBeUndefined();
  expect(point({ engineSize: '1.2L' })).toBeUndefined();
  expect(point({ engineCC: 0 })).toBeUndefined();
  expect(point({ engineCC: 999, fuel: 'Electric' })).toBeUndefined();
  expect(point({ engineSize: 'unknown' })).toBeUndefined();
});
