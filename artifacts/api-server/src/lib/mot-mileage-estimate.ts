import type { MotHistory } from "@workspace/vehicle-meta";

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
  const today = Date.parse(now.toISOString().slice(0, 10));
  const day = 86400000;
  const byDate = new Map<number, number>();
  let latestTestDate = -Infinity;
  for (const test of history.tests) {
    const date = Date.parse(test.completedDate.slice(0, 10));
    if (Number.isFinite(date) && date <= today)
      latestTestDate = Math.max(latestTestDate, date);
    const reading = test.mileage?.trim();
    if (
      !reading ||
      !/^\d+(?:\.\d+)?$/.test(reading) ||
      !test.mileageUnit ||
      !Number.isFinite(date) ||
      date > today
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
    today - latest[0] > 3 * 365.25 * day
  )
    return null;
  const recent = records.filter(
    ([date]) => latest[0] - date <= 3 * 365.25 * day,
  );
  if (recent.some(([, miles], i) => i > 0 && miles < recent[i - 1][1]))
    return null;
  const first = recent[0];
  if (latest[0] - first[0] < 180 * day) return null;
  const annualMiles =
    ((latest[1] - first[1]) * 365.25 * day) / (latest[0] - first[0]);
  if (annualMiles > 100000) return null; // Inconsistent or extreme history requires a real odometer reading.
  const projected =
    latest[1] + (annualMiles * (today - latest[0])) / (365.25 * day);
  const mileage = Math.round(projected / 1000) * 1000;
  if (mileage > 1000000) return null;
  return {
    mileage,
    lastTestDate: new Date(latest[0]).toISOString().slice(0, 10),
    lastTestMileage: Math.round(latest[1]),
    annualMiles: Math.round(annualMiles),
  };
}
