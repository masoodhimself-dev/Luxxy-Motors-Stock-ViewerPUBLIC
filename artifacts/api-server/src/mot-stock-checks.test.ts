import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { motStockCheckRunsTable, motStockChecksTable } from "@workspace/db";
import {
  createStockMotRepository,
  processStockMotChecks,
} from "./lib/mot-stock-checks";
import { MotError, createMotService } from "./lib/mot-history";
import { motRouter } from "./routes/mot-history";
import { runWithTenant } from "./lib/tenant-context";
import type { MotHistory } from "@workspace/vehicle-meta";
const first = "11111111-1111-4111-8111-111111111111",
  second = "22222222-2222-4222-8222-222222222222";
const history = (registration = "AB12CDE"): MotHistory => ({
  registration,
  make: "FORD",
  model: "FOCUS",
  checkedAt: new Date().toISOString(),
  firstMotDueDate: null,
  registrationDate: null,
  recall: "Unknown",
  tests: [
    {
      completedDate: "2026-05-01",
      result: "PASSED",
      expiryDate: "2027-04-30",
      mileage: "45000",
      mileageUnit: "MI",
      defects: [],
    },
  ],
});
async function fixture() {
  const engine = new PGlite();
  await engine.exec(
    `CREATE TABLE vehicles(id uuid PRIMARY KEY,dealer_id text NOT NULL,plate text,vrm text,registration text,inventory_status text NOT NULL DEFAULT 'available',source_status text NOT NULL DEFAULT 'live',archived_at timestamptz,first_seen_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,dealer_id));CREATE TABLE protected_records(id text PRIMARY KEY,data jsonb);INSERT INTO protected_records VALUES('invoice','{"price":10000,"paid":true}');`,
  );
  await engine.exec(
    await readFile("../../lib/db/drizzle/0074_mot_history.sql", "utf8"),
  );
  await engine.exec(
    await readFile("../../lib/db/drizzle/0078_mot_stock_checks.sql", "utf8"),
  );
  const query = (sql: string, values?: any[]) => engine.query<any>(sql, values);
  let lane = Promise.resolve();
  const database = {
    query,
    connect: async () => {
      let unlock!: () => void;
      const before = lane;
      lane = new Promise((r) => {
        unlock = r;
      });
      await before;
      return { query, release: unlock };
    },
  };
  return {
    engine,
    query,
    repository: createStockMotRepository(database, () => true),
    database,
  };
}
async function insert(
  f: Awaited<ReturnType<typeof fixture>>,
  id = first,
  dealer = "one",
  registration = "AB12CDE",
  status = "available",
  source = "live",
) {
  await f.query(
    "INSERT INTO vehicles(id,dealer_id,registration,inventory_status,source_status) VALUES($1,$2,$3,$4,$5)",
    [id, dealer, registration, status, source],
  );
}
test("0078 is additive and replay-safe, with exact Drizzle columns/indexes and a contiguous journal", async () => {
  const f = await fixture();
  try {
    await insert(f);
    await f.repository.start("one");
    const tables = [
      "vehicles",
      "protected_records",
      "mot_stock_check_runs",
      "mot_stock_checks",
    ];
    const before = await Promise.all(
      tables.map(
        async (table) => (await f.query(`SELECT * FROM ${table}`)).rows,
      ),
    );
    await f.engine.exec(
      await readFile("../../lib/db/drizzle/0078_mot_stock_checks.sql", "utf8"),
    );
    const after = await Promise.all(
      tables.map(
        async (table) => (await f.query(`SELECT * FROM ${table}`)).rows,
      ),
    );
    assert.deepEqual(
      after,
      before,
      "replaying the additive migration preserves queue, stock and financial fixture records",
    );
    const journal = JSON.parse(
      await readFile("../../lib/db/drizzle/meta/_journal.json", "utf8"),
    );
    assert.deepEqual(
      journal.entries.map((entry: { idx: number }) => entry.idx),
      journal.entries.map((_entry: unknown, index: number) => index),
    );
    assert.equal(journal.entries.at(-1).tag, "0078_mot_stock_checks");
    assert.equal(journal.entries.at(-1).idx, 78);
    for (const table of [motStockCheckRunsTable, motStockChecksTable]) {
      const schema = getTableConfig(table);
      const columns = (
        await f.query(
          "SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
          [schema.name],
        )
      ).rows;
      assert.deepEqual(
        columns.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          notNull: c.is_nullable === "NO",
          hasDefault: c.column_default !== null,
        })),
        schema.columns.map((c) => ({
          name: c.name,
          type: c.getSQLType(),
          notNull: c.notNull,
          hasDefault: c.hasDefault,
        })),
        `${schema.name} column names, order, types, nullability and defaults`,
      );
      const indexes = (
        await f.query(
          `SELECT x.relname AS name,i.indisunique AS unique,pg_get_expr(i.indpred,i.indrelid) AS predicate,
        ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,position) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.position) AS columns,
        i.indoption::smallint[] AS options FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid WHERE t.relname=$1 AND NOT i.indisprimary ORDER BY x.relname`,
          [schema.name],
        )
      ).rows;
      assert.deepEqual(
        indexes.map((i) => i.name),
        schema.indexes.map((i) => i.config.name).sort(),
        `${schema.name} exact declared index set`,
      );
      for (const definition of schema.indexes) {
        const index = indexes.find((i) => i.name === definition.config.name)!;
        const expected = definition.config.columns as any[];
        assert.deepEqual(
          index.columns,
          expected.map((c) => c.name),
        );
        assert.equal(index.unique, definition.config.unique);
        assert.deepEqual(
          index.options.map((option: number) => Boolean(option & 1)),
          expected.map((c) => c.indexConfig?.order === "desc"),
          `${index.name} ordering`,
        );
        assert.equal(
          Boolean(index.predicate),
          Boolean(definition.config.where),
        );
        if (definition.config.where) {
          const expectedWhere = new PgDialect().sqlToQuery(
            definition.config.where,
          ).sql;
          const literals = (value: string) =>
            [...value.matchAll(/'([^']*)'/g)].map((match) => match[1]);
          assert.deepEqual(
            literals(index.predicate),
            literals(expectedWhere),
            `${index.name} partial-index states`,
          );
        }
      }
    }
  } finally {
    await f.engine.close();
  }
});
test("tenant-bound additive queue discovers current valid plates, shares fresh public cache and preserves business records", async () => {
  const f = await fixture();
  try {
    await insert(f);
    await insert(f, second, "two", "ZZ99ABC");
    await insert(f, "33333333-3333-4333-8333-333333333333", "one", "68 reg");
    await insert(
      f,
      "44444444-4444-4444-8444-444444444444",
      "one",
      "AA11AAA",
      "sold",
    );
    await insert(
      f,
      "55555555-5555-4555-8555-555555555555",
      "one",
      "BB22BBB",
      "available",
      "missing",
    );
    const before = (await f.query("SELECT * FROM vehicles ORDER BY id")).rows;
    await f.repository.discover("one");
    assert.deepEqual((await f.repository.status("one")).current, {
      total: 2,
      checked: 0,
      needsCheck: 1,
      pending: 1,
      failed: 0,
      missingRegistration: 1,
    });
    assert.equal((await f.repository.status("two")).current.pending, 0);
    const started = await f.repository.start("one");
    assert.equal(started.run?.total, 2);
    assert.equal(started.run?.skipped, 1);
    const duplicate = await Promise.all([
      f.repository.start("one"),
      f.repository.start("one"),
    ]);
    assert.ok(duplicate.every((r) => r.run?.id === started.run?.id));
    const job = await f.repository.claim(["one"]);
    assert.ok(job);
    assert.equal(job.dealerId, "one");
    await f.repository.finish(job, { history: history() });
    const complete = await f.repository.status("one");
    assert.equal(complete.run?.status, "completed");
    assert.equal(complete.run?.checked, 1);
    assert.equal(complete.run?.skipped, 1);
    assert.equal(complete.current.checked, 1);
    assert.equal((await f.repository.start("one")).run?.id, started.run?.id);
    assert.deepEqual(
      (await f.query("SELECT * FROM vehicles ORDER BY id")).rows,
      before,
    );
    assert.deepEqual((await f.query("SELECT * FROM protected_records")).rows, [
      { id: "invoice", data: { price: 10000, paid: true } },
    ]);
    await f.query("UPDATE vehicles SET registration=$1 WHERE id=$2", [
      "AB12CDE",
      second,
    ]);
    await f.repository.discover("two");
    assert.equal((await f.repository.status("two")).current.checked, 1);
    assert.equal((await f.repository.status("two")).run, null);
  } finally {
    await f.engine.close();
  }
});
test("distributed claims allow only one running car across dealers and release a size-one pool before lookup", async () => {
  const f = await fixture();
  try {
    await insert(f);
    await insert(f, second, "two", "ZZ99ABC");
    await f.repository.discover("one");
    await f.repository.discover("two");
    const claims = await Promise.all([
      f.repository.claim(["one"]),
      f.repository.claim(["two"]),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const accepted = claims.find(Boolean)!;
    await f.repository.finish(accepted, {
      history: history(accepted.registration),
    });
    const next = await f.repository.claim(["one", "two"]);
    assert.ok(next);
    assert.notEqual(next.dealerId, accepted.dealerId);
    await assert.rejects(
      f.query(
        "INSERT INTO mot_stock_checks(dealer_id,vehicle_id,registration) VALUES('one',$1,'ZZ99ABC')",
        [second],
      ),
      /foreign key/i,
    );
  } finally {
    await f.engine.close();
  }
});
test("new arrivals and changed registrations enqueue automatically; stale successes requeue", async () => {
  const f = await fixture();
  try {
    await insert(f);
    await f.repository.discover("one");
    let job = await f.repository.claim(["one"]);
    assert.ok(job);
    await f.repository.finish(job, { history: history() });
    await insert(f, second, "one", "ZZ99ABC");
    await f.repository.discover("one");
    job = await f.repository.claim(["one"]);
    assert.equal(job?.vehicleId, second);
    assert.ok(job);
    await f.repository.finish(job, { history: history("ZZ99ABC") });
    await f.query("UPDATE vehicles SET registration=$1 WHERE id=$2", [
      "AA11AAA",
      first,
    ]);
    await f.repository.discover("one");
    job = await f.repository.claim(["one"]);
    assert.equal(job?.registration, "AA11AAA");
    assert.ok(job);
    await f.repository.finish(job, { history: history("AA11AAA") });
    await f.engine.exec(
      "UPDATE mot_history_cache SET expires_at=now()-interval '1 hour';UPDATE mot_stock_checks SET next_attempt_at=now()-interval '1 hour'",
    );
    await f.repository.discover("one");
    assert.equal((await f.repository.status("one")).current.pending, 2);
  } finally {
    await f.engine.close();
  }
});
test("expired running leases resume after restart; old workers and changed or sold stock cannot accept stale results", async () => {
  const f = await fixture();
  try {
    await insert(f);
    await f.repository.start("one");
    const abandoned = await f.repository.claim(["one"]);
    assert.ok(abandoned);
    assert.equal(await f.repository.claim(["one"]), null);
    await f.query(
      "UPDATE mot_stock_checks SET lease_until=now()-interval '1 second'",
    );
    const restarted = createStockMotRepository(f.database, () => true);
    const resumed = await restarted.claim(["one"]);
    assert.ok(resumed);
    assert.notEqual(resumed.leaseToken, abandoned.leaseToken);
    await f.repository.finish(abandoned, { history: history() });
    assert.equal((await f.repository.status("one")).current.checked, 0);
    await f.query("UPDATE vehicles SET registration=$1 WHERE id=$2", [
      "ZZ99ABC",
      first,
    ]);
    await restarted.finish(resumed, { history: history() });
    assert.equal(
      (await f.query("SELECT status FROM mot_stock_checks")).rows[0].status,
      "skipped",
    );
    assert.equal(
      (await f.query("SELECT * FROM mot_history_cache")).rows.length,
      0,
    );
    await f.repository.discover("one");
    const changed = await f.repository.claim(["one"]);
    assert.equal(changed?.registration, "ZZ99ABC");
    assert.ok(changed);
    await f.query("UPDATE vehicles SET inventory_status='sold' WHERE id=$1", [
      first,
    ]);
    await f.repository.finish(changed, { history: history("ZZ99ABC") });
    assert.equal(
      (await f.query("SELECT * FROM mot_history_cache")).rows.length,
      0,
    );
  } finally {
    await f.engine.close();
  }
});
test("quota busy does not exhaust attempts; transient errors back off and not-found never becomes exemption", async () => {
  const f = await fixture();
  try {
    await insert(f);
    await f.repository.start("one");
    let job = await f.repository.claim(["one"]);
    assert.ok(job);
    await f.repository.finish(job, { code: "busy" });
    let row = (await f.query("SELECT * FROM mot_stock_checks")).rows[0];
    assert.equal(row.attempts, 0);
    assert.equal(row.status, "queued");
    assert.equal(await f.repository.claim(["one"]), null);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await f.query("UPDATE mot_stock_checks SET next_attempt_at=now()");
      job = await f.repository.claim(["one"]);
      assert.ok(job);
      await f.repository.finish(job, { code: "unavailable" });
      row = (await f.query("SELECT * FROM mot_stock_checks")).rows[0];
      assert.equal(row.attempts, attempt);
      assert.equal(row.status, attempt < 3 ? "queued" : "failed");
    }
    assert.equal(
      (await f.repository.status("one")).run?.status,
      "completed_with_errors",
    );
    await f.repository.discover("one");
    assert.equal(await f.repository.claim(["one"]), null);
    await f.repository.start("one");
    job = await f.repository.claim(["one"]);
    assert.ok(job);
    await f.repository.finish(job, { code: "not_found" });
    assert.equal((await f.repository.status("one")).current.failed, 1);
    assert.equal((await f.repository.status("one")).current.checked, 0);
    await assert.rejects(
      createStockMotRepository(f.database, () => false).start("one"),
      { code: "not_configured" },
    );
  } finally {
    await f.engine.close();
  }
});
test("duplicate stock registrations reuse the existing service cache and global budget reservation", async () => {
  const f = await fixture();
  try {
    await insert(f);
    await insert(f, second, "one", "AB12 CDE");
    await f.repository.start("one");
    let upstream = 0,
      budget = 0;
    const service = createMotService({
      credentials: () => ({
        clientId: "fixture",
        clientSecret: "fixture",
        apiKey: "fixture",
        tokenUrl:
          "https://login.microsoftonline.com/a455b827-244f-4c97-b5b4-ce5d13b4d00c/oauth2/v2.0/token",
      }),
      reserve: async () => {
        budget++;
        return true;
      },
      transport: (async (url: any) => {
        if (String(url).includes("microsoftonline"))
          return new Response(
            JSON.stringify({ access_token: "fixture", expires_in: 3600 }),
          );
        upstream++;
        return new Response(
          JSON.stringify({
            registration: "AB12CDE",
            make: "FORD",
            model: "FOCUS",
            motTests: [],
          }),
        );
      }) as typeof fetch,
    });
    await processStockMotChecks({
      dealerIds: ["one"],
      repository: f.repository,
      service,
    });
    assert.equal(upstream, 1);
    assert.equal(budget, 1);
    assert.equal((await f.repository.status("one")).run?.checked, 2);
  } finally {
    await f.engine.close();
  }
});
test("mismatched results and future cache stamps cannot make a car appear checked", async () => {
  const f = await fixture();
  try {
    await insert(f);
    await f.repository.start("one");
    const job = await f.repository.claim(["one"]);
    assert.ok(job);
    await f.repository.finish(job, { history: history("ZZ99ABC") });
    assert.equal((await f.repository.status("one")).current.checked, 0);
    assert.equal(
      (await f.query("SELECT * FROM mot_history_cache")).rows.length,
      0,
    );
    await f.query(
      "INSERT INTO mot_history_cache(registration,data,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [
        "AB12CDE",
        {
          ...history(),
          checkedAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
    );
    assert.equal((await f.repository.status("one")).current.checked, 0);
  } finally {
    await f.engine.close();
  }
});
test("all invalid registrations finish skipped without a provider request", async () => {
  const f = await fixture();
  try {
    await insert(f, first, "one", "68 reg");
    const r = await f.repository.start("one");
    assert.equal(r.run?.status, "completed");
    assert.equal(r.run?.skipped, 1);
    assert.equal(await f.repository.claim(["one"]), null);
  } finally {
    await f.engine.close();
  }
});
test("an explicit manual run is eligible on active demos and removed cars finish skipped", async () => {
  const f = await fixture();
  const previous = process.env.MULTI_TENANT_ENABLED;
  process.env.MULTI_TENANT_ENABLED = "true";
  try {
    await f.engine.exec(
      "CREATE TABLE dealerships(id text PRIMARY KEY,status text);INSERT INTO dealerships VALUES('demo','active'),('inactive','suspended')",
    );
    await insert(f, first, "demo");
    await insert(f, second, "inactive", "ZZ99ABC");
    await f.repository.start("demo");
    await f.repository.start("inactive");
    assert.deepEqual(await f.repository.manualDealerIds(), ["demo"]);
    await f.query(
      "UPDATE vehicles SET source_status='missing' WHERE dealer_id='demo'",
    );
    await f.repository.discover("demo");
    const result = await f.repository.status("demo");
    assert.equal(result.run?.status, "completed");
    assert.equal(result.run?.skipped, 1);
    assert.deepEqual(await f.repository.manualDealerIds(), []);
  } finally {
    if (previous === undefined) delete process.env.MULTI_TENANT_ENABLED;
    else process.env.MULTI_TENANT_ENABLED = previous;
    await f.engine.close();
  }
});
test("skipped cars restored to current stock are immediately eligible again", async () => {
  const f = await fixture();
  try {
    await insert(f);
    await f.repository.discover("one");
    const job = await f.repository.claim(["one"]);
    assert.ok(job);
    await f.query("UPDATE vehicles SET source_status='missing' WHERE id=$1", [
      first,
    ]);
    await f.repository.finish(job, { history: history() });
    await f.query("UPDATE vehicles SET source_status='live' WHERE id=$1", [
      first,
    ]);
    await f.repository.discover("one");
    assert.equal((await f.repository.claim(["one"]))?.registration, "AB12CDE");
  } finally {
    await f.engine.close();
  }
});
test("worker is sequential and fixed-size, stops on global cooldown or shutdown before claiming another car", async () => {
  let claims = 0,
    finished = 0,
    draining = false;
  const repository = {
    withWorkerLock: async (work: () => Promise<void>) => work(),
    claim: async () => {
      claims++;
      return {
        dealerId: "one",
        vehicleId: first,
        registration: "AB12CDE",
        leaseToken: second,
        attempts: 0,
      };
    },
    finish: async () => {
      finished++;
      draining = true;
    },
  };
  await processStockMotChecks({
    dealerIds: ["one"],
    repository,
    service: { lookup: async () => history() },
    shouldStop: () => draining,
  });
  assert.equal(claims, 1);
  assert.equal(finished, 1);
  claims = 0;
  await processStockMotChecks({
    dealerIds: ["one"],
    repository,
    service: {
      lookup: async () => {
        throw new MotError("busy", "private");
      },
    },
    shouldStop: () => false,
  });
  assert.equal(claims, 1);
  claims = 0;
  await processStockMotChecks({
    dealerIds: ["one"],
    repository,
    service: { lookup: async () => history() },
  });
  assert.equal(claims, 2);
});
test("bulk routes require sales staff and verified dealer; ignore caller-supplied identity and reject cross-origin writes", async () => {
  const calls: any[] = [];
  const app = express();
  app.use((req, _res, next) => {
    if (req.get("x-role"))
      req.staff = {
        authUserId: "fixture",
        email: null,
        name: null,
        role: req.get("x-role") as "owner" | "accounts",
      };
    runWithTenant(
      {
        dealerId: req.get("x-dealer") || "one",
        canonicalOrigin: "https://example.test",
        platform: "cazoo",
        retailerId: "fixture",
        sourceUrl: "",
      },
      next,
    );
  });
  const result = {
    configured: true,
    automatic: true,
    current: {
      total: 0,
      checked: 0,
      needsCheck: 0,
      pending: 0,
      failed: 0,
      missingRegistration: 0,
    },
    run: null,
  };
  app.use(
    "/api",
    motRouter(undefined, undefined, undefined, undefined, {
      status: async (id: string) => {
        calls.push(["status", id]);
        return result;
      },
      start: async (id: string) => {
        calls.push(["start", id]);
        return result;
      },
    } as any),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/staff/vehicles/mot-checks`;
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal(
      (await fetch(base, { headers: { "x-role": "accounts" } })).status,
      403,
    );
    const r = await fetch(base + "?dealerId=two", {
      headers: { "x-role": "owner" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual(calls, [["status", "one"]]);
    assert.equal(
      (
        await fetch(base + "?dealerId=one", {
          method: "POST",
          headers: { "x-role": "owner", "x-dealer": "two" },
          body: "foreign",
        })
      ).status,
      202,
    );
    assert.deepEqual(calls.at(-1), ["start", "two"]);
    assert.equal(
      (
        await fetch(base, {
          method: "POST",
          headers: { "x-role": "owner", origin: "https://other.test" },
        })
      ).status,
      403,
    );
    assert.equal(calls.length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
