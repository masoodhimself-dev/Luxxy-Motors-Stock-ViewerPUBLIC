import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ search: '?reference=PRIVATE-RES-123&token=private-token', fetch: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: state.fetch }));
vi.mock('wouter', async importOriginal => ({ ...await importOriginal<object>(), useSearch: () => state.search }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { identity: { name: 'Example Motors' } } }) }));
import ReservationPaymentReturn from './reservation-payment-return';

const reservation = { reference: 'PRIVATE-RES-123', vehicleId: 'private-vehicle', vehicleTitle: 'Ford Fiesta', vehicleRegistration: 'AB20 CDE', amountReceivedPence: 10000, depositPence: 10000, paymentStatus: 'confirmed', status: 'reserved', mode: 'live', needsReview: false };
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReservationPaymentReturn /></QueryClientProvider>);
}
beforeEach(() => {
  state.search = '?reference=PRIVATE-RES-123&token=private-token';
  state.fetch.mockReset().mockResolvedValue({ reservation });
});

it('keeps authenticated status lookup intact while showing only car and payment details', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Your car is reserved' })).toBeInTheDocument();
  expect(screen.getByText('Ford Fiesta · AB20 CDE')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('£100.00 deposit has been confirmed');
  expect(screen.queryByText(/PRIVATE-RES|Reservation reference/)).not.toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledWith('/api/reservations/payment-status', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reference: 'PRIVATE-RES-123', token: 'private-token' }), referrerPolicy: 'no-referrer' }));
  expect(screen.getByRole('link', { name: 'View your car' })).toHaveAttribute('href', '/vehicle/private-vehicle');
});

it('explains a failed check without echoing an internal reference or inviting another payment', async () => {
  state.fetch.mockRejectedValue(new Error('PRIVATE-RES-123 status unavailable'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Please contact us with your name and car details.');
  expect(screen.getByRole('alert')).toHaveTextContent('Please don’t pay again');
  expect(screen.queryByText(/PRIVATE-RES/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
});

it('does not request an incomplete link and asks for customer and car details', () => {
  state.search = '?reference=PRIVATE-RES-123';
  mount();
  expect(screen.getByRole('alert')).toHaveTextContent('Contact us with your name and car details');
  expect(screen.queryByText(/PRIVATE-RES/)).not.toBeInTheDocument();
  expect(state.fetch).not.toHaveBeenCalled();
});
