import { it, expect } from "vitest";
import { longMot } from "./long-mot";
import type { MotHistory } from "@workspace/vehicle-meta";
const now = new Date("2026-10-29T10:00:00Z");
const record: MotHistory = {
  registration: "AB12CDE",
  make: "FORD",
  model: "FOCUS",
  checkedAt: now.toISOString(),
  recall: "Unknown",
  tests: [
    {
      completedDate: "2026-10-01T10:00:00Z",
      result: "PASSED",
      expiryDate: "2027-10-01",
      mileage: "42000",
      mileageUnit: "MI",
      defects: [],
    },
  ],
};
it("uses whole calendar months and includes the exact nine-month boundary", () => {
  expect(longMot(record, now)?.months).toBe(11);
  expect(
    longMot(
      { ...record, tests: [{ ...record.tests[0], expiryDate: "2027-07-29" }] },
      now,
    )?.months,
  ).toBe(9);
  expect(
    longMot(
      { ...record, tests: [{ ...record.tests[0], expiryDate: "2027-07-28" }] },
      now,
    ),
  ).toBeNull();
});
it("rejects stale, future, absent and invalid records", () => {
  for (const checkedAt of [
    "invalid",
    "2026-10-28T09:59:59Z",
    "2026-10-30T10:00:00Z",
  ])
    expect(longMot({ ...record, checkedAt }, now)).toBeNull();
  expect(longMot(null, now)).toBeNull();
  for (const expiryDate of [null, "invalid", "2025-01-01"])
    expect(
      longMot({ ...record, tests: [{ ...record.tests[0], expiryDate }] }, now),
    ).toBeNull();
});
it("sorts tests and never badges an older pass after a newer failure", () => {
  expect(
    longMot(
      {
        ...record,
        tests: [
          ...record.tests,
          {
            ...record.tests[0],
            completedDate: "2026-10-28",
            result: "FAILED",
            expiryDate: null,
          },
        ],
      },
      now,
    ),
  ).toBeNull();
  expect(longMot({ ...record, tests: [] }, now)).toBeNull();
});

import { firstMotDue } from "./long-mot";
it("uses only an official future first due date, never infers from missing tests", () => {
  const fresh = { ...record, tests: [], firstMotDueDate: "2028-05-20" };
  expect(firstMotDue(fresh, now)).toBe("2028-05-20");
  expect(firstMotDue({ ...fresh, tests: record.tests }, now)).toBeNull();
  expect(firstMotDue({ ...fresh, firstMotDueDate: undefined }, now)).toBeNull();
  expect(
    firstMotDue({ ...fresh, firstMotDueDate: "2026-10-29" }, now),
  ).toBeNull();
  expect(
    firstMotDue({ ...fresh, checkedAt: "2026-10-27T10:00:00Z" }, now),
  ).toBeNull();
});
