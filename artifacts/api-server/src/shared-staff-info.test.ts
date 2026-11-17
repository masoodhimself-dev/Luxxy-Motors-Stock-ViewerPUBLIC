import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request, type IncomingHttpHeaders } from 'node:http';
import test from 'node:test';
import express from 'express';
import { sharedStaffInfo } from './routes/shared-staff-info';

test('staff branding pages are public only on the configured host when enabled', async (t) => {
  const keys = ['MULTI_TENANT_ENABLED', 'STAFF_PORTAL_HOST', 'STAFF_PORTAL_PUBLIC_INFO_ENABLED',
    'STAFF_PORTAL_PUBLIC_SUPPORT_EMAIL', 'PLATFORM_ADMIN_HOST', 'STOCK_IMPORT_API_HOST'] as const;
  const original = new Map(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    MULTI_TENANT_ENABLED: 'true',
    STAFF_PORTAL_HOST: 'staff.example.test',
    STAFF_PORTAL_PUBLIC_INFO_ENABLED: 'false',
    STAFF_PORTAL_PUBLIC_SUPPORT_EMAIL: '',
    PLATFORM_ADMIN_HOST: 'admin.example.test',
    STOCK_IMPORT_API_HOST: 'imports.example.test',
  });
  const app = express();
  app.use(sharedStaffInfo);
  app.use((_req, res) => { res.sendStatus(404); });
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;

  function call(path: string, host = 'staff.example.test', method = 'GET') {
    return new Promise<{ status?: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method, headers: { Host: host } }, res => {
        const pieces: Buffer[] = [];
        res.on('data', chunk => pieces.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(pieces).toString('utf8') }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
  }

  for (const path of ['/about', '/privacy', '/robots.txt']) assert.equal((await call(path)).status, 404);
  process.env.STAFF_PORTAL_PUBLIC_INFO_ENABLED = 'true';
  for (const path of ['/About', '/privacy/', '/privacy/private', '/portal', '/api/staff-portal/memberships']) {
    assert.equal((await call(path)).status, 404);
  }
  assert.equal((await call('/about', 'dealer.example.test')).status, 404);
  assert.equal((await call('/privacy', undefined, 'POST')).status, 404);

  const about = await call('/about');
  assert.equal(about.status, 200);
  assert.match(about.body, /invitation-only/);
  assert.match(about.body, /href="\/portal"/);
  assert.match(about.body, /href="\/privacy"/);
  assert.doesNotMatch(about.body, /<script|<form/);
  const styles = /<style>([\s\S]*)<\/style>/.exec(about.body)?.[1];
  assert.ok(styles);
  const digest = createHash('sha256').update(styles).digest('base64');
  assert.ok(about.headers['content-security-policy']?.includes(`style-src 'sha256-${digest}'`));
  assert.equal((await call('/about', undefined, 'HEAD')).body, '');

  process.env.STAFF_PORTAL_PUBLIC_SUPPORT_EMAIL = 'support+staff@example.test';
  const privacy = await call('/privacy');
  assert.equal(privacy.status, 200);
  assert.match(privacy.body, /Clerk/);
  assert.match(privacy.body, /does not give DealerOS access to your Gmail, Google Drive files/);
  assert.match(privacy.body, /href="mailto:support\+staff@example.test"/);
  process.env.STAFF_PORTAL_PUBLIC_SUPPORT_EMAIL = 'support@example.test"><img src=x onerror=alert(1)>';
  assert.doesNotMatch((await call('/privacy')).body, /onerror|mailto:/);

  const robots = await call('/robots.txt');
  assert.equal(robots.body, 'User-agent: *\nDisallow: /\nAllow: /about$\nAllow: /privacy$\n');
  assert.equal((await call('/robots.txt', 'dealer.example.test')).status, 404);
  process.env.PLATFORM_ADMIN_HOST = 'staff.example.test';
  assert.equal((await call('/about')).status, 404);
});
