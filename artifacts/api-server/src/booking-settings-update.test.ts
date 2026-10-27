import test from "node:test";
import assert from "node:assert/strict";
import { bookingSettingsUpdate } from "./lib/booking-settings-update";
import { defaultBookingPolicy } from "./lib/booking-slots";

test("turning booking off preserves unrelated and imperfect legacy settings", () => {
  const current = {
    website: { invalidLegacy: "retained" },
    partExchange: { enabled: false },
    testDriveBooking: {
      enabled: true,
      slotMinutes: "legacy-invalid",
      blockedDates: ["bad"],
    },
  };
  const updated = bookingSettingsUpdate(
    { testDriveBooking: { enabled: false, slotMinutes: 30 } },
    current,
  );
  assert.deepEqual(updated, {
    ...current,
    testDriveBooking: { ...current.testDriveBooking, enabled: false },
  });
  assert.equal(updated.website, current.website);
  assert.equal(current.testDriveBooking.enabled, true);
});
test("enabling bookings validates the whole resulting booking policy", () => {
  const current = {
    website: { legacyCopy: "unchanged" },
    testDriveBooking: { ...defaultBookingPolicy, enabled: false },
  };
  const updated = bookingSettingsUpdate(
    { testDriveBooking: { enabled: true } },
    current,
  );
  assert.equal(updated.testDriveBooking.enabled, true);
  assert.equal(updated.website, current.website);
  assert.throws(
    () =>
      bookingSettingsUpdate(
        { testDriveBooking: { enabled: true, durationMinutes: 0 } },
        current,
      ),
    /booking settings/,
  );
});
test("booking-only updates reject unrelated changes and missing switches", () => {
  for (const body of [
    { testDriveBooking: { enabled: false }, website: {} },
    { testDriveBooking: {} },
    { testDriveBooking: { enabled: "false" } },
    null,
    [],
  ])
    assert.throws(() => bookingSettingsUpdate(body, {}));
});

test("booking-only PATCH publishes with revisions despite unrelated legacy errors, and stale writes never overwrite it", async () => {
  const { engine, pool } = await import("./test/tenant-test-db");
  const { readFile, readdir } = await import("node:fs/promises");
  const { createServer, request } = await import("node:http");
  const { default: express } = await import("express");
  const { runWithTenant } = await import("./lib/tenant-context");
  const { default: router } = await import("./routes/dealer-settings");
  process.env.MULTI_TENANT_ENABLED = "true";
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + file, "utf8"));
  const dealer = "booking-settings-test";
  await pool.query(
    "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Fictional Dealer','active','https://booking.example.test','autotrader','fictional','https://www.autotrader.co.uk/fictional')",
    [dealer],
  );
  const initial = {
    identity: { name: "Keep me" },
    website: { unsafeLegacy: "unchanged" },
    testDriveBooking: {
      enabled: true,
      durationMinutes: "legacy-invalid",
      blockedDates: ["bad"],
    },
    onlineReservation: { historicOpaque: "unchanged" },
  };
  await pool.query(
    "INSERT INTO dealer_settings(dealer_id,config,revision) VALUES($1,$2::jsonb,3)",
    [dealer, JSON.stringify(initial)],
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {} } as any;
    req.staff = {
      authUserId: "fictional-owner",
      name: "Owner",
      email: "owner@example.test",
      role: "owner",
    };
    runWithTenant(
      {
        dealerId: dealer,
        canonicalOrigin: "https://booking.example.test",
        platform: "autotrader",
        retailerId: "fictional",
        sourceUrl: "https://www.autotrader.co.uk/fictional",
      },
      next,
    );
  });
  app.use("/api", router);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  const patch = (revision: number, value: unknown) =>
    new Promise<{ status: number; data: any; revision: unknown }>(
      (resolve, reject) => {
        const r = request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/dealer-settings/bookings",
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "if-match": `"${revision}"`,
            },
          },
          (res) => {
            let out = "";
            res.on("data", (c) => (out += c));
            res.on("end", () =>
              resolve({
                status: res.statusCode!,
                data: JSON.parse(out),
                revision: res.headers["x-settings-revision"],
              }),
            );
          },
        );
        r.on("error", reject);
        r.write(JSON.stringify({ testDriveBooking: value }));
        r.end();
      },
    );
  try {
    const off = await patch(3, { enabled: false });
    assert.equal(off.status, 200);
    assert.equal(off.data.testDriveBooking.enabled, false);
    assert.equal(off.revision, "4");
    const saved = await pool.query(
      "SELECT config,revision FROM dealer_settings WHERE dealer_id=$1",
      [dealer],
    );
    assert.deepEqual(saved.rows[0]!.config, {
      ...initial,
      testDriveBooking: { ...initial.testDriveBooking, enabled: false },
    });
    const stale = await patch(3, { ...defaultBookingPolicy, enabled: true });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.revision, 4);
    const on = await patch(4, { ...defaultBookingPolicy, enabled: true });
    assert.equal(on.status, 200);
    assert.equal(on.data.testDriveBooking.enabled, true);
    assert.equal(on.revision, "5");
    assert.equal(
      (await patch(5, { enabled: true, durationMinutes: 0 })).status,
      400,
    );
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT revision FROM dealer_settings WHERE dealer_id=$1",
            [dealer],
          )
        ).rows[0]!.revision,
      ),
      5,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
  }
});
