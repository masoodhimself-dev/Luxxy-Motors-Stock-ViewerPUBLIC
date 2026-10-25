import { expect, it, vi } from 'vitest';
import { createStockLoader } from './stock-refresh';

const stock = (price = 9000) => ({ schemaVersion: 1, dealerName: 'Example Motors', dealerLocation: null, count: 1, scrapedAt: '2026-10-25T10:00:00Z', cars: [{ id: 'car-1', price }] });
const reply = (value: unknown, etag?: string) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json', ...(etag ? { ETag: etag } : {}) } });

it('keeps unchanged catalogue data in memory and does not read a 304 response body', async () => {
  const unchanged = new Response(null, { status: 304, headers: { ETag: '"dealer-a-v1"' } });
  const json = vi.spyOn(unchanged, 'json');
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(stock(), '"dealer-a-v1"')).mockResolvedValueOnce(unchanged).mockResolvedValueOnce(reply(stock(8500), '"dealer-a-v2"'));
  const load = createStockLoader(request);
  const first = await load();
  expect(request.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  expect((request.mock.calls[0][1]?.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
  expect(await load()).toBe(first);
  expect(request.mock.calls[1][1]?.headers).toMatchObject({ 'If-None-Match': '"dealer-a-v1"' });
  expect(json).not.toHaveBeenCalled();
  expect((await load()).cars[0].price).toBe(8500);
});

it('does not share validators or stock between independent providers/dealerships', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(stock(), '"dealer-a"')).mockResolvedValueOnce(reply({ ...stock(), dealerName: 'Other Motors' }, '"dealer-b"'));
  await createStockLoader(request)();
  const other = await createStockLoader(request)();
  expect(other.dealerName).toBe('Other Motors');
  expect((request.mock.calls[1][1]?.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
});

it('does not replace the validated copy with a failed or malformed refresh', async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(reply(stock(), '"v1"'))
    .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
    .mockResolvedValueOnce(reply({ error: 'Not stock' }, '"bad"'))
    .mockResolvedValueOnce(new Response(null, { status: 304 }));
  const load = createStockLoader(request), first = await load();
  await expect(load()).rejects.toThrow('Unable to load current stock');
  await expect(load()).rejects.toThrow('Unable to load current stock');
  expect(await load()).toBe(first);
  expect(request.mock.calls[3][1]?.headers).toMatchObject({ 'If-None-Match': '"v1"' });
});

it('drops an old validator when a successful server response no longer supplies one', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(stock(), '"v1"')).mockResolvedValueOnce(reply(stock(8000))).mockResolvedValueOnce(reply(stock(7500)));
  const load = createStockLoader(request);
  await load(); await load();
  expect((await load()).cars[0].price).toBe(7500);
  expect((request.mock.calls[2][1]?.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
});

it('recovers once from an unexpected 304 without any cached data', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 304 })).mockResolvedValueOnce(reply(stock(), '"v1"'));
  expect((await createStockLoader(request)()).count).toBe(1);
  expect(request).toHaveBeenCalledTimes(2);
  expect((request.mock.calls[1][1]?.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
});

it('does not loop when an intermediary repeatedly returns an unusable 304', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 304 }));
  await expect(createStockLoader(request)()).rejects.toThrow('Unable to load current stock');
  expect(request).toHaveBeenCalledTimes(2);
});

it('passes cancellation through and does not turn a cancelled fetch into stale success', async () => {
  const controller = new AbortController();
  const request = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  await expect(createStockLoader(request)(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(request.mock.calls[0][1]?.signal).toBe(controller.signal);
});
