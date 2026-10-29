import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { readFile } from "node:fs/promises";
import { engine } from "./test/tenant-test-db";
import { staffCarsRouter } from "./routes/staff-cars";
test("Cars endpoint requires staff, uses the current dealer and exposes GET only", async () => {
  process.env.MULTI_TENANT_ENABLED = "false";
  process.env.PORTAL_API_TOKEN = "isolated-cars-token";
  process.env.STOCK_DEALER_ID = "dealer-one";
  await engine.exec(
    await readFile("../../lib/db/drizzle/0000_married_cloak.sql", "utf8"),
  );
  await engine.exec(
    "ALTER TABLE vehicles ADD COLUMN archived_at timestamptz,ADD COLUMN retirement_started_at timestamptz; INSERT INTO vehicles(dealer_id,source,advert_id) VALUES('dealer-one','cazoo','AETV1'),('dealer-two','cazoo','AETV2')",
  );
  await engine.exec(`CREATE TABLE cazoo_feed_authority(dealer_id text,enabled boolean);
    CREATE TABLE cazoo_feed_checks(dealer_id text,received_at timestamptz,status text,error_code text,file_hash text);
    CREATE TABLE sale_workspace(id uuid,reference text,dealer_id text,state jsonb,updated_at timestamptz);`);
  const calls: any[] = [];
  const app = express();
  app.use((req, _res, next) => {
    (req as any).log = { error() {}, warn() {} };
    next();
  });
  app.use(
    staffCarsRouter(async (options) => {
      calls.push(options);
      return {
        cars: options.vehicles.map((v) => ({ id: v.id })) as any,
        feed: {
          source: "Cazoo",
          receivedAt: null,
          appliedAt: null,
          state: "unknown",
          scheduled: false,
        },
      };
    }),
  );
  app.use("/actual", staffCarsRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.equal((await fetch(base + "/staff/cars")).status, 401);
    assert.equal(calls.length, 0);
    const response = await fetch(base + "/staff/cars", {
      headers: { "x-portal-token": "isolated-cars-token" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls[0].dealerId, "dealer-one");
    assert.equal(calls[0].vehicles.length, 1);
    assert.equal(calls[0].vehicles[0].dealerId, "dealer-one");
    assert.equal(calls[0].canManage, true);
    const real = await fetch(base + "/actual/staff/cars", {
      headers: { "x-portal-token": "isolated-cars-token" },
    });
    assert.equal(real.status, 200, await real.clone().text());
    const actual = (await real.json()) as {
      cars: {
        advertId: string;
        staff: { inventoryStatus: string; sale: unknown };
      }[];
    };
    assert.equal(actual.cars.length, 1);
    assert.equal(actual.cars[0].advertId, "AETV1");
    assert.equal(actual.cars[0].staff.inventoryStatus, "available");
    assert.equal(actual.cars[0].staff.sale, null);

    assert.equal(
      (
        await fetch(base + "/staff/cars", {
          method: "DELETE",
          headers: { "x-portal-token": "isolated-cars-token" },
        })
      ).status,
      405,
    );
  } finally {
    server.close();
    await engine.close();
    delete process.env.PORTAL_API_TOKEN;
    delete process.env.STOCK_DEALER_ID;
  }
});
