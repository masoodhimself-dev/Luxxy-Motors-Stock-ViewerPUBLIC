import type { Stock } from '@workspace/api-client-react';

/** Each mounted stock provider owns its validator; no persistent or shared dealer cache. */
export function createStockLoader(request: typeof fetch = (...args) => fetch(...args)) {
  let saved: { etag: string; stock: Stock } | undefined;

  return async function loadStock(signal?: AbortSignal): Promise<Stock> {
    const read = (etag?: string) => request('/api/stock', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { Accept: 'application/json', ...(etag ? { 'If-None-Match': etag } : {}) },
    });
    let response = await read(saved?.etag);
    if (response.status === 304) {
      if (saved) return saved.stock;
      // Recover safely if an intermediary returns 304 before this page has any data.
      response = await read();
    }
    if (!response.ok) throw new Error('Unable to load current stock. Please try again.');
    const stock = await response.json() as Stock;
    if (!stock || stock.schemaVersion !== 1 || !Array.isArray(stock.cars)) {
      throw new Error('Unable to load current stock. Please try again.');
    }
    const etag = response.headers.get('ETag');
    saved = etag ? { etag, stock } : undefined;
    return stock;
  };
}
