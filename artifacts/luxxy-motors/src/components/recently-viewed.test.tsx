import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecentlyViewed } from './recently-viewed';

const state = vi.hoisted(() => ({ cars: [] as any[], ids: [] as string[] }));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: { cars: state.cars } }) }));
vi.mock('@/lib/customer-convenience', () => ({ recentVehicles: () => state.ids, clearRecentVehicles: vi.fn() }));
vi.mock('@/lib/responsive-vehicle-image', () => ({ responsiveVehicleImage: () => ({}), retryOriginalImage: () => false }));
afterEach(cleanup);
beforeEach(() => { state.cars = []; state.ids = []; });

it('keeps recently viewed stock readable when its photo is missing or fails', () => {
  state.cars = [
    { id: 'one', title: 'Fictional Ford Focus', price: 5000, heroImage: 'https://example.test/vehicle.jpg', images: [], inventoryStatus: 'available' },
    { id: 'two', title: 'Fictional MINI', price: 6000, heroImage: null, images: [], inventoryStatus: 'available' },
  ];
  state.ids = ['one', 'two'];
  const { container } = render(<RecentlyViewed />);
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(container.querySelectorAll('img')).toHaveLength(1);
  fireEvent.error(container.querySelector('img')!);
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByText('Fictional Ford Focus')).toBeVisible();
  expect(screen.getByText('Fictional MINI')).toBeVisible();
});

it('does not advertise sold, archived or hidden vehicles from a stale client stock record', () => {
  state.cars = ['sold', 'archived', 'hidden'].map(status => ({ id: status, title: `Fictional ${status}`, inventoryStatus: status }));
  state.ids = ['sold', 'archived', 'hidden', 'missing-record'];
  render(<RecentlyViewed />);
  expect(screen.queryByRole('heading', { name: 'Recently viewed' })).not.toBeInTheDocument();
});
