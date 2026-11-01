import type { MotHistory } from "@workspace/vehicle-meta";

export type MotVehicleMetadata = {
  /** A recorded expiry/first-test date, never an assertion of roadworthiness. */
  dueDate: string | null;
  firstTest: boolean;
  lastPassedDate: string | null;
  lastTestDate: string | null;
  latestTestResult: "PASSED" | "FAILED" | null;
  checkedAt: string;
  lastReading: { date: string; mileage: number; unit: "MI" | "KM" } | null;
};

/** Validate the actual calendar day before Date.parse can roll an impossible
 * date into the next month. Zone-less DVSA timestamps have deterministic wall
 * clock ordering; their recorded date is retained, rather than inferred. */
function recordedDate(value: unknown): { day: string; order: number } | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      value,
    );
  if (!match) return null;
  const day = match[1],
    calendar = new Date(day + "T12:00:00Z");
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== day
  )
    return null;
  if (
    match[2] &&
    (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59)
  )
    return null;
  const order = Date.parse(
    match[2]
      ? value.replace(" ", "T") + (match[5] ? "" : "Z")
      : day + "T00:00:00Z",
  );
  return Number.isFinite(order) ? { day, order } : null;
}

/** Public metadata from the SAME cached lookup as the mileage estimate.
 * Includes no VIN, defects, staff details or customer records. */
export function motVehicleDetails(history: MotHistory, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const tests = history.tests
    .flatMap((test) => {
      const date = recordedDate(test.completedDate);
      return date &&
        date.day <= today &&
        ["PASSED", "FAILED"].includes(test.result)
        ? [{ test, ...date }]
        : [];
    })
    .sort(
      (a, b) =>
        b.order - a.order ||
        (a.test.result === b.test.result
          ? 0
          : a.test.result === "FAILED"
            ? -1
            : 1),
    );
  const latest = tests[0],
    passed = tests.find((record) => record.test.result === "PASSED");
  // A newer pass with missing/invalid expiry must not borrow an older pass's expiry.
  const expiry = passed
    ? (recordedDate(passed.test.expiryDate)?.day ?? null)
    : null;
  const firstDue =
    history.tests.length === 0
      ? (recordedDate(history.firstMotDueDate)?.day ?? null)
      : null;
  const dueDate = passed
    ? expiry && expiry >= passed.day
      ? expiry
      : null
    : firstDue;
  const reading = tests.find(
    ({ test }) =>
      typeof test.mileage === "string" &&
      /^\d+(?:\.\d+)?$/.test(test.mileage) &&
      ["MI", "KM"].includes(test.mileageUnit ?? "") &&
      Number(test.mileage) >= 0 &&
      Number(test.mileage) <= 1_609_344,
  );
  const mot: MotVehicleMetadata = {
    dueDate,
    firstTest: firstDue !== null,
    lastPassedDate: passed?.day ?? null,
    lastTestDate: latest?.day ?? null,
    latestTestResult: latest?.test.result ?? null,
    checkedAt: history.checkedAt,
    lastReading: reading
      ? {
          date: reading.day,
          mileage: Number(reading.test.mileage),
          unit: reading.test.mileageUnit!,
        }
      : null,
  };
  return {
    vehicle: {
      make: history.make,
      model: history.model,
      registrationDate: recordedDate(history.registrationDate)?.day ?? null,
    },
    mot,
  };
}
