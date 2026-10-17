import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, engine, dealershipsTable, stockImportRunsTable, vehiclesTable, vehicleChangesTable } from "./test/tenant-test-db";
import { compactCompletedStockSnapshots, stockSnapshotRetentionPolicy } from "./lib/stock-snapshot-retention";
import { canonicalJson, stockPayloadHash } from "./lib/stock-payload-hash";
import { runWithTenant } from "./lib/tenant-context";
import { importSecretDigest } from "./middlewares/tenant";
import { default as stockRouter } from "./routes/stock";
import fixture from "./test/fixtures/cazoo-stock.json";

process.env.MULTI_TENANT_ENABLED = "true";
process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
const day = 86_400_000;
const current = new Date();
const maintenanceTime = new Date(current.getTime() + 30 * day);
const secret = "fictional-retention-import-key";
const tenant = { dealerId: "retention-a", canonicalOrigin: "https://a.example.test", platform: "cazoo" as const, retailerId: "fictional-retention", sourceUrl: "https://www.cazoo.co.uk/dealers/fictional-retention/", importSecretHash: importSecretDigest(secret), kind: "import" as const };
const payload = { ...structuredClone(fixture), runId: "retention-original-import", retailerId: tenant.retailerId, scrapedAt: current.toISOString() };
const enabled = { STOCK_RAW_RETENTION_DAYS: "7" };

before(async () => {
  for (const file of (await readdir("../../lib/db/drizzle")).filter(file => /^\d.*\.sql$/.test(file)).sort()) await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, "utf8"));
  for (const id of [tenant.dealerId, "retention-b"]) await db.insert(dealershipsTable).values({ id, name: "Fictional retention dealer", status: "active", canonicalOrigin: `https://${id}.example.test`, stockPlatform: "cazoo", retailerId: tenant.retailerId, sourceUrl: tenant.sourceUrl });
});
after(() => engine.close());

function send(body: unknown) {
  return runWithTenant(tenant, () => new Promise<{ status: number; data: any }>((resolve, reject) => {
    let status = 200;
    const req = { method: "POST", url: `/stock/imports/${tenant.dealerId}/grok`, body, headers: {}, get: (name: string) => name === "x-stock-import-secret" ? secret : undefined, log: { error() {}, warn() {} } } as unknown as Request;
    const res = { destroyed: false, status(value: number) { status = value; return this; }, json(data: unknown) { resolve({ status, data }); return this; } } as unknown as Response;
    stockRouter(req, res, error => error ? reject(error) : reject(new Error("Stock route did not respond")));
  }));
}

test("stock snapshot retention needs an explicit safe policy and never writes when disabled", async () => {
  const indexes = await engine.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename='stock_import_runs'");
  assert.ok(indexes.rows.some(row => row.indexname === "stock_import_runs_dealer_received_idx"));
  assert.ok(indexes.rows.some(row => row.indexname === "stock_import_runs_dealer_completed_received_idx"));
  for (const value of [undefined, "", "0", "6", "-1", "NaN", "Infinity", "7.5", "3651", "0x10", "7 days"]) assert.equal(stockSnapshotRetentionPolicy({ STOCK_RAW_RETENTION_DAYS: value }).enabled, false, String(value));
  assert.deepEqual(stockSnapshotRetentionPolicy({ STOCK_RAW_RETENTION_DAYS: "7" }), { enabled: true, days: 7, reason: null });
  const untouched = await compactCompletedStockSnapshots(tenant.dealerId, { env: {}, database: { transaction() { throw new Error("Disabled retention must not contact a database"); } } as never });
  assert.equal(untouched.enabled, false); assert.equal(untouched.compacted, 0);
  let busyQueries = 0;
  const busy = await compactCompletedStockSnapshots(tenant.dealerId, { env: enabled, database: { async transaction(work: (tx: unknown) => unknown) { return work({ async execute() { busyQueries++; return { rows: [{ acquired: false }] }; }, update() { throw new Error("Busy imports must not be updated by retention"); } }); } } as never });
  assert.equal(busy.busy, true); assert.equal(busy.compacted, 0); assert.equal(busyQueries, 1, "maintenance skips an active importer without loading snapshots");
  for (const batchSize of [0, 26, NaN, 1.5]) await assert.rejects(() => compactCompletedStockSnapshots(tenant.dealerId, { env: enabled, batchSize }), /retention batch/);
  assert.equal(stockPayloadHash({ b: [1, { c: true }], a: "value" }), stockPayloadHash({ a: "value", b: [1, { c: true }] }));
  assert.notEqual(stockPayloadHash({ b: [1, 2] }), stockPayloadHash({ b: [2, 1] }));
  assert.equal(canonicalJson({ absent: undefined, present: null }), '{"present":null}');
});

test("old successful payloads compact atomically while replay, audit, latest snapshots, rejected runs and other dealers stay protected", async () => {
  const imported = await send(payload);
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  const [original] = await db.select().from(stockImportRunsTable).where(eq(stockImportRunsTable.runId, payload.runId));
  assert.equal(original.payloadHash, stockPayloadHash(payload));
  const oldTime = new Date(maintenanceTime.getTime() - 20 * day);
  // Model a pre-migration successful import: its hash is backfilled before raw deletion.
  await db.update(stockImportRunsTable).set({ receivedAt: oldTime, updatedAt: oldTime, payloadHash: null }).where(eq(stockImportRunsTable.id, original.id));
  async function seed(runId: string, options: { dealerId?: string; source?: string; age?: number; scrapedOffset?: number; status?: "completed" | "quarantined" | "failed" | "pending" | "processing"; mismatch?: boolean } = {}) {
    const at = new Date(maintenanceTime.getTime() - (options.age ?? 20) * day);
    await db.insert(stockImportRunsTable).values({ runId, dealerId: options.dealerId ?? tenant.dealerId, source: options.source ?? "cazoo", retailerId: tenant.retailerId, schemaVersion: "1", scrapedAt: new Date(current.getTime() + (options.scrapedOffset ?? 1) * day), receivedAt: at, updatedAt: at, expectedCount: 1, receivedCount: 1, status: options.status ?? "completed", rawSnapshot: { marker: runId, cars: [{ advertId: runId }] }, ...(options.mismatch ? { payloadHash: "0".repeat(64) } : {}) });
  }
  await seed("retention-latest-one", { scrapedOffset: 11 });
  await seed("retention-latest-two", { scrapedOffset: 10 });
  await seed("retention-recent", { age: 2, scrapedOffset: 1 });
  await seed("retention-integrity-mismatch", { scrapedOffset: 2, mismatch: true });
  for (const status of ["failed", "quarantined", "pending", "processing"] as const) await seed(`retention-${status}`, { status });
  for (let number = 1; number <= 3; number++) {
    await seed(`other-source-${number}`, { source: "autotrader", scrapedOffset: number });
    await seed(`other-dealer-${number}`, { dealerId: "retention-b", scrapedOffset: number });
  }
  const before = await db.select().from(stockImportRunsTable);
  const vehicleBefore = await db.select().from(vehiclesTable);
  const changesBefore = await db.select().from(vehicleChangesTable);
  const result = await compactCompletedStockSnapshots(tenant.dealerId, { env: enabled, now: maintenanceTime, batchSize: 25 });
  assert.equal(result.compacted, 2); assert.equal(result.hashBackfilled, 2); assert.equal(result.integritySkipped, 1);
  assert.ok(result.rawBytesRemoved > 100); assert.equal(result.busy, false);
  const afterRows = await db.select().from(stockImportRunsTable);
  assert.equal(afterRows.length, before.length, "all run IDs, errors, timestamps and counts remain in the ledger");
  for (const row of afterRows) {
    const prior = before.find(item => item.id === row.id)!;
    if ([payload.runId, "other-source-1"].includes(row.runId)) {
      assert.equal(row.rawSnapshot, null); assert.equal(row.rawSnapshotCompactedAt?.toISOString(), maintenanceTime.toISOString());
      assert.equal(row.payloadHash, stockPayloadHash(prior.rawSnapshot));
      assert.deepEqual({ ...row, rawSnapshot: prior.rawSnapshot, rawSnapshotCompactedAt: prior.rawSnapshotCompactedAt, payloadHash: prior.payloadHash }, prior, "finish time, counters and audit fields are unchanged");
    } else assert.deepEqual(row, prior, row.runId);
  }
  const originalNow = Date.now;
  Date.now = () => maintenanceTime.getTime();
  try {
    const reordered = Object.fromEntries(Object.entries(payload).reverse());
    const replay = await send(reordered);
    assert.equal(replay.status, 200); assert.equal(replay.data.status, "replayed"); assert.equal(replay.data.runId, payload.runId, "a compacted stale snapshot remains replayable without applying it again");
    const conflict = await send({ ...payload, cars: payload.cars.map(car => ({ ...car, price: (car.price ?? 0) + 1 })) });
    assert.equal(conflict.status, 409); assert.equal(conflict.data.errors[0].code, "run_id_conflict");
  } finally { Date.now = originalNow; }
  assert.deepEqual(await db.select().from(vehiclesTable), vehicleBefore, "replay and conflict never apply the old stock again");
  assert.deepEqual(await db.select().from(vehicleChangesTable), changesBefore);
  assert.equal((await compactCompletedStockSnapshots(tenant.dealerId, { env: enabled, now: maintenanceTime })).compacted, 0);
  await assert.rejects(() => db.update(stockImportRunsTable).set({ payloadHash: null }).where(and(eq(stockImportRunsTable.id, original.id), eq(stockImportRunsTable.dealerId, tenant.dealerId))), error => (error as { cause?: { constraint?: string } }).cause?.constraint === "stock_import_runs_compaction_check");
});
