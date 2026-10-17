import { expect, it } from 'vitest';
import type { Car } from './stock-context';
import { runningCostScale } from './running-cost-scale';
const car = (label: string, value: string, overrides: Partial<Car> = {}) => ({ fuel: 'Petrol', sourceExtras: { runningCosts: { title: 'Running costs · WLTP', items: [{ label, value }] } }, ...overrides }) as Car;
it('places lower tax and emissions at the green end of the supplied stock range', () => {
  expect(runningCostScale('Tax per year', '£20', [car('Tax per year', '£20'), car('Tax per year', '£100'), car('Tax per year', '£200*')])?.position).toBe(0);
  const cars = ['100g/km', '150g/km', '200g/km'].map(value => car('CO₂ emissions', value));
  expect(runningCostScale('CO₂ emissions', '200g/km', cars, cars[2])?.position).toBe(100);
});
it('reverses MPG so better economy is green', () => {
  const cars = ['30mpg', '45mpg', '60mpg'].map(value => car('Average', value));
  expect(runningCostScale('Average', '60mpg', cars, cars[2])?.position).toBe(0);
  expect(runningCostScale('Average', '30mpg', cars, cars[0])?.position).toBe(100);
});
it('uses the insurance group number with its supplied suffix', () => {
  expect(runningCostScale('Insurance group', '1E', [])?.position).toBe(0);
  expect(runningCostScale('Insurance group', '50E', [])?.position).toBe(100);
  expect(runningCostScale('Insurance group', '15E', [])?.rating).toBe('Lower');
});
it('omits incompatible units, unknown values, and insufficient or identical samples', () => {
  for (const value of ['Contact seller', '£20–£40', '£20/month', '-£20']) expect(runningCostScale('Tax per year', value, [])).toBeNull();
  expect(runningCostScale('Average', '5L/100km', [car('Average', '30mpg'), car('Average', '60mpg')])).toBeNull();
  expect(runningCostScale('Insurance group', '51E', [])).toBeNull();
  expect(runningCostScale('Tax per year', '£20', [car('Tax per year', '£20')])).toBeNull();
  expect(runningCostScale('Tax per year', '£20', [car('Tax per year', '£20'), car('Tax per year', '£20')])).toBeNull();
});
it('keeps urban and extra urban separate and clamps the marker', () => {
  const cars = [car('Urban', '30mpg'), car('Urban', '40mpg'), car('Urban', '50mpg'), car('Extra Urban', '80mpg')];
  expect(runningCostScale('Urban', '40mpg', cars, cars[1])?.position).toBe(50);
  expect(runningCostScale('Urban', '90mpg', cars, cars[1])?.position).toBe(0);
});

it('compares only the same fuel and confirmed measurement cycle', () => {
  const cars = ['30mpg', '45mpg', '60mpg'].map(value => car('Average', value));
  cars.push(car('Average', '706.2mpg', { fuel: 'Petrol Plug-in Hybrid' }));
  cars.push(car('Average', '100mpg', { sourceExtras: { runningCosts: { title: 'NEDC', items: [{ label: 'Average', value: '100mpg' }] } } }));
  const result = runningCostScale('Average', '45mpg', cars, cars[1]);
  expect(result?.position).toBe(50);
  expect(result?.basis).toBe('Petrol · WLTP: 30–60 mpg · 3 cars with figures');
});

it('omits judgement for unknown, ambiguous or insufficient measurement samples', () => {
  const unknown = car('Average', '45mpg', { sourceExtras: { runningCosts: { items: [{ label: 'Average', value: '45mpg' }] } } });
  const ambiguous = car('Average', '45mpg', { sourceExtras: { runningCosts: { title: 'WLTP / NEDC', items: [{ label: 'Average', value: '45mpg' }] } } });
  const cars = ['30mpg', '45mpg', '60mpg'].map(value => car('Average', value));
  expect(runningCostScale('Average', '45mpg', cars, unknown)).toBeNull();
  expect(runningCostScale('Average', '45mpg', cars, ambiguous)).toBeNull();
  expect(runningCostScale('Average', '45mpg', cars.slice(0, 2), cars[1])).toBeNull();
  expect(runningCostScale('Average', '45mpg', cars)).toBeNull();
});

it('does not inflate the sample with duplicate, hidden or sold vehicles', () => {
  const first = car('Tax per year', '£20', { id: 'a' });
  const second = car('Tax per year', '£100', { id: 'b' });
  expect(runningCostScale('Tax per year', '£20', [first, first, second, car('Tax per year', '£300', { inventoryStatus: 'sold' }), car('Tax per year', '£400', { inventoryStatus: 'hidden' })])).toBeNull();
});
