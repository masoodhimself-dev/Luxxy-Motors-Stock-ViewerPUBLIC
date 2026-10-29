import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  applyOfficialCazooFeed,
  applyCollectedOfficialCazoo,
  catalogueFingerprint,
  officialCazooEnabled,
} from "./lib/cazoo-feed-apply";
import { CAZOO_CSV_COLUMNS, parseCazooCsv } from "./lib/cazoo-csv";
const now = new Date("2026-10-29T19:30:00Z");
async function setup() {
  const db = new PGlite();
  await db.exec(
    await readFile("../../lib/db/drizzle/0000_married_cloak.sql", "utf8"),
  );
  await db.exec(`ALTER TABLE vehicles ADD COLUMN archived_at timestamptz,ADD COLUMN retirement_started_at timestamptz;
 ALTER TABLE stock_import_runs ADD COLUMN payload_hash text;
 CREATE TABLE dealerships(id text PRIMARY KEY,status text,stock_platform text,retailer_id text);
 CREATE TABLE sale_workspace(dealer_id text,state jsonb); CREATE TABLE sales(dealer_id text);
 CREATE TABLE customer_intake_sessions(dealer_id text);
 CREATE TABLE customer_phone_shares(dealer_id text,revoked_at timestamptz);
 CREATE TABLE vehicle_videos(dealer_id text);
 CREATE TABLE enquiries(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,message text);
 CREATE TABLE cazoo_feed_checks(id uuid PRIMARY KEY,dealer_id text,status text,error_code text,received_at timestamptz,based_on_check_id uuid,candidate jsonb);
 INSERT INTO dealerships VALUES('multi','active','cazoo','cazoo-75497'),('other','active','autotrader','123');`);
  await db.exec(
    await readFile(
      "../../lib/db/drizzle/0076_cazoo_feed_authority.sql",
      "utf8",
    ),
  );
  const pool = {
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) =>
        sql.includes("pg_advisory_xact_lock")
          ? { rows: [] }
          : await db.query<any>(sql, values),
      release() {},
    }),
  };
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csv =
    CAZOO_CSV_COLUMNS.join(",") +
    "\r\n" +
    Array.from({ length: 31 }, (_, i) => {
      const id = `AETV${10000000 + i}`;
      const row: Record<string, string> = {
        Feed_ID: "AETA22820",
        Vehicle_ID: id,
        FullRegistration: `AB12C${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
        Colour: "Grey",
        FuelType: "Petrol",
        Year: "2018",
        Mileage: "55000",
        Bodytype: "HATCHBACK",
        Doors: "5",
        Make: "Fixture",
        Model: `Car ${i}`,
        EngineSize: "1498",
        Price: "7990",
        Transmission: "Automatic",
        PictureRefs: `https://cdn.images.autoexposure.co.uk/AETA22820/${id}_1.jpg,https://cdn.images.autoexposure.co.uk/AETA22820/${id}_2.jpg`,
        Options: "Synthetic test description.",
        New: "N",
        Used: "Y",
        V5: "N",
        ExDemo: "N",
        FranchisedApproved: "N",
        DID: "75497",
      };
      return CAZOO_CSV_COLUMNS.map((k) => escape(row[k] ?? "")).join(",");
    }).join("\r\n") +
    "\r\n";
  const candidate = parseCazooCsv(csv, {
    dealerId: "multi",
    expectedRetailerId: "cazoo-75497",
    expectedFeedId: "AETA22820",
    dealerName: "Multi Choice Motors",
    capturedAt: "2026-10-29T19:13:25Z",
  });
  return { db, pool, candidate };
}
test("official authority is absent by default and strictly dealer scoped", async () => {
  const { db, pool } = await setup();
  try {
    assert.equal(await officialCazooEnabled("multi", pool), false);
    await db.exec(
      "INSERT INTO cazoo_feed_authority(dealer_id,retailer_id,feed_id,enabled) VALUES('multi','cazoo-75497','AETA22820',false)",
    );
    assert.equal(await officialCazooEnabled("multi", pool), true);
    assert.equal(await officialCazooEnabled("other", pool), false);
  } finally {
    await db.close();
  }
});
test("atomic replacement removes all old statuses, retains enquiry text, imports the complete gallery and leaves other dealers intact", async () => {
  const { db, pool, candidate } = await setup();
  try {
    const old = randomUUID(),
      other = randomUUID();
    await db.query(
      "INSERT INTO vehicles(id,dealer_id,source,advert_id,inventory_status) VALUES($1,'multi','cazoo','old','sold'),($2,'other','autotrader','other','available')",
      [old, other],
    );
    await db.query("INSERT INTO enquiries VALUES($1,$2,$3)", [
      randomUUID(),
      old,
      "Keep the original customer text",
    ]);
    const rows = (
      await db.query<any>(
        "SELECT id,inventory_status FROM vehicles WHERE dealer_id='multi'",
      )
    ).rows;
    const result = await applyOfficialCazooFeed(pool, {
      dealerId: "multi",
      candidate,
      now,
      replace: {
        expectedFingerprint: catalogueFingerprint(rows),
        expectedFileHash: candidate.metadata.sha256,
      },
    });
    assert.equal(result.deleted, 1);
    assert.equal(result.created, 31);
    assert.equal(
      (await db.query("SELECT * FROM vehicles WHERE dealer_id='multi'")).rows
        .length,
      31,
    );
    assert.equal(
      (await db.query("SELECT * FROM vehicles WHERE dealer_id='other'")).rows
        .length,
      1,
    );
    assert.equal(
      (await db.query<any>("SELECT * FROM enquiries")).rows[0].vehicle_id,
      null,
    );
    assert.equal(
      (await db.query<any>("SELECT * FROM enquiries")).rows[0].message,
      "Keep the original customer text",
    );
    assert.equal(
      (await db.query("SELECT * FROM vehicle_images")).rows.length,
      62,
    );
    const replay = await applyOfficialCazooFeed(pool, {
      dealerId: "multi",
      candidate,
      now,
    });
    assert.equal(replay.status, "replayed");
    assert.equal(
      (await db.query("SELECT * FROM vehicle_images")).rows.length,
      62,
    );
  } finally {
    await db.close();
  }
});
test("invalid identity, wrong dealer, stale file and drift abort before changing stock", async () => {
  const { db, pool, candidate } = await setup();
  try {
    for (const input of [
      { ...candidate, metadata: { ...candidate.metadata, dealerId: "other" } },
      {
        ...candidate,
        metadata: { ...candidate.metadata, capturedAt: "2026-10-20T10:00:00Z" },
      },
    ])
      await assert.rejects(
        applyOfficialCazooFeed(pool, {
          dealerId: "multi",
          candidate: input,
          now,
        }),
      );
    await assert.rejects(
      applyOfficialCazooFeed(pool, {
        dealerId: "other",
        candidate: {
          ...candidate,
          metadata: { ...candidate.metadata, dealerId: "other" },
        },
        now,
      }),
      { code: "dealer_mismatch" },
    );
    await assert.rejects(
      applyOfficialCazooFeed(pool, {
        dealerId: "multi",
        candidate,
        now,
        replace: {
          expectedFingerprint: "changed",
          expectedFileHash: candidate.metadata.sha256,
        },
      }),
      { code: "inventory_changed" },
    );
    assert.equal((await db.query("SELECT * FROM vehicles")).rows.length, 0);
  } finally {
    await db.close();
  }
});
test("new sales block a stale zero-sales replacement preview", async () => {
  const { db, pool, candidate } = await setup();
  try {
    await db.exec("INSERT INTO sale_workspace VALUES('multi','{}')");
    await assert.rejects(
      applyOfficialCazooFeed(pool, {
        dealerId: "multi",
        candidate,
        now,
        replace: {
          expectedFingerprint: catalogueFingerprint([]),
          expectedFileHash: candidate.metadata.sha256,
        },
      }),
      { code: "business_records_changed" },
    );
    assert.equal((await db.query("SELECT * FROM vehicles")).rows.length, 0);
  } finally {
    await db.close();
  }
});
test("subsequent feeds preserve vehicle IDs and reserved/sold statuses, record price changes and mark missing without deleting", async () => {
  const { db, pool, candidate } = await setup();
  try {
    await applyOfficialCazooFeed(pool, { dealerId: "multi", candidate, now });
    const first = (
      await db.query<any>("SELECT * FROM vehicles WHERE advert_id=$1", [
        candidate.cars[0].advertId,
      ])
    ).rows[0];
    await db.query(
      "UPDATE vehicles SET inventory_status='reserved' WHERE id=$1",
      [first.id],
    );
    const second = structuredClone(candidate);
    second.metadata.capturedAt = "2026-10-29T19:20:00Z";
    second.metadata.sha256 = "a".repeat(64);
    second.cars[0].price = 7000;
    second.cars.pop();
    second.metadata.count--;
    const result = await applyOfficialCazooFeed(pool, {
      dealerId: "multi",
      candidate: second,
      now,
    });
    assert.equal(result.created, 0);
    assert.equal(result.missing, 1);
    const saved = (
      await db.query<any>("SELECT * FROM vehicles WHERE id=$1", [first.id])
    ).rows[0];
    assert.equal(saved.inventory_status, "reserved");
    assert.equal(saved.source_price, 7000);
    assert.equal(
      (
        await db.query(
          "SELECT * FROM vehicle_changes WHERE field_name='websitePublishedPrice'",
        )
      ).rows.length,
      1,
    );
    const third = structuredClone(second);
    third.metadata.capturedAt = "2026-10-29T19:25:00Z";
    third.metadata.sha256 = "b".repeat(64);
    third.cars = third.cars.slice(0, 2);
    third.metadata.count = 2;
    await assert.rejects(
      applyOfficialCazooFeed(pool, {
        dealerId: "multi",
        candidate: third,
        now,
      }),
      { code: "stock_drop" },
    );
    assert.equal(
      (await db.query("SELECT * FROM vehicles WHERE dealer_id='multi'")).rows
        .length,
      31,
    );
  } finally {
    await db.close();
  }
});
test("a database failure rolls the replacement back, including old vehicles and image rows", async () => {
  const { db, pool, candidate } = await setup();
  try {
    const id = randomUUID();
    await db.query(
      "INSERT INTO vehicles(id,dealer_id,source,advert_id) VALUES($1,'multi','cazoo','legacy')",
      [id],
    );
    await db.query(
      "INSERT INTO vehicle_images(vehicle_id,source_url,sort_order,is_hero) VALUES($1,'https://example.test/old.jpg',0,true)",
      [id],
    );
    await db.exec(
      "ALTER TABLE vehicles ADD CONSTRAINT fixture_fail CHECK(title IS DISTINCT FROM '2018 Fixture Car 1')",
    );
    const fingerprint = catalogueFingerprint(
      (
        await db.query<any>(
          "SELECT id,inventory_status FROM vehicles WHERE dealer_id='multi'",
        )
      ).rows,
    );
    await assert.rejects(
      applyOfficialCazooFeed(pool, {
        dealerId: "multi",
        candidate,
        now,
        replace: {
          expectedFingerprint: fingerprint,
          expectedFileHash: candidate.metadata.sha256,
        },
      }),
    );
    assert.equal((await db.query("SELECT * FROM vehicles")).rows.length, 1);
    assert.equal(
      (await db.query("SELECT * FROM vehicle_images")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("SELECT * FROM stock_import_runs")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("the saved-candidate runner is disabled by default and retries safely after restart", async () => {
  const { db, pool, candidate } = await setup();
  try {
    candidate.metadata.capturedAt = new Date(Date.now() - 1000).toISOString();
    await db.query(
      "INSERT INTO cazoo_feed_checks VALUES($1,'multi','ready',NULL,now(),NULL,$2::jsonb)",
      [randomUUID(), JSON.stringify(candidate)],
    );
    assert.deepEqual(await applyCollectedOfficialCazoo(pool), []);
    assert.equal((await db.query("SELECT * FROM vehicles")).rows.length, 0);
    await db.exec(
      "INSERT INTO cazoo_feed_authority(dealer_id,retailer_id,feed_id,enabled) VALUES('multi','cazoo-75497','AETA22820',true)",
    );
    assert.equal(
      (await applyCollectedOfficialCazoo(pool))[0].status,
      "imported",
    );
    assert.equal(
      (await applyCollectedOfficialCazoo(pool))[0].status,
      "replayed",
    );
    assert.equal((await db.query("SELECT * FROM vehicles")).rows.length, 31);
  } finally {
    await db.close();
  }
});
