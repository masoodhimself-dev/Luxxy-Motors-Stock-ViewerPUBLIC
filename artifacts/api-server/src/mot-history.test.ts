import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createMotService,
  normaliseMotRegistration,
  normaliseMotHistory,
} from "./lib/mot-history";
import { reserveMotBudget } from "./lib/mot-storage";
import { motRouter } from "./routes/mot-history";
import { runWithTenant, currentDealerId } from "./lib/tenant-context";
const credentials = {
  clientId: "fixture-client",
  clientSecret: "fixture-secret",
  apiKey: "fixture-key",
  tokenUrl:
    "https://login.microsoftonline.com/a455b827-244f-4c97-b5b4-ce5d13b4d00c/oauth2/v2.0/token",
};
const raw = (registration = "AB12CDE") => ({
  registration,
  make: "FORD",
  model: "FOCUS",
  vin: "DO-NOT-RETURN",
  hasOutstandingRecall: "Unknown",
  motTests: [
    {
      completedDate: "2024-02-10T10:00:00Z",
      testResult: "PASSED",
      expiryDate: "2025-02-09",
      odometerValue: "42000",
      odometerUnit: "MI",
      odometerResultType: "READ",
      defects: [{ text: "Tyre worn", type: "ADVISORY", dangerous: false }],
    },
    {
      completedDate: "2025-02-10T10:00:00Z",
      testResult: "FAILED",
      expiryDate: null,
      odometerValue: "0",
      odometerUnit: "KM",
      odometerResultType: "UNREADABLE",
      defects: [
        { text: "Brake pipe leaking", type: "DANGEROUS", dangerous: true },
      ],
    },
  ],
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const transport = (
  fn: (url: string, init?: RequestInit) => Promise<Response>,
) => fn as typeof fetch;
test("validates genuine registration formats and never treats reg bands or years as plates", () => {
  for (const [input, expected] of [
    ["ab12 cde", "AB12CDE"],
    ["A1", "A1"],
    ["ABC1234", "ABC1234"],
    ["123ABC", "123ABC"],
  ])
    assert.equal(normaliseMotRegistration(input), expected);
  for (const input of [
    "68 reg",
    "2019",
    "2019 (68 reg)",
    "../../secret",
    "X".repeat(21),
    "",
  ])
    assert.throws(() => normaliseMotRegistration(input), {
      code: "invalid_registration",
    });
});
test("normalises unsorted tests without leaking VINs or inventing mileage, passes, exemption or recall clearance", () => {
  const result = normaliseMotHistory(raw(), "AB12CDE", "2026-10-28T12:00:00Z");
  assert.equal(result.tests[0].result, "FAILED");
  assert.equal(result.tests[0].mileage, null);
  assert.equal(result.tests[1].mileage, "42000");
  assert.equal(result.tests[0].defects[0].dangerous, true);
  assert.equal(JSON.stringify(result).includes("DO-NOT-RETURN"), false);
  assert.equal(
    normaliseMotHistory({ ...raw(), motTests: [] }, "AB12CDE", result.checkedAt)
      .tests.length,
    0,
  );
  assert.throws(
    () => normaliseMotHistory(raw("ZZ99ABC"), "AB12CDE", result.checkedAt),
    { code: "unavailable" },
  );
  assert.throws(() =>
    normaliseMotHistory(
      { ...raw(), motTests: [{}] },
      "AB12CDE",
      result.checkedAt,
    ),
  );
});
test("uses both required headers and caches a coalesced OAuth token and successful MOT data across lookups", async () => {
  let tokens = 0,
    calls = 0,
    reservations = 0,
    clock = 1000000000000;
  const cache = new Map();
  const service = createMotService({
    credentials: () => credentials,
    now: () => clock,
    cache: {
      read: async (k) => cache.get(k) ?? null,
      write: async (d) => {
        cache.set(d.registration, d);
      },
    },
    reserve: async () => {
      reservations++;
      return true;
    },
    transport: transport(async (url, init) => {
      if (url.includes("microsoftonline")) {
        tokens++;
        const form = new URLSearchParams(String(init?.body));
        assert.equal(form.get("scope"), "https://tapi.dvsa.gov.uk/.default");
        assert.equal(form.get("client_secret"), "fixture-secret");
        return json({ access_token: "fixture-token", expires_in: 3600 });
      }
      calls++;
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer fixture-token",
      );
      assert.equal(new Headers(init?.headers).get("X-API-Key"), "fixture-key");
      return json(raw(url.split("/").at(-1)));
    }),
  });
  const [a, b] = await Promise.all([
    service.lookup("AB12 CDE"),
    service.lookup("ab12cde"),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  await service.lookup("AB12CDE");
  await service.lookup("ZZ99ABC");
  assert.equal(tokens, 1);
  assert.equal(calls, 2);
  assert.equal(reservations, 2);
  clock += 3600001;
  await service.lookup("AA11AAA");
  assert.equal(tokens, 2);
  const restarted = createMotService({
    credentials: () => null,
    now: () => clock,
    cache: { read: async (k) => cache.get(k), write: async () => {} },
    transport: transport(async () => {
      throw Error("must not request");
    }),
  });
  assert.equal((await restarted.lookup("AB12CDE")).registration, "AB12CDE");
  clock += 86400000;
  await assert.rejects(restarted.lookup("AB12CDE"), { code: "not_configured" });
});
test("not-found caching, provider errors, budget failures, timeouts and missing credentials never become successful histories", async () => {
  let calls = 0;
  const service = createMotService({
    credentials: () => credentials,
    transport: transport(async (url) =>
      url.includes("microsoftonline")
        ? json({ access_token: "t", expires_in: 3600 })
        : (calls++, json({}, 404)),
    ),
  });
  await assert.rejects(service.lookup("AB12CDE"), { code: "not_found" });
  await assert.rejects(service.lookup("AB12CDE"), { code: "not_found" });
  assert.equal(calls, 1);
  for (const status of [403, 429, 500]) {
    const broken = createMotService({
      credentials: () => credentials,
      transport: transport(async (url) =>
        url.includes("microsoftonline")
          ? json({ access_token: "t", expires_in: 3600 })
          : json({}, status),
      ),
    });
    await assert.rejects(broken.lookup("AB12CDE"), { code: "unavailable" });
    await assert.rejects(broken.lookup("ZZ99ABC"), { code: "busy" });
  }
  await assert.rejects(
    createMotService({ credentials: () => null }).lookup("AB12CDE"),
    { code: "not_configured" },
  );
  const noBudget = createMotService({
    credentials: () => credentials,
    reserve: async () => false,
    transport: transport(async () =>
      json({ access_token: "t", expires_in: 3600 }),
    ),
  });
  await assert.rejects(noBudget.lookup("AB12CDE"), { code: "busy" });
  const timed = createMotService({
    credentials: () => credentials,
    timeoutMs: 5,
    transport: transport(
      async (_url, init) =>
        new Promise((_resolve, reject) =>
          init!.signal!.addEventListener("abort", () =>
            reject(Error("PRIVATE-UPSTREAM-FAILURE")),
          ),
        ),
    ),
  });
  await assert.rejects(
    timed.lookup("AB12CDE"),
    (error) => !String(error).includes("PRIVATE-UPSTREAM"),
  );
});
test("401 refresh retries once, while a wrong issuer is refused before credential transmission", async () => {
  let tokens = 0,
    calls = 0;
  const service = createMotService({
    credentials: () => credentials,
    transport: transport(async (url) =>
      url.includes("microsoftonline")
        ? (tokens++, json({ access_token: "t" + tokens, expires_in: 3600 }))
        : (calls++, calls === 1 ? json({}, 401) : json(raw())),
    ),
  });
  await service.lookup("AB12CDE");
  assert.equal(tokens, 2);
  assert.equal(calls, 2);
  const wrong = createMotService({
    credentials: () => ({
      ...credentials,
      tokenUrl: "https://example.test/token",
    }),
    transport: transport(async () => {
      throw Error("must not transmit");
    }),
  });
  await assert.rejects(wrong.lookup("AB12CDE"), { code: "not_configured" });
});
test("additive migration and shared quota work across instances without touching existing records", async () => {
  const database = new PGlite();
  try {
    await database.exec(
      "CREATE TABLE protected_sales (id text); INSERT INTO protected_sales VALUES('real-sale')",
    );
    await database.exec(
      await readFile("../../lib/db/drizzle/0074_mot_history.sql", "utf8"),
    );
    const db = {
      query: (sql: string, params?: any[]) => database.query(sql, params),
    } as any;
    await database.exec("BEGIN");
    for (let i = 0; i < 4; i++) assert.equal(await reserveMotBudget(db), true);
    assert.equal(await reserveMotBudget(db), false);
    await database.exec("COMMIT");
    assert.equal(
      (await database.query("SELECT * FROM protected_sales")).rows.length,
      1,
    );
    await database.query(
      "UPDATE mot_api_usage SET count=100000 WHERE bucket LIKE 'day:%'",
    );
    assert.equal(await reserveMotBudget(db), false);
  } finally {
    await database.close();
  }
});
test("public vehicle checks are scoped to visible tenant stock; arbitrary registration checks require authorised sales staff", async () => {
  const server = createServer(),
    app = express();
  let calls = 0,
    cacheHit = true;
  const id = "12345678-1234-4234-8234-123456789abc",
    missing = "12345678-1234-4234-8234-123456789abd";
  app.use((req, _res, next) => {
    if (req.get("x-fixture-role"))
      req.staff = {
        authUserId: "fixture",
        email: null,
        name: null,
        role: req.get("x-fixture-role") as "owner" | "accounts",
      };
    runWithTenant(
      {
        dealerId: req.get("x-fixture-dealer") || "a",
        canonicalOrigin: "https://example.test",
        platform: "cazoo",
        retailerId: "fixture",
        sourceUrl: "",
      },
      next,
    );
  });
  const find = async (vehicleId: string) =>
    currentDealerId() === "a"
      ? vehicleId === id
        ? { id, plate: "AB12 CDE" }
        : vehicleId === missing
          ? { id: missing, registration: "2019 (68 reg)" }
          : null
      : null;
  app.use(
    "/api",
    motRouter(
      {
        lookup: async (registration: string) => {
          calls++;
          return normaliseMotHistory(
            raw(),
            registration.replace(/\s/g, ""),
            "2026-10-28T12:00:00Z",
          );
        },
      } as any,
      find as any,
      find as any,
      async (registration) => {
        assert.equal(
          registration,
          "AB12CDE",
          "cache keys normalise spaced stock plates",
        );
        return cacheHit
          ? normaliseMotHistory(raw(), "AB12CDE", "2026-10-28T12:00:00Z")
          : null;
      },
    ),
  );
  server.on("request", app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const get = async (path: string, headers: Record<string, string> = {}) => {
      const res = await fetch(base + path, { headers });
      return {
        status: res.status,
        body: (await res.json()) as any,
        cache: res.headers.get("cache-control"),
      };
    };
    assert.equal((await get(`/api/vehicles/${id}/mot-history`)).status, 200);
    assert.equal(calls, 1);
    const cached = await get(`/api/vehicles/${id}/mot-history?cacheOnly=true`);
    assert.equal(cached.body.status, "available");
    cacheHit = false;
    assert.equal(
      (await get(`/api/vehicles/${id}/mot-history?cacheOnly=true`)).body.status,
      "uncached",
    );
    cacheHit = true;
    assert.equal(calls, 1, "cache-only checks must not call DVSA");
    assert.equal(
      (
        await get(`/api/vehicles/${id}/mot-history?cacheOnly=true`, {
          "x-fixture-dealer": "b",
        })
      ).status,
      404,
    );
    assert.equal(
      (await get(`/api/vehicles/${missing}/mot-history?cacheOnly=true`)).body
        .status,
      "registration_missing",
    );
    const invalidEstimate = await get(
      "/api/mot-mileage-estimate?registration=invalid",
    );
    assert.equal(invalidEstimate.status, 400);
    assert.equal(calls, 1);
    const estimateReply = await get(
      "/api/mot-mileage-estimate?registration=AB12%20CDE",
    );
    assert.equal(estimateReply.status, 200);
    assert.equal(estimateReply.body.vehicle.make, "FORD");
    assert.equal(estimateReply.body.registration, "AB12CDE");
    assert.equal(estimateReply.body.history, undefined);
    assert.equal(estimateReply.body.tests, undefined);
    assert.equal(estimateReply.cache, "no-store");
    assert.equal(calls, 2);
    assert.equal(
      (
        await get(`/api/vehicles/${id}/mot-history`, {
          "x-fixture-dealer": "b",
        })
      ).status,
      404,
    );
    assert.equal(calls, 2);
    const absent = await get(`/api/vehicles/${missing}/mot-history`);
    assert.equal(absent.body.status, "registration_missing");
    assert.equal(calls, 2);
    assert.equal(absent.cache, "no-store");
    assert.equal(
      (await get("/api/staff/mot-history?registration=AB12CDE")).status,
      401,
    );
    assert.equal(
      (
        await get("/api/staff/mot-history?registration=AB12CDE", {
          "x-fixture-role": "accounts",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await get("/api/staff/mot-history?registration=AB12CDE", {
          "x-fixture-role": "owner",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await get(`/api/staff/vehicles/${id}/mot-history`, {
          "x-fixture-role": "owner",
          "x-fixture-dealer": "b",
        })
      ).status,
      404,
    );
    assert.equal((await get("/api/vehicles/invalid/mot-history")).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("newly registered DVSA records can omit tests and retain the official first due date", () => {
  const history = normaliseMotHistory(
    {
      registration: "AB12CDE",
      make: "FORD",
      model: "FOCUS",
      registrationDate: "2025-05-20",
      motTestDueDate: "2028-05-20",
    },
    "AB12CDE",
    "2026-10-29T10:00:00Z",
  );
  assert.equal(history.firstMotDueDate, "2028-05-20");
  assert.equal(history.registrationDate, "2025-05-20");
  assert.deepEqual(history.tests, []);
  assert.throws(() =>
    normaliseMotHistory(
      { registration: "AB12CDE" },
      "AB12CDE",
      history.checkedAt,
    ),
  );
});
