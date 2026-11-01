import { useEffect, useRef, useState, type Ref } from "react";
import { customFetch } from "@workspace/api-client-react";
import { isUKNumberPlate } from "@workspace/vehicle-meta";
import { Button } from "./ui/button";
import { dvsaVehicleName } from '@/lib/dvsa-vehicle-name';
import "./part-exchange-mot-details.css";

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
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
const finite = (value: unknown, max = 1_000_000): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max;

function readDetails(
  value: unknown,
  plate: string,
): PartExchangeMotDetailsResult {
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

function MotFacts({ details }: { details: PartExchangeMotDetailsResult }) {
  const mot = details.mot;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const today = ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join("-");
  const due = mot?.dueDate;
  const first =
    mot?.firstTest &&
    !mot.lastTestDate &&
    !mot.lastPassedDate &&
    !mot.latestTestResult;
  const reading =
    mot?.lastReading ??
    (details.estimate?.lastTestDate && details.estimate.lastTestMileage !== null
      ? {
          date: details.estimate.lastTestDate,
          mileage: details.estimate.lastTestMileage,
          unit: "MI" as const,
        }
      : null);
  return (
    <div className="part-exchange-mot-details__facts">
      {mot?.latestTestResult === "FAILED" ? (
        <p>
          MOT record needs checking.
          {due && (
            <>
              {" "}
              Last recorded expiry: <time dateTime={due}>{dateLabel(due)}</time>
              .
            </>
          )}
        </p>
      ) : due ? (
        <p>
          {first
            ? due < today
              ? "First MOT was due"
              : "First MOT due"
            : due < today
              ? "MOT expired"
              : "Next MOT due"}
          : <time dateTime={due}>{dateLabel(due)}</time>.
        </p>
      ) : (
        <p>MOT date unavailable. You can still continue.</p>
      )}
      {reading && (
        <p>
          Last recorded mileage: {reading.mileage.toLocaleString("en-GB")}{" "}
          {reading.unit === "KM" ? "km" : "miles"} on{" "}
          <time dateTime={reading.date}>{dateLabel(reading.date)}</time>.
        </p>
      )}
    </div>
  );
}

/** Explicit lookup only. All field ownership and step gating belong to the form. */
export function PartExchangeMotDetails({
  registration,
  onDetails,
  onManualEntry,
  mileage,
  mileageEstimated,
  lookupButtonRef,
  initialResult,
}: {
  registration: string;
  onDetails: (details: PartExchangeMotDetailsResult) => void;
  onManualEntry: () => void;
  mileage?: string;
  mileageEstimated?: boolean;
  lookupButtonRef?: Ref<HTMLButtonElement>;
  initialResult?: PartExchangeMotDetailsResult;
}) {
  const plate = normalise(registration),
    valid = plate.length <= 20 && isUKNumberPlate(plate);
  const current = useRef({ plate, onDetails, onManualEntry });
  current.current = { plate, onDetails, onManualEntry };
  const request = useRef<AbortController | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<
    | { plate: string; status: "loading" | "error" }
    | { plate: string; status: "ready"; details: PartExchangeMotDetailsResult }
    | null
  >(null);
  function cancel() {
    request.current?.abort();
    request.current = null;
    clearTimeout(timer.current);
  }
  useEffect(() => {
    cancel();
    setState(null);
    return cancel;
  }, [plate]);
  // Only the parent’s current in-memory gate supplies this result; drafts never do.
  const retained = valid && initialResult && normalise(initialResult.registration) === plate
    ? { plate, status: "ready" as const, details: initialResult }
    : null;
  const visible = state?.plate === plate ? state : retained,
    busy = visible?.status === "loading";
  async function find() {
    if (!valid || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ plate, status: "loading" });
    const active = () =>
      !controller.signal.aborted &&
      request.current === controller &&
      current.current.plate === plate;
    timer.current = setTimeout(() => {
      if (active()) {
        controller.abort();
        request.current = null;
        setState({ plate, status: "error" });
      }
    }, 12000);
    try {
      const reply = await customFetch<unknown>(
        `/api/mot-mileage-estimate?registration=${encodeURIComponent(plate)}`,
        { signal: controller.signal },
      );
      if (!active()) return;
      const details = readDetails(reply, plate);
      setState({ plate, status: "ready", details });
      current.current.onDetails(details);
    } catch {
      if (active()) setState({ plate, status: "error" });
    } finally {
      if (request.current === controller) {
        clearTimeout(timer.current);
        request.current = null;
      }
    }
  }
  return (
    <div className="part-exchange-mot-details">
      <div className="part-exchange-mot-details__actions">
        <Button
          ref={lookupButtonRef}
          type="button"
          disabled={!valid || busy}
          onClick={() => void find()}
        >
          {busy ? "Finding your car…" : "Find my car"}
        </Button>
        <button
          type="button"
          className="part-exchange-mot-details__manual"
          onClick={() => {
            cancel();
            setState(null);
            current.current.onManualEntry();
          }}
        >
          Enter details manually
        </button>
      </div>
      <div aria-live="polite" aria-atomic="true" role="status">
        {busy && <p>Checking your car’s details…</p>}
        {visible?.status === "error" && (
          <p>
            We couldn’t find your car’s details. Check the registration and try
            again, or enter them manually.
          </p>
        )}
        {visible?.status === "ready" && (
          <>
            <p className="part-exchange-mot-details__vehicle">
              Vehicle found:{" "}
              <strong>
                {dvsaVehicleName(visible.details.vehicle)}
              </strong>
            </p>
            <MotFacts details={visible.details} />
            {visible.details.mileage !== undefined &&
              mileageEstimated !== false &&
              (mileage === undefined ||
                mileage === visible.details.mileage) && (
                <p>
                  Suggested current mileage:{" "}
                  {Number(visible.details.mileage).toLocaleString("en-GB")}{" "}
                  miles. Estimated from MOT history and rounded to the nearest
                  1,000. Please check your odometer.
                </p>
              )}
            {visible.details.mileage === undefined && (
              <p>
                We couldn’t estimate current mileage reliably. Please enter your
                odometer reading.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
