import { expect, it } from 'vitest';
import type { Car } from './stock-context';
import { vehicleBenefits } from './vehicle-benefits';
const car = (fields: object) => ({ advertId: '80238245', ...fields }) as Car;
it.each([
  ['Petrol', 'Euro 4', true], ['Diesel', 'Euro 6', true], ['Diesel', 'Euro 5', false],
  ['Hybrid - Petrol/Electric', 'Euro 6', true], ['Electric', null, false], ['Petrol', null, false],
])('uses supplied fuel %s and emissions %s conservatively', (fuel, emissionClass, result) => {
  expect(Boolean(vehicleBenefits(car({ fuel, emissionClass })).ulez)).toBe(result);
});
function report(status: string, sourceText: string) {
  return { sourcePlatform: 'cazoo', sourceReport: { version: 1, platform: 'cazoo', sourceUrl: 'https://www.cazoo.co.uk/cars-for-sale/80238245/', capturedAt: '2026-10-24T20:00:00Z', ulez: { status, sourceText }, history: null } };
}
it('includes the Cazoo hybrid from its validated explicit ULEZ statement without inventing Euro or plate facts', () => {
  const input = car({ fuel: 'Hybrid - Petrol/Electric', sourceExtras: report('compliant', 'ULEZ Compliant') });
  expect(vehicleBenefits(input).ulez?.text).toBe('ULEZ compliant');
  expect(input.emissionClass).toBeUndefined();
});
it('an explicit negative statement overrides generic Euro evidence', () => {
  expect(vehicleBenefits(car({ fuel: 'Petrol', emissionClass: 'Euro 6', sourceExtras: report('not_compliant', 'Not ULEZ compliant') })).ulez).toBeNull();
});
it('does not expose retired low-cost or subjective benefit categories', () => {
  expect(Object.keys(vehicleBenefits(car({ mileage: 1, sourceExtras: { annualTax: '£20', insuranceGroup: '1' } })))).toEqual(['ulez']);
});
