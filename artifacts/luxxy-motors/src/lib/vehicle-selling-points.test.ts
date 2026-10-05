import { expect, it } from 'vitest';
import type { Car } from './stock-context';
import { vehicleSellingPoints } from './vehicle-selling-points';
const car = (data: object) => data as Car;
it('promotes only supplied low keeper count and low annual tax', () => {
 expect(vehicleSellingPoints(car({ owners: 2, sourceExtras: { runningCosts: { items: [{ label: 'Tax per year', value: '£20' }] } } })).map(p => p.text)).toEqual(['2 previous keepers', '£20 annual tax']);
 expect(vehicleSellingPoints(car({ owners: 7, mileage: 9000, sourceExtras: { serviceHistory: 'Partial service history', runningCosts: { items: [{ label: 'Tax per year', value: '£200' }] } } }))).toEqual([]);
});
it('does not guess low mileage from the odometer or missing facts', () => {
 expect(vehicleSellingPoints(car({ mileage: 1000 }))).toEqual([]);
 expect(vehicleSellingPoints(car({ mileage: 20000, sourceExtras: { vehicleHighlights: [{ key: 'MileageLow', quantifier: 'LOW' }] } }))[0].text).toBe('20,000 miles · below average');
 expect(vehicleSellingPoints(car({}))).toEqual([]);
});
it('does not turn partial or negated history into full history', () => {
 expect(vehicleSellingPoints(car({ sourceExtras: { serviceHistory: 'No full service history' } }))).toEqual([]);
 expect(vehicleSellingPoints(car({ sourceExtras: { serviceHistory: 'Full service history' } }))[0].text).toBe('Full service history');
});
