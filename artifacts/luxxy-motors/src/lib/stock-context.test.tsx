import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getGetStockQueryKey } from '@workspace/api-client-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StockProvider, useStock } from './stock-context';

let client: QueryClient;
let hidden = false;
let online = true;
const catalogue = (price: number, count = 1) => ({ schemaVersion: 1, dealerName: 'Example Motors', dealerLocation: null, count, scrapedAt: null, cars: count ? [{ id: 'one', title: 'Example car', price }] : [] });
const json = (value: unknown, etag: string) => new Response(JSON.stringify(value), { headers: { ETag: etag } });
function CurrentStock() {
  const { stock, error } = useStock();
  return <><div data-testid="price">{stock?.cars[0]?.price ?? (stock ? 'unavailable' : 'loading')}</div><div>{error}</div></>;
}
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(5); }); }
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false; online = true;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function mount() { render(<QueryClientProvider client={client}><StockProvider><CurrentStock /></StockProvider></QueryClientProvider>); }

it('quietly validates unchanged stock but immediately applies changed prices and availability', async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(json(catalogue(9000), '"v1"'))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(json(catalogue(8500), '"v2"'))
    .mockResolvedValueOnce(json(catalogue(8500, 0), '"v3"'));
  vi.stubGlobal('fetch', request); mount(); await settle();
  expect(screen.getByTestId('price')).toHaveTextContent('9000');
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); await settle();
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000); }); await settle();
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][1]?.headers).toMatchObject({ 'If-None-Match': '"v1"' });
  expect(screen.getByTestId('price')).toHaveTextContent('9000');
  await act(async () => { await client.invalidateQueries({ queryKey: getGetStockQueryKey() }); }); await settle();
  expect(screen.getByTestId('price')).toHaveTextContent('8500');
  await act(async () => { await client.invalidateQueries({ queryKey: getGetStockQueryKey() }); }); await settle();
  expect(screen.getByTestId('price')).toHaveTextContent('unavailable');
});

it('pauses hidden/offline stock refreshes and revalidates when the page returns', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => json(catalogue(9000), '"v1"'));
  vi.stubGlobal('fetch', request); mount(); await settle();
  expect(request).toHaveBeenCalledTimes(1);
  hidden = true; act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(request).toHaveBeenCalledTimes(1);
  hidden = false; act(() => document.dispatchEvent(new Event('visibilitychange'))); await settle();
  expect(request).toHaveBeenCalledTimes(2);
  online = false; act(() => window.dispatchEvent(new Event('offline')));
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(request).toHaveBeenCalledTimes(2);
  online = true; act(() => window.dispatchEvent(new Event('online'))); await settle();
  expect(request).toHaveBeenCalledTimes(3);
});
