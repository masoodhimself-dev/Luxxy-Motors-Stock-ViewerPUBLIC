import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, engine, dealershipsTable, dealerDomainsTable, dealerDemosTable } from './test/tenant-test-db';
import { currentTenant } from './lib/tenant-context';
import { resolveTenant } from './middlewares/tenant';

process.env.MULTI_TENANT_ENABLED = 'true';
process.env.DEMO_BASE_DOMAIN = 'demo.example.test';
process.env.PLATFORM_ADMIN_HOST = 'platform.example.test';
process.env.STOCK_IMPORT_API_HOST = 'imports.example.test';

const liveOrigin = 'https://live.example.test';
const formerAlias = 'former.demo.example.test';
const ownedToken = 'platform-owned-demo=' + 'a'.repeat(48);

before(async () => {
  const directory = join(process.cwd(), '../../lib/db/drizzle');
  for (const file of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await engine.exec(await readFile(join(directory, file), 'utf8'));
  }
  for (const [id, origin] of [['promoted', liveOrigin], ['unconverted', 'https://active.demo.example.test'], ['expired', 'https://expired.demo.example.test'], ['other', 'https://other.example.test']] as const) {
    await db.insert(dealershipsTable).values({ id, name: id, status: 'active', canonicalOrigin: origin, stockPlatform: 'cazoo', retailerId: id, sourceUrl: 'https://www.cazoo.co.uk/dealers/fixture/' });
  }
  for (const [hostname, dealerId, verified, verificationToken] of [
    ['live.example.test', 'promoted', true, 'custom-verification'],
    [formerAlias, 'promoted', false, ownedToken],
    ['secondary.example.test', 'promoted', true, 'custom-verification'],
    ['unverified.example.test', 'promoted', false, 'custom-verification'],
    ['forged.demo.example.test', 'promoted', false, 'not-platform-owned'],
    ['active.demo.example.test', 'unconverted', true, ownedToken],
    ['expired.demo.example.test', 'expired', true, ownedToken],
    ['other.example.test', 'other', true, 'custom-verification'],
  ] as const) {
    await db.insert(dealerDomainsTable).values({ hostname, dealerId, verified, verificationToken });
  }
  for (const [dealerId, convertedAt, expiresAt] of [
    ['promoted', new Date('2026-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z')],
    ['unconverted', null, new Date('2100-01-01T00:00:00Z')],
    ['expired', null, new Date('2020-01-01T00:00:00Z')],
  ] as const) {
    await db.insert(dealerDemosTable).values({ dealerId, convertedAt, expiresAt, recipient: 'test@example.test', updatedBy: 'fixture' });
  }
});
after(async () => { await engine.close(); });

type Result = { status: number; body?: unknown; headers: Record<string, string>; dealerId?: string; demo?: boolean };
function request(host: string, originalUrl = '/vehicle/fixture', method = 'GET', forwardedHost?: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const result: Result = { status: 200, headers: {} };
    const req = {
      method, originalUrl, path: originalUrl.split('?')[0], body: {}, query: {},
      get(name: string) { return name.toLowerCase() === 'host' ? host : name.toLowerCase() === 'x-forwarded-host' ? forwardedHost : undefined; },
    } as unknown as Request;
    const res = {
      status(value: number) { result.status = value; return res; },
      json(body: unknown) { result.body = body; resolve(result); return res; },
      set(headers: Record<string, string>) { for (const [key, value] of Object.entries(headers)) result.headers[key.toLowerCase()] = value; return res; },
      redirect(status: number, location: string) { result.status = status; result.headers.location = location; resolve(result); return res; },
    } as unknown as Response;
    resolveTenant(req, res, error => {
      if (error) { reject(error); return; }
      result.dealerId = currentTenant()?.dealerId;
      result.demo = currentTenant()?.demo;
      resolve(result);
    });
  });
}

test('old converted demo QR and customer links redirect to the same dealer with exact path and query', async () => {
  const path = '/customer/sale/capability-token?document=invoice&return=%2Fvehicle%2Ffixture';
  const result = await request(formerAlias, path);
  assert.equal(result.status, 308);
  assert.equal(result.headers.location, liveOrigin + path);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  assert.equal(result.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
  assert.equal(result.dealerId, undefined, 'the former alias never serves the live application');
  const head = await request(formerAlias, '/vehicle/fixture?print=1', 'HEAD');
  assert.equal(head.status, 308);
  assert.equal(head.headers.location, liveOrigin + '/vehicle/fixture?print=1');
});

test('the verified live domain and ordinary custom aliases resolve normally', async () => {
  for (const host of ['live.example.test', 'secondary.example.test']) {
    const result = await request(host);
    assert.equal(result.status, 200);
    assert.equal(result.dealerId, 'promoted');
    assert.equal(result.headers.location, undefined);
    assert.equal(result.demo, undefined);
  }
});

test('unconverted and expired demos retain their existing restrictions', async () => {
  const active = await request('active.demo.example.test');
  assert.equal(active.status, 200);
  assert.equal(active.dealerId, 'unconverted');
  assert.equal(active.demo, true);
  assert.equal(active.headers.location, undefined);
  assert.equal((await request('expired.demo.example.test')).status, 410);
});

test('former demo aliases do not redirect or accept POST, PUT, PATCH, or DELETE', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const result = await request(formerAlias, '/api/enquiries', method);
    assert.equal(result.status, 421, method);
    assert.equal(result.headers.location, undefined);
    assert.equal(result.dealerId, undefined);
  }
  const importResult = await request(formerAlias, '/api/stock/imports/promoted/grok', 'POST');
  assert.equal(importResult.status, 421);
  assert.deepEqual((importResult.body as { errors: Array<{ code: string }> }).errors.map(error => error.code), ['wrong_import_host']);
});

test('unknown hosts, spoofed forwarded hosts and arbitrary unverified mappings cannot redirect', async () => {
  for (const host of ['unknown.demo.example.test', 'unknown.example.test', 'unverified.example.test', 'forged.demo.example.test', 'former.demo.example.test.evil.test', 'live.example.test@evil.test']) {
    const result = await request(host, '/vehicle/fixture', 'GET', formerAlias);
    assert.equal(result.status, 421, host);
    assert.equal(result.headers.location, undefined);
  }
});

test('the destination must be a verified HTTPS origin mapped to this exact dealer', async () => {
  const unsafe = [
    'https://other.example.test', 'https://unverified.example.test', 'https://unknown.example.test',
    'http://live.example.test', 'https://live.example.test:8443', 'https://user:pass@live.example.test',
    'https://live.example.test/path', 'https://live.example.test/?next=1', 'https://live.example.test/#fragment',
    'https://' + formerAlias, 'https://active.demo.example.test', 'not-an-origin',
  ];
  try {
    for (const canonicalOrigin of unsafe) {
      await db.update(dealershipsTable).set({ canonicalOrigin }).where(eq(dealershipsTable.id, 'promoted'));
      const result = await request(formerAlias);
      assert.equal(result.status, 421, canonicalOrigin);
      assert.equal(result.headers.location, undefined);
    }
  } finally { await db.update(dealershipsTable).set({ canonicalOrigin: liveOrigin }).where(eq(dealershipsTable.id, 'promoted')); }
});

test('request-target tricks cannot create an external redirect', async () => {
  for (const path of ['//evil.example.test/x', '/\\evil.example.test/x', 'https://evil.example.test/x', '/vehicle/fixture\nLocation: https://evil.example.test']) {
    const result = await request(formerAlias, path);
    assert.equal(result.status, 421, JSON.stringify(path));
    assert.equal(result.headers.location, undefined);
  }
  const ordinaryQuery = '/vehicle/fixture?next=https%3A%2F%2Fevil.example.test';
  assert.equal((await request(formerAlias, ordinaryQuery)).headers.location, liveOrigin + ordinaryQuery);
});

test('a converted former alias stays redirect-only even if its old verified flag is retained', async () => {
  try {
    await db.update(dealerDomainsTable).set({ verified: true }).where(eq(dealerDomainsTable.hostname, formerAlias));
    assert.equal((await request(formerAlias)).status, 308);
    assert.equal((await request(formerAlias, '/api/enquiries', 'POST')).status, 421);
  } finally { await db.update(dealerDomainsTable).set({ verified: false }).where(eq(dealerDomainsTable.hostname, formerAlias)); }
});

test('suspended dealerships cannot use their former alias', async () => {
  try {
    await db.update(dealershipsTable).set({ status: 'suspended' }).where(eq(dealershipsTable.id, 'promoted'));
    assert.equal((await request(formerAlias)).status, 421);
  } finally { await db.update(dealershipsTable).set({ status: 'active' }).where(eq(dealershipsTable.id, 'promoted')); }
});
