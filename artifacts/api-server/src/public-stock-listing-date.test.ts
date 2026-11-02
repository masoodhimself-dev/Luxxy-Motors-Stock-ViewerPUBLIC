import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { eq } from "drizzle-orm";
import { GetStockResponse, GetVehicleResponse } from "@workspace/api-zod";
import { db, engine, dealershipsTable, vehiclesTable } from "./test/tenant-test-db";
import { runWithTenant, type TenantContext } from "./lib/tenant-context";
import { readPublicStockCars } from "./routes/stock";

test("public stock and vehicle contracts retain the persisted first-added date without exposing later checks or another dealer's stock", async () => {
  process.env.MULTI_TENANT_ENABLED = "true";
  for (const name of (await readdir("../../lib/db/drizzle")).filter(name => /^\d.*\.sql$/.test(name)).sort()) {
    await engine.exec(await readFile(`../../lib/db/drizzle/${name}`, "utf8"));
  }
  const listedAt = new Date("2026-10-01T10:15:00Z"), checkedAt = new Date("2026-11-01T19:30:00Z");
  const context = (dealerId: string): TenantContext => ({ dealerId, canonicalOrigin: `https://${dealerId}.example.test`, platform: "autotrader", retailerId: dealerId, sourceUrl: `https://source.example.test/${dealerId}` });
  try {
    for (const dealerId of ["listing-date-one", "listing-date-two"]) {
      await db.insert(dealershipsTable).values({ id: dealerId, name: dealerId, status: "active", canonicalOrigin: context(dealerId).canonicalOrigin, stockPlatform: "autotrader", retailerId: dealerId, sourceUrl: context(dealerId).sourceUrl });
      await db.insert(vehiclesTable).values({ dealerId, source: "autotrader", advertId: `${dealerId}-car`, title: "Fictional listing-date car", sourcePrice: 10000, firstSeenAt: listedAt, lastSeenAt: checkedAt, updatedAt: checkedAt, rawSourceData: { listedAt: "2099-01-01T00:00:00Z" } });
    }
    await runWithTenant(context("listing-date-one"), async () => {
      const cars = await readPublicStockCars();
      assert.equal(cars.length, 1);
      assert.equal(cars[0]!.advertId, "listing-date-one-car");
      assert.equal(cars[0]!.listedAt, listedAt.toISOString());
      const stock = GetStockResponse.parse({ schemaVersion: 1, dealerName: null, dealerLocation: null, count: cars.length, scrapedAt: checkedAt, cars });
      assert.equal(JSON.parse(JSON.stringify(stock)).cars[0].listedAt, listedAt.toISOString());
      assert.equal(JSON.parse(JSON.stringify(GetVehicleResponse.parse(cars[0]))).listedAt, listedAt.toISOString());
      assert.equal("firstSeenAt" in stock.cars[0]!, false);
      assert.equal("lastSeenAt" in stock.cars[0]!, false);
      assert.equal("updatedAt" in stock.cars[0]!, false);
      await db.update(vehiclesTable).set({ lastSeenAt: new Date("2026-11-02T20:00:00Z"), updatedAt: new Date("2026-11-02T20:00:00Z") }).where(eq(vehiclesTable.id, cars[0]!.id));
      assert.equal((await readPublicStockCars())[0]!.listedAt, listedAt.toISOString());
      assert.ok(GetVehicleResponse.safeParse({ ...cars[0], listedAt: "invalid date" }).success === false);
      assert.ok(GetVehicleResponse.safeParse({ ...cars[0], listedAt: null }).success);
      const { listedAt: _listedAt, ...olderResponse } = cars[0]!;
      assert.ok(GetVehicleResponse.safeParse(olderResponse).success);
    });
  } finally {
    await engine.close();
    delete process.env.MULTI_TENANT_ENABLED;
  }
});
