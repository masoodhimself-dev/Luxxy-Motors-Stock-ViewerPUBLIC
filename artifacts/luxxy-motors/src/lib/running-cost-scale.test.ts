import { expect, it } from 'vitest';
import type { Car } from './stock-context';
import { runningCostScale } from './running-cost-scale';
const car = (label: string, value: string) => ({ sourceExtras: { runningCosts: { items: [{ label, value }] } } }) as Car;
it('places lower tax and emissions at the green end of the supplied stock range', () => {
  expect(runningCostScale('Tax per year', '£20', [car('Tax per year', '£20'), car('Tax per year', '£200')])?.position).toBe(0);
  expect(runningCostScale('CO₂ emissions', '200g/km', [car('CO₂ emissions', '100g/km'), car('CO₂ emissions', '200g/km')])?.position).toBe(100);
});
it('reverses MPG so better economy is green', () => {
  const cars = [car('Average', '30mpg'), car('Average', '60mpg')];
  expect(runningCostScale('Average', '60mpg', cars)?.position).toBe(0);
  expect(runningCostScale('Average', '30mpg', cars)?.position).toBe(100);
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
  const cars = [car('Urban', '30mpg'), car('Urban', '50mpg'), car('Extra Urban', '80mpg')];
  expect(runningCostScale('Urban', '40mpg', cars)?.position).toBe(50);
  expect(runningCostScale('Urban', '90mpg', cars)?.position).toBe(0);
});
