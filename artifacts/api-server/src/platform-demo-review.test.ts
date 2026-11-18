import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import express from 'express';
import pino from 'pino';
import platformRouter from './routes/platform-dealers';
import { newDealerSettings } from './routes/dealer-settings';
import { applyDemoDealershipDetails } from './lib/demo-business-details';
import { engine } from './test/tenant-test-db';
import type { DemoReview } from '@workspace/vehicle-meta';

test('Platform Admin reviews and corrects private demos without reading or changing live stock', async context => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';
  process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
  process.env.STOCK_MISSING_HIDE_THRESHOLD = '2';
  for (const migration of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(`../../lib/db/drizzle/${migration}`, 'utf8'));
  context.mock.method(globalThis, 'fetch', async () => { throw new Error('Review must not fetch provider or photo data'); });
  const source = 'https://www.autotrader.co.uk/dealers/london/example-123456';
  const evidence = { sourceUrl: source, checkedAt: new Date().toISOString() };
  const savedDetails = { ...evidence, phone: '020 1234 5678', about: 'The saved dealership introduction', includedItems: ['Warranty included'] };
  for (const [id, status, demoState, platform = 'autotrader'] of [
    ['demo-review-one', 'draft', 'current'], ['demo-review-two', 'active', 'current'],
    ['demo-review-expired', 'draft', 'expired'], ['demo-review-suspended', 'suspended', 'current'],
    ['demo-review-converted', 'active', 'converted'], ['live-review-one', 'active', 'none'],
    ['demo-review-cazoo', 'draft', 'current', 'cazoo'],
  ]) {
    const dealerSource = platform === 'cazoo' ? 'https://www.cazoo.co.uk/dealers/example-654321/' : source;
    await engine.query('INSERT INTO dealerships (id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES ($1,$1,$2,$3,$4,$5,$6)', [id, status, `https://${id}.example.test`, platform, platform === 'cazoo' ? 'cazoo-654321' : '123456', dealerSource]);
    await engine.query('INSERT INTO dealer_settings (dealer_id,config) VALUES ($1,$2::jsonb)', [id, JSON.stringify(applyDemoDealershipDetails(newDealerSettings(id!), savedDetails))]);
    if (demoState !== 'none') await engine.query('INSERT INTO dealer_demos (dealer_id,recipient,expires_at,updated_by,business_details,converted_at) VALUES ($1,\'\',$2,\'fixture\',$3::jsonb,$4)', [id, new Date(Date.now() + (demoState === 'expired' ? -3600000 : 3600000)).toISOString(), JSON.stringify({ dealershipDetails: { ...savedDetails, sourceUrl: dealerSource } }), demoState === 'converted' ? new Date().toISOString() : null]);
  }
  const car = { make: 'Toyota', model: 'Yaris', year: 2024, mileage: 0, fuel: 'Petrol', transmission: 'Automatic', plate: 'AB24CDE', specifications: { description: 'Original vehicle advert.' } };
  async function seedCar(id: string, dealer: string, values: Record<string, unknown> = {}) {
    const columns = { dealer_id: dealer, source: 'autotrader', advert_id: id, title: 'Original Toyota Yaris', make: car.make, model: car.model, year: car.year, source_price: 12000, mileage: 0, fuel: car.fuel, transmission: car.transmission, plate: car.plate, raw_source_data: JSON.stringify({ specifications: car.specifications }), ...values };
    const names = Object.keys(columns);
    return (await engine.query<{ id: string }>(`INSERT INTO vehicles (${names.join(',')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, Object.values(columns))).rows[0]!.id;
  }
  const first = await seedCar('one', 'demo-review-one', { website_title_override: 'Published Toyota Yaris', website_price_override: 11900, website_hero_image_override: 'https://photos.example.test/main.jpg' });
  await engine.query('INSERT INTO vehicle_images (vehicle_id,source_url,is_active) VALUES ($1,\'https://photos.example.test/main.jpg\',true),($1,\'https://photos.example.test/inactive.jpg\',false)', [first]);
  await seedCar('reserved', 'demo-review-one', { inventory_status: 'reserved', website_hero_image_override: 'https://photos.example.test/reserved.jpg' });
  await seedCar('missing-info', 'demo-review-one', { registration: '2024 (24 reg)', plate: null, raw_source_data: '{}' });
  await seedCar('sold', 'demo-review-one', { inventory_status: 'sold' });
  await seedCar('hidden', 'demo-review-one', { inventory_status: 'hidden' });
  await seedCar('archived', 'demo-review-one', { archived_at: new Date().toISOString() });
  await seedCar('missing', 'demo-review-one', { source_status: 'missing' });
  await seedCar('missing-twice', 'demo-review-one', { missing_count: 2 });
  await seedCar('wrong-platform', 'demo-review-one', { source: 'cazoo' });
  await seedCar('other-dealer', 'demo-review-two');
  await seedCar('live-car', 'live-review-one');
  const cazooCar = await seedCar('cazoo-car', 'demo-review-cazoo', { source: 'cazoo' });
  await engine.query(`INSERT INTO stock_import_runs (run_id,dealer_id,source,retailer_id,schema_version,scraped_at,expected_count,received_count,complete,status,raw_snapshot)
    VALUES ('review-run','demo-review-one','autotrader','123456','1',now(),3,3,true,'completed','{}')`);
  const stockSnapshot = async () => (await engine.query('SELECT * FROM vehicles ORDER BY id')).rows;
  const beforeStock = await stockSnapshot();
  const liveSettings = (await engine.query("SELECT * FROM dealer_settings WHERE dealer_id='live-review-one'")).rows;
  const log = pino({ enabled: false });
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.log = log; next(); }); app.use('/api/platform', platformRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  async function call(id: string, body?: unknown, options: { user?: string; host?: string; origin?: string } = {}) {
    const data = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<{ status: number; data: DemoReview & { error?: string } }>((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port, path: `/api/platform/dealers/${id}/demo-review`, method: data ? 'PATCH' : 'GET', headers: {
        host: options.host ?? 'admin.example.test', 'x-test-user': options.user ?? 'user_admin', ...(options.origin ? { origin: options.origin } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      } }, response => { let result = ''; response.on('data', chunk => result += chunk); response.on('end', () => resolve({ status: response.statusCode!, data: JSON.parse(result) })); });
      request.on('error', reject); request.end(data);
    });
  }
  try {
    for (const options of [{ user: 'user_owner' }, { host: 'demo-review-one.example.test' }, { origin: 'https://evil.example.test' }]) assert.equal((await call('demo-review-one', undefined, options)).status, 403);
    for (const id of ['live-review-one', 'demo-review-converted', 'unknown']) assert.equal((await call(id)).status, 404);
    const reviewed = await call('demo-review-one');
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
    assert.equal(reviewed.data.stock.count, 3);
    assert.equal(reviewed.data.stock.countMatches, true);
    assert.equal(reviewed.data.stock.photosCount, 2);
    assert.equal(reviewed.data.stock.noPhotosCount, 1);
    assert.equal(reviewed.data.stock.missingInfoCount, 1);
    assert.equal(reviewed.data.stock.completeCount, 2);
    assert.equal(reviewed.data.stock.vehicles.find(car => car.id === first)?.title, 'Published Toyota Yaris');
    assert.equal(reviewed.data.stock.vehicles.find(car => car.id === first)?.price, 11900);
    assert.deepEqual(reviewed.data.stock.vehicles.find(car => car.advertId === 'missing-info')?.missingFields, ['Registration', 'Advert description']);
    assert.equal((await call('demo-review-two')).data.stock.vehicles[0]?.advertId, 'other-dealer');
    const cazooReview = await call('demo-review-cazoo');
    assert.equal(cazooReview.status, 200);
    assert.equal(cazooReview.data.dealer.platform, 'cazoo');
    assert.equal(cazooReview.data.stock.count, 1);
    assert.deepEqual(cazooReview.data.stock.vehicles.map(car => [car.id, car.advertId]), [[cazooCar, 'cazoo-car']], 'Cazoo review contains only its own demo stock');
    assert.equal((await call('demo-review-expired')).data.preview.allowed, false);
    assert.equal((await call('demo-review-suspended')).data.preview.allowed, false);
    assert.deepEqual(await stockSnapshot(), beforeStock, 'GET review never mutates stock');
    const patch = { expectedRevision: 0, expectedSettingsRevision: 0, dealershipDetails: { ...evidence, email: 'sales@example.test', visitInstructions: 'Please call before visiting.' } };
    for (const id of ['live-review-one', 'demo-review-converted']) assert.equal((await call(id, patch)).status, 404);
    assert.equal((await call('demo-review-suspended', patch)).status, 409);
    assert.equal((await call('demo-review-one', { ...patch, dealershipDetails: { ...evidence, sourceUrl: source.replace('123456', '999999') } })).status, 400);
    const corrected = await call('demo-review-one', patch);
    assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
    assert.equal(corrected.data.dealer.revision, 1);
    assert.equal(corrected.data.details.email, 'sales@example.test');
    assert.equal(corrected.data.details.phone, savedDetails.phone);
    assert.equal(corrected.data.details.editableDetails?.about, savedDetails.about);
    assert.equal((await call('demo-review-one', patch)).status, 409, 'stale revision is rejected');
    assert.equal((await call('demo-review-one', { ...patch, expectedRevision: 1, unsupported: true })).status, 400);
    await engine.query(`UPDATE dealer_settings SET config=jsonb_set(jsonb_set(config,'{contact,email}','"new-from-settings@example.test"'),'{hours}','[{"days":"Monday - Sunday","times":"By appointment"}]'),revision=revision+1 WHERE dealer_id='demo-review-one'`);
    assert.equal((await call('demo-review-one', { ...patch, expectedRevision: 1, expectedSettingsRevision: 1 })).status, 409, 'newer public Settings reject an old full editor payload');
    const phoneOnly = await call('demo-review-one', { expectedRevision: 1, expectedSettingsRevision: 2, dealershipDetails: { ...evidence, phone: '020 7777 8888' } });
    assert.equal(phoneOnly.status, 200);
    assert.equal(phoneOnly.data.details.email, 'new-from-settings@example.test', 'phone-only correction preserves newer public Settings');
    assert.equal(phoneOnly.data.details.editableDetails?.email, 'new-from-settings@example.test');
    assert.deepEqual((phoneOnly.data.details.editableDetails?.openingHours as { days: unknown[] }).days, Array.from({ length: 7 }, (_, day) => ({ day, status: 'appointment_only' })));
    assert.deepEqual(phoneOnly.data.details.hours, [{ days: 'Monday - Sunday', times: 'By appointment' }]);
    assert.deepEqual(await stockSnapshot(), beforeStock, 'corrections never mutate stock');
    assert.deepEqual((await engine.query("SELECT * FROM dealer_settings WHERE dealer_id='live-review-one'")).rows, liveSettings, 'live settings remain untouched');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await engine.close(); }
});
