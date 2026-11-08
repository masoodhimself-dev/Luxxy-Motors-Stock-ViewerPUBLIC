import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';
import { db, dealerDomainsTable, dealerSettingsTable, dealershipsTable, engine, vehiclesTable } from './test/tenant-test-db';
import { resolveTenant } from './middlewares/tenant';
import { serveFrontend } from './lib/serve-frontend';
import { newDealerSettings } from './routes/dealer-settings';
import platformDealersRouter from './routes/platform-dealers';
import previewRouter from './routes/platform-website-preview';

test('draft website preview keeps real stock private, scoped to its dealer, and read only', async () => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';
  process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
  delete process.env.DEMO_DOMAINS_READY;
  delete process.env.DEMO_EMAIL_RECIPIENTS;
  const directory = await mkdtemp(join(tmpdir(), 'dealer-site-preview-'));
  await writeFile(join(directory, 'index.html'), '<html><head><title>Showroom</title></head><body><div id="root"></div></body></html>');
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  }
  const drafts = [
    { id: 'draft-one', name: 'Draft One', canonicalOrigin: 'https://draft-one.example.test' },
    { id: 'draft-two', name: 'Draft Two', canonicalOrigin: 'https://draft-two.example.test' },
  ];
  const vehicleIds = ['95f1322e-814f-4652-83e0-73de3f07067c', '17153bc4-651a-4743-98ca-ae4df05ca2aa'];
  for (const [index, dealer] of drafts.entries()) {
    await db.insert(dealershipsTable).values({ ...dealer, status: 'draft', stockPlatform: 'autotrader', retailerId: dealer.id, sourceUrl: 'https://www.autotrader.co.uk/example' });
    await db.insert(dealerDomainsTable).values({ dealerId: dealer.id, hostname: new URL(dealer.canonicalOrigin).hostname, verificationToken: 'test-only', verified: true });
    await db.insert(dealerSettingsTable).values({ dealerId: dealer.id, config: newDealerSettings(dealer.name) });
    await db.insert(vehiclesTable).values({ id: vehicleIds[index], dealerId: dealer.id, source: 'autotrader', advertId: dealer.id, title: `Vehicle ${index + 1}`, sourcePrice: 10000 });
  }
  const app = express();
  app.use(express.json());
  app.use('/api/platform', platformDealersRouter);
  app.use('/platform/preview/:dealerId', previewRouter);
  app.use((req, res, next) => res.locals.privateWebsitePreview === true ? next() : resolveTenant(req, res, next));
  serveFrontend(app, directory);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  const read = (path: string, { host = 'admin.example.test', user = 'user_admin', method = 'GET', origin = '', body }: {
    host?: string; user?: string; method?: string; origin?: string; body?: object;
  } = {}) =>
    new Promise<Response>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: address.port, path, method, headers: {
        host, 'x-test-user': user, ...(origin ? { origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
      } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => { chunks.push(Buffer.from(chunk)); });
        res.on('end', () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) if (typeof value === 'string') headers.set(key, value);
          resolve(new Response(chunks.length ? new Uint8Array(Buffer.concat(chunks)) : null, { status: res.statusCode, headers }));
        });
      });
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  const base = '/platform/preview/draft-one';
  try {
    assert.equal((await read('/', { host: 'draft-one.example.test' })).status, 421);
    assert.equal((await read('/api/stock', { host: 'draft-one.example.test' })).status, 421);
    assert.equal((await read(base, { user: '' })).status, 403);
    assert.equal((await read(base + '/api/stock', { user: 'user_dealer' })).status, 403);
    assert.equal((await read(base + '/api/stock', { host: 'draft-one.example.test' })).status, 403);
    assert.equal((await read(base + '/api/stock', { origin: 'https://other.example.test' })).status, 403);
    const html = await read(base + '/stock');
    assert.equal(html.status, 200);
    assert.match(html.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.match(html.headers.get('cache-control') ?? '', /no-store/);
    assert.match(await html.text(), /luxxy-canonical-origin[^>]+draft-one\.example\.test/);
    const stock = await read(base + '/api/stock');
    assert.equal(stock.status, 200, await stock.clone().text());
    assert.match(stock.headers.get('cache-control') ?? '', /no-store/);
    assert.deepEqual((await stock.json() as { cars: { id: string }[] }).cars.map(car => car.id), [vehicleIds[0]]);
    assert.equal((await read(base + '/api/vehicles/' + vehicleIds[0])).status, 200);
    assert.equal((await read(base + '/api/vehicles/' + vehicleIds[1])).status, 404);
    assert.equal((await read(base + '/api/staff/enquiries')).status, 404);
    assert.equal((await read(base + '/api/enquiries', { method: 'POST' })).status, 405);
    const settings = await read(base + '/api/dealer-settings');
    assert.equal(settings.status, 200);
    const publicSettings = await settings.text();
    assert.match(publicSettings, /Draft One/);
    const logo = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+p1LkAAAAASUVORK5CYII=';
    const created = await read('/api/platform/demos', { method: 'POST', body: {
      slug: 'private-test', name: 'Private Test Motors', platform: 'autotrader', retailerId: 'private-retailer',
      sourceUrl: 'https://www.autotrader.co.uk/example', privatePreview: true, logoData: `data:image/png;base64,${logo}`,
    } });
    assert.equal(created.status, 201, await created.clone().text());
    const { dealerId, previewPath } = await created.json() as { dealerId: string; previewPath: string };
    assert.equal(previewPath, '/platform/preview/demo-private-test');
    assert.equal((await engine.query<{ status: string }>("SELECT status FROM dealerships WHERE id=$1", [dealerId])).rows[0].status, 'draft');
    assert.equal((await engine.query("SELECT hostname FROM dealer_domains WHERE dealer_id=$1", [dealerId])).rows.length, 0);
    assert.equal((await read('/', { host: 'private-test.demo.invalid' })).status, 421);
    assert.equal((await read(previewPath)).status, 200);
    assert.equal((await read(previewPath + '/api/demo-logo', { user: '' })).status, 403);
    const artwork = await read(previewPath + '/api/demo-logo');
    assert.equal(artwork.status, 200);
    assert.equal(artwork.headers.get('content-type'), 'image/png');
    assert.match(artwork.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(Buffer.from(await artwork.arrayBuffer()).toString('base64'), logo);
    assert.equal((await read(base + '/api/demo-logo')).status, 404);
    await engine.query("UPDATE dealer_demos SET expires_at=now()-interval '1 hour' WHERE dealer_id=$1", [dealerId]);
    assert.equal((await read(previewPath + '/api/stock')).status, 404);
    await engine.query("UPDATE dealerships SET status='active' WHERE id=$1", [drafts[0].id]);
    assert.equal((await read(base + '/api/stock')).status, 404);
    assert.equal((await read('/', { host: 'draft-one.example.test' })).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await engine.close();
    await rm(directory, { force: true, recursive: true });
  }
});
