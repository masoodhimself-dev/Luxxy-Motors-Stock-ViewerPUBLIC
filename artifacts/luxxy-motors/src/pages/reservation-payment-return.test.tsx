import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ReservationPaymentReturn from './reservation-payment-return';

const reference = 'RSV-ABCDEF123456';
const token = 'a'.repeat(64);
const record = {
  reference, vehicleId: 'car-1', vehicleTitle: 'Lexus RX', vehicleRegistration: 'AB20 XYZ',
  depositPence: 9900, amountReceivedPence: 0, amountRefundedPence: 0, needsReview: false,
  status: 'awaiting_payment', paymentStatus: 'pending', mode: 'live',
};

beforeEach(() => window.history.replaceState({}, '', `/reservation-payment#reference=${reference}&token=${token}`));
afterEach(() => vi.unstubAllGlobals());

it('checks the capability privately and waits for a confirmed payment', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ reservation: record }));
  vi.stubGlobal('fetch', fetchMock);
  render(<ReservationPaymentReturn />);
  expect(await screen.findByRole('heading', { name: 'Payment confirmation pending' })).toBeVisible();
  expect(screen.queryByText(/deposit has been confirmed/)).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/reservations/payment-status', expect.objectContaining({
    credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    method: 'POST', body: JSON.stringify({ reference, token }),
  }));
  expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});

it('shows the car is reserved when a verified live deposit covers the quoted amount', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
    reservation: { ...record, amountReceivedPence: 9900, paymentStatus: 'confirmed', status: 'reserved' },
  })));
  render(<ReservationPaymentReturn />);
  expect(await screen.findByRole('heading', { name: 'Your car is reserved' })).toBeVisible();
  expect(screen.getByText(/£99.00 deposit has been confirmed/)).toBeVisible();
});

it('distinguishes a completed full refund from a reserved car', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
    reservation: { ...record, amountReceivedPence: 9900, amountRefundedPence: 9900, paymentStatus: 'refunded', status: 'refunded' },
  })));
  render(<ReservationPaymentReturn />);
  expect(await screen.findByRole('heading', { name: 'Your deposit was refunded' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Your car is reserved' })).not.toBeInTheDocument();
});
