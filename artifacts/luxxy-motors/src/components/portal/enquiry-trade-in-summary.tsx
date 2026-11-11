import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { isUKNumberPlate, type MotHistory } from "@workspace/vehicle-meta";
import { firstMotDue } from "@/lib/long-mot";
import { motDateLabel, newestMotTests } from "@/lib/mot-mileage-history";
import { formatMileage } from "@/lib/utils";
import { DvlaVehicleCheck } from "./dvla-vehicle-check";

export function EnquiryTradeInSummary({ registration, mileage }: {
  registration: string;
  mileage?: number | null;
}) {
  const plate = registration.toUpperCase().replace(/[\s-]/g, "");
  const valid = isUKNumberPlate(plate);
  const lookup = useQuery({
    queryKey: ["staff-enquiry-trade-in-mot", plate],
    queryFn: ({ signal }) => customFetch<{ history: MotHistory }>(
      `/api/staff/mot-history?registration=${encodeURIComponent(plate)}`,
      { signal },
    ),
    enabled: valid,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const history = lookup.data?.history;
  const vehicle = history && [history.make, history.model].filter(Boolean).join(" ");
  const latest = history && newestMotTests(history.tests)[0];
  const firstDue = history && !latest && firstMotDue(history);

  return (
    <section className="enquiry-case-trade-in" aria-label="Part exchange">
      <h4>Part exchange</h4>
      <p><strong>{registration}</strong>{mileage != null && <> · {formatMileage(mileage)} reported by customer</>}</p>
      {!valid && <p>Check the registration with the customer to look up the car.</p>}
      {lookup.isLoading && <p role="status">Checking trade-in MOT history…</p>}
      {lookup.isError && <p>MOT details unavailable. <button type="button" onClick={() => void lookup.refetch()}>Retry lookup</button></p>}
      {history && (
        <p>
          {vehicle && <>{vehicle} · </>}
          {latest?.result === "FAILED" ? "Latest MOT failed"
            : latest?.expiryDate ? `Recorded MOT expiry ${motDateLabel(latest.expiryDate)}`
            : firstDue ? `First MOT due ${motDateLabel(firstDue)}`
            : "No MOT expiry returned"}
        </p>
      )}
      {valid && <div className="mt-3"><DvlaVehicleCheck registration={plate} /></div>}
    </section>
  );
}
