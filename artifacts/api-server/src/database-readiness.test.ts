import test from 'node:test';
import assert from 'node:assert/strict';
import { databasePoolConfig } from '../../../lib/db/src/pool-config';
import { createDatabaseReadiness } from './lib/database-readiness';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('shared pool uses bounded conservative defaults and rejects malformed overrides without echoing values', () => {
  const config = databasePoolConfig({ DATABASE_URL: 'postgres://fictional:private@example.invalid/test' });
  assert.equal(config.max, 10);
  assert.equal(config.min, 0);
  assert.equal(config.connectionTimeoutMillis, 5_000);
  assert.equal(config.idleTimeoutMillis, 30_000);
  assert.equal(config.statement_timeout, 60_000);
  assert.equal(config.idle_in_transaction_session_timeout, 60_000);
  assert.equal(config.query_timeout, undefined);
  assert.equal(config.keepAlive, true);
  assert.equal(databasePoolConfig({ DATABASE_URL: 'postgres://fictional', DB_POOL_MAX: '20' }).max, 20);
  for (const value of ['0', '-1', '31', '1.5', '100000000000000000000000', 'private-mistaken-secret']) {
    assert.throws(() => databasePoolConfig({ DATABASE_URL: 'postgres://fictional', DB_POOL_MAX: value }), error => {
      assert.equal((error as Error).message, 'DB_POOL_MAX must be an integer between 1 and 30.');
      return true;
    });
  }
  for (const name of ['DB_CONNECTION_TIMEOUT_MS', 'DB_IDLE_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'DB_IDLE_TRANSACTION_TIMEOUT_MS'] as const) {
    assert.throws(() => databasePoolConfig({ DATABASE_URL: 'postgres://fictional', [name]: '0' }));
  }
});

test('concurrent readiness requests share one lightweight probe and cache the result', async () => {
  let clock = 10_000, connects = 0, queries = 0;
  const pending = deferred<unknown>(), releases: boolean[] = [];
  const check = createDatabaseReadiness({ connect: async () => { connects++; return { query: async query => { assert.equal(query.text, 'SELECT 1'); assert.equal(query.query_timeout, 100); queries++; return pending.promise; }, release: destroy => releases.push(Boolean(destroy)) }; } }, { timeoutMs: 100, cacheMs: 5_000, now: () => clock });
  const a = check(), b = check();
  await tick();
  assert.equal(connects, 1);
  assert.equal(queries, 1);
  pending.resolve({ rows: [{ '?column?': 1 }] });
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.deepEqual(releases, [false]);
  assert.equal(await check(), true);
  assert.equal(connects, 1);
  clock += 5_001;
  assert.equal(await check(), true);
  assert.equal(connects, 2);
});

test('database failure is cached, releases the failed client and recovers after cache expiry', async () => {
  let clock = 1_000, connects = 0, fail = true;
  const releases: boolean[] = [];
  const check = createDatabaseReadiness({ connect: async () => { connects++; return { query: async () => { if (fail) throw new Error('private host/password error'); return {}; }, release: destroy => releases.push(Boolean(destroy)) }; } }, { now: () => clock });
  assert.equal(await check(), false);
  assert.equal(await check(), false);
  assert.equal(connects, 1);
  assert.deepEqual(releases, [true]);
  fail = false; clock += 5_001;
  assert.equal(await check(), true);
  assert.deepEqual(releases, [true, false]);
});

test('slow acquisition has a public deadline, cannot multiply pending probes, and discards a late client', async () => {
  const acquisition = deferred<{ query(query: { text: string; query_timeout: number }): Promise<unknown>; release(destroy?: boolean): void }>();
  let connects = 0, queries = 0, clock = 1_000;
  const releases: boolean[] = [];
  const check = createDatabaseReadiness({ connect: () => { connects++; return acquisition.promise; } }, { timeoutMs: 15, cacheMs: 5, now: () => clock });
  assert.equal(await check(), false);
  clock += 100;
  assert.deepEqual(await Promise.all(Array.from({ length: 50 }, () => check())), Array(50).fill(false));
  assert.equal(connects, 1);
  acquisition.resolve({ query: async () => { queries++; return {}; }, release: destroy => releases.push(Boolean(destroy)) });
  await tick();
  assert.deepEqual(releases, [true]);
  assert.equal(queries, 0);
});

test('slow queries destroy their client once and consume late rejection', async () => {
  const query = deferred<unknown>(), releases: boolean[] = [];
  const check = createDatabaseReadiness({ connect: async () => ({ query: () => query.promise, release: destroy => releases.push(Boolean(destroy)) }) }, { timeoutMs: 15 });
  assert.equal(await check(), false);
  assert.deepEqual(releases, [true]);
  query.reject(new Error('private late failure'));
  await tick();
  assert.deepEqual(releases, [true]);
  assert.equal(await check(), false);
});

test('healthz preserves liveness while readyz reports safe database readiness only', async t => {
  // Construction is lazy: this fictional URL never connects to any database.
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fictional:private@example.invalid/test';
  const { createHealthRouter } = await import('./routes/health');
  const { pool, databasePoolStatus } = await import('@workspace/db');
  try {
    let calls = 0;
    async function request(path: string, ready: boolean) {
      const router = createHealthRouter(async () => { calls++; if (ready) return true; throw new Error('private server error'); });
      const route = (router as any).stack.find((layer: any) => layer.route?.path === path).route.stack[0].handle;
      let data: unknown, status = 200;
      const headers: Record<string, string> = {};
      const response = { set(name: string, value: string) { headers[name] = value; return this; }, status(value: number) { status = value; return this; }, json(value: unknown) { data = value; return this; } };
      await route({}, response, () => {});
      return { status, data, headers };
    }
    assert.deepEqual((await request('/healthz', false)).data, { status: 'ok' });
    assert.equal(calls, 0);
    const healthy = await request('/readyz', true);
    assert.equal(healthy.status, 200);
    assert.deepEqual(healthy.data, { status: 'ready' });
    const unavailable = await request('/readyz', false);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(unavailable.data, { status: 'not_ready' });
    assert.equal(unavailable.headers['Cache-Control'], 'no-store');
    assert.equal(unavailable.headers['Retry-After'], '5');
    assert.doesNotMatch(JSON.stringify(unavailable), /private|password|example\.invalid/);
    const stderr = t.mock.method(process.stderr, 'write', () => true);
    pool.emit('error', new Error('private server error with password'));
    assert.equal(databasePoolStatus().idleErrorCount, 1);
    assert.ok(databasePoolStatus().lastIdleErrorAt);
    assert.doesNotMatch(JSON.stringify(databasePoolStatus()), /private|password|example\.invalid/);
    assert.match(String(stderr.mock.calls[0].arguments[0]), /discarded/);
    assert.doesNotMatch(String(stderr.mock.calls[0].arguments[0]), /private|password/);
  } finally {
    await pool.end();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});
