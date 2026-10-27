import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { VehicleRunningCosts } from './vehicle-running-costs';
it('keeps raw Auto Trader and Cazoo values without invented comparison scores', () => {
  const car = { sourceExtras: { runningCosts: { items: [{ label: 'Annual road tax', value: '£200' }, { label: 'Insurance group', value: '27E' }] } } } as unknown as Car;
  render(<VehicleRunningCosts car={car} />);
  expect(screen.getByText('Annual road tax')).toBeInTheDocument();
  expect(screen.getByText('£200')).toBeInTheDocument();
  expect(screen.getByText('27E')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
