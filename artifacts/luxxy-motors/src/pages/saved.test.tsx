import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import Saved from './saved';

const state = vi.hoisted(() => ({
  cars: ['a', 'b', 'c', 'd'].map(id => ({ id, title: `Car ${id}`, images: [], inventoryStatus: 'available' })),
  savedIds: ['a', 'b', 'c', 'd'], clearSaved: vi.fn(), share: vi.fn(),
}));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: { cars: state.cars }, isLoading: false, error: null }) }));
vi.mock('@/lib/saved-cars-context', () => ({ useSavedCars: () => state }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: dealerConfig }) }));
vi.mock('@/hooks/use-page-meta', () => ({ usePageMeta: () => {} }));
vi.mock('@/components/car-card', () => ({ CarCard: ({ car }: { car: { title: string } }) => <div>{car.title} card</div> }));
vi.mock('@/components/car-comparison', () => ({ CarComparison: ({ cars, open, onShare }: { cars: Array<{ id: string }>; open: boolean; onShare: (ids: string[]) => void }) => open ? <section aria-label="Comparison"><p>{cars.map(car => car.id).join(',')}</p><button onClick={() => onShare(cars.map(car => car.id))}>Share these cars</button></section> : null }));
beforeEach(() => {
  window.history.replaceState({}, '', '/saved');
  state.savedIds = ['a', 'b', 'c', 'd'];
  state.cars = ['a', 'b', 'c', 'd'].map(id => ({ id, title: `Car ${id}`, images: [], inventoryStatus: 'available' }));
  state.clearSaved.mockClear(); state.share.mockReset(); state.share.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'share', { configurable: true, value: state.share });
});

it('keeps the existing cards while limiting comparison to three and allowing a different selection', () => {
  render(<Saved />);
  expect(screen.getByText('Car a card')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Compare cars' })).toBeDisabled();
  for (const id of ['a', 'b', 'c']) fireEvent.click(screen.getByRole('checkbox', { name: `Compare Car ${id}` }));
  expect(screen.getByRole('checkbox', { name: 'Compare Car d' })).toBeDisabled();
  expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Compare Car b' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Compare Car d' }));
  fireEvent.click(screen.getByRole('button', { name: 'Compare cars' }));
  expect(screen.getByRole('region', { name: 'Comparison' })).toHaveTextContent('a,c,d');
  expect(state.clearSaved).not.toHaveBeenCalled();
});

it('compares shared shortlist cars without altering local saves and shares only the selected cars', () => {
  window.history.replaceState({}, '', '/saved?cars=b,c,d');
  render(<Saved />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Shared shortlist');
  expect(screen.queryByText('Car a card')).not.toBeInTheDocument();
  for (const id of ['b', 'd']) fireEvent.click(screen.getByRole('checkbox', { name: `Compare Car ${id}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Compare cars' }));
  fireEvent.click(screen.getByRole('button', { name: 'Share these cars' }));
  expect(new URL(state.share.mock.calls[0][0].url).searchParams.get('cars')).toBe('b,d');
  expect(state.savedIds).toEqual(['a', 'b', 'c', 'd']);
});

it('removes a car from comparison when a stock update marks it sold', () => {
  const view = render(<Saved />);
  for (const id of ['a', 'b']) fireEvent.click(screen.getByRole('checkbox', { name: `Compare Car ${id}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Compare cars' }));
  state.cars = state.cars.map(car => car.id === 'b' ? { ...car, inventoryStatus: 'sold' } : car);
  view.rerender(<Saved />);
  expect(screen.queryByRole('region', { name: 'Comparison' })).not.toBeInTheDocument();
  expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();
});
