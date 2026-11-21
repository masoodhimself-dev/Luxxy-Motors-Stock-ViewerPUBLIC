import type { MotHistory } from "@workspace/vehicle-meta";
import { recordedMotDate } from "./mot-vehicle-details";

export interface MotMileageEstimate {
  mileage: number;
  lastTestDate: string;
  lastTestMileage: number;
  annualMiles: number;
}

/** Extrapolate this vehicle's recent recorded usage; never substitute a national average. */
export function estimateMotMileage(
  history: MotHistory,
  now = new Date(),
): MotMileageEstimate | null {
  if (!Number.isFinite(now.getTime())) return null;
  const today = Date.parse(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now));
  const day = 86400000;
  const year = 365.25 * day;
  const byDate = new Map<number, number>();
  let latestTestDate = -Infinity;
  for (const test of history.tests) {
    const recorded = recordedMotDate(test.completedDate);
    if (!recorded) return null;
    const date = Date.parse(recorded.day);
    if (date > today) return null;
    latestTestDate = Math.max(latestTestDate, date);
    const reading = test.mileage?.trim();
    if (
      !reading ||
      !/^\d+(?:\.\d+)?$/.test(reading) ||
      (test.mileageUnit !== "MI" && test.mileageUnit !== "KM")
    )
      continue;
    const miles = Number(reading) / (test.mileageUnit === "KM" ? 1.609344 : 1);
    if (!Number.isFinite(miles) || miles < 0 || miles > 1000000) continue;
    // Retests on the same date are not separate usage intervals.
    byDate.set(date, Math.max(miles, byDate.get(date) ?? 0));
  }
  const records = [...byDate].sort((a, b) => a[0] - b[0]);
  const latest = records.at(-1);
  if (
    !latest ||
    latest[0] !== latestTestDate ||
    today - latest[0] > 1.5 * year
  )
    return null;
  const recent = records.filter(([date]) => latest[0] - date <= 3 * year);
  if (recent.some(([, miles], i) => i > 0 && Math.round(miles) < Math.round(recent[i - 1][1])))
    return null;
  // A nearby retest is too short an interval to extrapolate annual use.
  const previous = recent.filter(([date]) => latest[0] - date >= 180 * day).at(-1);
  if (!previous) return null;
  const annualMiles =
    ((Math.round(latest[1]) - Math.round(previous[1])) * year) / (latest[0] - previous[0]);
  if (annualMiles > 100000) return null; // Inconsistent or extreme history requires a real odometer reading.
  const projected =
    latest[1] + (annualMiles * (today - latest[0])) / year;
  // Even a rounded estimate must pass the enquiry's last-recorded-mileage floor.
  const mileage = Math.max(Math.round(projected / 1000), Math.ceil(latest[1] / 1000)) * 1000;
  if (mileage > 1000000) return null;
  return {
    mileage,
    lastTestDate: new Date(latest[0]).toISOString().slice(0, 10),
    lastTestMileage: Math.ceil(latest[1]),
    annualMiles: Math.round(annualMiles),
  };
}
