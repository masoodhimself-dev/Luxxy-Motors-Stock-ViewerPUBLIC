import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import { staffWriteOriginAllowed } from './middlewares/staff-write-origin';
import { requireStaff } from './middlewares/staff-auth';
import { runWithTenant } from './lib/tenant-context';
import { engine } from './test/tenant-test-db';

after(() => engine.close());

const tenant = { dealerId: 'dealer-a', canonicalOrigin: 'https://dealer-a.example.test', platform: 'autotrader' as const, retailerId: 'fictional', sourceUrl: 'https://www.autotrader.co.uk/fictional', kind: 'website' as const };
const fixture = (method: string, headers: Record<string, string> = {}) => ({ method, get: (name: string) => headers[name] });
test('staff write origins distinguish this dealer and its verified alias from sibling and cross-site origins', () => {
  const oldMulti = process.env.MULTI_TENANT_ENABLED;
  process.env.MULTI_TENANT_ENABLED = 'true';
  try {
    runWithTenant(tenant, () => {
      const verify = (origin: string, host = 'dealer-a.example.test') => staffWriteOriginAllowed(fixture('POST', { origin, host }));
      assert.equal(verify(tenant.canonicalOrigin), true);
      assert.equal(verify('https://www.dealer-a.example.test', 'www.dealer-a.example.test'), true);
      assert.equal(verify(tenant.canonicalOrigin, 'www.dealer-a.example.test'), true);
      for (const bad of ['https://dealer-b.example.test', 'https://evil.example', 'null', '', 'https://dealer-a.example.test/path', 'https://user:secret@dealer-a.example.test', 'https://dealer-a.example.test?x=1', 'https://dealer-a.example.test#x', 'https://dealer-a.example.test:444', 'http://dealer-a.example.test', 'https://dealer-a.example.test, https://evil.example']) assert.equal(verify(bad), false, bad);
      assert.equal(staffWriteOriginAllowed(fixture('POST', { host: 'dealer-a.example.test', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' })), false);
      assert.equal(staffWriteOriginAllowed(fixture('POST', { host: 'dealer-a.example.test' })), true);
      assert.equal(staffWriteOriginAllowed(fixture('POST', { host: 'dealer-a.example.test', 'sec-fetch-site': 'same-origin' })), true);
      assert.equal(staffWriteOriginAllowed(fixture('POST', { host: 'dealer-a.example.test', 'sec-fetch-site': 'same-site' })), false);
      assert.equal(staffWriteOriginAllowed(fixture('POST', { host: 'dealer-a.example.test', 'sec-fetch-site': 'cross-site' })), false);
      assert.equal(staffWriteOriginAllowed(fixture('GET', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })), true);
      assert.equal(staffWriteOriginAllowed(fixture('HEAD', { origin: 'null' })), true);
      assert.equal(staffWriteOriginAllowed(fixture('OPTIONS', { origin: 'https://evil.example' })), true);
    });
    assert.equal(staffWriteOriginAllowed(fixture('POST', { host: 'dealer-a.example.test', origin: tenant.canonicalOrigin })), false);
    runWithTenant({ ...tenant, kind: 'import' }, () => assert.equal(staffWriteOriginAllowed(fixture('POST', { host: 'dealer-a.example.test', origin: tenant.canonicalOrigin })), false));
  } finally { if (oldMulti === undefined) delete process.env.MULTI_TENANT_ENABLED; else process.env.MULTI_TENANT_ENABLED = oldMulti; }
});

test('standalone localhost and LAN writes work without trusting forwarded headers', () => {
  const oldMulti = process.env.MULTI_TENANT_ENABLED, oldOrigin = process.env.PUBLIC_SITE_URL, oldMode = process.env.NODE_ENV;
  process.env.MULTI_TENANT_ENABLED = 'false'; process.env.PUBLIC_SITE_URL = 'http://127.0.0.1:4175'; process.env.NODE_ENV = 'test';
  try {
    for (const host of ['127.0.0.1:4175', 'localhost:4175', '192.168.1.114:4175', '[::1]:4175']) assert.equal(staffWriteOriginAllowed(fixture('POST', { host, origin: `http://${host}` })), true);
    assert.equal(staffWriteOriginAllowed(fixture('PATCH', { host: '192.168.1.114:4175', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' })), false);
    assert.equal(staffWriteOriginAllowed(fixture('POST', { host: '192.168.1.114:4175', origin: 'http://192.168.1.114:4176' })), false);
  } finally {
    if (oldMulti === undefined) delete process.env.MULTI_TENANT_ENABLED; else process.env.MULTI_TENANT_ENABLED = oldMulti;
    if (oldOrigin === undefined) delete process.env.PUBLIC_SITE_URL; else process.env.PUBLIC_SITE_URL = oldOrigin;
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
  }
});

test('the shared staff middleware blocks browser mutations while leaving safe reads and stock upload credentials untouched', async () => {
  const oldMulti = process.env.MULTI_TENANT_ENABLED; process.env.MULTI_TENANT_ENABLED = 'true';
  const app = express(); let writes = 0;
  app.use((req, _res, next) => { req.staff = { authUserId: 'staff-a', name: 'Staff A', email: null, role: 'owner' }; runWithTenant(tenant, next); });
  app.post('/staff-action', requireStaff, (_req, res) => { writes++; res.json({ saved: true }); });
  app.get('/staff-action', requireStaff, (_req, res) => res.json({ readable: true }));
  app.post('/stock/imports/dealer-a/grok', (req, res) => res.status(req.get('x-stock-import-secret') === 'fictional-stock-key' ? 201 : 401).json({ status: 'fixture' }));
  const server = createServer(app);
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const request = (path: string, method = 'POST', headers: Record<string, string> = {}): Promise<number> => new Promise((resolve, reject) => {
      const call = httpRequest(`http://127.0.0.1:${address.port}${path}`, { method, headers: { host: 'dealer-a.example.test', ...headers } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
      call.on('error', reject); call.end();
    });
    assert.equal(await request('/staff-action', 'POST', { origin: tenant.canonicalOrigin }), 200);
    assert.equal(await request('/staff-action', 'POST', { origin: 'https://dealer-b.example.test', 'sec-fetch-site': 'same-site' }), 403);
    assert.equal(await request('/staff-action', 'POST', { origin: 'null' }), 403);
    assert.equal(await request('/staff-action', 'POST', { 'sec-fetch-site': 'cross-site' }), 403);
    assert.equal(await request('/staff-action'), 200);
    assert.equal(await request('/staff-action', 'GET', { origin: 'https://dealer-b.example.test' }), 200);
    assert.equal(await request('/stock/imports/dealer-a/grok', 'POST', { 'x-stock-import-secret': 'fictional-stock-key' }), 201);
    assert.equal(writes, 2);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (oldMulti === undefined) delete process.env.MULTI_TENANT_ENABLED; else process.env.MULTI_TENANT_ENABLED = oldMulti;
  }
});
