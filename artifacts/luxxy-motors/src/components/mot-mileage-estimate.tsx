import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { isUKNumberPlate } from "@workspace/vehicle-meta";

type Vehicle = { make: string | null; model: string | null };
type Reply =
  | {
      vehicle: Vehicle;
      status: "estimated";
      registration: string;
      estimate: { mileage: number };
    }
  | { vehicle: Vehicle; status: "unavailable"; registration: string };

/** One debounced check per registration; manual/restored mileage always wins. */
export function MotMileageEstimate({
  registration,
  mileage,
  onEstimate,
}: {
  registration: string;
  mileage: string;
  onEstimate: (value: string) => void;
}) {
  const plate = registration.toUpperCase().replace(/[\s-]/g, "");
  const current = useRef({ mileage, onEstimate });
  current.current = { mileage, onEstimate };
  const applied = useRef<{ plate: string; value: string } | null>(null);
  const [status, setStatus] = useState<{ plate: string; text: string } | null>(
    null,
  );
  useEffect(() => {
    if (applied.current && applied.current.plate !== plate) {
      if (current.current.mileage === applied.current.value) {
        current.current.onEstimate("");
        current.current = { ...current.current, mileage: "" };
      }
      applied.current = null;
    }
    if (
      !isUKNumberPlate(plate) ||
      (current.current.mileage && !applied.current)
    )
      return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (current.current.mileage && current.current.mileage !== applied.current?.value) return;
      setStatus({ plate, text: "Estimating mileage from MOT history…" });
      try {
        const reply = await customFetch<Reply>(
          `/api/mot-mileage-estimate?registration=${encodeURIComponent(plate)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (reply.registration !== plate)
          throw new Error("Registration mismatch");
        if (
          current.current.mileage &&
          current.current.mileage !== applied.current?.value
        ) {
          setStatus(null);
          return;
        }
        const vehicle = [reply.vehicle?.make, reply.vehicle?.model]
          .filter(Boolean)
          .join(" ");
        const prefix = vehicle ? `${vehicle} · ` : "";
        if (
          reply.status === "estimated" &&
          reply.registration === plate &&
          Number.isInteger(reply.estimate.mileage) &&
          reply.estimate.mileage >= 0 &&
          reply.estimate.mileage <= 1000000
        ) {
          const value = String(reply.estimate.mileage);
          applied.current = { plate, value };
          current.current.onEstimate(value);
          setStatus({
            plate,
            text: `${prefix}Estimated ${Number(value).toLocaleString("en-GB")} miles from MOT history, rounded to the nearest 1,000. Please check your odometer and change this if needed.`,
          });
        } else {
          setStatus({
            plate,
            text: `${prefix}Not enough reliable MOT history to estimate mileage. Please enter your current odometer reading.`,
          });
        }
      } catch {
        if (!controller.signal.aborted)
          setStatus({
            plate,
            text: "Mileage could not be estimated. Please enter your current odometer reading.",
          });
      }
    }, 800);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [plate]);
  if (
    !status ||
    status.plate !== plate ||
    (applied.current?.plate === plate && mileage !== applied.current.value)
  )
    return null;
  return (
    <p role="status" className="mt-2 text-xs leading-5 text-muted-foreground">
      {status.text}
    </p>
  );
}
