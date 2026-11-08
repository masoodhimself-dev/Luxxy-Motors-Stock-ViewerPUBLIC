import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { dailySalePaymentsOptions, dailySalePaymentsResult, type DailySalePaymentRow } from '@workspace/vehicle-meta';
import { DailyPayments } from './daily-payments';

const fetchDaily = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({ customFetch: fetchDaily }));

it('shows pending money separately and keeps day totals while paging through the ledger', async () => {
  const base = { saleId: 'sale-one', saleReference: 'SALE-101', vehicle: 'Fixture Focus', registration: 'AB20 XYZ', method: 'Bank transfer' };
  const confirmed: DailySalePaymentRow = { ...base, id: 'paid', kind: 'deposit', reference: 'BANK-01', amountPence: 50000 };
  const pending: DailySalePaymentRow = { ...base, id: 'pending', kind: 'part-payment', reference: 'BANK-02', amountPence: 20000 };
  fetchDaily.mockImplementation(async path => {
    const params = new URL(path, 'https://fixture.test').searchParams;
    const options = dailySalePaymentsOptions(params.get('date'), params.get('confirmedOffset'), params.get('pendingOffset'));
    return dailySalePaymentsResult(options, [options.confirmedOffset ? { ...confirmed, reference: 'BANK-26' } : confirmed], [pending], [
      { status: 'confirmed', method: confirmed.method, kind: 'deposit', amountPence: 50000, count: 26 },
      { status: 'pending', method: pending.method, kind: 'part-payment', amountPence: 20000, count: 1 },
    ]);
  });
  const onOpenSale = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DailyPayments onBack={vi.fn()} onOpenSale={onOpenSale}/></QueryClientProvider>);
  const recorded = await screen.findByRole('table', { name: 'Confirmed payments and refunds' });
  const awaiting = screen.getByRole('table', { name: 'Awaiting confirmation' });
  expect(within(recorded).getByText('Payment ref. BANK-01')).toBeInTheDocument();
  expect(within(awaiting).getByText('Payment ref. BANK-02')).toBeInTheDocument();
  fireEvent.click(within(recorded).getByRole('button', { name: 'SALE-101' }));
  expect(onOpenSale).toHaveBeenCalledWith('sale-one');
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Confirmed payments and refunds pages' })).getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Payment ref. BANK-26')).toBeInTheDocument();
  expect(within(awaiting).getByText('Payment ref. BANK-02')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-11-01' } });
  expect(await screen.findByText('Payment ref. BANK-01')).toBeInTheDocument();
  expect(fetchDaily.mock.calls.at(-1)?.[0]).toContain('date=2026-11-01&confirmedOffset=0&pendingOffset=0');
});
