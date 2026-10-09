import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from './test/fixtures/cazoo-stock.json';
import { ImportGrokStockBody } from '@workspace/api-zod';
import { factualStockDescription, stockDescriptionExtras } from '@workspace/vehicle-meta';
import { stockPlatformIssues, stockConnectionNeedsMigration } from './lib/stock-platform';
import { isPlatformAdmin } from './lib/platform-admin';
import { DealerIntegrationsStore } from './lib/dealer-integrations-store';
import { assertReservableVehicle, type OnlineReservationInput } from './lib/online-reservations';
import { permittedBrochureImage } from './lib/vehicle-brochure-images';

test('Cazoo snapshot uses the existing exact schema and matching platform', () => {
  const data = ImportGrokStockBody.parse(fixture);
  assert.equal(data.cars.length, data.count);
  assert.deepEqual(stockPlatformIssues(data.cars, 'cazoo'), []);
  assert.ok(stockPlatformIssues(data.cars, 'autotrader').length);
  assert.ok(stockPlatformIssues([{ ...data.cars[0], advertUrl: 'https://cazoo.co.uk.evil.invalid/car', sourceExtras: null }], 'cazoo').length);
});
test('factual description includes supplied facts, omits absent history and never invents claims', () => {
  const car = fixture.cars[0]; const extras = stockDescriptionExtras(car);
  assert.equal(extras.descriptionOrigin, 'generated-facts');
  assert.equal(extras.description, '2010 Lexus IS — 250 FSport 4dr Auto. Recorded mileage: 47,000 miles. Fuel: Petrol. Transmission: Automatic. Priced at £8,995.');
  assert.ok(!/condition|history|owners|accident|available|warranty/i.test(String(extras.description)));
  assert.equal(factualStockDescription({}), null);
  assert.equal(factualStockDescription({ title: 'Lexus IS', mileage: 0 }), 'Lexus IS. Recorded mileage: 0 miles.');
});
test('original description wins and generated price follows effective facts', () => {
  assert.equal(stockDescriptionExtras({ ...fixture.cars[0], sourceExtras: { description: 'Original dealer text' } }).description, 'Original dealer text');
  assert.equal(stockDescriptionExtras({ ...fixture.cars[0], sourceExtras: { advertDescription: 'Original alias' } }).description, undefined);
  const previous = stockDescriptionExtras(fixture.cars[0]);
  const updated = stockDescriptionExtras({ ...fixture.cars[0], price: 7995, sourceExtras: previous });
  assert.ok(String(updated.description).includes('£7,995')); assert.ok(!String(updated.description).includes('£8,995'));
  const restored = stockDescriptionExtras({ ...fixture.cars[0], sourceExtras: { ...previous, advertDescription: 'Real description now supplied' } });
  assert.equal(restored.advertDescription, 'Real description now supplied'); assert.equal(restored.descriptionOrigin, undefined);
});
test('platform administrator is explicit, owners and machine tokens are not implicit admins', () => {
  assert.equal(isPlatformAdmin('user_operator', 'user_operator,user_other'), true);
  assert.equal(isPlatformAdmin('user_dealer_owner', 'user_operator'), false);
  assert.equal(isPlatformAdmin('machine', 'machine'), false);
  assert.equal(isPlatformAdmin('user_operator', ''), false);
});
test('private stock settings persist, revisions protect changes and unsupported hosts are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stock-feed-'));
  const store = new DealerIntegrationsStore({ filename: join(dir, 'private.json'), production: true, encryptionKey: Buffer.alloc(32, 7).toString('base64') });
  try {
    const connection = { platform: 'cazoo', retailerId: 'cazoo-example', sourceUrl: 'https://www.cazoo.co.uk/dealers/example/', enabled: true };
    const first = await store.updateStockConnection({ expectedRevision: 0, connection });
    assert.equal(first.revision, 1); assert.deepEqual((await store.readStockConnection()).connection, connection);
    await assert.rejects(store.updateStockConnection({ expectedRevision: 0, connection }), /Reload/);
    await assert.rejects(store.updateStockConnection({ expectedRevision: 1, connection: { ...connection, sourceUrl: 'https://www.autotrader.co.uk/dealers/example/' } }), /selected marketplace/);
    await assert.rejects(store.updateStockConnection({ expectedRevision: 1, connection: { ...connection, sourceUrl: 'https://secret@www.cazoo.co.uk/dealers/example/' } }), /selected marketplace/);
    const paused = await store.updateStockConnection({ expectedRevision: 1, connection: { ...connection, enabled: false } });
    assert.equal(paused.connection.enabled, false); assert.equal((await store.readMasked() as Record<string, unknown>).stockConnection, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Cazoo reservation rules retain availability, price and owner safeguards', () => {
  const vehicle = { id: 'vehicle-test', dealerId: 'dealer-test', source: 'cazoo', inventoryStatus: 'available', sourceStatus: 'live', missingCount: 0, currency: 'GBP', sourcePrice: 8995, websitePriceOverride: null, title: 'Lexus IS' };
  const input = { vehicleId: vehicle.id, expectedPricePence: 899500, expectedDepositPence: 20000, terms: 'Approved terms', termsAccepted: true } as OnlineReservationInput;
  const settings = { enabled: true, depositPence: 20000, terms: 'Approved terms' };
  assert.doesNotThrow(() => assertReservableVehicle(vehicle, input, settings, { dealerId: 'dealer-test', stockPlatform: 'cazoo' }));
  assert.throws(() => assertReservableVehicle(vehicle, input, settings, { dealerId: 'other-dealer', stockPlatform: 'cazoo' }), /no longer/);
  assert.throws(() => assertReservableVehicle({ ...vehicle, inventoryStatus: 'sold' }, input, settings, { dealerId: 'dealer-test', stockPlatform: 'cazoo' }), /no longer/);
  assert.throws(() => assertReservableVehicle(vehicle, input, settings, { dealerId: 'dealer-test' }), /no longer/);
});
test('Cazoo image CDN is permitted for PDFs without relaxing private-address protections', () => {
  assert.ok(permittedBrochureImage('https://cdn.images.autoexposure.co.uk/example/car.jpg'));
  assert.equal(permittedBrochureImage('http://cdn.images.autoexposure.co.uk/example/car.jpg'), null);
  assert.equal(permittedBrochureImage('https://cdn.images.autoexposure.co.uk.evil.invalid/car.jpg'), null);
  assert.equal(permittedBrochureImage('https://127.0.0.1/car.jpg'), null);
});

test('stock source switching requires migration only when existing records would be abandoned', () => {
  const prior = { platform: 'autotrader', retailerId: 'example-auto' };
  assert.equal(stockConnectionNeedsMigration(prior, { platform: 'cazoo', retailerId: 'cazoo-example' }, true), true);
  assert.equal(stockConnectionNeedsMigration(prior, { ...prior, retailerId: 'different-dealer' }, true), true);
  assert.equal(stockConnectionNeedsMigration(prior, prior, true), false);
  assert.equal(stockConnectionNeedsMigration(prior, { platform: 'cazoo', retailerId: 'cazoo-example' }, false), false);
});
