import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReservationsPanel } from './reservations-panel';

const reservation = {
  id: 'reservation-1', reference: 'LM-RES-0001', vehicleId: 'vehicle-1',
  vehicleTitle: '2021 BMW 3 Series', depositPence: 10000, amountReceivedPence: 0,
  vehicleRegistration: 'AB21 CDE' as string | undefined,
  paymentStatus: 'simulated', status: 'reserved', createdAt: '2026-09-23T10:00:00.000Z',
  customerName: 'Alex Smith', email: 'alex@example.test', phone: '07700900123', leadId: 'lead-1',
};
let current = { ...reservation };
let cancelFailure = false;
let loadFailure = false;
let request: ReturnType<typeof vi.fn>;
let cache: QueryClient;

beforeEach(() => {
  current = { ...reservation };
  cancelFailure = false;
  loadFailure = false;
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  request = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input);
    if (path === '/api/reservations' && options?.method === 'GET') {
      return Response.json(loadFailure ? { error: 'Unavailable' } : { reservations: [current] }, { status: loadFailure ? 503 : 200 });
    }
    if (path === '/api/reservations/reservation-1/cancel' && options?.method === 'POST') {
      if (cancelFailure) return Response.json({ error: 'This reservation cannot be released while the deal is being completed.' }, { status: 409 });
      current = { ...current, status: 'cancelled' };
      return Response.json(current);
    }
    throw new Error(`Unexpected request: ${options?.method} ${path}`);
  });
  vi.stubGlobal('fetch', request);
});

afterEach(() => { cache.clear(); vi.unstubAllGlobals(); });

function renderPanel() {
  render(<QueryClientProvider client={cache}><ReservationsPanel /></QueryClientProvider>);
}

it('separates the expected deposit from money received without linking to the retired lead portal', async () => {
  renderPanel();
  const row = await screen.findByTestId('staff-reservation-reservation-1');
  expect(within(row).getByText('Payment simulated · £0 received')).toBeInTheDocument();
  expect(within(row).getByText('£100')).toBeInTheDocument();
  expect(within(row).getByText('LM-RES-0001')).toBeInTheDocument();
  expect(within(row).getByText('AB21 CDE')).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Open lead' })).not.toBeInTheDocument();
});

it('leaves older reservations without a registration snapshot free of placeholders', async () => {
  current.vehicleRegistration = undefined;
  renderPanel();
  const row = await screen.findByTestId('staff-reservation-reservation-1');
  expect(within(row).queryByText('AB21 CDE')).not.toBeInTheDocument();
  expect(row).not.toHaveTextContent(/Not supplied|Registration unavailable/);
});

it('requires confirmation, releases the reservation, and refreshes stock and lead records', async () => {
  const invalidate = vi.spyOn(cache, 'invalidateQueries');
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel reservation' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(/there is no payment to refund/)).toBeInTheDocument();
  expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep reservation' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel and release car' }));
  await screen.findByText('No reservations to show');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/stock'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/leads/lead-1'] });
  fireEvent.change(screen.getByLabelText('Reservation status'), { target: { value: 'cancelled' } });
  expect(screen.getByTestId('staff-reservation-reservation-1')).toHaveTextContent('Cancelled');
  expect(screen.queryByRole('button', { name: 'Cancel reservation' })).not.toBeInTheDocument();
});

it('keeps an unsuccessful cancellation visible and leaves the car reserved', async () => {
  cancelFailure = true;
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel reservation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel and release car' }));
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent('This reservation cannot be released while the deal is being completed.');
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(current.status).toBe('reserved');
});

it('allows a failed list request to be retried without a page reload', async () => {
  loadFailure = true;
  renderPanel();
  expect(await screen.findByRole('alert')).toHaveTextContent('Reservations could not be loaded.');
  loadFailure = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByTestId('staff-reservation-reservation-1')).toHaveTextContent('Alex Smith');
});
