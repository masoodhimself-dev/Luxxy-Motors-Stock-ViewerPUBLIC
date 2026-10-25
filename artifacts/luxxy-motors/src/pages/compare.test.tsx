import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Compare from './compare';
import { SavedCarsProvider } from '@/lib/saved-cars-context';

const state = vi.hoisted(() => ({ reserved: false, nestedCategory: null as string | null, keys: null as string | null }));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ isLoading: false, error: null, stock: { cars: [
  { id: 'zero', title: 'Zero mileage car', year: 2013, plate: 'AB12 CDE', registrationBand: '2013 (13 reg)', mileage: 0, price: 12000, owners: 0, images: [], writeOffCategory: null, specifications: { writeOffCategory: state.nestedCategory }, sourceExtras: { historyExtras: { historyItems: [{ key: 'KEYS', value: state.keys }] } } },
  { id: 'known', title: 'Known history car', year: 2012, registrationBand: '2012 (62 reg)', mileage: 1000, price: 12500, owners: 1, images: [], writeOffCategory: 'None', inventoryStatus: state.reserved ? 'reserved' : 'available' },
] } }) }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { identity: { name: 'Test Motors' }, contact: {}, presentation: { comparisonEnabled: true } } }) }));

beforeEach(() => {
  state.reserved = false;
  state.nestedCategory = null;
  state.keys = null;
  window.localStorage.clear();
  window.localStorage.setItem('luxxy.compare-cars.v1', JSON.stringify(['zero', 'known']));
  window.history.pushState({}, '', '/compare');
});

it('keeps a supplied nested insurance category consistent with the vehicle page', () => {
  state.nestedCategory = 'Cat S';
  render(<SavedCarsProvider><Compare /></SavedCarsProvider>);
  const table = within(screen.getByTestId('compare-table'));
  expect(table.getByText('Category S recorded')).toBeInTheDocument();
  expect(table.getByText('No write-off recorded')).toBeInTheDocument();
});

it('shows the supplied source-history keys instead of calling the recorded value missing', () => {
  state.keys = '2 keys';
  render(<SavedCarsProvider><Compare /></SavedCarsProvider>);
  expect(within(screen.getByTestId('compare-table')).getByText('2 keys')).toBeInTheDocument();
});

it('sends reserved-car enquiries straight to the car-specific enquiry form', () => {
  state.reserved = true;
  render(<SavedCarsProvider><Compare /></SavedCarsProvider>);
  expect(screen.getByRole('link', { name: 'Enquire' })).toHaveAttribute('href', '/enquire?type=general&vehicleId=known');
});

it('shows zero mileage and owners as supplied, while keeping missing history unknown', () => {
  render(<SavedCarsProvider><Compare /></SavedCarsProvider>);
  const table = within(screen.getByTestId('compare-table'));
  expect(table.getByText('0 miles')).toBeInTheDocument();
  expect(table.getByText('0')).toBeInTheDocument();
  expect(table.getByText('Not supplied')).toBeInTheDocument();
  expect(table.getAllByText('No write-off recorded')).toHaveLength(1);
  expect(table.queryByText('Category N recorded')).not.toBeInTheDocument();
});

it('identifies a supplied plate and falls back to the registration year without inventing a plate', () => {
  render(<SavedCarsProvider><Compare /></SavedCarsProvider>);
  const table = within(screen.getByTestId('compare-table'));
  expect(table.getByText('AB12 CDE')).toBeInTheDocument();
  expect(table.getByText('2012 (62 reg)')).toBeInTheDocument();
  const plates = screen.getAllByTestId('compare-plate');
  expect(plates).toHaveLength(1);
  expect(plates[0]).toHaveTextContent('AB12 CDE');
});
