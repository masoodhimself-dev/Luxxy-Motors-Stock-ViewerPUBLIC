import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { saleCalculationSnapshot, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { customFetch } from '@workspace/api-client-react';
import { CalculationCheck, useSaleCalculationCheck } from './calculation-check';
vi.mock('@workspace/api-client-react', () => ({ customFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const sale = (): SaleWorkspaceRecord => ({ id: 'sale-id', revision: 2, draft: { price: '8000', deliveryCharge: '150', partExchange: false, exchanges: [], adjustments: [], notes: 'Private note', customer: 'Private customer' }, payments: [{ id: 'payment', amount: '200', amountPence: 20000, signedAmountPence: 20000, status: 'confirmed', kind: 'deposit' }] }) as unknown as SaleWorkspaceRecord;
const answer = (record = sale()) => ({ status: 'checked' as const, message: 'The total and balance add up.', financialKey: 'server-hash', totals: saleCalculationSnapshot(record).totals, checkedAt: '2026-11-04T12:00:00Z', cached: false });
it('does nothing while editing; Preview sends only amounts and reuses unchanged figures', async () => {
  vi.mocked(customFetch).mockResolvedValue(answer());
  const hook = renderHook(() => useSaleCalculationCheck());
  hook.rerender(); expect(customFetch).not.toHaveBeenCalled();
  const original = sale();
  await act(async () => { await hook.result.current.check(original); });
  expect(customFetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(String(vi.mocked(customFetch).mock.calls[0][1]?.body));
  expect(body).toEqual({ expectedRevision: 2, figures: { price: '8000', allowances: [], adjustments: [], deliveryCharge: '150' } });
  expect(JSON.stringify(body)).not.toContain('Private');
  await act(async () => { await hook.result.current.check({ ...original, revision: 3, draft: { ...original.draft, notes: 'Changed note' } }); });
  expect(customFetch).toHaveBeenCalledTimes(1); expect(hook.result.current.result?.cached).toBe(true);
  await act(async () => { await hook.result.current.check(original, { ...original.draft, price: '8001' }); });
  expect(customFetch).toHaveBeenCalledTimes(2);
});
it('test checks stay local and use the actual arithmetic', async () => {
  const hook = renderHook(() => useSaleCalculationCheck());
  await act(async () => { await hook.result.current.check(sale(), undefined, { testOnly: true }); });
  expect(customFetch).not.toHaveBeenCalled(); expect(hook.result.current.result?.totals.balance).toBe(795000);
  expect(hook.result.current.busy).toBe(false);
});
it('an unavailable model leaves an informational message and no approval or override button', async () => {
  vi.mocked(customFetch).mockRejectedValue(new Error('Offline'));
  const hook = renderHook(() => useSaleCalculationCheck());
  await act(async () => { await hook.result.current.check(sale()); });
  render(<CalculationCheck result={hook.result.current.result} busy={hook.result.current.busy} />);
  expect(screen.getByRole('status')).toHaveTextContent('You can continue.');
  expect(screen.queryByRole('button')).not.toBeInTheDocument(); expect(hook.result.current.result?.status).toBe('unavailable');
});
it('reset discards a late result and does not trigger another call', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(customFetch).mockImplementation(() => new Promise(done => { resolve = done; }));
  const hook = renderHook(() => useSaleCalculationCheck());
  let request!: Promise<unknown>;
  act(() => { request = hook.result.current.check(sale()); });
  expect(hook.result.current.busy).toBe(true);
  act(() => hook.result.current.reset());
  await act(async () => { resolve(answer()); await request; });
  expect(hook.result.current.result).toBeNull(); expect(hook.result.current.busy).toBe(false); expect(customFetch).toHaveBeenCalledTimes(1);
});
