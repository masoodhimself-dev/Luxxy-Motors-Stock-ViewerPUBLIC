/*
 * This is deliberately an HTTP integration test: it starts the exported Express
 * app on an ephemeral port and uses the development PostgreSQL database.  Do not
 * point DATABASE_URL at a shared or production database.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  GetStockResponse,
  GetVehicleResponse,
  ImportAutotraderStockBody,
  ImportAutotraderStockResponse,
  type StockImportErrorResponse,
} from "@workspace/api-zod";

// These values are assigned before the app/routes are imported below.
process.env.STOCK_IMPORT_SECRET = "phase-1-test-import-secret";
process.env.STOCK_RETAILER_ID = "phase-1-test-retailer";
process.env.STOCK_DEALER_ID = "phase-1-test-dealer";
process.env.STOCK_MIN_PRICE = "500";
process.env.STOCK_MAX_PRICE_CHANGE_PERCENT = "50";
process.env.STOCK_MAX_DROP_PERCENT = "100";
process.env.STOCK_MISSING_HIDE_THRESHOLD = "2";

const secret = process.env.STOCK_IMPORT_SECRET;
const {
  backfillLuxxyTenant,
  createCollectorCredentialVerifier,
  db,
  dealersTable,
  dealerIntegrationsTable,
  integrationCollectorCredentialsTable,
  integrationProvidersTable,
  LUXXY_TENANT,
  organizationsTable,
  pool,
  stockImportRunsTable,
  verifyCollectorCredential,
  vehicleChangesTable,
  vehicleImagesTable,
  vehiclesTable,
} = await import("@workspace/db");

const requiredTables = [
  "stock_import_runs", "vehicles", "vehicle_images", "vehicle_changes",
  "organizations", "dealers", "dealer_domains", "users", "dealer_memberships",
  "integration_providers", "dealer_integrations", "integration_collector_credentials",
];
const availability = await pool.query<{ name: string; present: string | null }>(
  `select name, to_regclass(name)::text as present from unnest($1::text[]) as input(name)`,
  [requiredTables],
);
const absent = availability.rows.filter((row) => !row.present).map((row) => row.name);
if (absent.length) {
  await pool.end();
  throw new Error(`Phase 1 database migration prerequisite: missing tables ${absent.join(", ")}. Apply the existing DB migration before running API tests.`);
}

const { default: app } = await import("./app");
const server: Server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to start ephemeral API listener");
const baseOrigin = `http://127.0.0.1:${address.port}`;
const baseUrl = `${baseOrigin}/api`;
const workspaceRoot = path.resolve(process.cwd(), "../..");

async function clearStock() {
  await db.execute(sql`truncate table vehicle_changes, vehicle_images, vehicles, stock_import_runs restart identity cascade`);
}
beforeEach(clearStock);
after(async () => {
  try {
    await clearStock();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
});

function car(index: number, overrides: Record<string, unknown> = {}) {
  return {
    advertId: `phase1-synthetic-${String(index).padStart(2, "0")}`,
    title: `Synthetic Test Vehicle ${index}`,
    variant: "Integration Edition",
    make: "Testmaker",
    model: "Fixture",
    trim: "Phase One",
    year: 2022,
    price: 10000 + index,
    priceType: "Retail",
    currency: "GBP",
    mileage: 1000 + index,
    mileageText: `${1000 + index} miles`,
    registration: "2022 (22 reg)",
    registrationBand: "22",
    plate: `TST${String(index).padStart(3, "0")}`,
    vrm: `TST${String(index).padStart(3, "0")}`,
    vrmVerified: true,
    fuel: "Petrol",
    transmission: "Automatic",
    bodyType: "SUV",
    engineSize: "2.0L",
    engineCC: 1998,
    doors: 5,
    seats: 5,
    colour: "Blue",
    emissionClass: "Euro 6",
    drivetrain: "AWD",
    owners: 1,
    writeOffCategory: null,
    advertUrl: `https://example.test/adverts/${index}`,
    dealerName: "Synthetic Stock Dealer",
    dealerLocation: "Test City",
    imageCount: 1,
    heroImage: `https://images.example.test/${index}.jpg`,
    images: [{ url: `https://images.example.test/${index}.jpg`, caption: "front" }],
    specifications: { synthetic: true, number: index },
    sourceExtras: { fixture: "phase-1" },
    ...overrides,
  };
}

function snapshot(runId: string, cars: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    runId,
    source: "autotrader",
    retailerId: "phase-1-test-retailer",
    dealerName: "Synthetic Stock Dealer",
    scrapedAt: new Date().toISOString(),
    complete: true,
    expectedAdvertCount: cars.length,
    count: cars.length,
    failedAdvertIds: [],
    errors: [],
    cars,
    ...overrides,
  };
}

function highVolumeGallery(vehicleNumber: number) {
  const images = Array.from({ length: 60 }, (_, imageNumber) => ({
    url: `https://images.example.test/production-shaped/${vehicleNumber}/gallery-${String(imageNumber).padStart(2, "0")}.jpg`,
    caption: imageNumber === 0 ? "front" : `gallery image ${imageNumber + 1}`,
  }));
  // This mirrors the production failure shape: a scraper can repeat a gallery
  // URL late in a single vehicle's otherwise complete source image array.
  if (vehicleNumber === 17) images[59] = { ...images[7] };
  return images;
}

function productionShapedSnapshot(runId: string) {
  const cars = Array.from({ length: 32 }, (_, index) => {
    const vehicleNumber = index + 1;
    const images = highVolumeGallery(vehicleNumber);
    return car(vehicleNumber, {
      title: `Representative Source Vehicle ${vehicleNumber}`,
      price: vehicleNumber === 32 ? 99 : 18_000 + vehicleNumber,
      imageCount: images.length,
      heroImage: images[0]!.url,
      images,
      specifications: {
        bodyStyle: "SUV",
        fuelType: "Petrol",
        representativeSourceVehicle: vehicleNumber,
      },
      sourceExtras: {
        sourceRecord: `representative-${vehicleNumber}`,
        galleryComplete: true,
      },
    });
  });
  return snapshot(runId, cars);
}

async function request(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, init);
}
async function importStock(body: Record<string, unknown>, authorized = true) {
  return request("/stock/imports/autotrader", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { "x-stock-import-secret": secret! } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function runBaselineSeed(filePath: string) {
  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    const child = spawn(
      "pnpm",
      ["--filter", "@workspace/scripts", "run", "seed:stock", filePath, baseOrigin],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          STOCK_IMPORT_SECRET: secret,
          STOCK_RETAILER_ID: process.env.STOCK_RETAILER_ID,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const sanitized = secret ? stderr.replaceAll(secret, "[redacted]").trim() : stderr.trim();
        reject(new Error(`Baseline seed command exited with code ${code ?? "unknown"}${sanitized ? `: ${sanitized}` : ""}`));
      }
    });
  });
}
function parseStockImportError(value: unknown): StockImportErrorResponse {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "error response must be an object");
  const candidate = value as Record<string, unknown>;
  assert.ok(candidate.status === "rejected" || candidate.status === "quarantined", "error response must have a supported status");
  assert.ok(Array.isArray(candidate.errors) && candidate.errors.length > 0, "error response must contain errors");
  const errors = candidate.errors.map((error) => {
    assert.ok(error !== null && typeof error === "object" && !Array.isArray(error), "import issue must be an object");
    const issue = error as Record<string, unknown>;
    assert.ok(typeof issue.code === "string" && issue.code.length > 0, "import issue must have a code");
    assert.ok(typeof issue.message === "string" && issue.message.length > 0, "import issue must have a message");
    assert.ok(issue.path === null || typeof issue.path === "string", "import issue path must be nullable text");
    assert.ok(issue.advertId === null || typeof issue.advertId === "string", "import issue advertId must be nullable text");
    return {
      code: issue.code,
      message: issue.message,
      path: issue.path,
      advertId: issue.advertId,
    };
  });
  return { status: candidate.status, errors };
}
async function vehicle(advertId: string) {
  const [result] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.advertId, advertId));
  assert.ok(result, `expected vehicle ${advertId}`);
  return result;
}
async function run(runId: string) {
  const [result] = await db.select().from(stockImportRunsTable).where(eq(stockImportRunsTable.runId, runId));
  assert.ok(result, `expected run ${runId}`);
  return result;
}

function isForeignKeyViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return /foreign key constraint/i.test(`${error.message}\n${cause}`);
}

test("rejects unauthenticated imports and serves an empty stock feed", async () => {
  const body = snapshot("auth-run", [car(1)]);
  const unauthorized = await importStock(body, false);
  assert.equal(unauthorized.status, 401);
  assert.equal(parseStockImportError(await unauthorized.json()).errors[0]?.code, "unauthorized");
  const stock = await request("/stock");
  assert.equal(stock.status, 200);
  assert.equal(GetStockResponse.parse(await stock.json()).count, 0);
  assert.equal((await request("/vehicles/not-a-uuid")).status, 400);
});

test("rejects malformed JSON with the stock import error contract", async () => {
  const response = await request("/stock/imports/autotrader", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stock-import-secret": secret,
    },
    body: '{"schemaVersion":1,"cars":[',
  });
  assert.equal(response.status, 400);
  const body = parseStockImportError(await response.json());
  assert.equal(body.status, "rejected");
  assert.equal(body.errors[0]?.code, "invalid_json");
});

test("imports a wrapped legacy baseline through the real seed-stock script", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "phase-1-stock-"));
  const fixturePath = path.join(temporaryDirectory, "legacy-stock.json");
  try {
    const cars = Array.from({ length: 32 }, (_, index) => {
      const fixtureNumber = index + 1;
      return car(fixtureNumber, {
        year: "2022",
        price: `£${12_000 + fixtureNumber}`,
        mileage: `${2_000 + fixtureNumber} miles`,
        engineCC: "1998",
        doors: "5",
        seats: "5",
        owners: "2",
        imageCount: "1",
        images: [`https://images.example.test/legacy-${fixtureNumber}.jpg`],
        heroImage: `https://images.example.test/legacy-${fixtureNumber}.jpg`,
      });
    });
    await writeFile(fixturePath, JSON.stringify({
      dealerName: "Synthetic Legacy Dealer",
      scrapedAt: "2020-01-01T00:00:00.000Z",
      cars,
    }));

    await runBaselineSeed(fixturePath);

    const stored = await db.select().from(vehiclesTable);
    assert.equal(stored.length, 32);
    const first = await vehicle(car(1).advertId);
    assert.equal(first.year, 2022);
    assert.equal(first.sourcePrice, 12001);
    assert.equal(first.mileage, 2001);
    assert.equal(first.owners, 2);
    assert.equal(first.engineCC, 1998);
    const images = await db.select().from(vehicleImagesTable).where(eq(vehicleImagesTable.vehicleId, first.id));
    assert.deepEqual(images.map((image) => image.sourceUrl), ["https://images.example.test/legacy-1.jpg"]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("imports 32 synthetic cars and makes an identical replay idempotent", async () => {
  const body = snapshot("initial-32", Array.from({ length: 32 }, (_, i) => car(i + 1)));
  const first = await importStock(body);
  assert.equal(first.status, 201);
  assert.equal(ImportAutotraderStockResponse.parse(await first.json()).created, 32);
  assert.equal((await db.select().from(vehiclesTable)).length, 32);

  const replay = await importStock(body);
  assert.equal(replay.status, 200);
  assert.equal(ImportAutotraderStockResponse.parse(await replay.json()).status, "replayed");
  assert.equal((await db.select().from(stockImportRunsTable)).length, 1);
  const stock = await request("/stock");
  assert.equal(GetStockResponse.parse(await stock.json()).count, 32);
  const firstVehicle = await vehicle(car(1).advertId);
  const detail = await request(`/vehicles/${firstVehicle.id}`);
  assert.equal(detail.status, 200);
  assert.equal(GetVehicleResponse.parse(await detail.json()).advertId, car(1).advertId);
});

test("imports a production-shaped 32-vehicle gallery snapshot atomically", async () => {
  const body = productionShapedSnapshot("production-shaped-32");
  const parsedBody = ImportAutotraderStockBody.parse(body);
  const duplicateContainingCar = parsedBody.cars[16]!;
  const duplicateImages = duplicateContainingCar.images;
  const uniqueImageTotal = parsedBody.cars.reduce(
    (total, sourceCar) => total + new Set(sourceCar.images.map((image) => image.url)).size,
    0,
  );

  assert.equal(parsedBody.cars.length, 32);
  assert.ok(parsedBody.cars.every((sourceCar) => sourceCar.images.length >= 60));
  assert.equal(duplicateImages[59]?.url, duplicateImages[7]?.url);
  assert.notEqual(duplicateImages[59]?.url, duplicateImages[58]?.url);

  const response = await importStock(body);
  assert.equal(response.status, 201);
  assert.deepEqual(ImportAutotraderStockResponse.parse(await response.json()), {
    schemaVersion: 1,
    status: "imported",
    runId: "production-shaped-32",
    source: "autotrader",
    retailerId: "phase-1-test-retailer",
    received: 32,
    created: 32,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    errors: [],
  });

  const storedVehicles = await db.select().from(vehiclesTable);
  const storedImages = await db.select().from(vehicleImagesTable);
  assert.equal(storedVehicles.length, 32);
  assert.equal(storedImages.length, uniqueImageTotal);
  for (const sourceCar of parsedBody.cars) {
    const stored = await vehicle(sourceCar.advertId);
    const sourceUrls = sourceCar.images.map((image) => image.url);
    const persisted = storedImages.filter((image) => image.vehicleId === stored.id);
    assert.equal(persisted.length, new Set(sourceUrls).size);
    assert.equal(new Set(persisted.map((image) => image.sourceUrl)).size, persisted.length);
  }

  const duplicateVehicle = await vehicle(duplicateContainingCar.advertId);
  assert.deepEqual(
    (duplicateVehicle.rawSourceData as { images?: unknown }).images,
    duplicateImages,
    "raw source data must retain the complete duplicate-containing gallery",
  );

  const suspiciousVehicle = await vehicle(parsedBody.cars[31]!.advertId);
  assert.equal(suspiciousVehicle.sourcePrice, null);
  assert.equal(suspiciousVehicle.pendingSourcePrice, 99);
  assert.equal(suspiciousVehicle.priceReviewRequired, true);
  const publicStock = GetStockResponse.parse(await request("/stock").then((stock) => stock.json()));
  assert.equal(publicStock.count, 31);
  assert.ok(!publicStock.cars.some((sourceCar) => sourceCar.advertId === suspiciousVehicle.advertId));
  assert.equal((await request(`/vehicles/${suspiciousVehicle.id}`)).status, 404);

  const changeCountBeforeRollback = (await db.select().from(vehicleChangesTable)).length;
  const failedBody = {
    ...body,
    runId: "production-shaped-rollback",
    cars: parsedBody.cars.map((sourceCar, index) => ({
      ...sourceCar,
      title: index === 0
        ? "This update must roll back"
        : index === 31
          ? "invalid\u0000postgres-text"
          : sourceCar.title,
    })),
  };
  const failed = await importStock(failedBody);
  assert.equal(failed.status, 500);
  assert.equal((await db.select().from(stockImportRunsTable)).length, 1);
  assert.equal((await db.select().from(vehiclesTable)).length, 32);
  assert.equal((await db.select().from(vehicleImagesTable)).length, uniqueImageTotal);
  assert.equal((await db.select().from(vehicleChangesTable)).length, changeCountBeforeRollback);
  assert.equal((await vehicle(parsedBody.cars[0]!.advertId)).title, parsedBody.cars[0]!.title);
});

test("records source changes, preserves website overrides, and accepts a new advert", async () => {
  const originalImageUrl = "https://images.example.test/1.jpg";
  const replacementImageUrl = "https://images.example.test/1-replacement.jpg";
  await importStock(snapshot("base", [car(1)]));
  const original = await vehicle(car(1).advertId);
  await db.update(vehiclesTable).set({ websiteTitleOverride: "Editor selected title", websitePriceOverride: 43210 }).where(eq(vehiclesTable.id, original.id));

  const changed = car(1, {
    title: "Changed source title",
    price: 12000,
    mileage: 2222,
    heroImage: replacementImageUrl,
    images: [{ url: replacementImageUrl, caption: "front" }],
  });
  assert.equal((await importStock(snapshot("changed", [changed, car(2)]))).status, 201);
  const stored = await vehicle(car(1).advertId);
  assert.equal(stored.title, "Changed source title");
  assert.equal(stored.websiteTitleOverride, "Editor selected title");
  assert.equal(stored.websitePriceOverride, 43210);
  const changes = await db.select().from(vehicleChangesTable).where(eq(vehicleChangesTable.vehicleId, stored.id));
  assert.ok(changes.some((change) => change.fieldName === "title"));
  assert.ok(changes.some((change) => change.fieldName === "mileage"));
  const sourceImagesChange = changes.find((change) =>
    change.fieldName === "sourceImages"
    && Array.isArray(change.oldValue)
    && change.oldValue.some((image) =>
      image !== null
      && typeof image === "object"
      && "url" in image
      && image.url === originalImageUrl
    )
  );
  assert.ok(sourceImagesChange);
  assert.ok(Array.isArray(sourceImagesChange.oldValue));
  assert.ok(Array.isArray(sourceImagesChange.newValue));
  assert.deepEqual(sourceImagesChange.oldValue, [
    { url: originalImageUrl, caption: "front", sortOrder: 0, isHero: true },
  ]);
  assert.deepEqual(sourceImagesChange.newValue, [
    { url: replacementImageUrl, caption: "front", sortOrder: 0, isHero: true },
  ]);
  const storedImages = await db.select().from(vehicleImagesTable).where(eq(vehicleImagesTable.vehicleId, stored.id));
  assert.equal(storedImages.length, 2);
  assert.equal(storedImages.find((image) => image.sourceUrl === originalImageUrl)?.isActive, false);
  assert.equal(storedImages.find((image) => image.sourceUrl === replacementImageUrl)?.isActive, true);
  const publicStock = GetStockResponse.parse(await request("/stock").then((response) => response.json()));
  assert.equal(publicStock.cars[0]?.title, "Editor selected title");
  assert.deepEqual(publicStock.cars[0]?.images, [{ url: replacementImageUrl, caption: "front" }]);
});

test("quarantines or fails invalid snapshots without changing live stock", async () => {
  await importStock(snapshot("live", [car(1)]));
  const incomplete = snapshot("incomplete", Array.from({ length: 5 }, (_, i) => car(i + 1)), { complete: false });
  assert.equal((await importStock(incomplete)).status, 422);
  assert.equal((await run("incomplete")).status, "quarantined");

  const mismatch = snapshot("mismatch", [car(2)], { count: 2 });
  assert.equal((await importStock(mismatch)).status, 422);
  const failed = snapshot("failed", [], {
    failedAdvertIds: [car(3).advertId],
    errors: [{ code: "fetch", message: "fixture failure", advertId: car(3).advertId, sourceExtras: null }],
  });
  assert.equal((await importStock(failed)).status, 422);

  const duplicate = snapshot("duplicate", [car(4), car(4)]);
  assert.equal((await importStock(duplicate)).status, 400);
  assert.equal((await run("duplicate")).status, "failed");
  assert.equal((await db.select().from(vehiclesTable)).length, 1);

  const first = snapshot("conflict", [car(5)]);
  assert.equal((await importStock(first)).status, 201);
  const conflict = await importStock({ ...first, cars: [car(5, { title: "different" })] });
  assert.equal(conflict.status, 409);
  const conflictBody = parseStockImportError(await conflict.json());
  assert.equal(conflictBody.status, "rejected");
  assert.equal(conflictBody.errors[0]?.code, "run_id_conflict");
});

test("returns the stock import error shape for an unexpected database failure", async () => {
  // PostgreSQL text columns reject NUL while JSON and structural validation accept it.
  const response = await importStock(snapshot("database-error", [car(1, { title: "invalid\u0000postgres-text" })]));
  assert.equal(response.status, 500);
  const body = parseStockImportError(await response.json());
  assert.equal(body.status, "rejected");
  assert.equal(body.errors[0]?.code, "unexpected_error");
  assert.equal((await db.select().from(stockImportRunsTable)).length, 0);
});

test("handles suspicious prices, missing/reappearance, and sold inventory safely", async () => {
  await importStock(snapshot("price-base", [car(1), car(2)]));
  const firstId = (await vehicle(car(1).advertId)).id;
  await db.update(vehiclesTable).set({ inventoryStatus: "sold" }).where(eq(vehiclesTable.id, firstId));

  // £99 on an existing car is held for review, while its public source price remains safe.
  assert.equal((await importStock(snapshot("price-99-existing", [car(1, { price: 99 }), car(2)]))).status, 201);
  let existing = await vehicle(car(1).advertId);
  assert.equal(existing.sourcePrice, 10001);
  assert.equal(existing.pendingSourcePrice, 99);
  assert.equal(existing.inventoryStatus, "sold");

  // A new unsafe-only vehicle must not become public.
  assert.equal((await importStock(snapshot("price-99-new", [car(1, { price: 99 }), car(2), car(3, { price: 99 })]))).status, 201);
  const publicStock = GetStockResponse.parse(await request("/stock").then((response) => response.json()));
  assert.ok(!publicStock.cars.some((item: { advertId: string }) => item.advertId === car(3).advertId));
  assert.equal((await request(`/vehicles/${firstId}`)).status, 404);

  // One miss is retained; the second hides it; a reappearance clears the counter.
  await importStock(snapshot("missing-once", [car(1, { price: 99 }), car(3, { price: 99 })]));
  assert.equal((await vehicle(car(2).advertId)).missingCount, 1);
  assert.equal(GetStockResponse.parse(await request("/stock").then((response) => response.json())).cars.some((item) => item.advertId === car(2).advertId), true);
  await importStock(snapshot("missing-twice", [car(1, { price: 99 }), car(3, { price: 99 })]));
  assert.equal((await vehicle(car(2).advertId)).missingCount, 2);
  assert.equal(GetStockResponse.parse(await request("/stock").then((response) => response.json())).cars.some((item) => item.advertId === car(2).advertId), false);
  await importStock(snapshot("reappeared", [car(1, { price: 99 }), car(2), car(3, { price: 99 })]));
  existing = await vehicle(car(2).advertId);
  assert.equal(existing.missingCount, 0);
  assert.equal(existing.sourceStatus, "live");
});

test("sold and archived missing vehicles preserve lifecycle state when they reappear", async () => {
  await importStock(snapshot("lifecycle-base", [car(1), car(2)]));
  const sold = await vehicle(car(1).advertId);
  const archived = await vehicle(car(2).advertId);
  await db.update(vehiclesTable).set({ inventoryStatus: "sold" }).where(eq(vehiclesTable.id, sold.id));
  await db.update(vehiclesTable).set({ inventoryStatus: "archived" }).where(eq(vehiclesTable.id, archived.id));

  assert.equal((await importStock(snapshot("lifecycle-missing", []))).status, 201);
  for (const [advertId, inventoryStatus] of [[car(1).advertId, "sold"], [car(2).advertId, "archived"]] as const) {
    const missing = await vehicle(advertId);
    assert.equal(missing.inventoryStatus, inventoryStatus);
    assert.equal(missing.sourceStatus, "missing");
    assert.equal(missing.missingCount, 1);
  }

  assert.equal((await importStock(snapshot("lifecycle-reappeared", [car(1), car(2)]))).status, 201);
  for (const [advertId, inventoryStatus] of [[car(1).advertId, "sold"], [car(2).advertId, "archived"]] as const) {
    const reappeared = await vehicle(advertId);
    assert.equal(reappeared.inventoryStatus, inventoryStatus);
    assert.equal(reappeared.sourceStatus, "missing");
    assert.equal(reappeared.missingCount, 1);
  }
});

test("serializes two concurrent identical imports", async () => {
  const body = snapshot("concurrent", [car(1), car(2)]);
  const responses = await Promise.all([importStock(body), importStock(body)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  assert.deepEqual((await Promise.all(responses.map(async (response) => ImportAutotraderStockResponse.parse(await response.json())))).map((body) => body.status).sort(), ["imported", "replayed"]);
  assert.equal((await db.select().from(stockImportRunsTable)).length, 1);
  assert.equal((await db.select().from(vehiclesTable)).length, 2);
});

test("enforces tenant ownership, isolation, hashed credentials, idempotent backfill, preservation, and legacy rollback", async () => {
  const organizationB = randomUUID();
  const dealerB = randomUUID();
  const providerB = randomUUID();
  const integrationB = randomUUID();
  const plaintextMarker = "must-never-be-persisted";
  await db.insert(organizationsTable).values({ id: organizationB, slug: `tenant-${organizationB}`, name: "Isolated test organization" });
  await db.insert(dealersTable).values({ id: dealerB, organizationId: organizationB, slug: "dealer-b", name: "Dealer B" });
  await db.insert(integrationProvidersTable).values({ id: providerB, key: `provider-${providerB}`, name: "Test provider" });
  await db.insert(dealerIntegrationsTable).values({ id: integrationB, dealerId: dealerB, providerId: providerB, status: "active" });
  try {
    assert.equal((await importStock(snapshot("tenant-foundation-base", [car(1)]))).status, 201);
    const luxxyVehicle = await vehicle(car(1).advertId);
    const [luxxyRun] = await db.select().from(stockImportRunsTable).where(
      eq(stockImportRunsTable.runId, "tenant-foundation-base"),
    );
    assert.equal(luxxyVehicle.tenantDealerId, LUXXY_TENANT.dealerId);
    assert.equal(luxxyVehicle.dealerIntegrationId, LUXXY_TENANT.autoTraderIntegrationId);
    assert.ok(luxxyRun);
    await assert.rejects(
      db.delete(stockImportRunsTable).where(eq(stockImportRunsTable.id, luxxyRun.id)),
      isForeignKeyViolation,
    );
    const retainedVehicle = await vehicle(car(1).advertId);
    assert.equal(retainedVehicle.tenantDealerId, LUXXY_TENANT.dealerId);
    assert.equal(retainedVehicle.dealerIntegrationId, LUXXY_TENANT.autoTraderIntegrationId);
    const retainedChanges = await db.select().from(vehicleChangesTable).where(
      eq(vehicleChangesTable.importRunId, luxxyRun.id),
    );
    assert.ok(retainedChanges.length > 0);
    assert.ok(retainedChanges.every((change) =>
      change.tenantDealerId === LUXXY_TENANT.dealerId
      && change.dealerIntegrationId === LUXXY_TENANT.autoTraderIntegrationId,
    ));
    const retainedStock = GetStockResponse.parse(await request("/stock").then((response) => response.json()));
    assert.equal(retainedStock.cars.some((item) => item.id === luxxyVehicle.id), true);
    const legacyRunId = randomUUID();
    const legacyVehicleId = randomUUID();
    await db.insert(stockImportRunsTable).values({
      id: legacyRunId,
      runId: "legacy-unowned-delete",
      dealerId: "legacy-unowned",
      source: "autotrader",
      retailerId: "legacy",
      schemaVersion: "1",
      scrapedAt: new Date(),
      expectedCount: 1,
      receivedCount: 1,
      complete: true,
      status: "completed",
      rawSnapshot: { legacy: true },
    });
    await db.insert(vehiclesTable).values({
      id: legacyVehicleId,
      importRunId: legacyRunId,
      dealerId: "legacy-unowned",
      source: "autotrader",
      advertId: "legacy-unowned-delete",
    });
    await db.delete(stockImportRunsTable).where(eq(stockImportRunsTable.id, legacyRunId));
    const [legacyVehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, legacyVehicleId));
    assert.equal(legacyVehicle?.importRunId, null, "unowned Phase 1 rows retain single-column ON DELETE SET NULL behavior");

    await db.insert(vehiclesTable).values({
      dealerId: "dealer-b-legacy",
      tenantDealerId: dealerB,
      dealerIntegrationId: integrationB,
      source: "autotrader",
      advertId: "dealer-b-private",
    });
    const publicStock = GetStockResponse.parse(await request("/stock").then((response) => response.json()));
    assert.deepEqual(publicStock.cars.map((item) => item.advertId), [car(1).advertId]);

    await assert.rejects(
      db.insert(vehicleImagesTable).values({
        vehicleId: luxxyVehicle.id,
        tenantDealerId: dealerB,
        dealerIntegrationId: integrationB,
        sourceUrl: "https://images.example.test/cross-dealer.jpg",
      }),
      isForeignKeyViolation,
    );
    await assert.rejects(
      db.insert(vehiclesTable).values({
        dealerId: "cross-dealer",
        tenantDealerId: dealerB,
        dealerIntegrationId: LUXXY_TENANT.autoTraderIntegrationId,
        source: "autotrader",
        advertId: "cross-dealer-integration",
      }),
      isForeignKeyViolation,
    );
    await assert.rejects(
      db.insert(vehiclesTable).values({
        importRunId: luxxyRun.id,
        dealerId: "cross-dealer-run",
        tenantDealerId: dealerB,
        dealerIntegrationId: integrationB,
        source: "autotrader",
        advertId: "cross-dealer-run",
      }),
      isForeignKeyViolation,
    );

    const verifier = await createCollectorCredentialVerifier(`a-safe-${plaintextMarker}`);
    assert.equal(await verifyCollectorCredential(`a-safe-${plaintextMarker}`, verifier), true);
    assert.equal(await verifyCollectorCredential(`a-safe-${plaintextMarker}-wrong`, verifier), false);
    await db.insert(integrationCollectorCredentialsTable).values({
      dealerIntegrationId: integrationB,
      label: "test collector",
      ...verifier,
    });
    const [credential] = await db.select().from(integrationCollectorCredentialsTable)
      .where(eq(integrationCollectorCredentialsTable.dealerIntegrationId, integrationB));
    assert.ok(credential);
    assert.equal(JSON.stringify(credential).includes(plaintextMarker), false);
    const credentialColumns = await db.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'integration_collector_credentials'
    `);
    assert.equal(credentialColumns.rows.some((row) => /secret|password|plaintext|token/i.test(String(row.column_name))), false);

    const preservedBefore = await db.execute(sql`
      select id, dealer_id, source, advert_id, md5(coalesce(raw_source_data::text, 'null')) raw_hash
      from vehicles where id = ${luxxyVehicle.id}::uuid
    `);
    const foundationCountBefore = await db.execute(sql`
      select (select count(*) from organizations where id = ${LUXXY_TENANT.organizationId}::uuid) organizations,
        (select count(*) from dealers where id = ${LUXXY_TENANT.dealerId}::uuid) dealers,
        (select count(*) from dealer_integrations where id = ${LUXXY_TENANT.autoTraderIntegrationId}::uuid) integrations
    `);
    await backfillLuxxyTenant(db);
    await backfillLuxxyTenant(db);
    const foundationCountAfter = await db.execute(sql`
      select (select count(*) from organizations where id = ${LUXXY_TENANT.organizationId}::uuid) organizations,
        (select count(*) from dealers where id = ${LUXXY_TENANT.dealerId}::uuid) dealers,
        (select count(*) from dealer_integrations where id = ${LUXXY_TENANT.autoTraderIntegrationId}::uuid) integrations
    `);
    const preservedAfter = await db.execute(sql`
      select id, dealer_id, source, advert_id, md5(coalesce(raw_source_data::text, 'null')) raw_hash
      from vehicles where id = ${luxxyVehicle.id}::uuid
    `);
    assert.deepEqual(foundationCountAfter.rows, foundationCountBefore.rows);
    assert.deepEqual(preservedAfter.rows, preservedBefore.rows);

    // Legacy access remains usable without removing the shadow ownership keys.
    // A real migration rollback would drop the additive constraints/columns
    // before the tenant tables rather than mutating referenced parent keys.
    const legacyRows = await db.select().from(vehiclesTable).where(and(
      eq(vehiclesTable.dealerId, process.env.STOCK_DEALER_ID!),
      eq(vehiclesTable.source, "autotrader"),
    ));
    assert.equal(legacyRows.some((row) => row.id === luxxyVehicle.id), true);
  } finally {
    await db.delete(integrationCollectorCredentialsTable).where(eq(integrationCollectorCredentialsTable.dealerIntegrationId, integrationB));
    await db.delete(vehiclesTable).where(eq(vehiclesTable.tenantDealerId, dealerB));
    await db.delete(dealerIntegrationsTable).where(eq(dealerIntegrationsTable.id, integrationB));
    await db.delete(integrationProvidersTable).where(eq(integrationProvidersTable.id, providerB));
    await db.delete(dealersTable).where(eq(dealersTable.id, dealerB));
    await db.delete(organizationsTable).where(eq(organizationsTable.id, organizationB));
  }
});

test("rehearses Luxxy backfill against an exact production-shaped development copy", async () => {
  const runs = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(),
    runId: `phase2a-rehearsal-run-${index + 1}`,
    dealerId: "luxxy-motors",
    source: "autotrader",
    retailerId: "10040438",
    schemaVersion: "1",
    scrapedAt: new Date(`2025-01-0${index + 1}T12:00:00.000Z`),
    expectedCount: 32,
    receivedCount: 32,
    complete: true,
    status: "completed" as const,
    failedAdvertIds: [],
    errors: [],
    rawSnapshot: { rehearsal: true, sequence: index + 1, cars: [`source-${index + 1}`] },
  }));
  const vehicles = Array.from({ length: 32 }, (_, index) => ({
    id: randomUUID(),
    importRunId: runs[2]!.id,
    dealerId: "luxxy-motors",
    source: "autotrader",
    advertId: `phase2a-production-shaped-${String(index + 1).padStart(2, "0")}`,
    inventoryStatus: "available" as const,
    sourceStatus: "live" as const,
    sourcePrice: index === 31 ? null : 18_000 + index,
    pendingSourcePrice: index === 31 ? 99 : null,
    priceReviewRequired: index === 31,
    rawSourceData: { fixture: "phase2a-rehearsal", vehicle: index + 1, nested: { stable: true } },
  }));
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const imageRows = vehicles.flatMap((vehicle, vehicleIndex) => Array.from(
    { length: vehicleIndex < 4 ? 49 : 50 },
    (_, sortOrder) => ({
      id: randomUUID(),
      vehicleId: vehicle.id,
      origin: "source" as const,
      sourceUrl: `https://images.example.test/phase2a/${vehicleIndex + 1}/${String(sortOrder).padStart(2, "0")}.jpg`,
      sortOrder,
      isHero: sortOrder === 0,
      isActive: true,
      rawSourceData: { sourceIndex: sortOrder, vehicle: vehicleIndex + 1 },
    }),
  ));
  const changeRows = vehicles.flatMap((vehicle, vehicleIndex) => Array.from(
    { length: vehicleIndex < 28 ? 34 : 33 },
    (_, changeIndex) => ({
      id: randomUUID(),
      vehicleId: vehicle.id,
      importRunId: runs[changeIndex % runs.length]!.id,
      fieldName: `fixtureField${changeIndex}`,
      oldValue: { revision: changeIndex },
      newValue: { revision: changeIndex + 1, vehicle: vehicleIndex + 1 },
    }),
  ));

  try {
    await db.insert(stockImportRunsTable).values(runs);
    await db.insert(vehiclesTable).values(vehicles);
    await db.insert(vehicleImagesTable).values(imageRows);
    await db.insert(vehicleChangesTable).values(changeRows);

    const capture = async () => {
      const [storedRuns, storedVehicles, storedImages, storedChanges] = await Promise.all([
        db.select().from(stockImportRunsTable).where(eq(stockImportRunsTable.dealerId, "luxxy-motors")),
        db.select().from(vehiclesTable).where(eq(vehiclesTable.dealerId, "luxxy-motors")),
        db.select().from(vehicleImagesTable),
        db.select().from(vehicleChangesTable),
      ]);
      const eligible = storedVehicles.filter((row) =>
        ["available", "reserved"].includes(row.inventoryStatus)
        && row.missingCount < 2
        && !(row.priceReviewRequired && row.sourcePrice === null && row.websitePriceOverride === null),
      );
      return {
        counts: [storedRuns.length, storedVehicles.length, storedImages.length, storedChanges.length, eligible.length],
        runIds: storedRuns.map((row) => row.id).sort(),
        vehicleIds: storedVehicles.map((row) => row.id).sort(),
        imageRelationships: storedImages
          .map((row) => [row.id, row.vehicleId, row.sortOrder, row.isHero])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        changeRelationships: storedChanges
          .map((row) => [row.id, row.vehicleId, row.importRunId, row.fieldName])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        rawHashes: {
          runs: storedRuns.map((row) => [row.id, digest(row.rawSnapshot)]).sort(),
          vehicles: storedVehicles.map((row) => [row.id, digest(row.rawSourceData)]).sort(),
          images: storedImages.map((row) => [row.id, digest(row.rawSourceData)]).sort(),
        },
        imageOrdering: storedImages
          .map((row) => [row.vehicleId, row.sortOrder, row.sourceUrl, row.isHero])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1])),
        pending: storedVehicles.filter((row) => row.priceReviewRequired && row.pendingSourcePrice !== null)
          .map((row) => row.id).sort(),
      };
    };

    const before = await capture();
    assert.deepEqual(before.counts, [3, 32, 1596, 1084, 31]);
    assert.equal(before.pending.length, 1);
    assert.equal((await db.select().from(vehiclesTable).where(eq(vehiclesTable.tenantDealerId, LUXXY_TENANT.dealerId))).length, 0);

    await backfillLuxxyTenant(db);
    await backfillLuxxyTenant(db);

    const after = await capture();
    assert.deepEqual(after, before, "backfill may only populate additive ownership columns");
    const [ownedVehicles, ownedImages, ownedChanges, ownedRuns] = await Promise.all([
      db.select().from(vehiclesTable).where(and(eq(vehiclesTable.dealerId, "luxxy-motors"), eq(vehiclesTable.tenantDealerId, LUXXY_TENANT.dealerId), eq(vehiclesTable.dealerIntegrationId, LUXXY_TENANT.autoTraderIntegrationId))),
      db.select().from(vehicleImagesTable).where(and(eq(vehicleImagesTable.tenantDealerId, LUXXY_TENANT.dealerId), eq(vehicleImagesTable.dealerIntegrationId, LUXXY_TENANT.autoTraderIntegrationId))),
      db.select().from(vehicleChangesTable).where(and(eq(vehicleChangesTable.tenantDealerId, LUXXY_TENANT.dealerId), eq(vehicleChangesTable.dealerIntegrationId, LUXXY_TENANT.autoTraderIntegrationId))),
      db.select().from(stockImportRunsTable).where(and(eq(stockImportRunsTable.dealerId, "luxxy-motors"), eq(stockImportRunsTable.tenantDealerId, LUXXY_TENANT.dealerId), eq(stockImportRunsTable.dealerIntegrationId, LUXXY_TENANT.autoTraderIntegrationId))),
    ]);
    assert.deepEqual([ownedRuns.length, ownedVehicles.length, ownedImages.length, ownedChanges.length], [3, 32, 1596, 1084]);
  } finally {
    await clearStock();
  }
});

test("applies and reverses migrations in an isolated production-shaped PostgreSQL schema", async () => {
  const schema = `phase2a_rehearsal_${randomUUID().replaceAll("-", "")}`;
  const client = await pool.connect();
  const quote = `"${schema}"`;
  const manifestDigest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const runRows = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(), runId: `isolated-run-${index + 1}`,
  }));
  const vehicleRows = Array.from({ length: 32 }, (_, index) => ({
    id: randomUUID(), advertId: `isolated-advert-${index + 1}`,
  }));
  const imageRows = vehicleRows.flatMap((vehicle, vehicleIndex) => Array.from(
    { length: vehicleIndex < 4 ? 49 : 50 },
    (_, sortOrder) => ({ id: randomUUID(), vehicleId: vehicle.id, sortOrder }),
  ));
  const changeRows = vehicleRows.flatMap((vehicle, vehicleIndex) => Array.from(
    { length: vehicleIndex < 28 ? 34 : 33 },
    (_, changeIndex) => ({ id: randomUUID(), vehicleId: vehicle.id, runId: runRows[changeIndex % 3]!.id, changeIndex }),
  ));
  const capture = async () => {
    const result = await client.query(`
      select
        (select count(*)::int from stock_import_runs) runs,
        (select count(*)::int from vehicles) vehicles,
        (select count(*)::int from vehicle_images) images,
        (select count(*)::int from vehicle_changes) changes,
        (select count(*)::int from vehicles where inventory_status in ('available','reserved')
          and missing_count < 2 and not (price_review_required and source_price is null
          and website_price_override is null)) public_vehicles,
        (select count(*)::int from vehicles where price_review_required
          and pending_source_price is not null) pending_prices,
        (select coalesce(jsonb_agg(id order by id), '[]') from vehicles
          where inventory_status in ('available','reserved') and missing_count < 2
          and not (price_review_required and source_price is null and website_price_override is null)) public_manifest,
        (select coalesce(jsonb_agg(jsonb_build_array(id, dealer_id, source, advert_id,
          md5(coalesce(raw_source_data::text, 'null'))) order by id), '[]') from vehicles) vehicle_manifest,
        (select coalesce(jsonb_agg(jsonb_build_array(id, vehicle_id, sort_order, is_hero,
          source_url, md5(coalesce(raw_source_data::text, 'null'))) order by vehicle_id, sort_order, id), '[]') from vehicle_images) image_manifest,
        (select coalesce(jsonb_agg(jsonb_build_array(id, vehicle_id, import_run_id, field_name,
          md5(coalesce(old_value::text, 'null')), md5(coalesce(new_value::text, 'null'))) order by id), '[]') from vehicle_changes) change_manifest,
        (select coalesce(jsonb_agg(jsonb_build_array(id, run_id, dealer_id, source, status,
          md5(raw_snapshot::text)) order by id), '[]') from stock_import_runs) run_manifest
    `);
    const row = result.rows[0]!;
    return {
      counts: [row.runs, row.vehicles, row.images, row.changes, row.public_vehicles, row.pending_prices],
      hash: manifestDigest([
        row.vehicle_manifest,
        row.image_manifest,
        row.change_manifest,
        row.run_manifest,
      ]),
      publicProjection: manifestDigest(row.public_manifest),
    };
  };
  const applyMigration = async (name: string) => {
    const raw = await readFile(path.join(workspaceRoot, "lib/db/drizzle", name), "utf8");
    await client.query(raw.replaceAll(`"public".`, `${quote}.`));
  };
  try {
    await client.query(`create schema ${quote}; set search_path to ${quote}`);
    await applyMigration("0000_married_cloak.sql");
    await client.query("begin");
    for (const [index, run] of runRows.entries()) {
      await client.query(`insert into stock_import_runs
        (id, run_id, dealer_id, source, retailer_id, schema_version, scraped_at, expected_count, received_count, complete, status, raw_snapshot)
        values ($1, $2, 'luxxy-motors', 'autotrader', '10040438', '1', now(), 32, 32, true, 'completed', $3::jsonb)`,
      [run.id, run.runId, JSON.stringify({ isolated: true, run: index + 1 })]);
    }
    for (const [index, vehicle] of vehicleRows.entries()) {
      await client.query(`insert into vehicles
        (id, import_run_id, dealer_id, source, advert_id, inventory_status, source_status, source_price,
          pending_source_price, price_review_required, raw_source_data)
        values ($1, $2, 'luxxy-motors', 'autotrader', $3, 'available', 'live', $4, $5, $6, $7::jsonb)`,
      [vehicle.id, runRows[2]!.id, vehicle.advertId, index === 31 ? null : 18_000 + index,
        index === 31 ? 99 : null, index === 31, JSON.stringify({ isolated: true, vehicle: index + 1 })]);
    }
    for (const image of imageRows) {
      await client.query(`insert into vehicle_images
        (id, vehicle_id, origin, source_url, sort_order, is_hero, raw_source_data)
        values ($1, $2, 'source', $3, $4, $5, $6::jsonb)`,
      [image.id, image.vehicleId, `https://images.example.test/isolated/${image.vehicleId}/${image.sortOrder}.jpg`,
        image.sortOrder, image.sortOrder === 0, JSON.stringify({ image: image.sortOrder })]);
    }
    for (const change of changeRows) {
      await client.query(`insert into vehicle_changes
        (id, vehicle_id, import_run_id, field_name, old_value, new_value)
        values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [change.id, change.vehicleId, change.runId, `field${change.changeIndex}`,
        JSON.stringify({ old: change.changeIndex }), JSON.stringify({ next: change.changeIndex + 1 })]);
    }
    await client.query("commit");
    const before = await capture();
    assert.deepEqual(before.counts, [3, 32, 1596, 1084, 31, 1]);

    await applyMigration("0001_youthful_lizard.sql");
    await applyMigration("0002_curly_nuke.sql");
    await applyMigration("0003_spicy_zaladane.sql");
    await applyMigration("0004_quiet_captain_marvel.sql");
    const isolatedDb = drizzle(client);
    await backfillLuxxyTenant(isolatedDb);
    await backfillLuxxyTenant(isolatedDb);
    const after = await capture();
    assert.deepEqual(after, before, "migration/backfill must preserve the non-secret Phase 1 manifest");
    const ownership = await client.query(`
      select
        (select count(*)::int from vehicles where tenant_dealer_id is null or dealer_integration_id is null) vehicles,
        (select count(*)::int from vehicle_images where tenant_dealer_id is null or dealer_integration_id is null) images,
        (select count(*)::int from vehicle_changes where tenant_dealer_id is null or dealer_integration_id is null) changes,
        (select count(*)::int from stock_import_runs where tenant_dealer_id is null or dealer_integration_id is null) runs
    `);
    assert.deepEqual(Object.values(ownership.rows[0]!).map(Number), [0, 0, 0, 0]);

    // Documented down sequence: remove additive stock FKs/columns, then tenant
    // tables and enums. The untouched Phase 1 tables/data remain queryable.
    await client.query(`
      drop trigger stock_import_runs_prevent_owned_delete on stock_import_runs;
      drop function prevent_owned_stock_import_run_delete();
      alter table vehicle_changes drop column dealer_integration_id, drop column tenant_dealer_id;
      alter table vehicle_images drop column dealer_integration_id, drop column tenant_dealer_id;
      alter table vehicles drop column dealer_integration_id, drop column tenant_dealer_id;
      alter table stock_import_runs drop column dealer_integration_id, drop column tenant_dealer_id;
      drop table integration_collector_credentials, dealer_memberships, dealer_domains, dealer_integrations,
        integration_providers, users, dealers, organizations;
      drop type dealer_integration_status, dealer_membership_role;
    `);
    const reversed = await capture();
    assert.deepEqual(reversed, before, "down sequence leaves Phase 1 legacy data and projections usable");
  } finally {
    try { await client.query("rollback"); } catch { /* no transaction is acceptable */ }
    await client.query(`drop schema if exists ${quote} cascade`);
    await client.query("set search_path to public");
    client.release();
  }
});