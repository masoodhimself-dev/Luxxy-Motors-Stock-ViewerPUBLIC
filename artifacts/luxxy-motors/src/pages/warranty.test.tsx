import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig, type DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import Warranty from './warranty';

const state = vi.hoisted(() => ({ settings: {} as DealerConfig, error: null as unknown, cars: [] as Car[] }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: state.settings, isLoading: false, isError: false }) }));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: { cars: state.cars }, isLoading: false, error: state.error }) }));
vi.mock('@/hooks/use-page-meta', () => ({ usePageMeta: vi.fn() }));

beforeEach(() => {
  state.settings = structuredClone(dealerConfig);
  state.settings.identity.name = 'Fictional Motors';
  state.settings.warranty = { enabled: true, title: 'Our warranty options', description: 'Ask for the policy terms for this vehicle.', ctaLabel: 'Ask about warranty' };
  state.error = null;
  state.cars = [{ id: 'car-a', make: 'Ford', model: 'Fiesta', title: 'Ford Fiesta', year: 2020, price: 6500 } as Car];
  window.history.replaceState({}, '', '/warranty');
});

it('opens a warranty enquiry directly and retains the selected vehicle context', () => {
  render(<Warranty />);
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=warranty');
  fireEvent.change(screen.getByLabelText(/Which car are you asking about/), { target: { value: 'car-a' } });
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=warranty&vehicleId=car-a');
  expect(screen.getByTestId('warranty-whatsapp')).toHaveAttribute('href', expect.stringContaining('Ford%20Fiesta'));
  expect(document.querySelector('a[href="#warranty-enquiry"]')).toBeNull();
});

it('shows configured warranty copy without expanding a second generic FAQ', () => {
  render(<Warranty />);
  expect(screen.getByRole('heading', { name: 'Our warranty options' })).toBeInTheDocument();
  expect(screen.getByText('Ask for the policy terms for this vehicle.')).toBeInTheDocument();
  expect(screen.queryByText('Your warranty questions.')).not.toBeInTheDocument();
  expect(screen.getByText('What to check in the policy').closest('details')).not.toHaveAttribute('open');
});

it('keeps a general warranty enquiry available when the stock request fails', () => {
  state.error = new Error('Unavailable');
  state.cars = [];
  render(<Warranty />);
  expect(screen.getByLabelText(/Which car are you asking about/)).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load the vehicle list');
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=warranty');
});
