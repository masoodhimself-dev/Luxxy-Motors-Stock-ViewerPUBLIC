import { customFetch } from "@workspace/api-client-react";
import { isUKNumberPlate } from "@workspace/vehicle-meta";

export type PartExchangeMotDetailsResult = {
  registration: string;
  vehicle: {
    make: string | null;
    model: string | null;
    registrationDate: string | null;
  };
  mileage?: string;
  estimate?: {
    mileage: number;
    lastTestDate: string | null;
    lastTestMileage: number | null;
    annualMiles: number | null;
  };
  mot: {
    dueDate: string | null;
    firstTest: boolean;
    lastPassedDate: string | null;
    lastTestDate: string | null;
    latestTestResult: "PASSED" | "FAILED" | null;
    checkedAt: string;
    lastReading?: { date: string; mileage: number; unit: "MI" | "KM" } | null;
  } | null;
};
const normalise = (value: string) => value.toUpperCase().replace(/[\s-]/g, "");
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) =>
  typeof value === "string" && value.trim()
    ? value.trim().replace(/\s+/g, " ").slice(0, 100)
    : null;
function day(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))
    return null;
  const result = value.slice(0, 10),
    date = new Date(`${result}T12:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === result
    ? result
    : null;
}
const finite = (value: unknown, max = 1_000_000): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max;

export function readPartExchangeMotDetails(
  value: unknown,
  plate: string,
): PartExchangeMotDetailsResult {
  plate = normalise(plate);
  if (plate.length > 20 || !isUKNumberPlate(plate)) throw Error("Invalid registration");
  const reply = record(value),
    vehicle = record(reply?.vehicle),
    rawMot = record(reply?.mot),
    estimate = record(reply?.estimate);
  if (
    !reply ||
    !["estimated", "unavailable"].includes(String(reply.status)) ||
    typeof reply.registration !== "string" ||
    normalise(reply.registration) !== plate
  )
    throw Error("Unmatched car");
  const make = text(vehicle?.make),
    model = text(vehicle?.model);
  if (!make && !model) throw Error("No vehicle identity");
  const mileage =
    reply.status === "estimated" &&
    finite(estimate?.mileage) &&
    Number.isInteger(estimate.mileage) &&
    estimate.mileage % 1000 === 0
      ? estimate.mileage
      : undefined;
  const checkedAt =
    typeof rawMot?.checkedAt === "string" &&
    Number.isFinite(Date.parse(rawMot.checkedAt))
      ? rawMot.checkedAt
      : null;
  const reading = record(rawMot?.lastReading),
    readingDay = day(reading?.date);
  return {
    registration: plate,
    vehicle: { make, model, registrationDate: day(vehicle?.registrationDate) },
    ...(mileage !== undefined
      ? {
          mileage: String(mileage),
          estimate: {
            mileage,
            lastTestDate: day(estimate?.lastTestDate),
            lastTestMileage: finite(estimate?.lastTestMileage)
              ? estimate.lastTestMileage
              : null,
            annualMiles: finite(estimate?.annualMiles, 100000)
              ? estimate.annualMiles
              : null,
          },
        }
      : {}),
    mot:
      rawMot && checkedAt
        ? {
            dueDate: day(rawMot.dueDate),
            firstTest: rawMot.firstTest === true,
            lastPassedDate: day(rawMot.lastPassedDate),
            lastTestDate: day(rawMot.lastTestDate),
            latestTestResult:
              rawMot.latestTestResult === "PASSED" ||
              rawMot.latestTestResult === "FAILED"
                ? rawMot.latestTestResult
                : null,
            checkedAt,
            lastReading:
              readingDay &&
              finite(reading?.mileage, 1_609_344) &&
              (reading?.unit === "MI" || reading?.unit === "KM")
                ? {
                    date: readingDay,
                    mileage: reading.mileage,
                    unit: reading.unit,
                  }
                : null,
          }
        : null,
  };
}

/** Read-only lookup; the caller owns cancellation and the visible request state. */
export async function lookupPartExchangeCar(registration: string, signal?: AbortSignal): Promise<PartExchangeMotDetailsResult> {
  const plate = normalise(registration);
  if (plate.length > 20 || !isUKNumberPlate(plate)) throw Error("Invalid registration");
  const reply = await customFetch<unknown>(`/api/mot-mileage-estimate?registration=${encodeURIComponent(plate)}`, { signal });
  return readPartExchangeMotDetails(reply, plate);
}
