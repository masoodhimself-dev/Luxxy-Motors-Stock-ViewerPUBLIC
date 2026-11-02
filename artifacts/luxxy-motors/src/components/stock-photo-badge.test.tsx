import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { StockPhotoBadge, stockPhotoBadge } from './stock-photo-badge';
import { CarCard } from './car-card';

const start = Date.parse('2026-11-02T12:00:00Z');
const day = 86400000;
const car = (extra: Partial<Car> = {}) => ({
  id: 'badge-car', title: 'Ford Focus', make: 'Ford', model: 'Focus',
  price: 7500, currency: 'GBP', inventoryStatus: 'available',
  images: ['https://example.test/car.jpg'], sourceExtras: null,
  ...extra,
}) as Car;
const reduced = (detectedAt = start, extra: Record<string, unknown> = {}) => car({
  sourceExtras: { websitePriceReduction: {
    previousPrice: 7700, currentPrice: 7500,
    detectedAt: new Date(detectedAt).toISOString(), ...extra,
  } },
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); });
afterEach(() => { vi.useRealTimers(); });

it('shows the exact observed saving for fourteen days and rejects a changed current price', () => {
  expect(stockPhotoBadge(reduced(), start)).toEqual({kind: 'price-drop', saving: 200, expiresAt: start + 14 * day});
  expect(stockPhotoBadge(reduced(), start + 14 * day - 1)?.kind).toBe('price-drop');
  expect(stockPhotoBadge(reduced(), start + 14 * day)).toBeNull();
  expect(stockPhotoBadge(reduced(start + 1), start)).toBeNull();
  expect(stockPhotoBadge({...reduced(), price: 7600}, start)).toBeNull();
  expect(stockPhotoBadge(reduced(start, {previousPrice: 7500.25}), start)).toBeNull();
});

it('uses the recorded arrival date and never renews it from a later import or check', () => {
  const fresh = car({listedAt: new Date(start).toISOString()});
  expect(stockPhotoBadge(fresh, start + 14 * day - 1)?.kind).toBe('new-arrival');
  expect(stockPhotoBadge(fresh, start + 14 * day)).toBeNull();
  const old = {...fresh, listedAt: new Date(start - 15 * day).toISOString(), scrapedAt: new Date(start).toISOString(), updatedAt: new Date(start).toISOString()};
  expect(stockPhotoBadge(old, start)).toBeNull();
});

it('gives a genuine price drop priority when a car is also new', () => {
  const both = {...reduced(), listedAt: new Date(start).toISOString()};
  render(<StockPhotoBadge car={both} />);
  expect(screen.getAllByTestId('stock-photo-badge')).toHaveLength(1);
  expect(screen.getByText('Price drop')).toBeVisible();
  expect(screen.getByText('-£200')).toBeVisible();
  expect(screen.queryByText('New arrival')).not.toBeInTheDocument();
});

it('expires automatically in an untouched open tab, respecting an earlier server deadline', () => {
  render(<StockPhotoBadge car={reduced(start, {expiresAt: new Date(start + 1000).toISOString()})} />);
  expect(screen.getByText('Price drop')).toBeVisible();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.queryByTestId('stock-photo-badge')).not.toBeInTheDocument();
});

it('falls back to a still-current arrival after a reduction expires and then expires that too', () => {
  render(<StockPhotoBadge car={{...reduced(start, {expiresAt: new Date(start + 1000).toISOString()}), listedAt: new Date(start).toISOString()}} />);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByText('New arrival')).toBeVisible();
  act(() => { vi.advanceTimersByTime(14 * day - 1000); });
  expect(screen.queryByTestId('stock-photo-badge')).not.toBeInTheDocument();
});

it('rechecks after returning to a sleeping tab and after a price update', () => {
  const {rerender} = render(<StockPhotoBadge car={reduced()} />);
  rerender(<StockPhotoBadge car={{...reduced(), price: 7800}} />);
  expect(screen.queryByTestId('stock-photo-badge')).not.toBeInTheDocument();
  rerender(<StockPhotoBadge car={reduced()} />);
  vi.setSystemTime(start + 15 * day);
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(screen.queryByTestId('stock-photo-badge')).not.toBeInTheDocument();
});

it.each(['reserved', 'sold', 'hidden', 'archived'])('does not promote %s cars as newly available or reduced', inventoryStatus => {
  expect(stockPhotoBadge({...reduced(), inventoryStatus, listedAt: new Date(start).toISOString()}, start)).toBeNull();
});

it.each(['card', 'compact', 'row'] as const)('places the badge on the stock photograph in %s view without duplicate reduction copy', layout => {
  render(<CarCard car={reduced()} stockDetails catalogue layout={layout} photoControls={false} />);
  expect(screen.getByTestId('stock-photo-badge').closest('.vehicle-card-photo')).not.toBeNull();
  expect(screen.queryByTestId('price-reduction')).not.toBeInTheDocument();
  expect(screen.getByRole('link', {name: 'View full details for Ford Focus'})).toHaveAttribute('href', '/vehicle/badge-car');
});

it('leaves vehicle-page recommendations, featured and saved cards without photo badges', () => {
  const {rerender} = render(<CarCard car={reduced()} photoControls={false} />);
  expect(screen.queryByTestId('stock-photo-badge')).not.toBeInTheDocument();
  expect(screen.getByTestId('price-reduction')).toBeVisible();
  rerender(<CarCard car={car({listedAt: new Date(start).toISOString()})} catalogue savedDetails photoControls={false} />);
  expect(screen.queryByTestId('stock-photo-badge')).not.toBeInTheDocument();
});
