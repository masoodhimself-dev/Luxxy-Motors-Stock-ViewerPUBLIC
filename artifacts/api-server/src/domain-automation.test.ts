import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import { engine } from './test/tenant-test-db';
import { domainSetupHostname } from './lib/domain-setup';
import { automationConfig, DomainProviderError } from './lib/domain-providers';
import { processDomainSetupJobs } from './lib/domain-setup-jobs';
import { domainHttpsReady, domainHttpsRedirectAllowed } from './lib/domain-https-check';

test('operator domain setup is isolated, durable, bounded and never activates a dealership', async () => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';
  process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
  process.env.STOCK_IMPORT_API_HOST = 'imports.example.test';
  process.env.DEMO_BASE_DOMAIN = 'demo.example.test';
  for (const file of (await readdir('../../lib/db/drizzle')).filter(n => /^\d+.*\.sql$/.test(n)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  const { default: router } = await import('./routes/platform-dealers');
  const app = express(); app.use(express.json()); app.use('/api/platform', router);
  const server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No test server.');
  const request = (path: string, method = 'GET', body?: unknown, user = 'user_admin', host = 'admin.example.test', origin?: string): Promise<Response> => new Promise((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${address.port}/api/platform${path}`, { method, headers: { host, 'content-type': 'application/json', 'x-test-user': user, ...(origin ? { origin } : {}) } }, r => {
      let text = ''; r.on('data', c => text += c); r.on('end', () => resolve(new Response(text || null, { status: r.statusCode })));
    }); req.on('error', reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
  });
  try {
    await engine.exec("INSERT INTO dealerships(id,name,canonical_origin,stock_platform,retailer_id,source_url) VALUES ('dealer-a','A','https://a.demo.example.test','autotrader','a','https://www.autotrader.co.uk/a'),('dealer-b','B','https://b.demo.example.test','autotrader','b','https://www.autotrader.co.uk/b')");
    const path = '/dealers/dealer-a/domain-automation';
    assert.equal((await request(path, 'GET', undefined, 'user_other')).status, 403);
    assert.equal((await request(path, 'POST', { hostname: 'example.test' }, 'user_admin', 'admin.example.test', 'https://evil.example.test')).status, 403);
    assert.equal((await request(path, 'GET', undefined, 'user_admin', 'elsewhere.example.test')).status, 403);
    assert.equal((await request('/dealers/missing/domain-automation')).status, 404);
    process.env.DOMAIN_AUTOMATION_ENABLED = 'false';
    assert.equal(((await (await request(path)).json()) as any).configured, false);
    assert.equal((await request(path, 'POST', { hostname: 'example.test' })).status, 409);
    process.env.DOMAIN_AUTOMATION_ENABLED = 'true';
    process.env.CLOUDFLARE_DNS_API_TOKEN = 'fictional-cloudflare-secret';
    process.env.RENDER_DOMAINS_API_KEY = 'fictional-render-secret';
    process.env.DOMAIN_AUTOMATION_RENDER_SERVICE_ID = 'srv-fictional';
    process.env.DOMAIN_AUTOMATION_RENDER_TARGET = 'fictional.onrender.com';
    process.env.DOMAIN_AUTOMATION_ZONES = 'example.test';
    for (const host of ['https://example.test', 'example.test:443', '127.0.0.1', '*.example.test', 'admin.example.test', 'a.demo.example.test', 'fictional.onrender.com']) {
      assert.equal(domainSetupHostname(host), null, host);
      assert.equal((await request(path, 'POST', { hostname: host })).status, 400, host);
    }
    assert.equal((await request(path, 'POST', { hostname: 'not-allowed.test' })).status, 409);
    const created = await request(path, 'POST', { hostname: 'example.test' }); assert.equal(created.status, 202);
    const job = ((await created.json()) as any).job;
    assert.equal(((await (await request(path, 'POST', { hostname: 'example.test' })).json()) as any).job.id, job.id);
    assert.equal((await request('/dealers/dealer-b/domain-automation', 'POST', { hostname: 'example.test' })).status, 409);
    const response = await (await request(path)).text(); assert.ok(!response.includes('fictional-cloudflare-secret')); assert.ok(!response.includes('fictional-render-secret')); assert.ok(!response.includes('verification_token'));
    let writes = 0, failDns = true, dnsVisible = true, renderReady = false, httpsReady = true, probes = 0;
    const providers = {
      preflight: async (_host: string, _token: string) => ({ zoneId: 'zone-a', hostnames: ['example.test', 'www.example.test'] }),
      ensureRender: async () => { writes++; },
      ensureDns: async () => { writes++; if (failDns) throw new DomainProviderError('Cloudflare is temporarily unavailable.', false); return { zoneId: 'zone-a', hostnames: ['example.test', 'www.example.test'] }; },
      renderVerified: async () => renderReady,
    };
    const deps = {
      providers,
      resolveOwnership: async (name: string) => {
        if (!dnsVisible) return [];
        const host = name.replace(/^_dealer-verification\./, '');
        const row = (await engine.query<{ verification_token: string }>('SELECT verification_token FROM dealer_domains WHERE hostname=$1', [host])).rows[0];
        return [[row.verification_token]];
      },
      probeHttps: async (host: string, companions: string[] = []) => {
        probes++;
        assert.deepEqual(companions, host === 'example.test' ? [] : ['example.test']);
        return httpsReady;
      },
    };
    const saved = async () => (await engine.query<Record<string, any>>('SELECT * FROM domain_setup_jobs WHERE id=$1', [job.id])).rows[0];
    const makeDue = async () => { await engine.query('UPDATE domain_setup_jobs SET next_attempt_at=now() WHERE id=$1', [job.id]); };
    // Restart after partial external success: same job resumes and remains unverified.
    await processDomainSetupJobs(deps); assert.equal((await saved()).status, 'waiting'); assert.equal((await saved()).stage, 'dns');
    assert.equal((await engine.query<{ verified: boolean }>("SELECT verified FROM dealer_domains WHERE hostname='example.test'")).rows[0].verified, false);
    const writesBeforeGet = writes; await request(path); assert.equal(writes, writesBeforeGet);
    failDns = false; dnsVisible = false; await makeDue(); await processDomainSetupJobs(deps); assert.equal((await saved()).stage, 'ownership'); assert.equal(probes, 0);
    dnsVisible = true; await makeDue(); await processDomainSetupJobs(deps); assert.equal((await saved()).stage, 'https'); assert.equal(probes, 0);
    renderReady = true; httpsReady = false; await makeDue(); await processDomainSetupJobs(deps); assert.equal((await saved()).status, 'waiting'); assert.equal(probes, 2);
    httpsReady = true; await makeDue(); await processDomainSetupJobs(deps); assert.equal((await saved()).status, 'completed');
    assert.equal((await engine.query<{ count: number }>("SELECT count(*)::int AS count FROM dealer_domains WHERE dealer_id='dealer-a' AND verified=true")).rows[0].count, 2);
    const dealer = (await engine.query<Record<string, any>>("SELECT status,canonical_origin,onboarding_checklist FROM dealerships WHERE id='dealer-a'")).rows[0];
    assert.equal(dealer.status, 'draft'); assert.equal(dealer.canonical_origin, 'https://a.demo.example.test'); assert.deepEqual(dealer.onboarding_checklist, {});
    const doneWrites = writes; await processDomainSetupJobs(deps); assert.equal(writes, doneWrites);
    assert.equal((await request(`${path}/${job.id}/retry`, 'POST', {})).status, 409);

    // Provider destination changes cannot repurpose an existing job.
    await engine.query("UPDATE domain_setup_jobs SET status='waiting',next_attempt_at=now() WHERE id=$1", [job.id]);
    process.env.DOMAIN_AUTOMATION_RENDER_TARGET = 'different.onrender.com';
    await processDomainSetupJobs(deps); assert.equal((await saved()).status, 'blocked'); assert.equal(writes, doneWrites);
    assert.equal((await request(`${path}/${job.id}/retry`, 'POST', {})).status, 409);
    process.env.DOMAIN_AUTOMATION_RENDER_TARGET = 'fictional.onrender.com';
    assert.equal((await request(`/dealers/dealer-b/domain-automation/${job.id}/retry`, 'POST', {})).status, 409);
    assert.equal((await request(`${path}/${job.id}/retry`, 'POST', {})).status, 202);
    // A revoked operator cannot continue a queued external setup.
    process.env.PLATFORM_ADMIN_USER_IDS = 'user_replacement';
    await processDomainSetupJobs(deps); assert.equal((await saved()).status, 'blocked'); assert.equal(writes, doneWrites);
    process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
    await request(`${path}/${job.id}/retry`, 'POST', {});
    await engine.query("UPDATE domain_setup_jobs SET deadline_at=now()-interval '1 second' WHERE id=$1", [job.id]);
    await processDomainSetupJobs(deps); assert.equal((await saved()).status, 'blocked'); assert.equal(writes, doneWrites);

    // Companion collision with another tenant stops all provider writes.
    await engine.exec("INSERT INTO dealer_domains(hostname,dealer_id,verification_token) VALUES ('www.other.example.test','dealer-b','fictional')");
    const other = await (await request(path, 'POST', { hostname: 'other.example.test' })).json() as any;
    const collisionProviders = { ...providers, preflight: async () => ({ zoneId: 'zone-a', hostnames: ['other.example.test', 'www.other.example.test'] }) };
    await processDomainSetupJobs({ ...deps, providers: collisionProviders });
    const blocked = (await engine.query<Record<string, any>>('SELECT * FROM domain_setup_jobs WHERE id=$1', [other.job.id])).rows[0];
    assert.equal(blocked.status, 'blocked'); assert.equal(writes, doneWrites);
    assert.equal((await engine.query<{ dealer_id: string }>("SELECT dealer_id FROM dealer_domains WHERE hostname='www.other.example.test'")).rows[0].dealer_id, 'dealer-b');

    // Disabled runtime never processes even existing jobs.
    process.env.DOMAIN_AUTOMATION_ENABLED = 'false'; await processDomainSetupJobs(deps); assert.equal(writes, doneWrites);
    assert.equal(automationConfig().ready, false);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await engine.close(); }
});

test('HTTPS probe rejects private addresses and only permits an alias redirect to the verified canonical host', async () => {
  assert.equal(await domainHttpsReady('127.0.0.1'), false);
  const canonical = 'example.test', alias = 'www.example.test';
  assert.equal(domainHttpsRedirectAllowed(canonical, [], `https://${alias}/api/healthz`), false);
  assert.equal(domainHttpsRedirectAllowed(alias, [canonical], `https://${canonical}/api/healthz`), true);
  for (const url of ['http://example.test/api/healthz','https://evil.test/api/healthz','https://127.0.0.1/api/healthz','https://user:secret@example.test/api/healthz','https://example.test/api/healthz?token=x','https://example.test/other','https://www.example.test/api/healthz']) {
    assert.equal(domainHttpsRedirectAllowed(alias, [canonical], url), false, url);
  }
});
