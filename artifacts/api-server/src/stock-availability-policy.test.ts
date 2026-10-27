import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request } from "node:http";
import express from "express";
import { db, pool, engine } from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import { ensureBookingVehicleAvailable } from "./lib/booking-store";
import stock from "./routes/stock";
import enquiries from "./routes/enquiries";
process.env.MULTI_TENANT_ENABLED = "false";
process.env.STOCK_IMPORT_SECRET = "fictional-stock-policy";
process.env.STOCK_MAX_DROP_PERCENT = "100";
process.env.STOCK_MISSING_HIDE_THRESHOLD = "2";
let sequence = 0;
const car = (
  advertId = "test-advert",
  price = 10000,
  extra: Record<string, unknown> = {},
) => ({
  advertId,
  title: "Fictional Toyota Yaris",
  variant: "Test",
  make: "Toyota",
  model: "Yaris",
  trim: null,
  year: 2022,
  price,
  priceType: "Retail",
  currency: "GBP",
  mileage: 10000,
  mileageText: "10,000 miles",
  registration: "2022 (22 reg)",
  registrationBand: "22",
  plate: "AB22CDE",
  vrm: "AB22CDE",
  vrmVerified: false,
  fuel: "Petrol",
  transmission: "Automatic",
  bodyType: "Hatchback",
  engineSize: "1.0L",
  engineCC: 1000,
  doors: 5,
  seats: 5,
  colour: "Blue",
  emissionClass: "Euro 6",
  drivetrain: null,
  owners: 1,
  writeOffCategory: null,
  advertUrl: "https://www.autotrader.co.uk/car-details/fictional-test",
  dealerName: "Fictional dealer",
  dealerLocation: "Fictional showroom",
  imageCount: 1,
  heroImage: "https://images.example.test/car.jpg",
  images: [{ url: "https://images.example.test/car.jpg", caption: "front" }],
  specifications: {},
  sourceExtras: { sourcePlatform: "autotrader" },
  ...extra,
});
const snapshot = (
  cars: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  runId: randomUUID(),
  source: "autotrader",
  retailerId: "fictional-retailer",
  dealerName: "Fictional dealer",
  scrapedAt: new Date(Date.now() + sequence++).toISOString(),
  complete: true,
  expectedAdvertCount: cars.length,
  count: cars.length,
  failedAdvertIds: [],
  errors: [],
  cars,
  ...extra,
});

test("complete-feed absence controls public availability without changing appointments or sale history", async (t) => {
  globalThis.fetch = async () => {
    throw new Error("External requests forbidden in stock policy tests");
  };
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + file, "utf8"));
  const privateDir = await mkdtemp(join(tmpdir(), "luxxy-stock-policy-"));
  process.env.INTEGRATIONS_PRIVATE_DIR = privateDir;
  let platform: "autotrader" | "cazoo" = "autotrader";
  const tenant = () => ({
    dealerId: "availability-" + platform,
    canonicalOrigin: "https://availability.example.test",
    platform,
    retailerId: "fictional-retailer",
    sourceUrl:
      platform === "cazoo"
        ? "https://www.cazoo.co.uk/dealer/fictional"
        : "https://www.autotrader.co.uk/fictional",
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {}, warn() {}, info() {} } as any;
    runWithTenant(tenant(), next);
  });
  app.use("/api", stock, enquiries);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  const call = (path: string, body?: unknown) =>
    new Promise<{ status: number; data: any }>((resolve, reject) => {
      const r = request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api" + path,
          method: body ? "POST" : "GET",
          headers: {
            "content-type": "application/json",
            "x-stock-import-secret": "fictional-stock-policy",
          },
        },
        (res) => {
          let out = "";
          res.on("data", (c) => (out += c));
          res.on("end", () =>
            resolve({ status: res.statusCode!, data: JSON.parse(out) }),
          );
        },
      );
      r.on("error", reject);
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  try {
    for (const source of ["autotrader", "cazoo"] as const) {
      platform = source;
      await t.test(
        source +
          " first absence is unavailable, incomplete captures cannot remove stock, and reappearance restores it",
        async () => {
          const dealer = tenant().dealerId;
          await pool.query(
            "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Fictional Stock','active',$2,$3,'fictional-retailer',$4)",
            [dealer, tenant().canonicalOrigin, source, tenant().sourceUrl],
          );
          const cars = [car("keep"), car("gone")].map((c, index) => ({
            ...c,
            price: 10000 + index * 1000,
            advertUrl:
              source === "cazoo"
                ? "https://www.cazoo.co.uk/car-details/" + (80000000 + index)
                : "https://www.autotrader.co.uk/car-details/" +
                  (202600000000001 + index),
            sourceExtras: { sourcePlatform: source },
          }));
          const make = (
            list: typeof cars,
            extra: Record<string, unknown> = {},
          ) =>
            snapshot(list, {
              source: source === "cazoo" ? "grok" : "autotrader",
              ...extra,
            });
          assert.equal(
            (await call("/stock/imports/grok", make(cars))).status,
            201,
          );
          const gone = (
            await pool.query(
              "SELECT * FROM vehicles WHERE dealer_id=$1 AND advert_id='gone'",
              [dealer],
            )
          ).rows[0]!;
          const appointment = randomUUID(),
            sale = randomUUID();
          await pool.query(
            "INSERT INTO enquiries(id,dealer_id,type,status,customer_name,email,vehicle_id,message,appointment_at,appointment_status) VALUES($1::uuid,$2,'viewing','contacted','Fictional Customer','buyer@example.test',$3::uuid,'Existing visit',now()+interval '1 day','confirmed')",
            [appointment, dealer, gone.id],
          );
          await pool.query(
            "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1::uuid,$2,$3,1,$4::jsonb)",
            [
              sale,
              dealer,
              "HISTORY-" + source,
              JSON.stringify({
                documents: ["immutable issued example"],
                payments: ["existing ledger example"],
              }),
            ],
          );
          const financial = (
            await pool.query(
              "SELECT state FROM sale_workspace WHERE id=$1::uuid",
              [sale],
            )
          ).rows[0]!.state;
          assert.equal(
            (
              await call(
                "/stock/imports/grok",
                make(cars.slice(0, 1), { complete: false }),
              )
            ).status,
            422,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT source_status FROM vehicles WHERE id=$1::uuid",
                [gone.id],
              )
            ).rows[0]!.source_status,
            "live",
          );
          assert.equal((await call("/stock")).data.count, 2);
          await runWithTenant(tenant(), () =>
            db.transaction((tx) =>
              ensureBookingVehicleAvailable(
                tx as unknown as Parameters<
                  typeof ensureBookingVehicleAvailable
                >[0],
                dealer,
                gone.id,
              ),
            ),
          );
          assert.equal(
            (await call("/stock/imports/grok", make(cars.slice(0, 1)))).status,
            201,
          );
          const missing = (
            await pool.query("SELECT * FROM vehicles WHERE id=$1::uuid", [
              gone.id,
            ])
          ).rows[0]!;
          assert.equal(missing.source_status, "missing");
          assert.equal(missing.missing_count, 1);
          assert.equal(missing.inventory_status, "available");
          assert.equal(missing.archived_at, null);
          assert.equal((await call("/stock")).data.count, 1);
          assert.equal((await call("/vehicles/" + gone.id)).status, 404);
          const rejectedEnquiry = await call("/enquiries", {
            type: "general",
            customerName: "Fictional Interested Customer",
            email: "buyer@example.test",
            phone: "07700900123",
            preferredContact: "email",
            vehicleId: gone.id,
            message: "Is this car available?",appointmentAt:null,
          });
          assert.equal(rejectedEnquiry.status, 404);
          assert.match(rejectedEnquiry.data.error, /no longer available/);
          await assert.rejects(
            runWithTenant(tenant(), () =>
              db.transaction((tx) =>
                ensureBookingVehicleAvailable(
                  tx as unknown as Parameters<
                    typeof ensureBookingVehicleAvailable
                  >[0],
                  dealer,
                  gone.id,
                ),
              ),
            ),
            /no longer available/,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT appointment_status FROM enquiries WHERE id=$1::uuid",
                [appointment],
              )
            ).rows[0]!.appointment_status,
            "confirmed",
          );
          assert.deepEqual(
            (
              await pool.query(
                "SELECT state FROM sale_workspace WHERE id=$1::uuid",
                [sale],
              )
            ).rows[0]!.state,
            financial,
          );
          assert.equal(
            Number(
              (
                await pool.query(
                  "SELECT count(*) FROM stock_change_tasks WHERE dealer_id=$1",
                  [dealer],
                )
              ).rows[0]!.count,
            ),
            0,
          );
          assert.equal(
            (await call("/stock/imports/grok", make(cars))).status,
            201,
          );
          assert.equal((await call("/stock")).data.count, 2);
          assert.equal((await call("/vehicles/" + gone.id)).status, 200);
          await runWithTenant(tenant(), () =>
            db.transaction((tx) =>
              ensureBookingVehicleAvailable(
                tx as unknown as Parameters<
                  typeof ensureBookingVehicleAvailable
                >[0],
                dealer,
                gone.id,
              ),
            ),
          );
        },
      );
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
    await rm(privateDir, { recursive: true, force: true });
  }
});
