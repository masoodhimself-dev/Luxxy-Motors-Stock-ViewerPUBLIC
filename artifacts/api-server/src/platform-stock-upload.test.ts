import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import express from 'express';
import pino from 'pino';
import { resolveTenant } from './middlewares/tenant';
import platformRouter from './routes/platform-dealers';
import stockRouter from './routes/stock';
import cazooFixture from './test/fixtures/cazoo-stock.json';
import { db, dealerDemosTable, dealerDomainsTable, dealershipsTable, engine, portalUsersTable } from './test/tenant-test-db';

type UploadResponse = {
  status?: string;
  runId?: string;
  retailerId?: string;
  source?: string;
  received?: number;
  created?: number;
  updated?: number;
  errors?: { code: string }[];
};
const draft = 'draft-json-cars', demo = 'demo-json-cars', draftDemo = 'draft-demo-json-cars';
const uploadPath = (dealer: string) => `/api/platform/dealers/${dealer}/stock-upload`;

function payload(dealer: string, source: 'autotrader' | 'cazoo' = 'cazoo') {
  const snapshot = structuredClone(cazooFixture);
  return {
    ...snapshot,
    source: source === 'autotrader' ? 'autotrader' : 'grok',
    runId: `${dealer}-initial-json`, retailerId: dealer, dealerName: `Fictional ${dealer}`, scrapedAt: new Date().toISOString(),
    cars: snapshot.cars.map(car => ({ ...car,
      advertUrl: source === 'autotrader' ? 'https://www.autotrader.co.uk/car-details/123456' : car.advertUrl,
      sourceExtras: { ...car.sourceExtras, sourcePlatform: source },
    })),
  };
}

test('admin JSON stock upload accepts complete private snapshots and protects live stock', async () => {
  process.env.MULTI_TENANT_ENABLED = 'true';
  process.env.PLATFORM_ADMIN_HOST = 'admin.example.test';
  process.env.PLATFORM_ADMIN_USER_IDS = 'user_admin';
  process.env.STOCK_MAX_AGE_HOURS = '24';
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, 'utf8'));
  }
  async function seed(id: string, status: 'draft' | 'active' | 'suspended', stockPlatform: 'autotrader' | 'cazoo', demoState?: 'active' | 'expired' | 'converted') {
    const host = `${id}.example.test`;
    await db.insert(dealershipsTable).values({ id, name: id, status, canonicalOrigin: `https://${host}`, stockPlatform,
      retailerId: id, sourceUrl: `https://www.${stockPlatform === 'cazoo' ? 'cazoo' : 'autotrader'}.co.uk/dealers/${id}` });
    await db.insert(dealerDomainsTable).values({ dealerId: id, hostname: host, verificationToken: 'fictional', verified: true });
    if (demoState) await db.insert(dealerDemosTable).values({ dealerId: id, recipient: 'operator@example.test', updatedBy: 'fixture',
      expiresAt: new Date(Date.now() + (demoState === 'expired' ? -3_600_000 : 3_600_000)),
      ...(demoState === 'converted' ? { convertedAt: new Date(), convertedBy: 'fixture' } : {}),
    });
  }
  await seed(draft, 'draft', 'cazoo');
  await seed(demo, 'active', 'autotrader', 'active');
  await seed(draftDemo, 'draft', 'cazoo', 'active');
  await seed('live-json-cars', 'active', 'cazoo');
  await seed('suspended-json-cars', 'suspended', 'cazoo');
  await seed('expired-json-cars', 'active', 'cazoo', 'expired');
  await seed('converted-json-cars', 'active', 'cazoo', 'converted');
  await seed('official-json-cars', 'draft', 'cazoo');
  await db.insert(portalUsersTable).values({ dealerId: draft, authUserId: 'user_owner', role: 'owner' });
  await engine.query("INSERT INTO cazoo_feed_authority (dealer_id,retailer_id,feed_id) VALUES ('official-json-cars','official-json-cars','AETA1000')");

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  const log = pino({ enabled: false });
  app.use((req, _res, next) => { req.log = log; next(); });
  app.use('/api/platform', platformRouter);
  app.use(resolveTenant);
  app.use('/api', stockRouter);
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ status: 'rejected' });
  });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  function call(path: string, body?: unknown, options: { host?: string; user?: string; origin?: string; raw?: boolean; contentType?: string } = {}) {
    const data = body === undefined ? undefined : options.raw ? String(body) : JSON.stringify(body);
    return new Promise<{ status: number; data: UploadResponse }>((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port, method: data === undefined ? 'GET' : 'POST', path,
        headers: { host: options.host ?? 'admin.example.test', 'x-test-user': options.user ?? 'user_admin',
          'content-type': options.contentType ?? 'application/json', ...(data === undefined ? {} : { 'content-length': Buffer.byteLength(data) }),
          ...(options.origin ? { origin: options.origin } : {}) },
      }, response => {
        let bodyText = '';
        response.on('data', chunk => bodyText += chunk);
        response.on('end', () => {
          try { resolve({ status: response.statusCode!, data: JSON.parse(bodyText) }); }
          catch { reject(new Error(`Expected a JSON response for ${path}, got HTTP ${response.statusCode}`)); }
        });
      });
      request.on('error', reject);
      request.end(data);
    });
  }
  const upload = (id: string, body: unknown, options?: Parameters<typeof call>[2]) => call(uploadPath(id), body, options);
  const stockRows = () => engine.query<{ dealer_id: string; source: string; advert_id: string; source_price: number }>(
    'SELECT dealer_id,source,advert_id,source_price FROM vehicles ORDER BY dealer_id,advert_id',
  ).then(result => result.rows);
  try {
    const snapshot = payload(draft);
    assert.equal((await upload(draft, snapshot, { user: 'user_owner' })).status, 403);
    assert.equal((await upload(draft, snapshot, { host: `${draft}.example.test` })).status, 403);
    assert.equal((await upload(draft, snapshot, { origin: 'https://other.example.test' })).status, 403);
    assert.equal((await upload('missing-json-cars', snapshot)).status, 404);
    assert.equal((await upload(draft, snapshot, { contentType: 'text/plain' })).status, 415);
    assert.deepEqual(await stockRows(), []);

    const attempts = await Promise.all([upload(draft, snapshot), upload(draft, snapshot)]);
    assert.deepEqual(attempts.map(result => result.status).sort(), [200, 201], JSON.stringify(attempts));
    const imported = attempts.find(result => result.status === 201)!;
    assert.equal(imported.data.status, 'imported');
    assert.equal(imported.data.received, 1);
    assert.equal(imported.data.created, 1);
    assert.equal(imported.data.retailerId, draft);
    assert.equal(imported.data.source, 'grok');
    assert.deepEqual(imported.data.errors, []);
    assert.equal(attempts.find(result => result.status === 200)?.data.status, 'replayed');
    assert.equal((await upload(draft, JSON.stringify(snapshot, null, 2), { raw: true })).data.status, 'replayed');
    assert.equal((await call('/api/stock', undefined, { host: `${draft}.example.test` })).status, 421);

    const demoSnapshot = payload(demo, 'autotrader');
    const demoImport = await upload(demo, demoSnapshot);
    assert.equal(demoImport.status, 201, JSON.stringify(demoImport));
    assert.equal(demoImport.data.status, 'imported');
    assert.equal(demoImport.data.source, 'autotrader');
    assert.equal((await upload(draftDemo, payload(draftDemo))).status, 201);
    assert.equal((await call('/api/stock', undefined, { host: `${draftDemo}.example.test` })).status, 421);
    const savedStock = await stockRows();
    assert.deepEqual(savedStock.map(row => [row.dealer_id, row.source, row.advert_id]), [
      [demo, 'autotrader', cazooFixture.cars[0].advertId], [draftDemo, 'cazoo', cazooFixture.cars[0].advertId],
      [draft, 'cazoo', cazooFixture.cars[0].advertId],
    ]);

    const conflicting = { ...snapshot, cars: [{ ...snapshot.cars[0], price: 8990 }] };
    assert.equal((await upload(draft, conflicting)).status, 409);
    assert.equal((await upload(draft, { ...snapshot, runId: 'wrong-retailer', retailerId: demo })).status, 422);
    assert.equal((await upload(draft, { ...demoSnapshot, runId: 'wrong-adapter', retailerId: draft })).status, 400);
    assert.equal((await upload(draft, { ...demoSnapshot, source: 'grok', runId: 'wrong-marketplace', retailerId: draft })).status, 422);
    assert.equal((await upload(draft, { ...snapshot, runId: 'count-mismatch', count: 2 })).status, 422);
    assert.equal((await upload(draft, { ...snapshot, runId: 'incomplete', complete: false })).status, 422);
    assert.equal((await upload(draft, { ...snapshot, runId: 'too-old', scrapedAt: new Date(Date.now() - 48 * 3_600_000).toISOString() })).status, 422);
    assert.equal((await upload(draft, { ...snapshot, runId: 'invalid-shape', schemaVersion: 2 })).status, 400);
    assert.equal((await upload(draft, '{invalid', { raw: true })).status, 400);
    assert.equal((await upload(draft, { ...snapshot, runId: 'too-large', dealerName: 'A'.repeat(5 * 1024 * 1024) })).status, 413);

    for (const id of ['live-json-cars', 'suspended-json-cars', 'expired-json-cars', 'converted-json-cars', 'official-json-cars']) {
      assert.equal((await upload(id, payload(id))).status, 409, id);
    }
    await engine.query('UPDATE dealer_demos SET converted_at=now(), converted_by=$2 WHERE dealer_id=$1', [demo, 'fixture']);
    assert.equal((await upload(demo, demoSnapshot)).status, 409, 'conversion takes precedence over a previous successful run');
    await engine.query("UPDATE dealerships SET status='draft' WHERE id=$1", [demo]);
    assert.equal((await upload(demo, { ...demoSnapshot, runId: 'converted-after-run' })).status, 409, 'converted demos remain ineligible even when draft');
    await engine.query("UPDATE dealerships SET status='active' WHERE id=$1", [draft]);
    assert.equal((await upload(draft, snapshot)).status, 409, 'launch takes precedence over a previous successful run');
    assert.equal((await upload(draft, { ...conflicting, runId: 'after-go-live' })).status, 409);
    assert.deepEqual(await stockRows(), savedStock);
    assert.equal((await engine.query("SELECT id FROM stock_import_runs WHERE status='completed'")).rows.length, 3);
    const rejectedRuns = await engine.query<{ run_id: string }>("SELECT run_id FROM stock_import_runs WHERE status<>'completed' ORDER BY run_id");
    assert.deepEqual(rejectedRuns.rows.map(row => row.run_id), ['too-old'], 'malformed and other-tenant files are not stored');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await engine.close();
  }
});
