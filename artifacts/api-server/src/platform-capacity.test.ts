import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import express from 'express';
import { engine, pool } from './test/tenant-test-db';
import { importCapacitySql, importCapacitySummary } from './lib/platform-capacity';

test('freshness thresholds use collection time and preserve missing connection and failed-attempt signals', () => {
  const now = Date.parse('2026-10-17T14:00:00Z');
  const base = { id: 'example', name: 'Example Motors', active_key_count: 1, last_success_received_at: new Date(now), last_attempt_at: new Date(now), last_attempt_status: 'completed' };
  const summary = importCapacitySummary([
    { ...base, last_success_scraped_at: new Date(now - 13 * 3_600_000 + 1_000) },
    { ...base, id: 'warning', last_success_scraped_at: new Date(now - 13 * 3_600_000) },
    { ...base, id: 'critical', last_success_scraped_at: new Date(now - 14 * 3_600_000) },
    { ...base, id: 'not-connected', active_key_count: 0, last_success_scraped_at: null },
    { ...base, id: 'failed', last_attempt_status: 'failed', last_success_scraped_at: new Date(now) },
  ], now);
  assert.deepEqual(summary.dealers.map(dealer => dealer.freshness), ['fresh', 'warning', 'critical', 'missing', 'fresh']);
  assert.equal(summary.attentionCount, 4);
  assert.equal(summary.missingConnectionCount, 1);
  assert.equal(summary.neverImportedCount, 1);
  assert.equal(summary.warningCount, 1);
  assert.equal(summary.criticalCount, 1);
});

test('admin capacity aggregates active live dealers, avoids snapshot/private fields and preserves access checks', async () => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';
  process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  // Remove only the migration's fictional default from this isolated test database.
  await engine.exec("UPDATE dealerships SET status='draft'");
  const now = Date.now();
  for (const [id, status] of [['fresh', 'active'], ['stale', 'active'], ['missing', 'active'], ['suspended', 'suspended'], ['demo', 'active'], ['converted', 'active']]) {
    await engine.query("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$2,$3,$4,'autotrader',$1,'https://www.autotrader.co.uk/fictional')", [id, `${id} Motors`, status, `https://${id}.example.test`]);
    if (id !== 'missing') await engine.query('INSERT INTO dealer_import_keys(dealer_id,secret_hash) VALUES($1,$2)', [id, `private-key-hash-${id}`]);
  }
  await engine.exec("INSERT INTO dealer_demos(dealer_id,recipient,expires_at,updated_by,converted_at) VALUES ('demo','private-recipient@example.test',now()+interval '1 day','private-admin',NULL),('converted','private-recipient@example.test',now()+interval '1 day','private-admin',now())");
  async function run(id: string, suffix: string, hours: number, status = 'completed') {
    await engine.query("INSERT INTO stock_import_runs(dealer_id,run_id,source,retailer_id,schema_version,scraped_at,received_at,expected_count,received_count,status,raw_snapshot,errors) VALUES($1,$2,'grok',$1,'1',$3,$4,1,1,$5,'{\"private-snapshot\":\"must-not-leak\"}','[{\"message\":\"private-provider-error\"}]')", [id, `${id}-${suffix}`, new Date(now - hours * 3_600_000).toISOString(), new Date(now - hours * 3_600_000 + 1_000).toISOString(), status]);
  }
  await run('fresh', 'old', 20); await run('fresh', 'success', 1); await run('fresh', 'failed', 0, 'failed');
  await run('stale', 'success', 15); await run('suspended', 'success', 1); await run('demo', 'success', 1); await run('converted', 'success', 1);
  const aggregate = importCapacitySummary((await pool.query(importCapacitySql)).rows as Parameters<typeof importCapacitySummary>[0]);
  assert.deepEqual(aggregate.dealers.map(dealer => dealer.dealerId), ['converted', 'fresh', 'missing', 'stale']);
  assert.equal(aggregate.dealers.find(dealer => dealer.dealerId === 'fresh')?.lastAttemptStatus, 'failed');
  assert.equal(aggregate.dealers.find(dealer => dealer.dealerId === 'fresh')?.freshness, 'fresh');
  assert.equal(aggregate.criticalCount, 1);

  const { default: router } = await import('./routes/platform-dealers');
  const app = express(); app.use('/api/platform', router);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test address');
  const request = (user = 'user_admin', host = 'admin.example.test', origin?: string): Promise<{ status: number; body: any; cache: string | undefined }> => new Promise((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${address.port}/api/platform/capacity`, { headers: { host, 'x-test-user': user, ...(origin ? { origin } : {}) } }, response => {
      let raw = ''; response.on('data', chunk => { raw += chunk; }); response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(raw), cache: response.headers['cache-control'] }));
    }); req.on('error', reject); req.end();
  });
  try {
    assert.equal((await request('user_other')).status, 403);
    assert.equal((await request('user_admin', 'fresh.example.test')).status, 403);
    assert.equal((await request('user_admin', 'admin.example.test', 'https://evil.example.test')).status, 403);
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.cache, 'no-store');
    assert.equal(result.body.scope, 'this_process');
    assert.equal(result.body.database.ready, true);
    assert.equal(result.body.database.pool.maximum, 10);
    assert.equal(result.body.imports.dealerCount, 4);
    assert.equal(result.body.imports.admission.maximum, 2);
    assert.ok(Array.isArray(result.body.jobs.sweeps));
    const serialized = JSON.stringify(result.body);
    assert.doesNotMatch(serialized, /private|must-not-leak|secret_hash|raw_snapshot|source_url|recipient|errors/);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await engine.close();
  }
});
