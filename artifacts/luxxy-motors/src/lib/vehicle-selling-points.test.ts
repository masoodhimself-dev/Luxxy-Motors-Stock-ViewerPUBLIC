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
