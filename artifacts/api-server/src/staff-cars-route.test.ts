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
    "ALTER TABLE vehicles ADD COLUMN archived_at timestamptz,ADD COLUMN retirement_started_at timestamptz; INSERT INTO vehicles(dealer_id,source,advert_id) VALUES('dealer-one','cazoo','AETV1'),('dealer-two','cazoo','AETV2'),('dealer-one','cazoo','AETV3')",
  );
  await engine.exec(`CREATE TABLE cazoo_feed_authority(dealer_id text,enabled boolean);
    CREATE TABLE cazoo_feed_checks(dealer_id text,received_at timestamptz,status text,error_code text,file_hash text);
    CREATE TABLE sale_workspace(id uuid,reference text,dealer_id text,state jsonb,updated_at timestamptz);`);
  await engine.exec(await readFile("../../lib/db/drizzle/0074_mot_history.sql", "utf8"));
  await engine.exec(await readFile("../../lib/db/drizzle/0083_vehicle_public_links.sql", "utf8"));
  await engine.exec("CREATE UNIQUE INDEX vehicles_id_dealer_id_unique ON vehicles(id,dealer_id)");
  await engine.exec(await readFile("../../lib/db/drizzle/0090_stock_tax_checks.sql", "utf8"));
  await engine.exec(`
    UPDATE vehicles SET first_seen_at='2026-10-01T11:00:00Z',last_seen_at='2026-10-09T11:00:00Z';
    INSERT INTO vehicle_changes(vehicle_id,field_name,old_value,new_value,changed_at)
    SELECT id,change.field,change.before::jsonb,change.after::jsonb,change.changed_at::timestamptz
    FROM vehicles CROSS JOIN (VALUES
      ('sourceImages','[]','["initial"]','2026-10-01T11:00:00Z'),
      ('mileage','15000','20000','2026-10-03T11:00:00Z'),
      ('sourceStatus','"missing"','"live"','2026-10-07T11:00:00Z'),
      ('plate',NULL,'null','2026-10-08T11:00:00Z'),
      ('websitePublishedPrice','10000','10000','2026-10-09T11:00:00Z')
    ) AS change(field,before,after,changed_at)
    WHERE advert_id='AETV1' OR change.field='sourceImages';
    INSERT INTO vehicle_changes(vehicle_id,field_name,old_value,new_value,changed_at)
    SELECT id,'sourceImages','["initial"]'::jsonb,'["second"]'::jsonb,'2026-10-10T11:00:00Z'
    FROM vehicles WHERE dealer_id='dealer-two';
  `);
  const calls: any[] = [];
  const routeErrors: unknown[] = [];
  const app = express();
  app.use((req, _res, next) => {
    (req as any).log = { error(fields: unknown) { routeErrors.push(fields); }, warn() {} };
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
    assert.equal(calls[0].vehicles.length, 2);
    assert.ok(calls[0].vehicles.every((vehicle: { dealerId: string }) => vehicle.dealerId === "dealer-one"));
    assert.equal(calls[0].canManage, true);
    const real = await fetch(base + "/actual/staff/cars", {
      headers: { "x-portal-token": "isolated-cars-token" },
    });
    assert.equal(real.status, 200, JSON.stringify(routeErrors) || await real.clone().text());
    const actual = (await real.json()) as {
      cars: {
        advertId: string;
        staff: { inventoryStatus: string; sale: unknown; lastRecordedChange: unknown };
      }[];
    };
    assert.equal(actual.cars.length, 2);
    const changed = actual.cars.find((vehicle) => vehicle.advertId === "AETV1");
    const arrival = actual.cars.find((vehicle) => vehicle.advertId === "AETV3");
    assert.ok(changed && arrival);
    assert.equal(changed.staff.inventoryStatus, "available");
    assert.equal(changed.staff.sale, null);
    assert.deepEqual(changed.staff.lastRecordedChange, {
      label: "Details updated",
      at: "2026-10-03T11:00:00.000Z",
    });
    assert.equal(arrival.staff.lastRecordedChange, null);

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
