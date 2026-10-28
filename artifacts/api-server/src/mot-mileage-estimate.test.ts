import test from "node:test";
import assert from "node:assert/strict";
import type { MotHistory, MotTest } from "@workspace/vehicle-meta";
import { estimateMotMileage } from "./lib/mot-mileage-estimate";
const record = (
  date: string,
  mileage: string,
  unit: "MI" | "KM" | null = "MI",
): MotTest => ({
  completedDate: date,
  mileage,
  mileageUnit: unit,
  result: "PASSED",
  expiryDate: null,
  defects: [],
});
const history = (tests: MotTest[]): MotHistory => ({
  registration: "AB12CDE",
  make: "FORD",
  model: "FOCUS",
  checkedAt: "2026-07-01T00:00:00Z",
  recall: "Unknown",
  tests,
});
const now = new Date("2026-07-02T00:00:00Z");
test("projects this car’s annual usage to today and rounds to thousands", () => {
  const estimate = estimateMotMileage(
    history([record("2026-01-01", "60000"), record("2025-01-01", "50000")]),
    now,
  )!;
  assert.equal(estimate.mileage, 65000);
  assert.equal(estimate.lastTestMileage, 60000);
  assert.equal(estimate.lastTestDate, "2026-01-01");
  assert.ok(Math.abs(estimate.annualMiles - 10000) < 10);
});
test("uses up to three years of recent history; dates need not be in order", () => {
  const estimate = estimateMotMileage(
    history([
      record("2025-01-01", "50000"),
      record("2023-01-01", "30000"),
      record("2010-01-01", "1"),
      record("2026-01-01", "60000"),
    ]),
    now,
  )!;
  assert.equal(estimate.mileage, 65000);
});
test("combines same-day retests and converts kilometres to miles", () => {
  const estimate = estimateMotMileage(
    history([
      record("2025-01-01", "80467.2", "KM"),
      record("2026-01-01T10:00:00Z", "60000"),
      record("2026-01-01T11:00:00Z", "60001"),
    ]),
    now,
  )!;
  assert.equal(estimate.mileage, 65000);
});
test("does not invent a rate from missing, unknown-unit, short or single-test history", () => {
  for (const tests of [
    [],
    [record("2026-01-01", "60000")],
    [record("2026-01-01", "60000"), record("2025-12-01", "59000")],
    [record("2026-01-01", "60000"), record("2025-01-01", "50000", null)],
    [record("2026-01-01", "not known"), record("2025-01-01", "50000")],
  ])
    assert.equal(estimateMotMileage(history(tests), now), null);
});
test("refuses declining odometer readings, excessive rates and stale histories", () => {
  for (const tests of [
    [record("2025-01-01", "70000"), record("2026-01-01", "60000")],
    [record("2025-01-01", "10000"), record("2026-01-01", "200000")],
    [record("2021-01-01", "50000"), record("2022-01-01", "60000")],
  ])
    assert.equal(estimateMotMileage(history(tests), now), null);
});
test("supports zero historical use and rounds to the nearest thousand", () => {
  const tests = [record("2025-01-01", "60100"), record("2026-01-01", "60100")];
  const estimate = estimateMotMileage(history(tests), now)!;
  assert.equal(estimate.mileage, 60000);
  assert.equal(estimate.annualMiles, 0);
});

test("does not estimate from older readings when the latest MOT mileage is unreadable", () => {
  assert.equal(
    estimateMotMileage(
      history([
        record("2024-01-01", "50000"),
        record("2025-01-01", "60000"),
        record("2026-01-01", ""),
      ]),
      now,
    ),
    null,
  );
});
