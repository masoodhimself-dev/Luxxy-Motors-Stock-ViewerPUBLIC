import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { VehicleDeskContext } from './enquiry-desk-context';

it('keeps known vehicle history and a write-off category separate from running costs', () => {
  const car = { id: 'fictional-car', make: 'Ford', model: 'Focus', year: 2020, mileage: 42000, fuel: 'Petrol', transmission: 'Manual', colour: 'Blue', registration: 'AB20CDE', owners: 2, writeOffCategory: 'S', sourceExtras: { serviceHistory: 'Service receipts supplied', runningCosts: { items: [{ label: 'Tax per year', value: '£190' }] } } } as unknown as Car;
  render(<VehicleDeskContext car={car} />);
  const history = screen.getByRole('region', { name: 'Vehicle history' });
  expect(history).toHaveTextContent('Owners2');
  expect(history).toHaveTextContent('Service receipts supplied');
  expect(history).toHaveTextContent('Write-off categoryS');
  expect(history).not.toHaveTextContent('£190');
  const costs = screen.getByText('Running costs', { selector: 'summary' }).closest('details')!;
  costs.open = true;
  expect(within(costs).getByText('£190')).toBeVisible();
  expect(screen.getByText('42,000 miles')).toBeVisible();
});

it('clearly states missing vehicle history without suggesting checks have passed', () => {
  render(<VehicleDeskContext car={{ id: 'fictional-car', sourceExtras: {} } as unknown as Car} />);
  expect(screen.getByText('Service history and previous keepers haven’t been recorded.')).toBeVisible();
  expect(screen.queryByText('Running costs', { selector: 'summary' })).not.toBeInTheDocument();
});
