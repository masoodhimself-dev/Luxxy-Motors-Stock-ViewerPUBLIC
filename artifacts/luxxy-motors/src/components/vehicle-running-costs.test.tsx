import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { VehicleRunningCosts } from './vehicle-running-costs';
const car = (value: string) => ({ sourceExtras: { runningCosts: { items: [{ label: 'Tax per year', value }, { label: 'Insurance group', value: '15E' }] } } }) as Car;
it('shows a labelled comparison without relying on colour or losing the original value', () => {
  render(<VehicleRunningCosts car={car('£20')} comparisonCars={[car('£20'), car('£200')]} />);
  expect(screen.getByText('£20')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Tax per year: £20.*Our stock: 20–200/ })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Insurance group: 15E.*Insurance groups 1–50/ })).toBeInTheDocument();
});
it('retains the figure with no invented tax comparison when stock has no valid range', () => {
  render(<VehicleRunningCosts car={car('£20')} />);
  expect(screen.getByText('£20')).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Tax per year/ })).not.toBeInTheDocument();
});
