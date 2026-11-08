import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import express from 'express';
import pino from 'pino';
import { importSecretDigest, resolveTenant } from './middlewares/tenant';
import platformRouter from './routes/platform-dealers';
import previewRouter from './routes/platform-website-preview';
import collectorCallback, { demoStockCollectorCallbackPath } from './routes/demo-stock-collector-callback';
import { engine } from './test/tenant-test-db';
import exampleStock from './test/fixtures/cazoo-stock.json';

const adminHost = 'admin.example.test';
const createPath = '/api/platform/demos/from-autotrader';
const collectorUrl = 'https://collector.example.test/v1/collect';
const retailerId = '123456';
const canonicalSource = 'https://www.autotrader.co.uk/dealers/greater-london/hayes/fictional-motors-123456';
const submittedSource = 'https://autotrader.co.uk/dealers/greater-london/hayes/fictional-motors-123456/?tracking=example';

test('an authorised Auto Trader link creates one private demo in either collector mode', async context => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_HOST = adminHost;
  process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
  process.env.STOCK_MAX_AGE_HOURS = '24';
  delete process.env.DEMO_STOCK_COLLECTOR_MODE;
  delete process.env.DEMO_STOCK_COLLECTOR_URL;
  delete process.env.DEMO_STOCK_COLLECTOR_TOKEN;
  delete process.env.DEMO_STOCK_CALLBACK_AUTH;
  delete process.env.DEMO_STOCK_CALLBACK_SIGNING_KEY;
  for (const migration of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await engine.exec(await readFile(`../../lib/db/drizzle/${migration}`, 'utf8'));
  }

  const snapshot = {
    ...exampleStock,
    runId: '930b9b74-b57a-4c09-a3ee-43cb1850d935',
    retailerId,
    dealerName: 'Fictional Motors',
    scrapedAt: new Date().toISOString(),
    cars: exampleStock.cars.map(car => ({
      ...car,
      advertId: '202611081234567',
      advertUrl: 'https://www.autotrader.co.uk/car-details/202611081234567',
      dealerName: 'Fictional Motors',
      sourceExtras: { ...car.sourceExtras, sourcePlatform: 'autotrader' },
    })),
  };
  let providerReply = () => Response.json(snapshot);
  let webhookJobId: string | undefined;
  let webhookCallbackProof: string | undefined;
  const collect = context.mock.method(globalThis, 'fetch', async (input: URL | string, options?: RequestInit) => {
    assert.equal(String(input), collectorUrl);
    assert.equal(options?.method, 'POST');
    assert.equal(options?.redirect, 'error');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('authorization'), 'Bearer fictional-test-token');
    assert.equal(headers.get('content-type'), 'application/json');
    const body = JSON.parse(String(options?.body));
    if (process.env.DEMO_STOCK_COLLECTOR_MODE === 'grok-webhook') {
      assert.match(body.jobId, /^[a-f0-9-]{36}$/);
      const expected = { jobId: body.jobId, sourceUrl: canonicalSource.replace(retailerId, '123457'), retailerId: '123457' };
      const proof = body.callbackProof;
      if (process.env.DEMO_STOCK_CALLBACK_AUTH === 'demo-onboarding') {
        assert.deepEqual(body, expected);
      } else {
        assert.match(proof, /^[A-Za-z0-9_-]{43}$/);
        assert.deepEqual(body, { ...expected, callbackProof: proof });
      }
      webhookJobId = body.jobId;
      webhookCallbackProof = proof;
    } else assert.deepEqual(body, { sourceUrl: canonicalSource, retailerId });
    return providerReply();
  });

  const app = express();
  const log = pino({ enabled: false });
  app.use((req, _res, next) => { req.log = log; next(); });
  app.use(demoStockCollectorCallbackPath, collectorCallback);
  app.use(express.json());
  app.use('/api/platform', platformRouter);
  app.use('/platform/preview/:dealerId', previewRouter);
  app.use(resolveTenant);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  const { port } = address;

  function call(path: string, options: { sourceUrl?: string; snapshot?: unknown; rawBody?: string; token?: string; onboardingSecret?: string; stockSecret?: string; user?: string; host?: string; origin?: string } = {}) {
    const body = options.rawBody ?? (options.sourceUrl === undefined
      ? options.snapshot === undefined ? undefined : JSON.stringify(options.snapshot)
      : JSON.stringify({ sourceUrl: options.sourceUrl }));
    return new Promise<Response>((resolve, reject) => {
      const request = httpRequest({
        hostname: '127.0.0.1',
        port,
        path,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          host: options.host ?? adminHost,
          'x-test-user': options.user ?? 'user_admin',
          ...(options.origin ? { origin: options.origin } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.onboardingSecret ? { 'x-demo-onboarding-secret': options.onboardingSecret } : {}),
          ...(options.stockSecret ? { 'x-stock-import-secret': options.stockSecret } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === 'string') headers.set(name, value);
          }
          resolve(new Response(chunks.length ? new Uint8Array(Buffer.concat(chunks)) : null, { status: response.statusCode, headers }));
        });
      });
      request.on('error', reject);
      request.end(body);
    });
  }

  async function assertNoDemoWrites() {
    const { rows } = await engine.query<{ dealers: number; demos: number; imports: number; stock: number }>(
      `SELECT
        (SELECT count(*)::int FROM dealerships WHERE retailer_id=$1) AS dealers,
        (SELECT count(*)::int FROM dealer_demos) AS demos,
        (SELECT count(*)::int FROM stock_import_runs) AS imports,
        (SELECT count(*)::int FROM vehicles) AS stock`,
      [retailerId],
    );
    assert.deepEqual(rows, [{ dealers: 0, demos: 0, imports: 0, stock: 0 }]);
  }

  try {
    const unavailable = await call('/api/platform/demo-config');
    assert.equal((await unavailable.json() as { linkImportReady: boolean }).linkImportReady, false);
    const missingConnection = await call(createPath, { sourceUrl: submittedSource });
    assert.ok(missingConnection.status >= 400);
    assert.equal(collect.mock.callCount(), 0);

    process.env.DEMO_STOCK_COLLECTOR_URL = collectorUrl;
    process.env.DEMO_STOCK_COLLECTOR_TOKEN = 'fictional-test-token';
    const available = await call('/api/platform/demo-config');
    const config = await available.text();
    assert.equal((JSON.parse(config) as { linkImportReady: boolean }).linkImportReady, true);
    assert.ok(!config.includes(collectorUrl) && !config.includes('fictional-test-token'));

    assert.equal((await call(createPath, { sourceUrl: submittedSource, user: 'user_dealer' })).status, 403);
    assert.equal((await call(createPath, { sourceUrl: submittedSource, origin: 'https://other.example.test' })).status, 403);
    for (const sourceUrl of [
      'https://www.autotrader.co.uk.evil.example/dealers/fictional-123456',
      'https://www.autotrader.co.uk/car-details/202611081234567',
      'https://www.autotrader.co.uk/dealers/fictional-motors',
      'https://user@www.autotrader.co.uk/dealers/fictional-123456',
      'http://www.autotrader.co.uk/dealers/fictional-123456',
    ]) {
      assert.equal((await call(createPath, { sourceUrl })).status, 400, sourceUrl);
    }
    assert.equal(collect.mock.callCount(), 0);

    for (const invalid of [
      { ...snapshot, complete: false },
      { ...snapshot, retailerId: '999999' },
      { ...snapshot, expectedAdvertCount: 2 },
      { ...snapshot, cars: [], expectedAdvertCount: 0, count: 0 },
    ]) {
      providerReply = () => Response.json(invalid);
      const rejected = await call(createPath, { sourceUrl: submittedSource });
      assert.ok(rejected.status >= 400, await rejected.text());
      await assertNoDemoWrites();
    }
    assert.equal(collect.mock.callCount(), 4);

    providerReply = () => Response.redirect('https://other.example.test/collect');
    const redirected = await call(createPath, { sourceUrl: submittedSource });
    assert.ok(redirected.status >= 400);
    assert.equal(collect.mock.callCount(), 5);
    await assertNoDemoWrites();

    providerReply = () => Response.json(snapshot);
    const created = await call(createPath, { sourceUrl: submittedSource });
    assert.ok([200, 201].includes(created.status), await created.clone().text());
    const receipt = await created.json() as { dealerId: string; dealerName: string; previewPath: string; received: number };
    assert.equal(receipt.dealerName, snapshot.dealerName);
    assert.ok(receipt.previewPath === `/platform/preview/${receipt.dealerId}` || receipt.previewPath === `/platform/preview/${receipt.dealerId}/stock`);
    assert.equal(receipt.received, 1);

    const retry = await call(createPath, { sourceUrl: canonicalSource });
    assert.ok([200, 201].includes(retry.status), await retry.clone().text());
    const repeated = await retry.json() as typeof receipt;
    assert.equal(repeated.dealerId, receipt.dealerId);
    assert.equal(repeated.received, 1);
    const dealership = await engine.query<{ id: string; status: string; canonical_origin: string }>(
      'SELECT id, status, canonical_origin FROM dealerships WHERE stock_platform=$1 AND retailer_id=$2',
      ['autotrader', retailerId],
    );
    assert.equal(dealership.rows.length, 1);
    assert.equal(dealership.rows[0].status, 'draft');
    assert.equal(dealership.rows[0].id, receipt.dealerId);
    const domains = await engine.query('SELECT hostname FROM dealer_domains WHERE dealer_id=$1', [receipt.dealerId]);
    assert.equal(domains.rows.length, 0);
    const imports = await engine.query('SELECT run_id, status FROM stock_import_runs WHERE dealer_id=$1', [receipt.dealerId]);
    assert.deepEqual(imports.rows, [{ run_id: snapshot.runId, status: 'completed' }]);

    const publicHost = new URL(dealership.rows[0].canonical_origin).hostname;
    assert.equal((await call('/api/stock', { host: publicHost })).status, 421);
    const previewStock = `/platform/preview/${receipt.dealerId}/api/stock`;
    assert.equal((await call(previewStock, { user: 'user_dealer' })).status, 403);
    const preview = await call(previewStock);
    assert.equal(preview.status, 200, await preview.clone().text());
    assert.match(preview.headers.get('cache-control') ?? '', /no-store/);
    assert.match(preview.headers.get('x-robots-tag') ?? '', /noindex/);
    const cars = (await preview.json() as { cars: { advertId: string }[] }).cars;
    assert.deepEqual(cars.map(car => car.advertId), [snapshot.cars[0].advertId]);

    process.env.DEMO_STOCK_COLLECTOR_MODE = 'grok-webhook';
    process.env.STOCK_IMPORT_API_HOST = 'imports.example.test';
    process.env.DEMO_STOCK_COLLECTOR_RETAILER_ID = '123457';
    process.env.SESSION_SECRET = 'fictional-server-session-secret-for-demo-callback-tests';
    providerReply = () => new Response(null, { status: 200 });
    const webhookCalls = collect.mock.callCount();
    assert.equal((await call(createPath, { sourceUrl: submittedSource })).status, 422);
    assert.equal(collect.mock.callCount(), webhookCalls);

    const asyncSource = submittedSource.replace(retailerId, '123457');
    const queued = await call(createPath, { sourceUrl: asyncSource });
    assert.equal(queued.status, 202, await queued.clone().text());
    const job = await queued.json() as { jobId: string; status: string };
    assert.deepEqual(job, { jobId: webhookJobId, status: 'collecting' });
    const pollPath = `/api/platform/demos/collection/${job.jobId}`;
    assert.deepEqual(await (await call(pollPath)).json(), job);
    assert.equal((await call(pollPath, { user: 'user_dealer' })).status, 403);
    assert.deepEqual(await (await call(createPath, { sourceUrl: asyncSource })).json(), job);
    assert.equal(collect.mock.callCount(), webhookCalls + 1);
    assert.equal((await engine.query('SELECT 1 FROM dealerships WHERE retailer_id = $1', ['123457'])).rows.length, 0);

    const callbackPath = `${demoStockCollectorCallbackPath}/${job.jobId}`;
    const token = webhookCallbackProof!;
    const authorised = { host: 'imports.example.test', token };
    const asyncSnapshot = { ...snapshot, retailerId: '123457', runId: '0a0bd802-0d36-42f3-803d-1b0ec7205e54' };
    assert.equal((await call(callbackPath, { host: authorised.host, onboardingSecret: 'a'.repeat(43), rawBody: '{' })).status, 401);
    assert.equal((await call(callbackPath, { ...authorised, onboardingSecret: 'a'.repeat(43), rawBody: '{' })).status, 401);
    assert.equal((await call(callbackPath, { ...authorised, token: 'a'.repeat(43), snapshot: asyncSnapshot })).status, 401);
    assert.equal((await call(callbackPath.toUpperCase(), { ...authorised, token: 'a'.repeat(43), rawBody: '{' })).status, 401);
    assert.equal((await call(callbackPath, { token, snapshot: asyncSnapshot })).status, 404);
    assert.equal((await call(callbackPath, { ...authorised, snapshot })).status, 422);
    assert.equal((await call(callbackPath, { ...authorised, snapshot: { ...asyncSnapshot, complete: false } })).status, 422);
    assert.deepEqual(await (await call(pollPath)).json(), job);

    const accepted = await call(callbackPath, { ...authorised, snapshot: asyncSnapshot });
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const ready = await accepted.json() as typeof receipt & { status: string };
    assert.equal(ready.status, 'ready');
    assert.equal(ready.received, 1);
    assert.notEqual(ready.dealerId, receipt.dealerId);
    assert.deepEqual(await (await call(pollPath)).json(), ready);
    assert.deepEqual(await (await call(callbackPath, { ...authorised, snapshot: asyncSnapshot })).json(), ready);
    assert.equal((await call(callbackPath, { ...authorised, snapshot: { ...asyncSnapshot, dealerName: 'Different export' } })).status, 409);
    // Recover a job whose process stopped after the stock transaction committed.
    await engine.query(`UPDATE demo_stock_collection_jobs SET status = 'collecting', dealer_id = NULL,
      dealer_name = NULL, received = NULL, lease_until = now() - interval '1 second' WHERE id = $1`, [job.jobId]);
    assert.deepEqual(await (await call(callbackPath, { ...authorised, snapshot: asyncSnapshot })).json(), ready);
    assert.equal((await call(`${ready.previewPath}/api/stock`, { user: 'user_dealer' })).status, 403);
    assert.equal((await call(`${ready.previewPath}/api/stock`)).status, 200);
    assert.deepEqual((await engine.query('SELECT status FROM dealerships WHERE id = $1', [ready.dealerId])).rows, [{ status: 'draft' }]);
    assert.deepEqual((await engine.query('SELECT run_id, status FROM stock_import_runs WHERE dealer_id = $1', [ready.dealerId])).rows, [{ run_id: asyncSnapshot.runId, status: 'completed' }]);

    const retryJob = await (await call(createPath, { sourceUrl: asyncSource })).json() as typeof job;
    const failurePath = `${demoStockCollectorCallbackPath}/${retryJob.jobId}`;
    assert.notEqual(webhookCallbackProof, token);
    assert.equal((await call(failurePath, { ...authorised, snapshot: { status: 'failed' } })).status, 401);
    const reported = await call(failurePath, { ...authorised, token: webhookCallbackProof, snapshot: { status: 'failed' } });
    assert.equal(reported.status, 200);
    assert.equal((await (await call(`/api/platform/demos/collection/${retryJob.jobId}`)).json() as { status: string }).status, 'failed');

    const expiredJob = await (await call(createPath, { sourceUrl: asyncSource })).json() as typeof job;
    const later = Date.now() + 11 * 60_000;
    const clock = context.mock.method(Date, 'now', () => later);
    try {
      const expiredCallback = await call(`${demoStockCollectorCallbackPath}/${expiredJob.jobId}`, { ...authorised, token: webhookCallbackProof, snapshot: asyncSnapshot });
      assert.equal(expiredCallback.status, 410);
      assert.equal((await (await call(`/api/platform/demos/collection/${expiredJob.jobId}`)).json() as { status: string }).status, 'failed');
    } finally {
      clock.mock.restore();
    }

    await engine.query("UPDATE demo_stock_collection_jobs SET expires_at = now() - interval '1 second' WHERE id = $1", [expiredJob.jobId]);
    process.env.DEMO_STOCK_CALLBACK_AUTH = 'demo-onboarding';
    process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin,user_other_admin';
    delete process.env.SESSION_SECRET;
    const onboardingKey = 'k'.repeat(43);
    const wrongOwnerKey = 'w'.repeat(43);
    const revokedKey = 'r'.repeat(43);
    const expiredKey = 'e'.repeat(43);
    for (const [secret, owner, expired, revoked] of [
      [onboardingKey, 'user_admin', false, false],
      [wrongOwnerKey, 'user_other_admin', false, false],
      [revokedKey, 'user_admin', false, true],
      [expiredKey, 'user_admin', true, false],
    ] as const) {
      await engine.query(
        `INSERT INTO demo_onboarding_keys (secret_hash, label, owner_auth_user_id, max_demos, max_per_day, expires_at, revoked_at)
         VALUES ($1, 'test', $2, 1, 1, CASE WHEN $3 THEN now() - interval '1 day' ELSE now() + interval '1 day' END,
         CASE WHEN $4 THEN now() ELSE NULL END)`,
        [importSecretDigest(secret), owner, expired, revoked],
      );
    }
    const onboardingQueued = await call(createPath, { sourceUrl: asyncSource });
    assert.equal(onboardingQueued.status, 202, await onboardingQueued.clone().text());
    const onboardingJob = await onboardingQueued.json() as typeof job;
    assert.equal(onboardingJob.jobId, webhookJobId);
    assert.equal(webhookCallbackProof, undefined);
    const onboardingPath = `${demoStockCollectorCallbackPath}/${onboardingJob.jobId}`;
    const onboardingHost = { host: authorised.host };
    const onboardingRequest = { ...onboardingHost, onboardingSecret: onboardingKey };
    for (const headers of [
      {},
      { onboardingSecret: 'm'.repeat(43) },
      { onboardingSecret: wrongOwnerKey },
      { onboardingSecret: revokedKey },
      { onboardingSecret: expiredKey },
      { token },
      { stockSecret: onboardingKey },
      { token, onboardingSecret: onboardingKey },
    ]) {
      assert.equal((await call(onboardingPath, { ...onboardingHost, ...headers, rawBody: '{' })).status, 401);
    }
    assert.equal((await call(onboardingPath, { ...onboardingRequest, host: adminHost, snapshot: asyncSnapshot })).status, 404);
    assert.equal((await call(onboardingPath, { ...onboardingRequest, origin: 'https://other.example.test', snapshot: asyncSnapshot })).status, 403);
    const onboardingImport = await call(onboardingPath, { ...onboardingRequest, snapshot: asyncSnapshot });
    assert.equal(onboardingImport.status, 200, await onboardingImport.clone().text());
    assert.deepEqual(await onboardingImport.json(), ready);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await engine.close();
  }
});
