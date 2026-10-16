import assert from 'node:assert/strict';
import test from 'node:test';
import { automationConfig, createDomainProviders, DomainProviderError, type DomainAutomationConfig } from './lib/domain-providers';

const config: DomainAutomationConfig = {
  cloudflareToken: 'fictional-cloudflare-secret', renderToken: 'fictional-render-secret',
  serviceId: 'srv-fictional', target: 'fictional-site.onrender.com', allowedZones: ['example.test'],
};
const verificationToken = 'dealer-verification=fictionalverificationvalue123456';
const accountId = '0123456789abcdef0123456789abcdef';
type Dns = { type: string; name: string; content: string; proxied?: boolean };
type Domain = { name: string; redirectForName: string; verificationStatus: string };

function fixture() {
  const dns: Dns[] = [];
  const domains = new Map<string, Domain>();
  const calls: Array<{ url: URL; method: string; headers: Headers; body?: Record<string, unknown>; redirect?: RequestInit['redirect']; signal?: AbortSignal | null }> = [];
  let dnsTimeout = false, renderTimeout = false, renderConflict = false, verified = false;
  let override: ((url: URL, init: RequestInit) => Response | null) | undefined;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const transport: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); const method = init.method ?? 'GET';
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : undefined, redirect: init.redirect, signal: init.signal });
    const other = override?.(url, init); if (other) return other;
    if (url.hostname === 'api.cloudflare.com') {
      if (url.pathname === '/client/v4/zones' && method === 'GET') return json({ success: true, result: [{ id: 'zonefictional', name: 'example.test', type: 'full', status: 'active', account: { id: accountId } }], result_info: { total_pages: 1 } });
      if (url.pathname === '/client/v4/zones/zonefictional/dns_records') {
        if (method === 'GET') return json({ success: true, result: dns.filter(r => r.name === url.searchParams.get('name')), result_info: { total_pages: 1 } });
        if (method === 'POST') {
          const record = JSON.parse(String(init.body)); dns.push(record);
          if (dnsTimeout) { dnsTimeout = false; throw new Error(`timeout ${config.cloudflareToken}`); }
          return json({ success: true, result: record }, 200);
        }
      }
    }
    if (url.hostname === 'api.render.com') {
      if (url.pathname === '/v1/services/srv-fictional' && method === 'GET') return json({ id: config.serviceId, type: 'web_service', serviceDetails: { url: `https://${config.target}` } });
      const prefix = '/v1/services/srv-fictional/custom-domains';
      if (url.pathname === prefix && method === 'POST') {
        const { name } = JSON.parse(String(init.body));
        domains.set(name, { name, redirectForName: '', verificationStatus: 'unverified' });
        const pair = name === 'example.test' ? 'www.example.test' : name === 'www.example.test' ? 'example.test' : undefined;
        if (pair) domains.set(pair, { name: pair, redirectForName: name, verificationStatus: 'unverified' });
        if (renderTimeout) { renderTimeout = false; throw new Error(`timeout ${config.renderToken}`); }
        if (renderConflict) { renderConflict = false; return json({ message: config.renderToken }, 409); }
        return json([...domains.values()], 201);
      }
      const name = decodeURIComponent(url.pathname.slice(prefix.length + 1).replace(/\/verify$/, ''));
      if (url.pathname === `${prefix}/${name}/verify` && method === 'POST') { if (verified && domains.has(name)) domains.get(name)!.verificationStatus = 'verified'; return new Response(null, { status: 202 }); }
      if (method === 'GET' && url.pathname === `${prefix}/${name}`) return domains.has(name) ? json(domains.get(name)) : json({ message: 'not found' }, 404);
    }
    throw new Error(`Unexpected provider request: ${url.origin}${url.pathname}`);
  };
  return {
    dns, domains, calls, transport, provider: createDomainProviders(config, transport),
    setDnsTimeout: () => { dnsTimeout = true; }, setRenderTimeout: () => { renderTimeout = true; }, setRenderConflict: () => { renderConflict = true; },
    setVerified: () => { verified = true; }, setOverride: (value: typeof override) => { override = value; },
  };
}

test('domain automation config is opt-in and requires scoped zones and a Render target', () => {
  const keys = ['DOMAIN_AUTOMATION_ENABLED', 'CLOUDFLARE_DNS_API_TOKEN', 'RENDER_DOMAINS_API_KEY', 'DOMAIN_AUTOMATION_RENDER_SERVICE_ID', 'DOMAIN_AUTOMATION_RENDER_TARGET', 'DOMAIN_AUTOMATION_ZONES', 'DOMAIN_AUTOMATION_CLOUDFLARE_ACCOUNT_ID'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(automationConfig().ready, false);
    process.env.DOMAIN_AUTOMATION_ENABLED = 'true';
    process.env.CLOUDFLARE_DNS_API_TOKEN = config.cloudflareToken;
    process.env.RENDER_DOMAINS_API_KEY = config.renderToken;
    process.env.DOMAIN_AUTOMATION_RENDER_SERVICE_ID = config.serviceId;
    process.env.DOMAIN_AUTOMATION_RENDER_TARGET = config.target;
    assert.equal(automationConfig().ready, false);
    assert.ok(!JSON.stringify(automationConfig()).includes(config.cloudflareToken));
    process.env.DOMAIN_AUTOMATION_ZONES = 'example.test';
    assert.equal(automationConfig().ready, true);
    delete process.env.DOMAIN_AUTOMATION_ZONES;
    process.env.DOMAIN_AUTOMATION_CLOUDFLARE_ACCOUNT_ID = accountId;
    assert.equal(automationConfig().ready, true, 'an approved account allows exact zone discovery');
    process.env.DOMAIN_AUTOMATION_CLOUDFLARE_ACCOUNT_ID = 'not-a-cloudflare-account';
    assert.equal(automationConfig().ready, false);
    process.env.DOMAIN_AUTOMATION_CLOUDFLARE_ACCOUNT_ID = accountId;
    process.env.DOMAIN_AUTOMATION_RENDER_TARGET = 'https://attacker.example/';
    assert.equal(automationConfig().ready, false);
  } finally { for (const key of keys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
});

test('preflight is read-only, covers apex/www, and DNS is create-only and idempotent', async () => {
  const f = fixture();
  f.dns.push({ type: 'MX', name: 'example.test', content: 'mail.example.test' }, { type: 'TXT', name: 'example.test', content: 'unrelated-policy' });
  assert.deepEqual(await f.provider.preflight('example.test', verificationToken), { zoneId: 'zonefictional', hostnames: ['example.test', 'www.example.test'] });
  assert.ok(f.calls.every(call => call.method === 'GET'));
  await f.provider.ensureDns('example.test', verificationToken);
  await f.provider.ensureDns('www.example.test', verificationToken);
  assert.equal(f.dns.filter(r => r.type === 'CNAME').length, 2);
  assert.equal(f.dns.filter(r => r.type === 'TXT' && r.name.startsWith('_dealer-verification.')).length, 2);
  assert.ok(f.dns.filter(r => r.type === 'CNAME').every(r => r.proxied === false && r.content === config.target));
  const count = f.calls.filter(call => call.method === 'POST').length;
  await f.provider.ensureDns('example.test', verificationToken);
  await f.provider.ensureDns('www.example.test', verificationToken);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, count);
  assert.ok(f.dns.some(r => r.type === 'MX' && r.content === 'mail.example.test'));
  assert.ok(f.dns.some(r => r.content === 'unrelated-policy'));
  assert.ok(f.calls.every(call => call.method === 'GET' || call.method === 'POST'));
});

test('existing exact CNAME and proxied status are preserved; subdomain has no automatic www pair', async () => {
  const f = fixture();
  f.dns.push({ type: 'CNAME', name: 'cars.example.test', content: `${config.target}.`, proxied: true });
  const result = await f.provider.ensureDns('cars.example.test', verificationToken);
  assert.deepEqual(result.hostnames, ['cars.example.test']);
  assert.equal(f.dns.find(r => r.type === 'CNAME')?.proxied, true);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});

test('conflicting primary, companion and ownership DNS all stop before any write', async () => {
  for (const record of [
    { type: 'A', name: 'example.test', content: '192.0.2.1' },
    { type: 'AAAA', name: 'www.example.test', content: '2001:db8::1' },
    { type: 'CNAME', name: 'www.example.test', content: 'old.example.test' },
    { type: 'CNAME', name: '_dealer-verification.www.example.test', content: 'old.example.test' },
  ]) {
    const f = fixture(); f.dns.push(record);
    await assert.rejects(f.provider.ensureDns('example.test', verificationToken), error => error instanceof DomainProviderError && error.permanent);
    assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('all filtered DNS pages are checked, including a late conflicting record', async () => {
  const f = fixture();
  f.setOverride(url => {
    if (url.hostname === 'api.cloudflare.com' && url.pathname.endsWith('/dns_records') && url.searchParams.get('name') === 'example.test') {
      return new Response(JSON.stringify({ success: true, result: url.searchParams.get('page') === '1' ? [{ name: 'example.test', type: 'TXT', content: 'okay' }] : [{ name: 'example.test', type: 'AAAA', content: '2001:db8::1' }], result_info: { total_pages: 2 } }), { status: 200 });
    }
    return null;
  });
  await assert.rejects(f.provider.preflight('example.test', verificationToken), DomainProviderError);
  assert.ok(f.calls.some(call => call.url.searchParams.get('page') === '2'));
  assert.ok(f.calls.every(call => call.method === 'GET'));
});

test('a successful DNS create followed by a timeout is re-read rather than duplicated', async () => {
  const f = fixture(); f.setDnsTimeout();
  await f.provider.ensureDns('cars.example.test', verificationToken);
  await f.provider.ensureDns('cars.example.test', verificationToken);
  assert.equal(f.dns.filter(r => r.type === 'CNAME').length, 1);
  assert.equal(f.dns.filter(r => r.type === 'TXT').length, 1);
});

test('Render create array, uncertain POST and conflict are followed by exact GET and never duplicate domains', async () => {
  for (const mode of ['normal', 'timeout', 'conflict']) {
    const f = fixture(); if (mode === 'timeout') f.setRenderTimeout(); if (mode === 'conflict') f.setRenderConflict();
    await f.provider.ensureRender('example.test');
    await f.provider.ensureRender('example.test');
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.url.pathname.endsWith('/custom-domains')).length, 1);
    assert.equal(f.domains.size, 2);
    assert.equal(await f.provider.renderVerified('example.test'), false, '202 is not proof of verification');
    f.setVerified();
    assert.equal(await f.provider.renderVerified('example.test'), false, 'a just-triggered check still needs a fresh GET');
    assert.equal(await f.provider.renderVerified('example.test'), true);
    assert.equal(await f.provider.renderVerified('www.example.test'), false, 'paired redirect is allowed but must still verify');
    assert.equal(await f.provider.renderVerified('www.example.test'), true);
  }
});

test('a requested canonical domain redirect is blocked without altering it', async () => {
  const f = fixture(); f.domains.set('example.test', { name: 'example.test', redirectForName: 'www.example.test', verificationStatus: 'verified' });
  await assert.rejects(f.provider.ensureRender('example.test'), error => error instanceof DomainProviderError && error.permanent);
  assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
});

test('scoped zones, active Cloudflare access and valid hostnames are required', async () => {
  const f = fixture();
  for (const hostname of ['other.test', 'example.test.evil.test', 'https://example.test', 'example.test:443', '*.example.test', '127.0.0.1']) {
    await assert.rejects(f.provider.preflight(hostname, verificationToken), DomainProviderError);
    await assert.rejects(f.provider.ensureRender(hostname), DomainProviderError);
  }
  assert.equal(f.calls.length, 0);
  f.setOverride(url => url.pathname === '/client/v4/zones' ? new Response(JSON.stringify({ success: true, result: [{ id: 'bad', name: 'other.test', status: 'active', type: 'full' }], result_info: { total_pages: 1 } })) : null);
  await assert.rejects(f.provider.preflight('example.test', verificationToken), error => error instanceof DomainProviderError && error.permanent);
  assert.ok(f.calls.every(call => call.method === 'GET'));
});

test('Render service identity must match the DNS destination before any write', async () => {
  const f = fixture();
  f.setOverride(url => url.pathname === '/v1/services/srv-fictional' ? new Response(JSON.stringify({ id: config.serviceId, type: 'web_service', serviceDetails: { url: 'https://wrong-site.onrender.com' } })) : null);
  await assert.rejects(f.provider.ensureDns('example.test', verificationToken), error => error instanceof DomainProviderError && error.permanent);
  await assert.rejects(f.provider.ensureRender('example.test'), error => error instanceof DomainProviderError && error.permanent);
  assert.ok(f.calls.every(call => call.method === 'GET'));
});

test('account-scoped discovery finds the exact zone and pairs apex/www without per-zone configuration', async () => {
  const f = fixture();
  const provider = createDomainProviders({ ...config, allowedZones: [], accountId }, f.transport);
  const plan = await provider.preflight('www.example.test', verificationToken);
  assert.deepEqual(plan.hostnames, ['www.example.test', 'example.test']);
  assert.equal(plan.zoneId, 'zonefictional');
  const searches = f.calls.filter(call => call.url.pathname === '/client/v4/zones');
  assert.deepEqual(searches.map(call => call.url.searchParams.get('name')), ['www.example.test', 'example.test']);
  assert.ok(searches.every(call => call.url.searchParams.get('account.id') === accountId && call.url.searchParams.get('status') === 'active'));
  assert.ok(f.calls.every(call => call.method === 'GET'));
  await provider.ensureDns('www.example.test', verificationToken);
  assert.equal(f.dns.filter(record => record.type === 'CNAME').length, 2);
  await provider.ensureRender('www.example.test');
  assert.ok(f.domains.has('www.example.test'));
});

test('account-scoped discovery rejects wrong-account, ambiguous and missing zones before any write', async () => {
  for (const mode of ['wrong-account', 'ambiguous', 'missing']) {
    const f = fixture();
    f.setOverride(url => {
      if (url.pathname !== '/client/v4/zones') return null;
      const zone = { id: 'zonefictional', name: 'example.test', type: 'full', status: 'active', account: { id: mode === 'wrong-account' ? 'f'.repeat(32) : accountId } };
      return new Response(JSON.stringify({ success: true, result: mode === 'missing' ? [] : mode === 'ambiguous' ? [zone, { ...zone, id: 'otherzone' }] : [zone], result_info: { total_pages: 1 } }));
    });
    const provider = createDomainProviders({ ...config, allowedZones: [], accountId }, f.transport);
    await assert.rejects(provider.ensureDns('example.test', verificationToken), error => error instanceof DomainProviderError && error.permanent);
    await assert.rejects(provider.ensureRender('example.test'), error => error instanceof DomainProviderError && error.permanent);
    assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('an explicit zone allow-list remains restrictive when account scope is also configured', async () => {
  const f = fixture();
  const provider = createDomainProviders({ ...config, accountId }, f.transport);
  await assert.rejects(provider.preflight('another.test', verificationToken), DomainProviderError);
  await assert.rejects(provider.ensureRender('another.test'), DomainProviderError);
  assert.equal(f.calls.length, 0);
});

test('tokens go only to fixed TLS provider hosts, redirects are refused, and request deadlines exist', async () => {
  const f = fixture(); await f.provider.ensureDns('cars.example.test', verificationToken); await f.provider.ensureRender('cars.example.test');
  for (const call of f.calls) {
    assert.equal(call.url.protocol, 'https:');
    assert.equal(call.redirect, 'error');
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(call.headers.get('authorization'), `Bearer ${call.url.hostname === 'api.cloudflare.com' ? config.cloudflareToken : config.renderToken}`);
    assert.ok(!call.url.href.includes('secret'));
    if (call.url.pathname === '/client/v4/zones') assert.equal(call.url.searchParams.get('per_page'), '50');
  }
});

test('provider failures expose only safe classified messages, never raw errors or bodies', async () => {
  for (const status of [301, 400, 401, 403, 429, 500, 503]) {
    const f = fixture(); f.setOverride(() => new Response(JSON.stringify({ message: `${config.cloudflareToken} ${config.renderToken} customer@example.test` }), { status, headers: status === 301 ? { Location: 'https://attacker.example/' } : {} }));
    for (const action of [() => f.provider.preflight('example.test', verificationToken), () => f.provider.ensureRender('example.test')]) {
      await assert.rejects(action(), error => {
        assert.ok(error instanceof DomainProviderError);
        assert.equal(error.permanent, status !== 429 && status < 500);
        assert.ok(!String(error).includes('fictional-'));
        assert.ok(!String(error).includes('customer@'));
        return true;
      });
    }
  }
  const f = fixture(); f.setOverride(() => new Response('x'.repeat(1024 * 1024 + 1), { status: 200 }));
  await assert.rejects(f.provider.preflight('example.test', verificationToken), error => error instanceof DomainProviderError && !error.permanent);
});
