import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, request } from 'node:http';
import { sendConditionalStock, stockRepresentation } from './lib/stock-http-cache';

const fixture = () => ({ schemaVersion: 1, scrapedAt: '2026-10-25T08:00:00.000Z', count: 1, cars: [{ id: 'car-1', price: 12500, inventoryStatus: 'available', images: [{ url: 'https://images.example.test/front.jpg', caption: 'Front' }], sourceExtras: { description: 'Original description', equipment: ['Cruise control'] } }] });

test('the complete public response gets a deterministic, dealer/source-scoped strong validator', () => {
  const body = fixture();
  const first = stockRepresentation('dealer-a', 'autotrader', body);
  assert.match(first.etag, /^"stock-v1-[a-f0-9]{64}"$/);
  assert.deepEqual(JSON.parse(first.json), body);
  assert.equal(first.etag, stockRepresentation('dealer-a', 'autotrader', { cars: body.cars, count: 1, scrapedAt: body.scrapedAt, schemaVersion: 1 }).etag);
  assert.notEqual(first.etag, stockRepresentation('dealer-b', 'autotrader', body).etag);
  assert.notEqual(first.etag, stockRepresentation('dealer-a', 'cazoo', body).etag);
  const edits: ((copy: ReturnType<typeof fixture>) => void)[] = [
    copy => { copy.cars[0]!.price = 12000; },
    copy => { copy.cars[0]!.inventoryStatus = 'reserved'; },
    copy => { copy.cars[0]!.images[0]!.url = 'https://images.example.test/new.jpg'; },
    copy => { copy.cars[0]!.sourceExtras.description = 'Staff-reviewed description'; },
    copy => { copy.cars[0]!.sourceExtras.equipment.push('Navigation'); },
    copy => { copy.scrapedAt = '2026-10-25T20:00:00.000Z'; },
    copy => { copy.cars = []; copy.count = 0; },
  ];
  for (const edit of edits) {
    const changed = structuredClone(body); edit(changed);
    assert.notEqual(first.etag, stockRepresentation('dealer-a', 'autotrader', changed).etag);
  }
});

test('HTTP stock revalidation returns no body only for the matching representation and keeps demo privacy headers', async () => {
  let body = fixture();
  const app = express();
  app.get('/:dealer/:source/stock', (req, res) => {
    if (req.params.dealer === 'demo') res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer' });
    sendConditionalStock(req, res, { dealerId: req.params.dealer!, source: req.params.source! }, body);
  });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const get = (path = '/dealer-a/autotrader/stock', etag?: string) => new Promise<{ status: number; headers: Record<string, unknown>; text: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: address.port, path, headers: etag ? { 'If-None-Match': etag } : {} }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }));
    });
    req.on('error', reject); req.end();
  });
  try {
    const initial = await get();
    assert.equal(initial.status, 200); assert.deepEqual(JSON.parse(initial.text), body);
    assert.equal(initial.headers['cache-control'], 'private, no-cache');
    const tag = String(initial.headers.etag);
    const repeat = await get(undefined, tag);
    assert.equal(repeat.status, 304); assert.equal(repeat.text, ''); assert.equal(repeat.headers.etag, tag);
    assert.equal((await get(undefined, `"older", W/${tag}`)).status, 304);
    assert.equal((await get('/dealer-b/autotrader/stock', tag)).status, 200);
    assert.equal((await get('/dealer-a/cazoo/stock', tag)).status, 200);
    body = fixture(); body.cars[0]!.price -= 500;
    const price = await get(undefined, tag);
    assert.equal(price.status, 200); assert.notEqual(price.headers.etag, tag); assert.equal(JSON.parse(price.text).cars[0].price, 12000);
    body.cars[0]!.inventoryStatus = 'reserved';
    const reserved = await get(undefined, String(price.headers.etag)); assert.equal(reserved.status, 200);
    body.cars = []; body.count = 0;
    assert.equal((await get(undefined, String(reserved.headers.etag))).status, 200);
    const demo = await get('/demo/cazoo/stock');
    for (const response of [demo, await get('/demo/cazoo/stock', String(demo.headers.etag))]) {
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => resolve()); }); }
});
