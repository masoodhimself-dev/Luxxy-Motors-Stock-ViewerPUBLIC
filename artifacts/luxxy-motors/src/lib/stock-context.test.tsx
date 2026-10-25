import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Router } from 'wouter';
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
  return <><div data-testid="price">{stock?.cars[0]?.price ?? (stock ? 'unavailable' : 'loading')}</div><div>{error}</div><Link href="/stock">Customer stock</Link><Link href="/portal">Staff portal</Link><Link href="/vehicle/one">Vehicle</Link></>;
}
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(5); }); }
beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/stock');
  hidden = false; online = true;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function mount(path = '/stock') {
  window.history.replaceState(null, '', path);
  render(<QueryClientProvider client={client}><Router><StockProvider><CurrentStock /></StockProvider></Router></QueryClientProvider>);
}

it('does not poll customer stock and still applies invalidated prices and availability immediately', async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(json(catalogue(9000), '"v1"'))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(json(catalogue(8500), '"v2"'))
    .mockResolvedValueOnce(json(catalogue(8500, 0), '"v3"'));
  vi.stubGlobal('fetch', request); mount(); await settle();
  expect(screen.getByTestId('price')).toHaveTextContent('9000');
  await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 60_000); }); await settle();
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => { await client.invalidateQueries({ queryKey: getGetStockQueryKey() }); }); await settle();
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

it('reuses fresh customer stock on a short return and checks an older copy on desktop focus', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => json(catalogue(9000), '"v1"'));
  vi.stubGlobal('fetch', request); mount(); await settle();
  hidden = true; act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
  hidden = false; act(() => document.dispatchEvent(new Event('visibilitychange'))); await settle();
  act(() => window.dispatchEvent(new Event('focus'))); await settle();
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000); });
  expect(request).toHaveBeenCalledTimes(1);
  act(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); }); await settle();
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][1]?.headers).toMatchObject({ 'If-None-Match': '"v1"' });
  act(() => window.dispatchEvent(new Event('focus'))); await settle();
  expect(request).toHaveBeenCalledTimes(2);
});

it('keeps customer navigation cached and stops the portal timer on leaving the portal', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => json(catalogue(9000), '"v1"'));
  vi.stubGlobal('fetch', request); mount('/portal/leads/example'); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); }); await settle();
  expect(request).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('link', { name: 'Customer stock' })); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
  expect(request).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('link', { name: 'Vehicle' })); await settle();
  expect(request).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('link', { name: 'Staff portal' })); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); }); await settle();
  expect(request).toHaveBeenCalledTimes(3);
});

it('reuses fresh customer stock after a short connection interruption', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => json(catalogue(9000), '"v1"'));
  vi.stubGlobal('fetch', request); mount(); await settle();
  online = false; act(() => window.dispatchEvent(new Event('offline')));
  await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
  online = true; act(() => window.dispatchEvent(new Event('online'))); await settle();
  expect(request).toHaveBeenCalledTimes(1);
});
