import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';
import { GetDealerSettingsResponse, GetPlatformDealerWebsiteTemplateResponse, GetStockResponse, UpdateDealerSettingsBody, UpdatePlatformDealerWebsiteTemplateResponse } from '@workspace/api-zod';
import { WEBSITE_TEMPLATES, isWebsiteTemplateId, resolveWebsiteTemplateId } from '@workspace/vehicle-meta/website-templates';
import { db, pool, engine, dealerDemosTable, dealerDomainsTable, dealerSettingsTable, dealershipsTable, vehiclesTable } from './test/tenant-test-db';
import { resolveTenant } from './middlewares/tenant';
import { PostgresSettingsVersionStore } from './lib/settings-versions';
import { serveFrontend } from './lib/serve-frontend';
import { newDealerSettings } from './routes/dealer-settings';
import platformRouter from './routes/platform-dealers';
import previewRouter from './routes/platform-website-preview';
import publicRouter from './routes/index';
import { motService } from './lib/mot-storage';

test('website template registry preserves old values and agrees with the public settings contract', () => {
  const defaults = newDealerSettings('Fictional dealer');
  assert.equal(resolveWebsiteTemplateId(undefined), 'existing');
  assert.equal(resolveWebsiteTemplateId('unrecognised'), 'existing');
  assert.deepEqual(WEBSITE_TEMPLATES.filter(template => !template.legacy).map(template => template.id), ['showroom', 'modern-showroom', 'grand-touring', 'forecourt', 'panorama']);
  for (const { id } of WEBSITE_TEMPLATES) {
    assert.equal(isWebsiteTemplateId(id), true);
    assert.equal(resolveWebsiteTemplateId(id), id);
    const config = { ...defaults, presentation: { websiteTemplate: id } };
    assert.equal(UpdateDealerSettingsBody.parse(config).presentation?.websiteTemplate, id);
    assert.equal(GetDealerSettingsResponse.parse(config).presentation?.websiteTemplate, id);
  }
  for (const value of ['', 'Showroom', '../showroom', true, null]) assert.equal(isWebsiteTemplateId(value), false);
  assert.equal(GetDealerSettingsResponse.parse(defaults).presentation?.websiteTemplate, undefined);
});

test('per-dealer template previews and publications are private, scoped and revision guarded', async context => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';
  process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
  const directory = await mkdtemp(join(tmpdir(), 'website-template-test-'));
  await writeFile(join(directory, 'index.html'), '<html><head><title>Website</title></head><body><div id="root"></div></body></html>');
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  }
  // PGlite runs the real settings transaction and history SQL. It has no sessions
  // competing for advisory locks; skip only that PostgreSQL lock primitive.
  context.mock.method(pool, 'connect', async () => ({
    query: async (sql: string, parameters?: unknown[]) => /pg_advisory_xact_lock/.test(sql) ? { rows: [] } : engine.query<Record<string, any>>(sql, parameters),
    release() {},
  }));
  const firstConfig = {
    ...newDealerSettings('Alpha Test Motors'),
    presentation: { pageColour: '#112233', heroImagePosition: 'right', websiteCopy: { stockTitle: 'Alpha stock' }, customFutureField: { retain: true } },
    publicOnlineReservations: false, onlineReservation: { privateFixture: 'retain-alpha-private' }, recentHandovers: { enabled: false },
    futurePrivateSetting: { nested: ['keep', 12, false] },
  };
  const secondConfig = { ...newDealerSettings('Bravo Test Motors'), presentation: { websiteTemplate: 'classic' } };
  const dealers = [
    { id: 'template-alpha', name: 'Alpha Test Motors', status: 'active' as const, revision: 7, config: firstConfig },
    { id: 'template-bravo', name: 'Bravo Test Motors', status: 'draft' as const, revision: 2, config: secondConfig },
    { id: 'template-demo', name: 'Demo Test Motors', status: 'active' as const, revision: 0, config: newDealerSettings('Demo Test Motors') },
  ];
  for (const dealer of dealers) {
    await db.insert(dealershipsTable).values({ id: dealer.id, name: dealer.name, status: dealer.status,
      canonicalOrigin: `https://${dealer.id}.example.test`, stockPlatform: 'autotrader', retailerId: dealer.id, sourceUrl: 'https://www.autotrader.co.uk/fictional-dealer' });
    await db.insert(dealerSettingsTable).values({ dealerId: dealer.id, revision: dealer.revision, config: dealer.config });
    await db.insert(dealerDomainsTable).values({ dealerId: dealer.id, hostname: `${dealer.id}.example.test`, verified: true, verificationToken: 'test-fixture' });
  }
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+p1LkAAAAASUVORK5CYII=';
  await db.insert(dealerDemosTable).values({ dealerId: 'template-demo', recipient: 'operator@example.test', expiresAt: new Date(Date.now() + 86_400_000), updatedBy: 'user_admin', logoData: `data:image/png;base64,${pixel}` });
  const carIds = ['89a8d499-6ca1-4ea1-a865-d96929508008', 'c4b30998-0d10-4973-9b06-44901c350e03'];
  for (let index = 0; index < 2; index++) await db.insert(vehiclesTable).values({ id: carIds[index], dealerId: dealers[index]!.id,
    source: 'autotrader', advertId: `template-car-${index}`, title: `Fictional vehicle ${index}`, sourcePrice: 10000, registration: index === 0 ? 'AB12CDE' : 'CD34EFG' });

  const app = express();
  app.use(express.json());
  app.use('/api/platform', platformRouter);
  app.use('/platform/preview/:dealerId/template/:templateId/:templateRevision', previewRouter);
  app.use('/platform/preview/:dealerId', previewRouter);
  app.use((req, res, next) => res.locals.privateWebsitePreview === true ? next() : resolveTenant(req, res, next));
  app.use('/api', publicRouter);
  serveFrontend(app, directory);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No isolated test server');
  const request = (path: string, { method = 'GET', body, user = 'user_admin', host = 'admin.example.test', origin, revision }: {
    method?: string; body?: unknown; user?: string; host?: string; origin?: string; revision?: string;
  } = {}) => new Promise<Response>((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: address.port, path, method, headers: {
      host, 'x-test-user': user, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(origin ? { origin } : {}), ...(revision === undefined ? {} : { 'If-Match': revision }),
    } }, incoming => {
      const chunks: Buffer[] = [];
      incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
      incoming.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(key, value);
        resolve(new Response(chunks.length ? new Uint8Array(Buffer.concat(chunks)) : null, { status: incoming.statusCode, headers }));
      });
    });
    outgoing.on('error', reject); outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const statePath = '/api/platform/dealers/template-alpha/website-template';
  const previewPath = '/platform/preview/template-alpha/template/modern-showroom/7';
  const stored = async (id = 'template-alpha') => (await engine.query<{ config: Record<string, any>; revision: number }>('SELECT config,revision FROM dealer_settings WHERE dealer_id=$1', [id])).rows[0]!;
  const history = async () => (await engine.query<{ dealer_id: string; revision: number; action: string; config: Record<string, any> }>('SELECT * FROM dealer_settings_versions ORDER BY dealer_id,revision')).rows;
  try {
    await context.test('only the Platform Admin origin and account can read, preview or apply', async () => {
      for (const options of [{ user: '' }, { user: 'user_dealer_owner' }, { host: 'template-alpha.example.test' }, { origin: 'https://untrusted.example.test' }]) {
        assert.equal((await request(statePath, options)).status, 403);
        assert.equal((await request(previewPath + '/api/dealer-settings', options)).status, 403);
        assert.equal((await request(statePath, { ...options, method: 'PATCH', revision: '7', body: { template: 'showroom', reviewed: true } })).status, 403);
      }
      assert.equal((await request('/api/platform/dealers/missing-dealer/website-template')).status, 404);
    });
    await context.test('current selection reads do not default or publish settings', async () => {
      const response = await request(statePath);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('etag'), '"7"');
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      const rawState = await response.json();
      const state = GetPlatformDealerWebsiteTemplateResponse.parse(rawState);
      assert.equal(state.currentTemplate, 'existing');
      assert.equal(state.previewPath, '/platform/preview/template-alpha');
      assert.deepEqual(state.templates.map((template: { id: string }) => template.id), WEBSITE_TEMPLATES.map(template => template.id));
      assert.equal(JSON.stringify(rawState).includes('retain-alpha-private'), false);
      assert.deepEqual(await stored(), { config: firstConfig, revision: 7 });
      assert.deepEqual(await history(), []);
    });
    await context.test('active, draft and demo candidate pages remain read only and tenant scoped', async () => {
      const beforeStock = (await engine.query('SELECT * FROM vehicles ORDER BY id')).rows;
      const settings = await request(previewPath + '/api/dealer-settings');
      assert.equal(settings.status, 200, await settings.clone().text());
      const rawConfig = await settings.json();
      const config = GetDealerSettingsResponse.parse(rawConfig);
      assert.equal(config.identity.name, 'Alpha Test Motors');
      assert.equal(config.presentation?.websiteTemplate, 'modern-showroom');
      assert.equal(config.presentation?.pageColour, '#112233');
      assert.equal(typeof rawConfig === 'object' && rawConfig !== null && 'futurePrivateSetting' in rawConfig, false);
      const html = await request(previewPath + '/stock');
      assert.equal(html.status, 200, await html.clone().text());
      assert.match(html.headers.get('x-robots-tag') ?? '', /noindex/);
      assert.match(html.headers.get('cache-control') ?? '', /no-store/);
      assert.match(await html.text(), /template-alpha\.example\.test/);
      const stock = await request(previewPath + '/api/stock');
      assert.deepEqual(GetStockResponse.parse(await stock.json()).cars.map(car => car.id), [carIds[0]]);
      assert.equal((await request(previewPath + '/api/vehicles/' + carIds[1])).status, 404);
      const draft = await request('/platform/preview/template-bravo/template/panorama/2/api/dealer-settings');
      assert.equal(draft.status, 200);
      assert.equal(GetDealerSettingsResponse.parse(await draft.json()).identity.name, 'Bravo Test Motors');
      const logo = await request('/platform/preview/template-demo/template/forecourt/0/api/demo-logo');
      assert.equal(logo.status, 200);
      assert.equal(logo.headers.get('content-type'), 'image/png');
      assert.equal(Buffer.from(await logo.arrayBuffer()).toString('base64'), pixel);
      const lookup = context.mock.method(motService, 'lookup', async () => { throw Error('Provider calls are forbidden in template previews'); });
      assert.equal((await request(previewPath + '/api/vehicles/' + carIds[0] + '/mot-history?cacheOnly=false')).status, 200);
      assert.equal(lookup.mock.callCount(), 0);
      assert.equal((await request(previewPath + '/api/enquiries', { method: 'POST', body: {} })).status, 405);
      assert.equal((await request(previewPath + '/api/dealer-settings', { method: 'PATCH', body: {} })).status, 405);
      assert.deepEqual(await stored(), { config: firstConfig, revision: 7 });
      assert.deepEqual((await engine.query('SELECT * FROM vehicles ORDER BY id')).rows, beforeStock);
      assert.deepEqual(await history(), []);
    });
    await context.test('ordinary previews keep their restrictions and bad candidates fail closed', async () => {
      assert.equal((await request('/platform/preview/template-alpha/api/stock')).status, 404);
      assert.equal((await request('/platform/preview/template-bravo/api/dealer-settings')).status, 200);
      for (const suffix of ['unknown/7', 'Showroom/7', 'showroom/-1', 'showroom/1.5', 'showroom/9007199254740992']) {
        assert.equal((await request('/platform/preview/template-alpha/template/' + suffix + '/api/dealer-settings')).status, 400);
      }
      const stale = await request('/platform/preview/template-alpha/template/showroom/6/api/dealer-settings');
      assert.equal(stale.status, 409);
      assert.equal((await stale.json() as { revision: number }).revision, 7);
      assert.equal((await request('/platform/preview/template-alpha/template/classic/7/api/dealer-settings')).status, 200);
    });
    await context.test('Apply requires review, a supported selection and the settings revision', async () => {
      for (const body of [{ template: 'showroom' }, { template: 'showroom', reviewed: false }, { template: 'unknown', reviewed: true },
        { template: 'showroom', reviewed: true, dealerId: 'template-bravo' }, { template: 'showroom', reviewed: true, presentation: { pageColour: '#ffffff' } }]) {
        assert.equal((await request(statePath, { method: 'PATCH', body, revision: '7' })).status, 400);
      }
      assert.equal((await request(statePath, { method: 'PATCH', body: { template: 'showroom', reviewed: true } })).status, 428);
      assert.equal((await request(statePath, { method: 'PATCH', body: { template: 'showroom', reviewed: true }, revision: 'invalid' })).status, 400);
      assert.deepEqual(await stored(), { config: firstConfig, revision: 7 });
      assert.deepEqual(await history(), []);
    });
    await context.test('Apply changes one dealer and one field while preserving private settings and history', async () => {
      const response = await request(statePath, { method: 'PATCH', body: { template: 'modern-showroom', reviewed: true }, revision: '"7"' });
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(UpdatePlatformDealerWebsiteTemplateResponse.parse(await response.json()), { dealerId: 'template-alpha', currentTemplate: 'modern-showroom', revision: 8 });
      assert.equal(response.headers.get('x-settings-revision'), '8');
      const after = await stored();
      assert.equal(after.config.presentation.websiteTemplate, 'modern-showroom');
      delete after.config.presentation.websiteTemplate;
      assert.deepEqual(after.config, firstConfig);
      assert.deepEqual(await stored('template-bravo'), { config: secondConfig, revision: 2 });
      const versions = await history();
      assert.deepEqual(versions.map(row => [row.dealer_id, row.revision, row.action]), [['template-alpha', 7, 'initial'], ['template-alpha', 8, 'publish']]);
      assert.equal(versions[0]!.config.presentation.websiteTemplate, undefined);
      assert.equal(versions[1]!.config.presentation.websiteTemplate, 'modern-showroom');
      assert.deepEqual(versions[1]!.config.futurePrivateSetting, firstConfig.futurePrivateSetting);
      const publicSettings = await request('/api/dealer-settings', { host: 'template-alpha.example.test' });
      assert.equal(GetDealerSettingsResponse.parse(await publicSettings.json()).presentation?.websiteTemplate, 'modern-showroom');
      const oldPreview = await request(previewPath + '/stock');
      assert.equal(oldPreview.status, 409);
      assert.match(oldPreview.headers.get('content-type') ?? '', /text\/html/);
      const oldMarkup = await oldPreview.text();
      assert.match(oldMarkup, /Website settings have changed/);
      assert.match(oldMarkup, /href="\/platform\?dealer=template-alpha&amp;tab=Website"/);
      assert.match(oldMarkup, /Reopen preview/);
    });
    await context.test('a normal settings publication invalidates older reviews without losing either edit', async () => {
      await new PostgresSettingsVersionStore('template-alpha', pool).publish({ config: {}, expectedRevision: 8, actor: 'Fictional staff settings editor',
        validate: async (_input, current) => ({ ...current, hero: { ...(current.hero as object), copy: 'Updated by staff while the template was being reviewed' } }) });
      const before = await stored();
      const versionsBefore = await history();
      const stale = await request(statePath, { method: 'PATCH', body: { template: 'panorama', reviewed: true }, revision: '8' });
      assert.equal(stale.status, 409);
      assert.equal(stale.headers.get('x-settings-revision'), '9');
      assert.equal((await stale.json() as { revision: number }).revision, 9);
      assert.equal((await request('/platform/preview/template-alpha/template/panorama/8/api/dealer-settings')).status, 409);
      assert.deepEqual(await stored(), before);
      assert.deepEqual(await history(), versionsBefore);
      const latest = await request(statePath, { method: 'PATCH', body: { template: 'grand-touring', reviewed: true }, revision: '9' });
      assert.equal(latest.status, 200);
      assert.equal((await stored()).config.hero.copy, 'Updated by staff while the template was being reviewed');
      assert.equal((await stored()).revision, 10);
    });
    await context.test('legacy selections can be restored and expired demos cannot be previewed or changed', async () => {
      const restored = await request(statePath, { method: 'PATCH', body: { template: 'existing', reviewed: true }, revision: '10' });
      assert.equal(restored.status, 200);
      assert.equal((await stored()).config.presentation.websiteTemplate, 'existing');
      await engine.query("UPDATE dealer_demos SET expires_at=now()-interval '1 hour' WHERE dealer_id='template-demo'");
      assert.equal((await request('/platform/preview/template-demo/template/showroom/0/api/dealer-settings')).status, 404);
      assert.equal((await request('/api/platform/dealers/template-demo/website-template')).status, 404);
      assert.equal((await request('/api/platform/dealers/template-demo/website-template', { method: 'PATCH', body: { template: 'showroom', reviewed: true }, revision: '0' })).status, 404);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await engine.close();
    await rm(directory, { force: true, recursive: true });
  }
});
