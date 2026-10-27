import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { performance } from "node:perf_hooks";
import express from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  engine,
  pool,
  dealershipsTable,
  dealerDomainsTable,
  dealerImportKeysTable,
  vehiclesTable,
  vehicleImagesTable,
  vehicleChangesTable,
  stockImportRunsTable,
} from "./test/tenant-test-db";
import { randomUUID } from "node:crypto";
import fixture from "./test/fixtures/cazoo-stock.json";
import {
  stockSourceData,
  projectedStockSourceData,
} from "./lib/stock-source-data";
process.env.MULTI_TENANT_ENABLED = "true";
process.env.STOCK_IMPORT_API_HOST = "imports.example.test";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "fatal";
process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString(
  "base64",
);
const baseline = process.env.STOCK_PERFORMANCE_BASELINE === "1";
const dealer = "performance-a",
  other = "performance-b";
type Query = { text: string; rows: number; bytes: number };
let queries: Query[] = [];
let ownershipRaceId: string | undefined;
const watch = (client: any) => {
  const original = client.query.bind(client);
  client.query = async (...args: any[]) => {
    const result = await original(...args);
    if (ownershipRaceId && /^select .*from "vehicles" where/i.test(args[0])) {
      const id = ownershipRaceId;
      ownershipRaceId = undefined;
      // Return the original read, then simulate a reservation owner saved before
      // the importer updates that row. Its SQL merge must retain the newer owner.
      await original(
        "UPDATE vehicles SET audit_metadata = $1::jsonb WHERE id = $2::uuid",
        [
          JSON.stringify({
            saleWorkspaceId: "concurrently-created-sale",
            raceNote: "new owner evidence",
          }),
          id,
        ],
      );
    }
    queries.push({
      text: args[0],
      rows: result.affectedRows ?? result.rows?.length ?? 0,
      bytes: Buffer.byteLength(JSON.stringify(result.rows ?? [])),
    });
    return result;
  };
};
watch(engine);
const transaction = engine.transaction.bind(engine);
(engine as any).transaction = (callback: any) =>
  transaction(async (client) => {
    watch(client);
    return callback(client);
  });
before(async () => {
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort())
    await engine.exec(
      await readFile(join("../../lib/db/drizzle", file), "utf8"),
    );
  const { importSecretDigest } = await import("./middlewares/tenant");
  for (const id of [dealer, other]) {
    await db.insert(dealershipsTable).values({
      id,
      name: id,
      status: "active",
      canonicalOrigin: `https://${id}.example.test`,
      stockPlatform: "cazoo",
      retailerId: id,
      sourceUrl: `https://www.cazoo.co.uk/dealers/${id}/`,
    });
    await db.insert(dealerDomainsTable).values({
      dealerId: id,
      hostname: `${id}.example.test`,
      verified: true,
      verificationToken: "fictional",
    });
    await db.insert(dealerImportKeysTable).values({
      dealerId: id,
      secretHash: importSecretDigest(`fictional-${id}`),
    });
  }
});

after(() => engine.close());

test("only explicit collector check metadata is separated; nested and unknown facts remain intact", () => {
  const source = {
    sourceExtras: {
      lastCheckedAt: "earlier",
      detailFreshness: "cached",
      sourcePlatform: "cazoo",
      plateSource: "ocr",
      description: "Actual description",
      features: ["Heated seats"],
      history: { lastCheckedAt: "A supplied history fact" },
      unknown: "Must survive",
    },
  };
  const before = JSON.stringify(source),
    parts = stockSourceData(source);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(parts.checks, {
    lastCheckedAt: "earlier",
    detailFreshness: "cached",
  });
  assert.equal(
    (parts.facts.sourceExtras as any).history.lastCheckedAt,
    "A supplied history fact",
  );
  const projected = projectedStockSourceData(source, {
    sourceCheckMetadata: { lastCheckedAt: "newer" },
  });
  assert.equal((projected.sourceExtras as any).lastCheckedAt, "newer");
  assert.equal((projected.sourceExtras as any).unknown, "Must survive");
  assert.equal((projected.sourceExtras as any).detailFreshness, undefined);
  assert.deepEqual(
    stockSourceData({ sourceExtras: { lastCheckedAt: "today" } }).facts,
    { sourceExtras: null },
  );
});

test("24-car, 1204-image imports avoid unchanged gallery writes while preserving real changes and safeguards", async () => {
  const { resolveTenant } = await import("./middlewares/tenant");
  const { default: router } = await import("./routes/stock");
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use((req, _res, next) => {
    (req as any).log = { warn() {}, error() {} };
    next();
  });
  app.use(resolveTenant);
  app.use("/api", router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test listener");
  const request = (
    path: string,
    host: string,
    body?: unknown,
  ): Promise<Response> =>
    new Promise((resolve, reject) => {
      const call = httpRequest(
        `http://127.0.0.1:${address.port}${path}`,
        {
          method: body ? "POST" : "GET",
          headers: {
            host,
            "content-type": "application/json",
            ...(body ? { "x-stock-import-secret": `fictional-${dealer}` } : {}),
          },
        },
        (response) => {
          let text = "";
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve(
              new Response(text || null, {
                status: response.statusCode,
                headers: { "content-type": "application/json" },
              }),
            ),
          );
        },
      );
      call.on("error", reject);
      if (body) call.write(JSON.stringify(body));
      call.end();
    });
  let sequence = 0;
  const initial = Array.from({ length: 24 }, (_, index) => ({
    ...structuredClone(fixture.cars[0]),
    advertId: `fictional-car-${index}`,
    heroImage: `https://images.example.test/${index}/0.jpg`,
    imageCount: index < 4 ? 51 : 50,
    images: Array.from({ length: index < 4 ? 51 : 50 }, (_, n) => ({
      url: `https://images.example.test/${index}/${n}.jpg`,
      caption: n ? `Detail ${n}` : "front",
    })),
    sourceExtras: {
      sourcePlatform: "cazoo",
      description: "Fictional equipment description",
      features: ["Air conditioning"],
      lastCheckedAt: "first",
      detailFreshness: "cached",
    },
  }));
  const snapshot = (cars = initial) => ({
    ...fixture,
    runId: `performance-${++sequence}`,
    retailerId: dealer,
    scrapedAt: new Date(Date.now() - 60000 + sequence * 1000).toISOString(),
    count: cars.length,
    expectedAdvertCount: cars.length,
    cars,
  });
  const post = async (body: unknown) => {
    const response = await request(
      `/api/stock/imports/${dealer}/grok`,
      "imports.example.test",
      body,
    );
    const data = (await response.json()) as any;
    assert.ok([200, 201].includes(response.status), JSON.stringify(data));
    return data;
  };
  try {
    assert.equal((await post(snapshot())).created, 24);
    const firstImages = await db.select().from(vehicleImagesTable);
    assert.equal(firstImages.length, 1204);
    const checked = initial.map((car) => ({
      ...car,
      sourceExtras: {
        ...car.sourceExtras,
        lastCheckedAt: "second",
        detailFreshness: "fresh",
      },
    }));
    queries = [];
    const started = performance.now();
    const quietBody = snapshot(checked),
      quiet = await post(quietBody);
    const duration = performance.now() - started,
      quietQueries = [...queries];
    const imageReads = quietQueries.filter((query) =>
      /^select .*from "vehicle_images"/i.test(query.text),
    );
    const imageWrites = quietQueries.filter((query) =>
      /^(insert into|update) "vehicle_images"/i.test(query.text),
    );
    assert.equal(quiet.updated, baseline ? 24 : 0);
    assert.equal(quiet.unchanged, baseline ? 0 : 24);
    assert.equal(imageReads.length, baseline ? 24 : 1);
    assert.equal(
      imageWrites.reduce((sum, query) => sum + query.rows, 0),
      baseline ? 1204 : 0,
    );
    console.log(
      JSON.stringify({
        benchmark: baseline ? "original-import" : "optimized-import",
        cars: 24,
        images: 1204,
        sqlQueries: quietQueries.length,
        imageReads: imageReads.length,
        imageRowsWritten: imageWrites.reduce(
          (sum, query) => sum + query.rows,
          0,
        ),
        response: { updated: quiet.updated, unchanged: quiet.unchanged },
        durationMs: Math.round(duration),
      }),
    );
    const afterQuiet = await db.select().from(vehicleImagesTable);
    if (!baseline)
      assert.deepEqual(
        afterQuiet,
        firstImages,
        "No image sightings or firstSeenAt values are rewritten on an unchanged check",
      );
    const publicStock = (await (
      await request("/api/stock", `${dealer}.example.test`)
    ).json()) as any;
    assert.equal(publicStock.cars[0].sourceExtras.lastCheckedAt, "second");
    assert.equal(
      publicStock.cars[0].sourceExtras.description,
      "Fictional equipment description",
    );
    const changesBeforeReplay = (await db.select().from(vehicleChangesTable))
      .length;
    queries = [];
    assert.equal((await post(quietBody)).status, "replayed");
    const correctedCar=(await db.select().from(vehiclesTable).where(and(eq(vehiclesTable.dealerId,dealer),eq(vehiclesTable.advertId,checked[0].advertId))))[0];
    await db.update(vehiclesTable).set({archivedAt:new Date("2026-09-01T12:00:00Z"),retirementStartedAt:new Date("2026-08-24T12:00:00Z"),plate:"AB12CDE",vrm:"AB12CDE",auditMetadata:{...(correctedCar.auditMetadata as any),plateCorrection:{plate:"AB12CDE",by:"Fixture staff"}}}).where(eq(vehiclesTable.id,correctedCar.id));
    await post(snapshot(checked));
    const correctedAgain=(await db.select().from(vehiclesTable).where(eq(vehiclesTable.id,correctedCar.id)))[0];
    assert.equal(correctedAgain.plate,"AB12CDE");
    assert.equal(correctedAgain.vrm,"AB12CDE");
    assert.equal(correctedAgain.archivedAt,null);
    assert.equal(correctedAgain.retirementStartedAt,null);
    assert.equal(
      (await db.select().from(vehicleChangesTable)).length,
      changesBeforeReplay,
    );
    assert.equal(
      queries.filter((q) =>
        /^(insert into|update) "vehicle_images"/.test(q.text),
      ).length,
      0,
    );

    const galleryChange = structuredClone(checked);
    galleryChange[0].images[1].caption = "New supplied caption";
    galleryChange[0].images[2].url =
      "https://images.example.test/0/new-photo.jpg";
    queries = [];
    const galleryResult = await post(snapshot(galleryChange));
    assert.equal(galleryResult.updated, 1);
    assert.equal(galleryResult.unchanged, 23);
    if (!baseline)
      assert.equal(
        queries
          .filter((q) => /^insert into "vehicle_images"/.test(q.text))
          .reduce((sum, q) => sum + q.rows, 0),
        2,
      );
    const oldPhoto = (await db.select().from(vehicleImagesTable)).find(
      (image) => image.sourceUrl === initial[0].images[2].url,
    )!;
    assert.equal(oldPhoto.isActive, false);
    await post(snapshot(checked));
    assert.equal(
      (await db.select().from(vehicleImagesTable)).find(
        (image) => image.id === oldPhoto.id,
      )!.isActive,
      true,
    );
    assert.equal(
      (await db.select().from(vehicleImagesTable))
        .find((image) => image.id === oldPhoto.id)!
        .firstSeenAt.getTime(),
      oldPhoto.firstSeenAt.getTime(),
    );

    const factChange = structuredClone(checked);
    factChange[1].price -= 200;
    factChange[1].sourceExtras.description = "New actual description";
    factChange[1].sourceExtras.features.push("Parking sensors");
    const changed = await post(snapshot(factChange));
    assert.equal(changed.updated, 1);
    assert.equal(changed.unchanged, 23);
    const [reserved] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.advertId, initial[2].advertId));
    await db
      .update(vehiclesTable)
      .set({
        inventoryStatus: "reserved",
        websitePriceOverride: 9999,
        auditMetadata: {
          saleWorkspaceId: "owned-sale",
          sourceCheckMetadata: { lastCheckedAt: "second" },
        },
      })
      .where(eq(vehiclesTable.id, reserved.id));
    await post(snapshot(factChange));
    const [stillReserved] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, reserved.id));
    assert.equal(stillReserved.inventoryStatus, "reserved");
    assert.equal(stillReserved.websitePriceOverride, 9999);
    assert.equal(stillReserved.auditMetadata?.saleWorkspaceId, "owned-sale");
    ownershipRaceId = reserved.id;
    await post(snapshot(factChange));
    const [concurrent] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, reserved.id));
    assert.equal(
      concurrent.auditMetadata?.saleWorkspaceId,
      "concurrently-created-sale",
    );
    assert.equal(concurrent.auditMetadata?.raceNote, "new owner evidence");
    if (!baseline) {
      const manualUrl = initial[3].images[4].url;
      const [vehicle] = await db
        .select()
        .from(vehiclesTable)
        .where(eq(vehiclesTable.advertId, initial[3].advertId));
      await db
        .update(vehicleImagesTable)
        .set({ origin: "manual", caption: "Dealer caption", isActive: false })
        .where(
          and(
            eq(vehicleImagesTable.vehicleId, vehicle.id),
            eq(vehicleImagesTable.sourceUrl, manualUrl),
          ),
        );
      const [manualBefore] = await db
        .select()
        .from(vehicleImagesTable)
        .where(
          and(
            eq(vehicleImagesTable.vehicleId, vehicle.id),
            eq(vehicleImagesTable.sourceUrl, manualUrl),
          ),
        );
      await post(snapshot(factChange));
      const [manualAfter] = await db
        .select()
        .from(vehicleImagesTable)
        .where(eq(vehicleImagesTable.id, manualBefore.id));
      assert.deepEqual(
        manualAfter,
        manualBefore,
        "A manually claimed or hidden photo remains dealer-controlled",
      );
    }
    const missingCars = factChange.slice(1);
    await post(snapshot(missingCars));
    assert.equal(
      (
        (await (
          await request("/api/stock", `${dealer}.example.test`)
        ).json()) as any
      ).count,
      24,
    );
    await post(snapshot(missingCars));
    assert.equal(
      (
        (await (
          await request("/api/stock", `${dealer}.example.test`)
        ).json()) as any
      ).count,
      23,
    );
    assert.equal(
      (
        await db
          .select()
          .from(vehiclesTable)
          .where(eq(vehiclesTable.dealerId, other))
      ).length,
      0,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
