import { expect, it } from "vitest";
import type { StaffMotSummary } from "@workspace/vehicle-meta";
import { focusStockMot } from "./stock-workspace-options";
const now = Date.parse("2026-11-06T12:00:00Z");
const mot = (
  state: StaffMotSummary["state"],
  date: string | null,
): StaffMotSummary => ({
  state,
  date,
  tone: "grey",
  label: "",
  checkedAt: null,
  lastMileage: null,
});
const cars = [
  { id: "unknown", mot: mot("unknown", null) },
  { id: "later", mot: mot("current", "2027-05-01") },
  { id: "expired", mot: mot("expired", "2026-10-01") },
  { id: "due", mot: mot("due", "2026-12-06") },
  { id: "failed", mot: mot("failed", "2026-11-01") },
];
it("filters expiry, failure and missing data without claiming unknown data passed", () => {
  expect(
    focusStockMot(cars, "expired", (c) => c.mot, now).map((c) => c.id),
  ).toEqual(["expired", "failed"]);
  expect(
    focusStockMot(cars, "due30", (c) => c.mot, now).map((c) => c.id),
  ).toEqual(["due"]);
  expect(
    focusStockMot(cars, "unknown", (c) => c.mot, now).map((c) => c.id),
  ).toEqual(["unknown"]);
});
it("sorts real expiry dates first and leaves test-failure dates out of expiry ordering", () => {
  expect(
    focusStockMot(cars, "earliest", (c) => c.mot, now).map((c) => c.id),
  ).toEqual(["expired", "due", "later", "unknown", "failed"]);
  expect(cars[0].id).toBe("unknown");
});
