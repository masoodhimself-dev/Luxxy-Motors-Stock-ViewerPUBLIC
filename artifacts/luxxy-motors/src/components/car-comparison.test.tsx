import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { CarComparison } from './car-comparison';

const fetch = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({ customFetch: fetch }));
const cars = [
  { id: 'lexus', title: 'Lexus RX', price: 9500, fuel: 'Petrol', transmission: 'Automatic', mileage: 132000, features: ['Bluetooth', 'Reversing camera'], images: [] },
  { id: 'ford', title: 'Ford Focus', price: 6500, fuel: 'Petrol', transmission: 'Manual', mileage: 60000, features: ['Bluetooth'], images: [] },
] as unknown as Car[];
beforeEach(() => { fetch.mockReset(); fetch.mockResolvedValue({ status: 'unavailable' }); });
afterEach(() => vi.unstubAllGlobals());

it('reads only cached MOTs for cars explicitly being compared and offers normal details links', async () => {
  const share = vi.fn();
  const view = render(<CarComparison cars={cars} open={false} onOpenChange={vi.fn()} onShare={share} />);
  expect(fetch).not.toHaveBeenCalled();
  view.rerender(<CarComparison cars={cars} open onOpenChange={vi.fn()} onShare={share} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/vehicles/lexus/mot-history?cacheOnly=true', '/api/vehicles/ford/mot-history?cacheOnly=true']);
  expect(screen.getByRole('link', { name: 'Lexus RX' })).toHaveAttribute('href', '/vehicle/lexus');
  fireEvent.click(screen.getByRole('button', { name: 'Share these cars' }));
  expect(share).toHaveBeenCalledWith(['lexus', 'ford']);
});

it('shows differences without presenting unlisted equipment as absent, and returns to the shortlist', async () => {
  const change = vi.fn();
  render(<CarComparison cars={cars} open onOpenChange={change} onShare={vi.fn()} />);
  await waitFor(() => expect(screen.queryByText('Checking…')).not.toBeInTheDocument());
  expect(screen.getByRole('rowheader', { name: 'Fuel' })).toBeInTheDocument();
  expect(screen.getByRole('rowheader', { name: 'Bluetooth' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show differences' }));
  expect(screen.queryByRole('rowheader', { name: 'Fuel' })).not.toBeInTheDocument();
  expect(screen.queryByRole('rowheader', { name: 'Bluetooth' })).not.toBeInTheDocument();
  const feature = screen.getByRole('rowheader', { name: 'Reversing camera' }).closest('tr')!;
  expect(within(feature).getByText('Listed')).toBeInTheDocument();
  expect(within(feature).getByText('Not listed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to shortlist' }));
  expect(change).toHaveBeenCalledWith(false);
});

it('fits a selected pair at narrow widths and can switch to the other two cars', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  const third = { ...cars[0], id: 'bmw', title: 'BMW X6' };
  render(<CarComparison cars={[...cars, third]} open onOpenChange={vi.fn()} onShare={vi.fn()} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(screen.getByRole('link', { name: 'Lexus RX' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'BMW X6' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Cars to compare' }), { target: { value: '2' } });
  expect(screen.getByRole('link', { name: 'Ford Focus' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'BMW X6' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Lexus RX' })).not.toBeInTheDocument();
});
