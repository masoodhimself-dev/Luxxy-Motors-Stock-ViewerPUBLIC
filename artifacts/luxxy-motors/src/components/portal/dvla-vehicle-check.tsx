import { useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { formatRegistrationPlate, isUKNumberPlate } from "@workspace/vehicle-meta";
import { Button } from "@/components/ui/button";
import { motDateLabel } from "@/lib/mot-mileage-history";

export type DvlaVehicleDetails = {
  registration: string;
  checkedAt: string;
  make?: string;
  colour?: string;
  fuelType?: string;
  yearOfManufacture?: number;
  engineCapacity?: number;
  co2Emissions?: number;
  euroStatus?: string;
  taxStatus?: string;
  taxDueDate?: string;
  dateOfLastV5CIssued?: string;
  motStatus?: string;
  motExpiry?: string;
  markedAsScrapped?: boolean;
  markedForExport?: boolean;
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});

function lookupError(error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  switch (code) {
    case "not_configured":
      return "The DVLA connection has not been set up.";
    case "not_found":
      return "DVLA found no record for this registration. Check the number plate and try again.";
    case "busy":
      return "The DVLA check is busy. Try again shortly.";
    case "invalid_registration":
      return "Check the registration and try again.";
    default:
      return "DVLA details are temporarily unavailable. Try again.";
  }
}

export function DvlaResult({ details }: { details: DvlaVehicleDetails }) {
  const fields = [
    { label: "Tax status", value: details.taxStatus },
    { label: "Tax due date", value: details.taxDueDate && motDateLabel(details.taxDueDate) },
    { label: "Last V5C issued", value: details.dateOfLastV5CIssued && motDateLabel(details.dateOfLastV5CIssued) },
    { label: "Make", value: details.make },
    { label: "Colour", value: details.colour },
    { label: "Fuel", value: details.fuelType },
    { label: "Year of manufacture", value: details.yearOfManufacture },
    { label: "Engine size", value: details.engineCapacity != null ? `${details.engineCapacity.toLocaleString("en-GB")} cc` : undefined },
    { label: "CO₂ emissions", value: details.co2Emissions != null ? `${details.co2Emissions} g/km` : undefined },
    { label: "Euro standard", value: details.euroStatus },
    { label: "DVLA MOT status", value: details.motStatus },
    { label: "DVLA MOT expiry", value: details.motExpiry && motDateLabel(details.motExpiry) },
    { label: "Vehicle marker", value: [
      details.markedAsScrapped ? "Marked as scrapped" : null,
      details.markedForExport ? "Marked for export" : null,
    ].filter(Boolean).join(", ") },
  ].filter(({ value }) => value != null && value !== "");
  const checkedAt = new Date(details.checkedAt);

  return (
    <section aria-label="DVLA vehicle details" className="mt-3 min-w-0 border-t border-border pt-3 text-sm">
      <p role="status">
        <strong>DVLA details for {formatRegistrationPlate(details.registration)}</strong>
        {Number.isFinite(checkedAt.getTime()) && (
          <span className="block text-xs text-muted-foreground">
            Checked <time dateTime={details.checkedAt}>{dateTime.format(checkedAt)}</time>
          </span>
        )}
      </p>
      {fields.length ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
          {fields.map(({ label, value }) => (
            <div key={label} className="min-w-0 break-words">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-muted-foreground">DVLA returned no additional details for this registration.</p>
      )}
    </section>
  );
}

type VehicleCheckProps = {
  registration: string | null | undefined;
  vehicleId?: string;
  onChecked?: () => void;
};

function RegistrationCheck({ registration, vehicleId, onChecked }: Omit<VehicleCheckProps, "registration"> & { registration: string }) {
  const lookup = useMutation({
    mutationFn: () => customFetch<DvlaVehicleDetails>("/api/staff/dvla/vehicle-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registration, vehicleId }),
      responseType: "json",
    }),
    onSuccess: onChecked,
  });

  return (
    <div className="min-w-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={lookup.isPending}
        onClick={() => lookup.mutate()}
      >
        {lookup.isPending ? "Checking DVLA…" : lookup.data ? "Check DVLA again" : "Check DVLA"}
      </Button>
      {lookup.isPending && <span role="status" className="sr-only">Checking DVLA vehicle details</span>}
      {lookup.isError && <p role="alert" className="mt-2 text-sm text-muted-foreground">{lookupError(lookup.error)}</p>}
      {lookup.data && <DvlaResult details={lookup.data} />}
    </div>
  );
}

export function DvlaVehicleCheck({ registration, vehicleId, onChecked }: VehicleCheckProps) {
  const plate = registration?.toUpperCase().replace(/[\s-]/g, "") ?? "";
  return isUKNumberPlate(plate) ? <RegistrationCheck key={`${vehicleId ?? ""}:${plate}`} registration={plate} vehicleId={vehicleId} onChecked={onChecked} /> : null;
}
