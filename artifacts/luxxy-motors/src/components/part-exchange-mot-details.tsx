import { useEffect, useRef, useState, type Ref } from "react";
import { isUKNumberPlate } from "@workspace/vehicle-meta";
import { Button } from "./ui/button";
import { dvsaVehicleName } from '@/lib/dvsa-vehicle-name';
import { MakeLogo } from './make-logo';
import { lookupPartExchangeCar, type PartExchangeMotDetailsResult } from '@/lib/part-exchange-lookup';
export type { PartExchangeMotDetailsResult } from '@/lib/part-exchange-lookup';
import "./part-exchange-mot-details.css";

const normalise = (value: string) => value.toUpperCase().replace(/[\s-]/g, "");
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London",
  });

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
      const details = await lookupPartExchangeCar(plate, controller.signal);
      if (!active()) return;
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
              <MakeLogo make={visible.details.vehicle.make} size={32} />
              <span><strong>{dvsaVehicleName(visible.details.vehicle)}</strong>
                {visible.details.vehicle.registrationDate && <span className="part-exchange-mot-details__year"> {visible.details.vehicle.registrationDate.slice(0, 4)}</span>}
              </span>
            </p>
            <MotFacts details={visible.details} />
            {visible.details.mileage !== undefined &&
              mileageEstimated !== false &&
              (mileage === undefined ||
                mileage === visible.details.mileage) && (
                <p>
                  Estimated mileage:{" "}
                  {Number(visible.details.mileage).toLocaleString("en-GB")}{" "}
                  miles. Please check your odometer.
                </p>
              )}
            {visible.details.mileage === undefined && (
              <p>
                Please enter your odometer reading.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
