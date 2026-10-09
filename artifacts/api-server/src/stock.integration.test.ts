import "./test/setup";
/*
 * This is deliberately an HTTP integration test: it starts the exported Express
 * app on an ephemeral port and uses a disposable local PostgreSQL database.
 * The shared setup requires LUXXY_TEST_DATABASE_URL and rejects remote targets.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  GetStockResponse,
  GetVehicleResponse,
  ImportAutotraderStockBody,
  ImportAutotraderStockResponse,
  ImportGrokStockResponse,
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
process.env.STOCK_PLATFORM = "autotrader";
const privateDir = await mkdtemp(path.join(tmpdir(), "stock-integration-private-"));
process.env.INTEGRATIONS_PRIVATE_DIR = privateDir;

const secret = process.env.STOCK_IMPORT_SECRET;
const { db, pool, stockImportRunsTable, vehicleChangesTable, vehicleImagesTable, vehiclesTable } = await import("@workspace/db");

const requiredTables = ["stock_import_runs", "vehicles", "vehicle_images", "vehicle_changes"];
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
    await rm(privateDir, { recursive: true, force: true });
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
    advertUrl: `https://www.autotrader.co.uk/car-details/fictional-${index}`,
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
async function importGrokStock(body: Record<string, unknown>, authorized = true) {
  return request("/stock/imports/grok", {
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

test("imports Grok snapshots through the existing stock reconciliation feed", async () => {
  const body = snapshot("grok-adapter", [car(1)], { source: "grok" });
  const first = await importGrokStock(body);
  assert.equal(first.status, 201);
  assert.deepEqual(ImportGrokStockResponse.parse(await first.json()), {
    schemaVersion: 1,
    status: "imported",
    runId: "grok-adapter",
    source: "grok",
    retailerId: "phase-1-test-retailer",
    received: 1,
    created: 1,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    errors: [],
  });
  assert.equal((await vehicle(car(1).advertId)).source, "autotrader");
  assert.equal(GetStockResponse.parse(await request("/stock").then((response) => response.json())).count, 1);

  const replay = await importGrokStock(body);
  assert.equal(replay.status, 200);
  assert.equal(ImportGrokStockResponse.parse(await replay.json()).status, "replayed");
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
test("Cazoo imports, retries, public descriptions and dealer state preservation use the selected platform", async () => {
  process.env.STOCK_PLATFORM = 'cazoo';
  try {
    const inputCar = car(1, { advertUrl: 'https://www.cazoo.co.uk/cars-for-sale/example-1/', sourceExtras: { sourcePlatform: 'cazoo', description: null, features: [] }, specifications: null });
    const payload = snapshot('cazoo-first', [inputCar], { source: 'grok' });
    const submit = (body: unknown) => request('/stock/imports/grok', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-stock-import-secret': secret! }, body: JSON.stringify(body) });
    assert.equal((await submit(payload)).status, 201);
    const stored = await vehicle(inputCar.advertId);
    assert.equal(stored.source, 'cazoo');
    assert.equal((await submit(payload)).status, 200);
    const stock = GetStockResponse.parse(await request('/stock').then(r => r.json()));
    assert.equal(stock.cars[0].sourceExtras?.descriptionOrigin, 'generated-facts');
    assert.equal((await request(`/vehicles/${stored.id}`)).status, 200);
    assert.equal((await submit({ ...payload, runId: 'cazoo-incomplete', complete: false, cars: [], count: 0 })).status, 422);
    assert.equal(GetStockResponse.parse(await request('/stock').then(r => r.json())).count, 1);
    await db.update(vehiclesTable).set({ inventoryStatus: 'reserved' }).where(eq(vehiclesTable.id, stored.id));
    assert.equal((await submit(snapshot('cazoo-update', [{ ...inputCar, price: 9000 }], { source: 'grok' }))).status, 201);
    assert.equal((await vehicle(inputCar.advertId)).inventoryStatus, 'reserved');
    await db.update(vehiclesTable).set({ inventoryStatus: 'sold' }).where(eq(vehiclesTable.id, stored.id));
    assert.equal((await submit(snapshot('cazoo-sold', [inputCar], { source: 'grok' }))).status, 201);
    assert.equal((await vehicle(inputCar.advertId)).inventoryStatus, 'sold');
    assert.equal(GetStockResponse.parse(await request('/stock').then(r => r.json())).count, 0);
  } finally { process.env.STOCK_PLATFORM = 'autotrader'; }
});
