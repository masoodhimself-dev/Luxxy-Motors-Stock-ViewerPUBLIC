import test from "node:test";
import assert from "node:assert/strict";
import type { MotHistory, MotTest } from "@workspace/vehicle-meta";
import { motVehicleDetails } from "./lib/mot-vehicle-details";
const record = (extra: Partial<MotTest> = {}): MotTest => ({
  completedDate: "2026-06-01T10:00:00Z",
  result: "PASSED",
  expiryDate: "2027-06-01",
  mileage: "85042",
  mileageUnit: "MI",
  defects: [],
  ...extra,
});
const history = (extra: Partial<MotHistory> = {}): MotHistory => ({
  registration: "AB12CDE",
  make: "FORD",
  model: "FOCUS",
  registrationDate: "2012-05-01",
  checkedAt: "2026-11-01T09:00:00Z",
  recall: "Unknown",
  tests: [record()],
  ...extra,
});
const now = new Date("2026-11-01T12:00:00Z");
test("returns only supplied identity, MOT dates and the actual last reading without tests or defects", () => {
  const result = motVehicleDetails(history(), now);
  assert.deepEqual(result.vehicle, {
    make: "FORD",
    model: "FOCUS",
    registrationDate: "2012-05-01",
  });
  assert.deepEqual(result.mot, {
    dueDate: "2027-06-01",
    firstTest: false,
    lastPassedDate: "2026-06-01",
    lastTestDate: "2026-06-01",
    latestTestResult: "PASSED",
    checkedAt: "2026-11-01T09:00:00Z",
    lastReading: { date: "2026-06-01", mileage: 85042, unit: "MI" },
  });
  assert.equal("tests" in result, false);
});
test("retains newer failure and older expiry separately, never a validity assertion", () => {
  const result = motVehicleDetails(
    history({
      tests: [
        record(),
        record({
          completedDate: "2026-10-01",
          result: "FAILED",
          expiryDate: null,
          mileage: "90000",
        }),
      ],
    }),
    now,
  );
  assert.equal(result.mot.latestTestResult, "FAILED");
  assert.equal(result.mot.dueDate, "2027-06-01");
  assert.equal(result.mot.lastTestDate, "2026-10-01");
  assert.equal(result.mot.lastPassedDate, "2026-06-01");
  assert.equal(result.mot.lastReading?.mileage, 90000);
  assert.equal("valid" in result.mot, false);
});
test("supplied first MOT date is retained only with no recorded tests", () => {
  const result = motVehicleDetails(
    history({ tests: [], firstMotDueDate: "2028-05-01" }),
    now,
  );
  assert.equal(result.mot.firstTest, true);
  assert.equal(result.mot.dueDate, "2028-05-01");
  assert.equal(result.mot.lastReading, null);
  assert.equal(
    motVehicleDetails(history({ tests: [] }), now).mot.dueDate,
    null,
  );
});
test("rejects impossible dates/future records and never borrows an old expiry for a newer pass", () => {
  const result = motVehicleDetails(
    history({
      registrationDate: "2026-02-30",
      tests: [
        record(),
        record({
          completedDate: "2026-10-01",
          expiryDate: "2027-02-30",
          mileage: null,
        }),
        record({ completedDate: "2028-01-01", mileage: "100000" }),
      ],
    }),
    now,
  );
  assert.equal(result.vehicle.registrationDate, null);
  assert.equal(result.mot.lastTestDate, "2026-10-01");
  assert.equal(result.mot.dueDate, null);
  assert.equal(result.mot.lastReading?.date, "2026-06-01");
});
test("preserves kilometre readings in their original unit and ignores malformed readings", () => {
  const result = motVehicleDetails(
    history({ tests: [record({ mileage: "136863", mileageUnit: "KM" })] }),
    now,
  );
  assert.deepEqual(result.mot.lastReading, {
    date: "2026-06-01",
    mileage: 136863,
    unit: "KM",
  });
  assert.equal(
    motVehicleDetails(history({ tests: [record({ mileage: "unknown" })] }), now)
      .mot.lastReading,
    null,
  );
});
