import test from 'node:test';
import assert from 'node:assert/strict';
import { GetDealerSettingsResponse, UpdateDealerSettingsBody } from '@workspace/api-zod';
import { normaliseIncludedItems, websiteColourPolicy } from './lib/website-colour-policy';

test('included-item contracts are optional, bounded and explicit about clearing', () => {
  for (const schema of [GetDealerSettingsResponse.shape.presentation, UpdateDealerSettingsBody.shape.presentation]) {
    assert.equal(schema.safeParse({}).success, true);
    assert.deepEqual(schema.parse({ includedItems: [] })?.includedItems, []);
    assert.deepEqual(schema.parse({ includedItems: ['6 months warranty'] })?.includedItems, ['6 months warranty']);
    for (const includedItems of [[''], ['   '], ['x'.repeat(161)], Array.from({ length: 13 }, (_, index) => `Item ${index}`), [2], 'Warranty'])
      assert.equal(schema.safeParse({ includedItems }).success, false);
  }
  assert.deepEqual(normaliseIncludedItems({ presentation: { includedItems: [' 6 months warranty ', ' FULL VALET ', 'full valet'] } }), { presentation: { includedItems: ['6 months warranty', 'FULL VALET'] } });
});

test('colour policy retains omitted values, rejects dealer changes and keeps current colours on restore', () => {
  const current = { identity: { name: 'Dealer A', brandColors: { primaryHsl: '210 50% 20%', accentHsl: '30 40% 35%' } }, presentation: { pageColour: '#fafafa', panelColour: '#ffffff', headingColour: '#112233', linkColour: '#334455' } };
  const before = structuredClone(current);
  const updated = websiteColourPolicy({ identity: { name: 'Updated dealer' }, presentation: { includedItems: ['Warranty'] } }, current);
  assert.deepEqual(updated.identity, { ...current.identity, name: 'Updated dealer' });
  assert.deepEqual(updated.presentation, { ...current.presentation, includedItems: ['Warranty'] });
  assert.deepEqual(current, before);
  assert.throws(() => websiteColourPolicy({ identity: { ...current.identity, brandColors: { ...current.identity.brandColors, primaryHsl: '0 0% 0%' } } }, current), { status: 403 });
  assert.throws(() => websiteColourPolicy({ presentation: { pageColour: '' } }, current), { status: 403 });
  const historic = { identity: { name: 'Historic dealer', brandColors: { primaryHsl: '0 0% 100%', accentHsl: '0 0% 0%' } }, presentation: { pageColour: '#ffffff', includedItems: ['Historical item'] } };
  const restored = websiteColourPolicy(historic, current, { restoring: true });
  assert.deepEqual(restored.identity, { ...historic.identity, brandColors: current.identity.brandColors });
  assert.deepEqual(restored.presentation, { ...historic.presentation, ...current.presentation });
  assert.deepEqual(websiteColourPolicy(historic, current, { allowChanges: true }), { ...historic, presentation: { ...current.presentation, ...historic.presentation } });
});

test('actual settings routes enforce colour locks while publishing dealer-wide inclusions and restoring safely within the tenant', async () => {
  const { engine, pool } = await import('./test/tenant-test-db');
  const { readFile, readdir } = await import('node:fs/promises');
  const { createServer, request } = await import('node:http');
  const { default: express } = await import('express');
  const { runWithTenant } = await import('./lib/tenant-context');
  const { default: router, defaultSettings } = await import('./routes/dealer-settings');
  const previousMultiTenant = process.env.MULTI_TENANT_ENABLED, previousAdmins = process.env.PLATFORM_ADMIN_USER_IDS;
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_USER_IDS = 'fictional-platform,machine';
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d.*\.sql$/.test(name)).sort())
    await engine.exec(await readFile('../../lib/db/drizzle/' + file, 'utf8'));
  const initial = { ...defaultSettings, identity: { ...defaultSettings.identity, name: 'Dealer A' }, contact: { phone: '', whatsapp: '', email: '' }, address: { ...defaultSettings.address, postcode: '' }, presentation: { pageColour: '#fafafa', panelColour: '#ffffff', headingColour: '#112233', linkColour: '#334455', includedItems: ['6 months warranty'] } };
  const neighbour = { ...initial, identity: { ...initial.identity, name: 'Dealer B' }, presentation: { ...initial.presentation, includedItems: ['Dealer B only'] } };
  const historic = { ...initial, identity: { ...initial.identity, brandColors: { primaryHsl: '0 0% 100%', accentHsl: '0 0% 0%' } }, hero: { ...initial.hero, announcement: 'Historical content' }, presentation: { ...initial.presentation, pageColour: '#dddddd', includedItems: ['Historical included item'] } };
  for (const [id, config, revision] of [['policy-a', initial, 3], ['policy-b', neighbour, 8]] as const) {
    await pool.query("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$2,'active',$3,'autotrader','fictional','https://www.autotrader.co.uk/fictional')", [id, config.identity.name, `https://${id}.example.test`]);
    await pool.query('INSERT INTO dealer_settings(dealer_id,config,revision) VALUES($1,$2::jsonb,$3)', [id, JSON.stringify(config), revision]);
  }
  for (const [id, revision, config] of [['policy-a', 1, historic], ['policy-b', 99, neighbour]] as const)
    await pool.query("INSERT INTO dealer_settings_versions(dealer_id,revision,config,published_at,published_by,action) VALUES($1,$2,$3::jsonb,now(),'Fictional setup','initial')", [id, revision, JSON.stringify(config)]);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {} } as any;
    req.staff = { authUserId: req.get('x-test-user') || 'fictional-owner', name: 'Fictional owner', email: 'owner@example.test', role: req.get('x-test-role') === 'salesperson' ? 'salesperson' : 'owner' };
    const dealerId = req.get('x-test-dealer') === 'policy-b' ? 'policy-b' : 'policy-a';
    runWithTenant({ dealerId, canonicalOrigin: `https://${dealerId}.example.test`, platform: 'autotrader', retailerId: 'fictional', sourceUrl: 'https://www.autotrader.co.uk/fictional', kind: 'website' }, next);
  });
  app.use('/api', router);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  const call = (path = '/dealer-settings', method = 'GET', config?: unknown, revision?: number, extra: Record<string, string> = {}) => new Promise<{ status: number; data: any; revision: string | undefined }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/api' + path, method, headers: { 'content-type': 'application/json', ...(revision === undefined ? {} : { 'if-match': `"${revision}"` }), ...extra } }, res => {
      let output = ''; res.on('data', data => { output += data; }); res.on('end', () => resolve({ status: res.statusCode!, data: JSON.parse(output), revision: res.headers['x-settings-revision'] as string | undefined }));
    }); req.on('error', reject); if (config !== undefined) req.write(JSON.stringify(config)); req.end();
  });
  try {
    const first = await call('/dealer-settings', 'PATCH', { ...initial, presentation: { ...initial.presentation, includedItems: [' 6 months warranty ', ' FULL VALET ', 'full valet'] } }, 3);
    assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(first.revision, '4');
    assert.deepEqual(first.data.presentation.includedItems, ['6 months warranty', 'FULL VALET']);
    const { presentation: _omittedPresentation, ...oldClient } = first.data;
    delete oldClient.identity.brandColors;
    const compatible = await call('/dealer-settings', 'PATCH', oldClient, 4);
    assert.equal(compatible.status, 200, JSON.stringify(compatible.data)); assert.equal(compatible.revision, '5');
    assert.deepEqual(compatible.data.presentation, first.data.presentation);
    assert.deepEqual(compatible.data.identity.brandColors, initial.identity.brandColors);
    for (const includedItems of [['   '], ['x'.repeat(161)], Array.from({ length: 13 }, (_, index) => `Item ${index}`), [2]]) {
      const invalid = await call('/dealer-settings', 'PATCH', { ...compatible.data, presentation: { ...compatible.data.presentation, includedItems } }, 5);
      assert.equal(invalid.status, 400, JSON.stringify(invalid.data));
    }
    const mutations = [
      ...['primaryHsl', 'accentHsl'].map(key => ({ ...compatible.data, identity: { ...compatible.data.identity, brandColors: { ...compatible.data.identity.brandColors, [key]: '0 0% 0%' } } })),
      ...['pageColour', 'panelColour', 'headingColour', 'linkColour'].map(key => ({ ...compatible.data, presentation: { ...compatible.data.presentation, [key]: '#aabbcc' } })),
    ];
    for (const mutation of mutations) {
      const denied = await call('/dealer-settings', 'PATCH', mutation, 5);
      assert.equal(denied.status, 403); assert.match(denied.data.error, /colours.*platform/);
    }
    assert.equal((await call('/dealer-settings', 'PATCH', mutations[0], 5, { 'x-test-user': 'machine' })).status, 403);
    assert.equal((await call('/dealer-settings', 'PATCH', compatible.data, 5, { 'x-test-role': 'salesperson' })).status, 403);
    assert.equal((await call()).revision, '5');
    const adminConfig = { ...compatible.data, identity: { ...compatible.data.identity, brandColors: { primaryHsl: '220 50% 20%', accentHsl: '40 50% 30%' } }, presentation: { ...compatible.data.presentation, pageColour: '#ffeedd' } };
    const admin = await call('/dealer-settings', 'PATCH', adminConfig, 5, { 'x-test-user': 'fictional-platform' });
    assert.equal(admin.status, 200, JSON.stringify(admin.data)); assert.equal(admin.revision, '6');
    const wrongTenant = await call('/staff/settings-history/99/restore', 'POST', undefined, 6);
    assert.equal(wrongTenant.status, 404);
    const restore = await call('/staff/settings-history/1/restore', 'POST', undefined, 6);
    assert.equal(restore.status, 200, JSON.stringify(restore.data)); assert.equal(restore.revision, '7');
    assert.equal(restore.data.config.hero.announcement, 'Historical content');
    assert.deepEqual(restore.data.config.identity.brandColors, adminConfig.identity.brandColors);
    assert.deepEqual(restore.data.config.presentation, { ...historic.presentation, pageColour: '#ffeedd' });
    const clear = await call('/dealer-settings', 'PATCH', { ...restore.data.config, presentation: { ...restore.data.config.presentation, includedItems: [] } }, 7);
    assert.equal(clear.status, 200, JSON.stringify(clear.data)); assert.deepEqual(clear.data.presentation.includedItems, []);
    const stale = await call('/dealer-settings', 'PATCH', first.data, 3);
    assert.equal(stale.status, 409); assert.equal(stale.revision, '8');
    const dealerB = await call('/dealer-settings', 'GET', undefined, undefined, { 'x-test-dealer': 'policy-b' });
    assert.equal(dealerB.revision, '8'); assert.deepEqual(dealerB.data.presentation.includedItems, ['Dealer B only']);
    assert.deepEqual(dealerB.data.identity.brandColors, neighbour.identity.brandColors);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await engine.close();
    if (previousMultiTenant === undefined) delete process.env.MULTI_TENANT_ENABLED; else process.env.MULTI_TENANT_ENABLED = previousMultiTenant;
    if (previousAdmins === undefined) delete process.env.PLATFORM_ADMIN_USER_IDS; else process.env.PLATFORM_ADMIN_USER_IDS = previousAdmins;
  }
});
