import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PaymentRequestPage, { type PublicPaymentRequest } from './payment-request';

const state = vi.hoisted(() => ({ token: 'a'.repeat(64), fetch: vi.fn() }));
vi.mock('wouter', () => ({ useRoute: () => [true, { token: state.token }] }));
const fixture = (): PublicPaymentRequest => ({ reference: 'PAY-1042', saleReference: 'SALE-1042', kind: 'deposit', amountPence: 50000, amountDuePence: 50000, balancePence: 1000000, dueDate: '2026-11-08', note: 'Agreed deposit', customer: 'Jamie Patel', vehicle: 'Ford Focus', registration: 'AB20XYZ', dealer: { name: 'Fictional Motors', phone: '02000000000', email: 'sales@example.test' }, paymentInstructions: 'Bank: Example Bank\nAccount name: Fictional Motors', invoiceAvailable: false });
beforeEach(() => { state.token = 'a'.repeat(64); state.fetch.mockReset().mockResolvedValue(Response.json(fixture())); vi.stubGlobal('fetch', state.fetch); });
afterEach(() => vi.unstubAllGlobals());
const posts = () => state.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');

it('loads a private request without credentials or automatic writes and shows its real amount', async () => {
  render(<PaymentRequestPage />);
  expect(await screen.findByRole('heading', { name: '£500.00 to pay' })).toBeVisible();
  expect(screen.getByText('Ford Focus')).toBeVisible();
  expect(screen.getByText('Bank: Example Bank Account name: Fictional Motors')).toBeVisible();
  expect(state.fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  expect(posts()).toHaveLength(0);
});

it('reports a customer payment only after confirmation and never treats it as received money', async () => {
  state.fetch.mockImplementation(async (_url, options) => Response.json(options?.method === 'POST' ? { recorded: true } : fixture()));
  render(<PaymentRequestPage />); await screen.findByRole('heading', { name: '£500.00 to pay' });
  fireEvent.click(screen.getByRole('button', { name: 'I have sent the payment' }));
  expect(posts()).toHaveLength(0);
  expect(screen.getByText('This tells the dealership to check for it. It does not make a payment or confirm a receipt.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, tell the dealership' }));
  await screen.findByRole('status');
  expect(posts()).toHaveLength(1); expect(posts()[0][0]).toMatch(/\/report-payment$/);
  expect(JSON.parse(posts()[0][1].body)).toEqual({ confirm: true });
  expect(screen.getByRole('heading', { name: '£500.00 to pay' })).toBeVisible();
  expect(screen.getByText(/They still need to check the funds/)).toBeVisible();
});

it('does not claim success when a payment report fails', async () => {
  state.fetch.mockImplementation(async (_url, options) => options?.method === 'POST' ? Response.json({ error: 'Connection lost. Try again.' }, { status: 503 }) : Response.json(fixture()));
  render(<PaymentRequestPage />); await screen.findByRole('heading', { name: '£500.00 to pay' });
  fireEvent.click(screen.getByRole('button', { name: 'I have sent the payment' })); fireEvent.click(screen.getByRole('button', { name: 'Yes, tell the dealership' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
  expect(screen.queryByText(/You have told the dealership/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Yes, tell the dealership' })).toBeEnabled();
});

it('records an invoice request without pretending the invoice has been issued', async () => {
  state.fetch.mockImplementation(async (_url, options) => Response.json(options?.method === 'POST' ? { recorded: true } : fixture()));
  render(<PaymentRequestPage />); await screen.findByRole('heading', { name: '£500.00 to pay' });
  fireEvent.click(screen.getByRole('button', { name: 'Request my invoice' }));
  expect(await screen.findByRole('status')).toHaveTextContent('invoice request has been saved');
  expect(posts()[0][0]).toMatch(/\/request-invoice$/);
  expect(screen.queryByRole('link', { name: 'Download invoice' })).not.toBeInTheDocument();
});

it('offers an issued invoice as a download without an extra write', async () => {
  state.fetch.mockResolvedValue(Response.json({ ...fixture(), invoiceAvailable: true }));
  render(<PaymentRequestPage />); await screen.findByRole('heading', { name: '£500.00 to pay' });
  expect(screen.getByRole('link', { name: 'Download invoice' })).toHaveAttribute('href', `/api/payment-requests/${state.token}/invoice`);
  expect(screen.queryByRole('button', { name: 'Request my invoice' })).not.toBeInTheDocument(); expect(posts()).toHaveLength(0);
});

it('shows an expired-link response without exposing saved customer details', async () => {
  state.fetch.mockResolvedValue(Response.json({ error: 'This payment request has expired or changed.' }, { status: 410 }));
  render(<PaymentRequestPage />); expect(await screen.findByRole('alert')).toHaveTextContent('expired or changed');
  expect(screen.queryByText('Jamie Patel')).not.toBeInTheDocument(); expect(screen.queryByText('Ford Focus')).not.toBeInTheDocument(); expect(posts()).toHaveLength(0);
});

it('rejects an incomplete token before making any API request', async () => {
  state.token = 'invalid'; render(<PaymentRequestPage />); expect(await screen.findByRole('alert')).toHaveTextContent('incomplete'); expect(state.fetch).not.toHaveBeenCalled();
});

it('does not let a late response reveal the previous token’s customer', async () => {
  let finish!: (response: Response) => void;
  state.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(Response.json({ error: 'Link unavailable.' }, { status: 410 }));
  const view = render(<PaymentRequestPage />); state.token = 'b'.repeat(64); view.rerender(<PaymentRequestPage />);
  await screen.findByRole('alert'); await act(async () => { finish(Response.json(fixture())); });
  expect(screen.queryByText('Jamie Patel')).not.toBeInTheDocument(); expect(screen.queryByText('Ford Focus')).not.toBeInTheDocument();
});
