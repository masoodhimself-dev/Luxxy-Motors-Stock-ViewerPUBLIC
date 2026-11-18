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
import demoOnboardingRouter from './routes/demo-onboarding';
import { engine } from './test/tenant-test-db';
import exampleStock from './test/fixtures/cazoo-stock.json';
import { autoTraderDealerLink } from '@workspace/vehicle-meta';

const adminHost = 'admin.example.test';
const createPath = '/api/platform/demos/from-autotrader';
const collectorUrl = 'https://collector.example.test/v1/collect';
const retailerId = '123456';
const canonicalSource = 'https://www.autotrader.co.uk/dealers/greater-london/hayes/fictional-motors-123456';
const submittedSource = 'https://autotrader.co.uk/dealers/greater-london/hayes/fictional-motors-123456/?tracking=example';

test('Auto Trader dealership links share one strict parser for dealer pages and retailer stock pages', () => {
  assert.deepEqual(autoTraderDealerLink(` ${submittedSource} `), { sourceUrl: canonicalSource, retailerId });
  assert.deepEqual(autoTraderDealerLink('https://autotrader.co.uk/cars/retailer/stock?retailerId=123456&sort=price-asc#top'), {
    sourceUrl: 'https://www.autotrader.co.uk/cars/retailer/stock?retailerId=123456', retailerId,
  });
  for (const invalid of [
    'https://www.autotrader.co.uk/car-details/202611081234567',
    'https://www.autotrader.co.uk.evil.test/dealers/fictional-123456',
    'https://user@www.autotrader.co.uk/dealers/fictional-123456',
    'http://www.autotrader.co.uk/dealers/fictional-123456',
    'https://www.autotrader.co.uk/cars/retailer/stock?retailerId=123456&retailerId=999999',
    'https://www.autotrader.co.uk/cars/retailer/stock?retailerId=no-number',
    'https://www.autotrader.co.uk\\@evil.test/dealers/fictional-123456',
  ]) assert.equal(autoTraderDealerLink(invalid), null, invalid);
});

test('platform administrators can create private demos from marketplace stock links', async context => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_HOST = adminHost;
  process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
  process.env.STOCK_MAX_AGE_HOURS = '24';
  delete process.env.DEMO_STOCK_COLLECTOR_MODE;
  delete process.env.DEMO_STOCK_COLLECTOR_URL;
  delete process.env.DEMO_STOCK_COLLECTOR_TOKEN;
  delete process.env.DEMO_STOCK_COLLECTOR_RETAILER_IDS;
  delete process.env.DEMO_STOCK_CALLBACK_AUTH;
  delete process.env.DEMO_STOCK_CALLBACK_KEY_ID;
  delete process.env.DEMO_STOCK_CALLBACK_KEY_VALID_UNTIL;
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
      assert.ok(['123457', '123458'].includes(body.retailerId));
      const expected = { jobId: body.jobId, sourceUrl: canonicalSource.replace(retailerId, body.retailerId), retailerId: body.retailerId };
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
  app.use('/api/demo-onboarding', demoOnboardingRouter);
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

    const secondRetailer = '123458';
    const secondSource = submittedSource.replace(retailerId, secondRetailer);
    const callsBeforePlural = collect.mock.callCount();
    for (const invalid of ['', `123457,${secondRetailer},invalid`, `123457,${secondRetailer},`]) {
      process.env.DEMO_STOCK_COLLECTOR_RETAILER_IDS = invalid;
      assert.equal((await call(createPath, { sourceUrl: asyncSource })).status, 503);
      assert.equal((await call(callbackPath, { ...authorised, snapshot: asyncSnapshot })).status, 404);
    }
    process.env.DEMO_STOCK_COLLECTOR_RETAILER_IDS = secondRetailer;
    assert.equal((await call(createPath, { sourceUrl: asyncSource })).status, 422);
    assert.equal((await call(callbackPath, { ...authorised, snapshot: asyncSnapshot })).status, 404);
    process.env.DEMO_STOCK_COLLECTOR_RETAILER_IDS = `123457, ${secondRetailer}`;
    assert.equal((await call(createPath, { sourceUrl: submittedSource })).status, 422);
    assert.equal(collect.mock.callCount(), callsBeforePlural);

    const secondQueued = await call(createPath, { sourceUrl: secondSource });
    assert.equal(secondQueued.status, 202, await secondQueued.clone().text());
    const secondJob = await secondQueued.json() as typeof job;
    const secondPath = `${demoStockCollectorCallbackPath}/${secondJob.jobId}`;
    const secondAuthorised = { host: authorised.host, token: webhookCallbackProof };
    const secondSnapshot = { ...snapshot, retailerId: secondRetailer, dealerName: 'Second Motors', runId: 'dd26a7ce-3e7f-4922-8b86-1fece0d18b25' };
    assert.equal((await call(secondPath, { ...authorised, snapshot: secondSnapshot })).status, 401);
    assert.equal((await call(secondPath, { ...secondAuthorised, snapshot: asyncSnapshot })).status, 422);
    const secondAccepted = await call(secondPath, { ...secondAuthorised, snapshot: secondSnapshot });
    assert.equal(secondAccepted.status, 200, await secondAccepted.clone().text());
    const secondReady = await secondAccepted.json() as typeof ready;
    assert.equal(secondReady.status, 'ready');
    assert.notEqual(secondReady.dealerId, ready.dealerId);
    assert.deepEqual((await engine.query('SELECT status, retailer_id FROM dealerships WHERE id = $1', [secondReady.dealerId])).rows, [{ status: 'draft', retailer_id: secondRetailer }]);
    assert.equal((await call(`${secondReady.previewPath}/api/stock`, { user: 'user_dealer' })).status, 403);
    assert.equal((await call(`${secondReady.previewPath}/api/stock`)).status, 200);

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
    const keyIds = new Map<string, string>();
    for (const [secret, owner, expired, revoked] of [
      [onboardingKey, 'user_admin', false, false],
      [wrongOwnerKey, 'user_other_admin', false, false],
      [revokedKey, 'user_admin', false, true],
      [expiredKey, 'user_admin', true, false],
    ] as const) {
      const { rows: [key] } = await engine.query<{ id: string }>(
        `INSERT INTO demo_onboarding_keys (secret_hash, label, owner_auth_user_id, max_demos, max_per_day, expires_at, revoked_at)
         VALUES ($1, 'test', $2, 1, 1, CASE WHEN $3 THEN now() - interval '1 day' ELSE now() + interval '1 day' END,
         CASE WHEN $4 THEN now() ELSE NULL END) RETURNING id`,
        [importSecretDigest(secret), owner, expired, revoked],
      );
      keyIds.set(secret, key.id);
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

    const expiredKeyRequest = { ...onboardingHost, onboardingSecret: expiredKey };
    const capabilityPath = '/api/demo-onboarding/capabilities';
    const validUntil = new Date(Date.now() + 86_400_000).toISOString();
    process.env.DEMO_STOCK_CALLBACK_KEY_ID = keyIds.get(expiredKey)!;
    assert.equal((await call(onboardingPath, { ...expiredKeyRequest, snapshot: asyncSnapshot })).status, 404);
    assert.equal((await call(createPath, { sourceUrl: asyncSource })).status, 503);

    process.env.DEMO_STOCK_CALLBACK_KEY_VALID_UNTIL = validUntil;
    assert.deepEqual(await (await call(onboardingPath, { ...expiredKeyRequest, snapshot: asyncSnapshot })).json(), ready);
    assert.equal((await call(capabilityPath, onboardingRequest)).status, 200);
    assert.equal((await call(capabilityPath, expiredKeyRequest)).status, 401);
    assert.equal((await call(onboardingPath, { ...onboardingRequest, snapshot: asyncSnapshot })).status, 401);
    assert.equal((await call(`${demoStockCollectorCallbackPath}/${expiredJob.jobId}`, {
      ...expiredKeyRequest, snapshot: asyncSnapshot,
    })).status, 410);

    for (const key of [wrongOwnerKey, revokedKey]) {
      process.env.DEMO_STOCK_CALLBACK_KEY_ID = keyIds.get(key)!;
      assert.equal((await call(onboardingPath, { ...onboardingHost, onboardingSecret: key, rawBody: '{' })).status, 401);
    }

    process.env.DEMO_STOCK_CALLBACK_KEY_ID = 'invalid';
    assert.equal((await call(onboardingPath, { ...expiredKeyRequest, snapshot: asyncSnapshot })).status, 404);
    process.env.DEMO_STOCK_CALLBACK_KEY_ID = keyIds.get(expiredKey)!;
    process.env.DEMO_STOCK_CALLBACK_KEY_VALID_UNTIL = validUntil.slice(0, -1);
    assert.equal((await call(onboardingPath, { ...expiredKeyRequest, snapshot: asyncSnapshot })).status, 404);
    process.env.DEMO_STOCK_CALLBACK_KEY_VALID_UNTIL = new Date(Date.now() - 1).toISOString();
    assert.equal((await call(onboardingPath, { ...expiredKeyRequest, snapshot: asyncSnapshot })).status, 404);

    await context.test('a pasted Cazoo snapshot creates and reopens a private demo with photos and logo', async () => {
      const cazooPath = '/api/platform/demos/from-cazoo';
      const cazooId = 'cazoo-42656';
      const cazooSource = 'https://www.cazoo.co.uk/dealers/example-cars-42656/';
      const submittedCazooLink = 'https://cazoo.co.uk/dealers/example-cars-42656?campaign=example';
      const logo = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+p1LkAAAAASUVORK5CYII=';
      const originalPhoto = exampleStock.cars[0].images[0];
      const car = {
        ...exampleStock.cars[0],
        advertId: '80087729',
        advertUrl: 'https://www.cazoo.co.uk/cars-for-sale/80087729/',
        sourceExtras: { ...exampleStock.cars[0].sourceExtras, cazooDealerId: '42656', stockListUrl: cazooSource },
      };
      const cazooStock = {
        ...exampleStock, retailerId: cazooId, scrapedAt: new Date().toISOString(), cars: [car],
      };
      const checkedAt = new Date().toISOString();
      const dealershipDetails = {
        sourceUrl: cazooSource, checkedAt,
        phone: '020 7946 0123', email: 'showroom@example.test', websiteUrl: 'https://example.test/',
        about: 'A family-run dealership in Hayes.',
        visitInstructions: 'Please arrange an appointment before visiting.',
        showroomAddress: { street: '1 Example Road', city: 'Hayes', region: 'London', postcode: 'UB3 1AA', sourceUrl: 'https://example.test/contact', checkedAt },
        openingHours: { timezone: 'Europe/London', sourceUrl: cazooSource, checkedAt, days: Array.from({ length: 7 }, (_, day) => ({ day, status: 'appointment_only' })) },
        includedItems: ['6-month warranty', '6-month warranty', 'Vehicle inspection'],
        warrantyDescription: 'A six-month warranty is included with every vehicle.',
        deliveryDescription: 'Ask the team about delivery to your address.',
        partExchangeDescription: 'Part exchange is welcome.',
      };
      const payload = { sourceUrl: submittedCazooLink, stock: cazooStock, logoData: `data:image/png;base64,${logo}`, dealershipDetails };
      const collectorCalls = collect.mock.callCount();
      await engine.query(`INSERT INTO dealerships (id, name, status, canonical_origin, stock_platform, retailer_id, source_url)
        VALUES ('existing-cazoo', 'Existing showroom', 'active', 'https://existing-cazoo.example.test', 'cazoo', $1, $2)`, [cazooId, cazooSource]);
      await engine.query(`INSERT INTO vehicles (dealer_id, source, advert_id, title, source_price)
        VALUES ('existing-cazoo', 'cazoo', $1, 'Live stock', 7995)`, [car.advertId]);

      const databaseCounts = () => engine.query(`SELECT
        (SELECT count(*)::int FROM dealerships) AS dealers,
        (SELECT count(*)::int FROM dealer_demos) AS demos,
        (SELECT count(*)::int FROM dealer_settings) AS settings,
        (SELECT count(*)::int FROM portal_users) AS users,
        (SELECT count(*)::int FROM stock_import_runs) AS runs,
        (SELECT count(*)::int FROM vehicles) AS vehicles,
        (SELECT count(*)::int FROM vehicle_images) AS images`);
      const before = (await databaseCounts()).rows;
      for (const access of [
        { user: '' }, { user: 'user_dealer' }, { origin: 'https://other.example.test' },
        { host: 'existing-cazoo.example.test' },
      ]) {
        assert.equal((await call(cazooPath, { ...access, snapshot: payload })).status, 403);
      }
      for (const invalid of [
        { ...payload, sourceUrl: car.advertUrl },
        { ...payload, sourceUrl: 'https://cazoo.co.uk.example.test/dealers/example-cars-42656/' },
        { ...payload, logoData: 'data:image/png;base64,dGVzdA==' },
        { ...payload, dealershipDetails: { ...dealershipDetails, sourceUrl: 'https://www.cazoo.co.uk/dealers/other-cars-99999/' } },
        { ...payload, dealershipDetails: { ...dealershipDetails, settings: { publicOnlineReservations: true } } },
        { ...payload, dealershipDetails: { ...dealershipDetails, email: 'not-an-email' } },
        { ...payload, dealershipDetails: { ...dealershipDetails, includedItems: [''] } },
      ]) {
        assert.equal((await call(cazooPath, { snapshot: invalid })).status, 400);
      }
      for (const stock of [
        { ...cazooStock, retailerId: 'cazoo-99999' },
        { ...cazooStock, complete: false },
        { ...cazooStock, expectedAdvertCount: 2 },
        { ...cazooStock, scrapedAt: new Date(Date.now() - 25 * 3_600_000).toISOString() },
        { ...cazooStock, cars: [{ ...car, sourceExtras: { ...car.sourceExtras, sourcePlatform: 'autotrader' } }] },
        { ...cazooStock, cars: [{ ...car, sourceExtras: { ...car.sourceExtras, cazooDealerId: '99999' } }] },
      ]) {
        assert.equal((await call(cazooPath, { snapshot: { ...payload, stock } })).status, 422);
      }
      assert.deepEqual((await databaseCounts()).rows, before);

      // Force a persistence error after the demo and import run have already been inserted.
      await engine.exec('ALTER TABLE vehicles ADD CONSTRAINT test_demo_import_rollback CHECK (dealer_id = \'existing-cazoo\' OR advert_id <> \'80087729\')');
      try {
        const failure = await call(cazooPath, { snapshot: payload });
        assert.equal(failure.status, 500, await failure.text());
        assert.deepEqual((await databaseCounts()).rows, before);
      } finally {
        await engine.exec('ALTER TABLE vehicles DROP CONSTRAINT test_demo_import_rollback');
      }

      const response = await call(cazooPath, { snapshot: payload });
      assert.equal(response.status, 201, await response.clone().text());
      const demo = await response.json() as { dealerId: string; previewPath: string; hasLogo: boolean; received: number; dealerName: string };
      assert.equal(demo.previewPath, `/platform/preview/${demo.dealerId}`);
      assert.equal(demo.hasLogo, true);
      assert.equal(demo.received, 1);
      assert.equal(demo.dealerName, cazooStock.dealerName);
      const settingsPath = `${demo.previewPath}/api/dealer-settings`;
      const publicSettings = await (await call(settingsPath)).json() as Record<string, any>;
      assert.deepEqual(publicSettings.contact, { phone: dealershipDetails.phone, email: dealershipDetails.email, whatsapp: '' });
      assert.equal(publicSettings.address.street, dealershipDetails.showroomAddress.street);
      assert.equal(publicSettings.address.mapsUrl, '');
      assert.equal(publicSettings.hours.length, 7);
      assert.ok(publicSettings.hours.every((row: { times: string }) => row.times === 'By appointment'));
      assert.equal(publicSettings.presentation.teamIntroduction, dealershipDetails.about);
      assert.equal(publicSettings.presentation.visitInstructions, dealershipDetails.visitInstructions);
      assert.deepEqual(publicSettings.presentation.includedItems, ['6-month warranty', 'Vehicle inspection']);
      assert.equal(publicSettings.warranty.enabled, true);
      assert.equal(publicSettings.warranty.description, dealershipDetails.warrantyDescription);
      assert.equal(publicSettings.delivery.enabled, true);
      assert.equal(publicSettings.partExchange.enabled, true);
      assert.equal(publicSettings.testDriveBooking.enabled, false);
      const savedSettings = () => engine.query('SELECT config, revision FROM dealer_settings WHERE dealer_id = $1', [demo.dealerId]);
      const firstSettings = (await savedSettings()).rows;
      const retry = await call(cazooPath, { snapshot: { sourceUrl: cazooSource, stock: cazooStock } });
      assert.equal(retry.status, 200, await retry.clone().text());
      assert.deepEqual(await retry.json(), demo);
      assert.deepEqual((await savedSettings()).rows, firstSettings, 'Legacy exports preserve previously supplied public details');
      assert.equal((await call(cazooPath, { snapshot: payload })).status, 200);
      assert.deepEqual((await savedSettings()).rows, firstSettings, 'Identical exports do not create another settings revision');
      const partialDetails = { sourceUrl: cazooSource, checkedAt, phone: '020 7946 0321' };
      assert.equal((await call(cazooPath, { snapshot: { sourceUrl: cazooSource, stock: cazooStock, dealershipDetails: partialDetails } })).status, 200);
      const partialSettings = await (await call(settingsPath)).json() as Record<string, any>;
      assert.equal(partialSettings.contact.phone, partialDetails.phone);
      assert.equal(partialSettings.contact.email, dealershipDetails.email);
      assert.deepEqual(partialSettings.presentation, publicSettings.presentation);
      assert.deepEqual(partialSettings.address, publicSettings.address);
      assert.deepEqual(partialSettings.hours, publicSettings.hours);
      const metadata = (await engine.query<{ business_details: Record<string, any> }>('SELECT business_details FROM dealer_demos WHERE dealer_id=$1', [demo.dealerId])).rows[0].business_details;
      assert.equal(metadata.dealershipDetails.websiteUrl, dealershipDetails.websiteUrl);
      assert.equal(metadata.dealershipDetails.phone, partialDetails.phone);
      assert.equal(collect.mock.callCount(), collectorCalls);

      const { rows } = await engine.query<{ canonical_origin: string }>('SELECT canonical_origin, source_url, status FROM dealerships WHERE id = $1', [demo.dealerId]);
      assert.deepEqual(rows, [{ canonical_origin: `https://${demo.dealerId.slice(5)}.demo.invalid`, source_url: cazooSource, status: 'draft' }]);
      assert.deepEqual((await engine.query('SELECT status FROM stock_import_runs WHERE dealer_id = $1', [demo.dealerId])).rows, [{ status: 'completed' }]);
      assert.equal((await engine.query('SELECT 1 FROM dealer_domains WHERE dealer_id = $1', [demo.dealerId])).rows.length, 0);
      assert.deepEqual((await engine.query("SELECT title, source_price FROM vehicles WHERE dealer_id = 'existing-cazoo'")).rows, [{ title: 'Live stock', source_price: 7995 }]);
      assert.equal((await call('/api/stock', { host: new URL(rows[0].canonical_origin).hostname })).status, 421);

      const stockPath = `${demo.previewPath}/api/stock`;
      assert.equal((await call(stockPath, { user: '' })).status, 403);
      const preview = await call(stockPath);
      assert.equal(preview.status, 200, await preview.clone().text());
      assert.match(preview.headers.get('x-robots-tag') ?? '', /noindex/);
      const { cars } = await preview.json() as { cars: { advertId: string; heroImage: string; images: typeof car.images }[] };
      assert.deepEqual(cars.map(({ advertId, heroImage, images }) => ({ advertId, heroImage, images })), [
        { advertId: car.advertId, heroImage: originalPhoto.url, images: [originalPhoto] },
      ]);
      const logoPath = `${demo.previewPath}/api/demo-logo`;
      assert.equal((await call(logoPath, { user: 'user_dealer' })).status, 403);
      const artwork = await call(logoPath);
      assert.equal(artwork.status, 200);
      assert.equal(artwork.headers.get('content-type'), 'image/png');
      assert.equal(Buffer.from(await artwork.arrayBuffer()).toString('base64'), logo);
    });

    await context.test('an Auto Trader JSON upload includes verified business details without a collector or live-stock writes', async () => {
      delete process.env.DEMO_STOCK_COLLECTOR_URL;
      delete process.env.DEMO_STOCK_COLLECTOR_TOKEN;
      const sourceUrl = 'https://www.autotrader.co.uk/dealers/greater-london/hayes/example-motors-654321';
      const stockSource = 'https://autotrader.co.uk/cars/retailer/stock?retailerId=654321&sort=price-asc';
      const logo = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+p1LkAAAAASUVORK5CYII=';
      const checkedAt = new Date().toISOString();
      const car = {
        ...snapshot.cars[0], advertId: '202611181234567',
        advertUrl: 'https://www.autotrader.co.uk/car-details/202611181234567',
        sourceExtras: { sourcePlatform: 'autotrader', stockListUrl: stockSource },
      };
      const stock = {
        ...snapshot, retailerId: '654321', runId: '131246ce-84c8-4ce0-8b19-8a47198a1ca0',
        scrapedAt: checkedAt, cars: [car],
      };
      const dealershipDetails = {
        sourceUrl: stockSource, checkedAt,
        phone: '020 7946 0456', email: 'showroom@example.test', websiteUrl: 'https://example.test/',
        showroomAddress: { street: '7 Example Road', city: 'Hayes', region: 'London', postcode: 'UB3 1AA', mapsUrl: '', sourceUrl: 'https://example.test/contact', checkedAt },
        openingHours: { timezone: 'Europe/London', sourceUrl: stockSource, checkedAt,
          days: Array.from({ length: 7 }, (_, day) => day === 0 ? { day, status: 'closed' } : { day, status: 'open', open: '10:00', close: '18:00' }) },
        visitInstructions: 'Please book an appointment before visiting.',
      };
      const payload = { sourceUrl, stock, logoData: `data:image/png;base64,${logo}`, dealershipDetails };
      const collectorCalls = collect.mock.callCount();
      await engine.query(`INSERT INTO dealerships (id, name, status, canonical_origin, stock_platform, retailer_id, source_url)
        VALUES ('existing-at-upload', 'Existing Auto Trader showroom', 'active', 'https://existing-at.example.test', 'autotrader', '654321', $1)`, [sourceUrl]);
      await engine.query(`INSERT INTO vehicles (dealer_id, source, advert_id, title, source_price, inventory_status)
        VALUES ('existing-at-upload', 'grok', $1, 'Live Auto Trader stock', 10995, 'reserved')`, [car.advertId]);
      const liveBefore = (await engine.query("SELECT * FROM vehicles WHERE dealer_id = 'existing-at-upload'")).rows;
      const databaseCounts = async () => (await engine.query(`SELECT
        (SELECT count(*)::int FROM dealerships) AS dealers,
        (SELECT count(*)::int FROM dealer_demos) AS demos,
        (SELECT count(*)::int FROM dealer_settings) AS settings,
        (SELECT count(*)::int FROM stock_import_runs) AS runs,
        (SELECT count(*)::int FROM vehicles) AS vehicles,
        (SELECT count(*)::int FROM vehicle_images) AS images`)).rows;
      const before = await databaseCounts();
      for (const access of [{ user: '' }, { user: 'user_dealer' }, { host: 'existing-at.example.test' }, { origin: 'https://other.example.test' }]) {
        assert.equal((await call(createPath, { ...access, snapshot: payload })).status, 403);
      }
      for (const invalid of [
        { ...payload, logoData: 'data:image/png;base64,dGVzdA==' },
        { ...payload, dealershipDetails: { ...dealershipDetails, sourceUrl: stockSource.replace('654321', '999999') } },
        { ...payload, dealershipDetails: { ...dealershipDetails, sourceUrl: 'https://www.cazoo.co.uk/dealers/example-motors-654321/' } },
        { ...payload, dealershipDetails: { ...dealershipDetails, email: 'invalid' } },
        { ...payload, dealershipDetails: { ...dealershipDetails, websiteUrl: 'not-a-url' } },
        { ...payload, dealershipDetails: { ...dealershipDetails, showroomAddress: { ...dealershipDetails.showroomAddress, mapsUrl: 'not-a-url' } } },
        { sourceUrl, dealershipDetails },
      ]) assert.equal((await call(createPath, { snapshot: invalid })).status, 400);
      for (const invalid of [
        { ...stock, retailerId: '999999' }, { ...stock, complete: false },
        { ...stock, expectedAdvertCount: 2 },
        { ...stock, scrapedAt: new Date(Date.now() - 25 * 3_600_000).toISOString() },
        { ...stock, cars: [{ ...car, sourceExtras: { sourcePlatform: 'cazoo' } }] },
        { ...stock, cars: [{ ...car, sourceExtras: { ...car.sourceExtras, stockListUrl: stockSource.replace('654321', '999999') } }] },
      ]) assert.equal((await call(createPath, { snapshot: { ...payload, stock: invalid } })).status, 422);
      assert.deepEqual(await databaseCounts(), before);

      await engine.exec("ALTER TABLE vehicles ADD CONSTRAINT test_at_demo_rollback CHECK (dealer_id = 'existing-at-upload' OR advert_id <> '202611181234567')");
      try {
        assert.equal((await call(createPath, { snapshot: payload })).status, 500);
        assert.deepEqual(await databaseCounts(), before);
      } finally {
        await engine.exec('ALTER TABLE vehicles DROP CONSTRAINT test_at_demo_rollback');
      }
      const created = await call(createPath, { snapshot: payload });
      assert.equal(created.status, 201, await created.clone().text());
      const demo = await created.json() as { dealerId: string; previewPath: string; hasLogo: boolean; received: number };
      assert.equal(demo.hasLogo, true);
      assert.equal(demo.received, 1);
      const settingsPath = `${demo.previewPath}/api/dealer-settings`;
      const settings = await (await call(settingsPath)).json() as Record<string, any>;
      assert.deepEqual(settings.contact, { phone: dealershipDetails.phone, email: dealershipDetails.email, whatsapp: '' });
      assert.equal(settings.address.street, dealershipDetails.showroomAddress.street);
      assert.equal(settings.hours.length, 7);
      assert.equal(settings.hours[6].times, 'Closed');
      assert.equal(settings.presentation.visitInstructions, dealershipDetails.visitInstructions);
      const savedSettings = async () => (await engine.query('SELECT config, revision FROM dealer_settings WHERE dealer_id = $1', [demo.dealerId])).rows;
      const firstSettings = await savedSettings();
      assert.equal((await call(createPath, { snapshot: payload })).status, 200);
      assert.deepEqual(await savedSettings(), firstSettings, 'Replays do not add another settings revision');
      assert.equal((await call(createPath, { snapshot: { sourceUrl: stockSource, stock } })).status, 200);
      assert.deepEqual(await savedSettings(), firstSettings, 'Old stock-only JSON preserves supplied business details');
      assert.equal((await call(createPath, { snapshot: { ...payload, dealershipDetails: { sourceUrl, checkedAt, phone: '020 7946 0654' } } })).status, 200);
      const updated = await (await call(settingsPath)).json() as Record<string, any>;
      assert.equal(updated.contact.phone, '020 7946 0654');
      assert.equal(updated.contact.email, dealershipDetails.email);
      assert.deepEqual(updated.address, settings.address);
      assert.deepEqual(updated.hours, settings.hours);
      const preview = await call(`${demo.previewPath}/api/stock`);
      const cars = (await preview.json() as { cars: { advertId: string; images: typeof car.images }[] }).cars;
      assert.deepEqual(cars.map(({ advertId, images }) => ({ advertId, images })), [{ advertId: car.advertId, images: car.images }]);
      assert.equal((await call(`${demo.previewPath}/api/dealer-settings`, { user: '' })).status, 403);
      const artwork = await call(`${demo.previewPath}/api/demo-logo`);
      assert.equal(artwork.headers.get('content-type'), 'image/png');
      assert.equal(Buffer.from(await artwork.arrayBuffer()).toString('base64'), logo);
      const row = (await engine.query<{ status: string; canonical_origin: string }>('SELECT status, canonical_origin FROM dealerships WHERE id=$1', [demo.dealerId])).rows[0];
      assert.equal(row.status, 'draft');
      assert.equal((await engine.query('SELECT 1 FROM dealer_domains WHERE dealer_id=$1', [demo.dealerId])).rows.length, 0);
      assert.equal((await call('/api/stock', { host: new URL(row.canonical_origin).hostname })).status, 421);
      assert.deepEqual((await engine.query("SELECT * FROM vehicles WHERE dealer_id = 'existing-at-upload'")).rows, liveBefore);
      assert.equal(collect.mock.callCount(), collectorCalls, 'The upload never calls the stock collector');
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await engine.close();
  }
});
