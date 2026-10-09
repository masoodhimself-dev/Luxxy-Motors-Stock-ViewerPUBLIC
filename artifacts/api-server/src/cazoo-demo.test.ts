import { GetStockResponse, GetVehicleResponse } from "@workspace/api-zod";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCazooDemoApp } from './cazoo-demo-server';
test('separate Cazoo demo displays real fixture facts and rejects all mutations and private APIs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cazoo-public-'));
  await writeFile(join(directory, 'index.html'), '<html>CAZOO TEST</html>');
  const server = createServer(createCazooDemoApp(directory));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing test listener');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(base + '/api/stock'); const stock = GetStockResponse.parse(await response.json());
    assert.equal(stock.count, 33); assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.ok(stock.cars.every((car: any) => car.sourceExtras.descriptionOrigin === 'generated-facts'));
    const car = GetVehicleResponse.parse(await fetch(base + '/api/vehicles/' + stock.cars[0].id).then(r => r.json())); assert.equal(car.id, stock.cars[0].id);
    assert.equal((await fetch(base + '/api/vehicles/missing')).status, 404);
    const settings = await fetch(base + '/api/dealer-settings').then(r => r.json()) as { identity: { name: string }; onlineReservation: { enabled: boolean }; presentation: { reviewsEnabled: boolean }; contact: { phone: string } };
    assert.equal(settings.identity.name, 'Cazoo stock demo'); assert.equal(settings.onlineReservation.enabled, false); assert.equal(settings.presentation.reviewsEnabled, false); assert.equal(settings.contact.phone, '');
    for (const path of ['/api/stock/imports/grok','/api/enquiries','/api/reservations','/api/dealer-integrations','/api/sale-workspace']) {
      assert.equal((await fetch(base + path, { method: 'POST', body: '{"test":true}' })).status, 405);
      assert.equal((await fetch(base + path)).status, 404);
    }
    assert.equal((await fetch(base + '/stock')).status, 200);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
