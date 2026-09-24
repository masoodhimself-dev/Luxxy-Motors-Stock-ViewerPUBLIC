import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Compare from './compare';
import { SavedCarsProvider } from '@/lib/saved-cars-context';

vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ isLoading: false, error: null, stock: { cars: [
  { id: 'zero', title: 'Zero mileage car', mileage: 0, price: 12000, owners: 0, images: [], writeOffCategory: null },
  { id: 'known', title: 'Known history car', mileage: 1000, price: 12500, owners: 1, images: [], writeOffCategory: 'None' },
] } }) }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { identity: { name: 'Test Motors' }, contact: {}, presentation: { comparisonEnabled: true } } }) }));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('luxxy.compare-cars.v1', JSON.stringify(['zero', 'known']));
  window.history.pushState({}, '', '/compare');
});

it('shows zero mileage and owners as supplied, while keeping missing history unknown', () => {
  render(<SavedCarsProvider><Compare /></SavedCarsProvider>);
  const table = within(screen.getByTestId('compare-table'));
  expect(table.getByText('0 miles')).toBeInTheDocument();
  expect(table.getByText('0')).toBeInTheDocument();
  expect(table.getByText('Not provided')).toBeInTheDocument();
  expect(table.getAllByText('No write-off recorded')).toHaveLength(1);
  expect(table.queryByText('Category N recorded')).not.toBeInTheDocument();
});
