import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Request, Response } from 'express';
import type { Server } from 'node:http';
import { createServiceLifecycle, ServiceDrainingError, startLifecycleWorker } from './lib/service-lifecycle';
import { createShutdown } from './lib/shutdown';
import { createStockImportAdmission } from './lib/stock-import-admission';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function request(path = '/api/staff/enquiries', method = 'POST') {
  const req = Object.assign(new EventEmitter(), { path, method }) as unknown as Request;
  const headers: Record<string, string> = {};
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200, body: undefined as any, destroyed: false,
    set(values: Record<string, string>) { Object.assign(headers, values); return this; },
    status(value: number) { this.statusCode = value; return this; },
    json(value: unknown) { this.body = value; return this; },
  }) as unknown as Response & { body: any };
  return { req, res, headers };
}
const log = { info() {}, warn() {} };
function server(events: string[]) {
  return {
    close(callback: (error?: Error) => void) { events.push('http-close'); setImmediate(callback); return this; },
    closeIdleConnections() { events.push('idle-close'); },
    closeAllConnections() { events.push('force-close'); },
  } as unknown as Pick<Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>;
}

test('draining rejects new work while accepted operations and continuations finish', async () => {
  const lifecycle = createServiceLifecycle(), work = deferred();
  const pending = lifecycle.run(() => work.promise);
  lifecycle.beginDrain();
  await assert.rejects(lifecycle.run(async () => {}), ServiceDrainingError);
  assert.equal(lifecycle.snapshot().activeOperations, 1);
  await lifecycle.track(async () => {}); // Already-admitted continuation.
  let idle = false; void lifecycle.waitForIdle().then(() => { idle = true; });
  await tick(); assert.equal(idle, false);
  work.resolve(); await pending; await lifecycle.waitForIdle(); assert.equal(idle, true);
});

test('new requests are refused before work and imports keep an immutable-retry response', () => {
  const lifecycle = createServiceLifecycle(); lifecycle.beginDrain();
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const sample = request('/api/staff/enquiries', method); let admitted = false;
    lifecycle.middleware(sample.req, sample.res, () => { admitted = true; });
    assert.equal(admitted, false); assert.equal(sample.res.statusCode, 503); assert.equal(sample.headers['Retry-After'], '15');
  }
  const stock = request('/api/stock/imports/example/grok');
  lifecycle.middleware(stock.req, stock.res, () => assert.fail('Must reject before buffering/import'));
  assert.equal(stock.res.body.status, 'busy');
  assert.equal(stock.res.body.errors[0].code, 'service_restarting');
  assert.match(stock.res.body.errors[0].message, /same runId and identical body/);
  const direct = request('/api/stock/imports/example/grok');
  const admission = createStockImportAdmission(2, Date.now, lifecycle);
  admission.middleware(direct.req, direct.res, () => assert.fail('Draining importer must also refuse new work'));
  assert.equal(direct.res.statusCode, 503);
  assert.equal(admission.status().active, 0);
  assert.deepEqual(lifecycle.snapshot(), { draining: true, activeOperations: 0, activeRequests: 0 });
});

test('a disconnected import retains its request and operation until DB work actually finishes', async () => {
  const lifecycle = createServiceLifecycle(), admission = createStockImportAdmission(2, Date.now, lifecycle), sample = request('/api/stock/imports/example/grok');
  lifecycle.middleware(sample.req, sample.res, () => {});
  admission.middleware(sample.req, sample.res, () => {});
  const work = deferred(), pending = admission.run(sample.req, sample.res, () => work.promise);
  sample.res.emit('close'); sample.req.emit('aborted');
  lifecycle.beginDrain();
  assert.equal(lifecycle.snapshot().activeRequests, 1);
  assert.equal(lifecycle.snapshot().activeOperations, 1);
  assert.equal(admission.status().active, 1);
  work.resolve(); await pending; await lifecycle.waitForIdle();
  assert.equal(lifecycle.snapshot().activeRequests, 0);
  assert.equal(admission.status().active, 0);
});

test('shutdown is idempotent and closes the pool only after HTTP and provider/startup work finish', async () => {
  const lifecycle = createServiceLifecycle(), events: string[] = [], work = deferred(), sample = request();
  lifecycle.middleware(sample.req, sample.res, () => {});
  const pendingWork = lifecycle.track(() => work.promise);
  const shutdown = createShutdown({ server: server(events), lifecycle, stopWorkers: [() => events.push('stop')], closePool: async () => { events.push('pool-close'); }, log, exit: code => events.push(`exit-${code}`), deadlineMs: 1_000 });
  const first = shutdown('SIGTERM'), second = shutdown('SIGINT');
  assert.equal(first, second);
  await tick(); assert.equal(events.includes('pool-close'), false);
  sample.res.emit('finish'); await tick(); assert.equal(events.includes('pool-close'), false);
  work.resolve(); await pendingWork; await first;
  assert.deepEqual(events, ['stop', 'http-close', 'idle-close', 'pool-close', 'exit-0']);
});

test('the hard deadline does not close the pool under uncertain disconnected HTTP work', async () => {
  const lifecycle = createServiceLifecycle(), events: string[] = [], sample = request(), work = deferred();
  const provider = lifecycle.track(() => work.promise);
  lifecycle.middleware(sample.req, sample.res, () => {}); sample.res.emit('close');
  await createShutdown({ server: server(events), lifecycle, stopWorkers: [], closePool: async () => { events.push('pool-close'); }, log, exit: code => events.push(`exit-${code}`), deadlineMs: 15 })('SIGTERM');
  assert.equal(events.includes('pool-close'), false);
  assert.equal(events.at(-1), 'exit-1');
  lifecycle.finishRequest(sample.req); work.resolve(); await provider; await tick();
  assert.equal(events.includes('pool-close'), false);
});

test('timer workers stop new ticks while their accepted work remains part of the drain', async () => {
  const lifecycle = createServiceLifecycle(), work = deferred(); let calls = 0;
  const stop = startLifecycleWorker({ lifecycle, intervalMs: 5, work: async () => { calls++; await work.promise; }, onError: () => assert.fail('Unexpected worker failure') });
  await tick(); assert.equal(calls, 1);
  lifecycle.beginDrain(); stop(); await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(calls, 1); assert.equal(lifecycle.snapshot().activeOperations, 1);
  work.resolve(); await lifecycle.waitForIdle(); assert.equal(lifecycle.snapshot().activeOperations, 0);
});

test('readiness fails during draining without querying DB, while liveness stays compatible', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://fictional@example.invalid/test';
  const { createHealthRouter } = await import('./routes/health');
  const { pool } = await import('@workspace/db');
  try {
    const lifecycle = createServiceLifecycle(); lifecycle.beginDrain(); let calls = 0;
    const router = createHealthRouter(async () => { calls++; return true; }, lifecycle);
    for (const [path, status, body] of [['/readyz', 503, { status: 'not_ready' }], ['/healthz', 200, { status: 'ok' }]] as const) {
      const handler = (router as any).stack.find((layer: any) => layer.route?.path === path).route.stack[0].handle;
      const sample = request(path, 'GET');
      await handler(sample.req, sample.res, () => {});
      assert.equal(sample.res.statusCode, status); assert.deepEqual(sample.res.body, body);
    }
    assert.equal(calls, 0);
  } finally { await pool.end(); if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('a real child process handles repeated SIGTERM and exits after tracked work and pool closure', { timeout: 10_000 }, async () => {
  const child = fork(fileURLToPath(new URL('./test/shutdown-signal-child.mjs', import.meta.url)), [], { silent: true, env: { NODE_ENV: 'test' } });
  const events: string[] = []; let stderr = '';
  child.stderr?.on('data', data => { stderr += data; });
  child.on('message', message => {
    const event = String(message); events.push(event);
    if (event === 'ready') child.kill('SIGTERM');
    if (event === 'workers-stopped') { child.kill('SIGTERM'); setTimeout(() => child.send('finish-work'), 15); }
  });
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    assert.deepEqual(result, { code: 0, signal: null }, stderr);
    assert.deepEqual(events, ['ready', 'workers-stopped', 'http-closed', 'work-finished', 'pool-closed', 'exit-0']);
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});

test('pnpm and the explicit exec shell forward SIGTERM and wait for the Node drain', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dealer-shutdown-start-'));
  const fixture = fileURLToPath(new URL('./test/shutdown-signal-child.mjs', import.meta.url));
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'fictional-shutdown-start', private: true, scripts: { start: `NODE_ENV=test exec ${quote(process.execPath)} ${quote(fixture)}` } }));
  // No real database, provider credentials or account environment enters this child.
  const child = spawn('pnpm', ['start'], { cwd: directory, env: { PATH: process.env.PATH, NODE_ENV: 'test' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const events: string[] = []; let output = '', nodePid: number | undefined;
  child.stdin.on('error', () => {}); child.stderr.on('data', () => {});
  child.stdout.on('data', chunk => {
    output += String(chunk);
    let end: number;
    while ((end = output.indexOf('\n')) >= 0) {
      const event = output.slice(0, end).trim(); output = output.slice(end + 1);
      if (/^pid:[0-9]+$/.test(event)) nodePid = Number(event.slice(4));
      else if (['ready', 'workers-stopped', 'http-closed', 'work-finished', 'pool-closed', 'exit-0', 'exit-1'].includes(event)) {
        events.push(event);
        if (event === 'ready') child.kill('SIGTERM');
        if (event === 'workers-stopped') setTimeout(() => child.stdin.write('finish-work\n'), 20);
      }
    }
  });
  child.on('exit', (code, signal) => events.push(`wrapper-exit:${code ?? signal}`));
  const killOwnedChildren = () => {
    if (nodePid && !events.includes('exit-0') && !events.includes('exit-1')) { try { process.kill(nodePid, 'SIGKILL'); } catch { /* Already exited. */ } }
    if (child.exitCode === null) child.kill('SIGKILL');
  };
  const deadline = setTimeout(killOwnedChildren, 4_000);
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    assert.deepEqual(result, { code: 0, signal: null });
    assert.deepEqual(events, ['ready', 'workers-stopped', 'http-closed', 'work-finished', 'pool-closed', 'exit-0', 'wrapper-exit:0']);
  } finally { clearTimeout(deadline); killOwnedChildren(); await rm(directory, { recursive: true, force: true }); }
});
