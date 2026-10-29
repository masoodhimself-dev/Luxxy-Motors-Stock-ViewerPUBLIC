import assert from "node:assert/strict";
import { test } from "node:test";
import { staffMotSummary, type MotHistory } from "@workspace/vehicle-meta";
import {
  readStaffCars,
  staffCarChanges,
  staffCarQueries,
} from "./lib/staff-cars";
const now = new Date("2026-10-29T12:00:00Z");
const history = (extra: Partial<MotHistory> = {}): MotHistory => ({
  registration: "AB12CDE",
  make: "Fixture",
  model: "Car",
  checkedAt: now.toISOString(),
  recall: "Unknown",
  tests: [
    {
      completedDate: "2026-06-01T10:00:00Z",
      result: "PASSED",
      expiryDate: "2027-06-01",
      mileage: "65000",
      mileageUnit: "MI",
      defects: [],
    },
  ],
  ...extra,
});
test("MOT uses exact UK calendar dates, six-month boundary and expiry inclusive of today", () => {
  assert.equal(staffMotSummary(history(), now).tone, "green");
  for (const [expiry, tone, state] of [
    ["2027-04-29", "amber", "due"],
    ["2027-04-30", "green", "current"],
    ["2026-10-29", "amber", "due"],
    ["2026-10-28", "red", "expired"],
  ]) {
    const h = history();
    h.tests[0].expiryDate = expiry;
    const s = staffMotSummary(h, now);
    assert.equal(s.tone, tone);
    assert.equal(s.state, state);
    assert.equal(s.date, expiry);
  }
});
test("latest failure cannot be hidden by an older pass; malformed and stale data never gets green", () => {
  const h = history();
  h.tests.push({
    ...h.tests[0],
    result: "FAILED",
    completedDate: "2026-10-28T10:00:00Z",
    expiryDate: null,
  });
  assert.equal(staffMotSummary(h, now).state, "failed");
  assert.equal(
    staffMotSummary(history({ checkedAt: "2026-10-27T12:00:00Z" }), now).tone,
    "grey",
  );
  assert.equal(
    staffMotSummary(history({ checkedAt: "2026-10-30T12:00:00Z" }), now).tone,
    "grey",
  );
  const bad = history();
  bad.tests[0].expiryDate = "2027-02-31";
  assert.equal(staffMotSummary(bad, now).tone, "grey");
  assert.equal(staffMotSummary(null, now).date, null);
});
test("first MOT due must come from DVSA, never registration-year arithmetic", () => {
  assert.equal(
    staffMotSummary(history({ tests: [], firstMotDueDate: "2028-01-01" }), now)
      .state,
    "first_due",
  );
  assert.equal(
    staffMotSummary(history({ tests: [], firstMotDueDate: "2026-10-01" }), now)
      .tone,
    "red",
  );
  assert.equal(
    staffMotSummary(history({ tests: [], registrationDate: "2025-01-01" }), now)
      .tone,
    "grey",
  );
});
test("first MOTs due within six months are amber and future invalid test dates remain unknown", () => {
  assert.equal(
    staffMotSummary(history({ tests: [], firstMotDueDate: "2027-02-01" }), now)
      .tone,
    "amber",
  );
  const h = history();
  h.tests.push({
    ...h.tests[0],
    completedDate: "2027-01-01T12:00:00Z",
    result: "FAILED",
  });
  assert.equal(staffMotSummary(h, now).tone, "grey");
});

test("staff changes use actual previous values and distinguish new arrivals and photo changes", () => {
  const run = {
      created_at: "2026-10-29T11:00:00Z",
      received_at: "2026-10-29T11:01:00Z",
    },
    at = "2026-10-29T11:00:30Z";
  const rows = [
    {
      field_name: "sourcePrice",
      old_value: 9000,
      new_value: 8000,
      changed_at: at,
    },
    {
      field_name: "websitePublishedPrice",
      old_value: 8500,
      new_value: 8000,
      changed_at: at,
    },
    {
      field_name: "sourceImages",
      old_value: ["a"],
      new_value: ["a", "b"],
      changed_at: at,
    },
  ];
  const changes = staffCarChanges(rows, "2026-10-01T12:00:00Z", run);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].before, 8500);
  assert.equal(changes[1].kind, "photos");
  assert.equal(staffCarChanges(rows, at, run)[0].kind, "arrival");
  assert.deepEqual(staffCarChanges([], "2026-10-01T12:00:00Z", run), []);
});
test("staff aggregate scopes business reads to the dealer, reads cached MOT in one batch and keeps secrets out", async () => {
  const calls: { sql: string; values: unknown[] | undefined }[] = [];
  const v = (id: string, status = "available", source = "live") => ({
    id,
    source: "cazoo",
    inventoryStatus: status,
    sourceStatus: source,
    firstSeenAt: new Date("2026-10-01T10:00:00Z"),
    lastSeenAt: now,
    archivedAt: null,
    vrm: "AB12CDE",
    sourcePrice: 8000,
    priceReviewRequired: false,
  });
  const vehicles = [
    v("one"),
    v("sold", "sold"),
    v("missing", "available", "missing"),
  ] as any;
  const database = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return {
        rows:
          sql === staffCarQueries.latest
            ? [
                {
                  id: "run",
                  source: "cazoo",
                  created_at: "2026-10-29T11:00:00Z",
                  received_at: now,
                },
              ]
            : sql === staffCarQueries.cache
              ? [{ registration: "AB12CDE", data: history() }]
              : sql === staffCarQueries.sales
                ? [
                    {
                      vehicle_id: "one",
                      id: "sale",
                      reference: "SALE-1",
                      status: "draft",
                      secret: "not returned",
                    },
                  ]
                : sql === staffCarQueries.connection
                  ? [{ enabled: true }]
                  : sql === staffCarQueries.check
                    ? [
                        {
                          received_at: now,
                          status: "ready",
                          password: "never returned",
                        },
                      ]
                    : [],
      };
    },
  };
  const result = await readStaffCars({
    dealerId: "dealer-one",
    canManage: true,
    vehicles,
    database,
    project: async (rows) => rows.map((v) => ({ id: v.id })) as any,
    now,
  });
  assert.equal(calls.length, 6);
  for (const call of calls.filter((c) => c.sql !== staffCarQueries.cache))
    assert.equal(call.values?.[0], "dealer-one");
  assert.deepEqual(calls.find((c) => c.sql === staffCarQueries.cache)?.values, [
    ["AB12CDE"],
  ]);
  assert.equal(result.cars[0].staff.mot.tone, "green");
  assert.equal(result.cars[1].staff.published, false);
  assert.equal(result.cars[2].staff.published, false);
  assert.equal(result.cars[0].staff.sale?.id, "sale");
  assert.equal(result.feed.scheduled, true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret|password|not returned|never returned/,
  );
  calls.length = 0;
  const restricted = await readStaffCars({
    dealerId: "dealer-two",
    canManage: false,
    vehicles,
    database,
    project: async (rows) => rows.map((v) => ({ id: v.id })) as any,
    now,
  });
  assert.ok(!calls.some((c) => c.sql === staffCarQueries.sales));
  assert.equal(restricted.cars[0].staff.sale, null);
  assert.ok(calls.every((c) => /^SELECT/.test(c.sql)));
});

test("an un-applied supplier file or overdue check is never labelled current", async () => {
  const database = {
    query: async (sql: string) => ({
      rows:
        sql === staffCarQueries.latest
          ? [{ id: "run", source: "cazoo", created_at: now, received_at: now }]
          : sql === staffCarQueries.connection
            ? [{ enabled: true }]
            : sql === staffCarQueries.check
              ? [{ received_at: now, status: "ready", applied: false }]
              : [],
    }),
  };
  const result = await readStaffCars({
    dealerId: "one",
    canManage: false,
    vehicles: [],
    database,
    project: async () => [],
    now,
  });
  assert.equal(result.feed.state, "review");
  const old = {
    query: async (sql: string) => ({
      rows:
        sql === staffCarQueries.latest
          ? [
              {
                id: "old",
                source: "autotrader",
                created_at: "2026-10-01T12:00:00Z",
                received_at: "2026-10-01T12:00:00Z",
              },
            ]
          : [],
    }),
  };
  assert.equal(
    (
      await readStaffCars({
        dealerId: "two",
        canManage: false,
        vehicles: [],
        database: old,
        project: async () => [],
        now,
      })
    ).feed.state,
    "stale",
  );
});

test("official arrival events do not rely on database/client clock ordering", () => {
  const first = "2026-10-29T10:59:59.990Z";
  assert.equal(
    staffCarChanges(
      [
        {
          field_name: "vehicleAdded",
          old_value: null,
          new_value: true,
          changed_at: "2026-10-29T11:00:00Z",
        },
      ],
      first,
      {
        created_at: "2026-10-29T11:00:00Z",
        received_at: "2026-10-29T11:00:00Z",
      },
    )[0].kind,
    "arrival",
  );
});
