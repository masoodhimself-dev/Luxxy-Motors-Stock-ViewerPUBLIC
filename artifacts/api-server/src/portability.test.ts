import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sendEmail } from './lib/email-provider';
import { serveFrontend } from './lib/serve-frontend';
import { siteUrl } from './lib/enquiry-links';

const savedFetch = globalThis.fetch;
const keys = ['RESEND_ENABLED', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'PUBLIC_SITE_URL', 'PUBLIC_SITE_BASE_PATH', 'NODE_ENV'] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => {
  globalThis.fetch = savedFetch;
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

test('direct email preserves sender, attachments and idempotency without any platform credentials', async () => {
  process.env.RESEND_ENABLED = 'true';
  process.env.RESEND_API_KEY = 're_syntheticIntegrationTestOnly';
  process.env.RESEND_FROM_EMAIL = 'Dealer <hello@dealer.example>';
  let called = false;
  globalThis.fetch = async (url, init) => {
    called = true;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer re_syntheticIntegrationTestOnly');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'enquiry-test');
    assert.deepEqual(JSON.parse(String(init?.body)), { from: process.env.RESEND_FROM_EMAIL, to: ['buyer@example.test'], subject: 'Viewing', html: '<p>Booked</p>', attachments: [{filename:'viewing.ics',content:'YQ=='}] });
    assert.ok(init?.signal);
    return new Response(JSON.stringify({id:'email-test'}), {status:200});
  };
  assert.equal(await sendEmail('buyer@example.test','Viewing','<p>Booked</p>','enquiry-test','Dealer',[{filename:'viewing.ics',content:'YQ=='}]), 'email-test');
  assert.ok(called);
});

test('missing email credentials fail before any network request', async () => {
  process.env.RESEND_ENABLED = 'true';
  delete process.env.RESEND_API_KEY;
  globalThis.fetch = async () => { throw new Error('Unexpected network'); };
  await assert.rejects(sendEmail('x','x','x','x','x'), /Configure RESEND/);
});

test('provider rejection does not leak response contents', async () => {
  process.env.RESEND_ENABLED = 'true'; process.env.RESEND_API_KEY = 're_syntheticIntegrationTestOnly'; process.env.RESEND_FROM_EMAIL = 'dealer@example.test';
  globalThis.fetch = async () => new Response('sensitive provider response', {status:429});
  await assert.rejects(sendEmail('buyer@example.test','Receipt','<p>Confirmed</p>','receipt-test','Dealer'), /^Error: Email provider returned HTTP 429\.$/);
});

test('production links require an explicit public URL and preserve base path', () => {
  process.env.NODE_ENV = 'production'; delete process.env.PUBLIC_SITE_URL;
  assert.throws(() => siteUrl('/viewing/token'), /PUBLIC_SITE_URL/);
  process.env.PUBLIC_SITE_URL = 'https://dealer.example/'; process.env.PUBLIC_SITE_BASE_PATH = '/showroom/';
  assert.equal(siteUrl('/viewing/token'), 'https://dealer.example/showroom/viewing/token');
  for (const invalid of ['http://dealer.example', 'https://user:pass@dealer.example', 'https://dealer.example/path', 'javascript:alert(1)']) {
    process.env.PUBLIC_SITE_URL = invalid;
    assert.throws(() => siteUrl('/viewing/token'));
  }
});

test('portable frontend serves deep links and assets without swallowing API or asset 404s', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luxxy-static-'));
  await writeFile(path.join(dir, 'index.html'), '<html>Standalone showroom</html>');
  await writeFile(path.join(dir, 'app.js'), 'console.log("test");');
  const app = express();
  app.get('/api/healthz', (_req,res) => {res.json({status:'ok'});});
  app.use(['/api','/share'], (_req,res) => {res.status(404).json({error:'Not found'});});
  serveFrontend(app, dir);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const route of ['/', '/vehicle/test', '/portal/sales', '/sign/example']) {
      const response = await fetch(base+route);
      assert.equal(response.status,200); assert.match(await response.text(), /Standalone showroom/);
    }
    assert.equal((await fetch(base+'/app.js')).status,200);
    assert.equal((await fetch(base+'/missing.js')).status,404);
    assert.equal((await fetch(base+'/api/missing')).status,404);
    assert.equal((await fetch(base+'/share/missing')).status,404);
    assert.deepEqual(await (await fetch(base+'/api/healthz')).json(), {status:'ok'});
  } finally {
    await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir,{recursive:true,force:true});
  }
});
