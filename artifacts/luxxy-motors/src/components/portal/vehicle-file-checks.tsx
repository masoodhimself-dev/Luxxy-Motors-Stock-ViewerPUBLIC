import { useId } from "react";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { isUKNumberPlate, type MotHistory, type StaffMotSummary, type StaffTaxSummary } from "@workspace/vehicle-meta";
import { ArrowUpRight, ClipboardCheck, RefreshCw, ShieldCheck } from "@/components/icons";
import { MotHistoryResults } from "@/components/mot-history";
import { Button } from "@/components/ui/button";
import { motDateLabel, motTestTime } from "@/lib/mot-mileage-history";
import { DvlaResult, dvlaLookupError, lookupStaffDvlaVehicle, type DvlaVehicleDetails } from "./dvla-vehicle-check";
import "./vehicle-file-checks.css";

type VehicleFileChecksProps = {
  vehicleId: string;
  registration: string | null | undefined;
  tax?: StaffTaxSummary | null;
  mot: StaffMotSummary;
  canManage: boolean;
  onMotHistory?: (history: MotHistory) => void;
  onDvlaChecked?: () => void;
};

type MotLookup =
  | { status: "available"; history: MotHistory }
  | { status: "uncached" }
  | { status: "registration_missing"; message: string };

function motLookupError(error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  switch (code) {
    case "not_configured":
      return "The DVSA connection has not been set up.";
    case "not_found":
      return "DVSA found no MOT history for this registration. Check the number plate.";
    case "busy":
      return "The MOT check is busy. Try again shortly.";
    case "invalid_registration":
      return "Check the registration and try again.";
    default:
      return "MOT history is temporarily unavailable. Try again.";
  }
}

function CheckedDate({ value }: { value: string }) {
  return motTestTime(value) !== null
    ? <p className="vehicle-checks-checked">Checked <time dateTime={value}>{motDateLabel(value)}</time></p>
    : null;
}

function StockDvlaRecord({
  vehicleId, plate, tax, canManage, onDvlaChecked,
}: {
  vehicleId: string;
  plate: string;
  tax: StaffTaxSummary | null | undefined;
  canManage: boolean;
  onDvlaChecked?: () => void;
}) {
  const heading = useId();
  const client = useQueryClient();
  const key = ["vehicle-file-dvla", vehicleId, plate];
  const { data } = useQuery<DvlaVehicleDetails>({ queryKey: key, queryFn: skipToken });
  const check = useMutation({
    mutationFn: () => lookupStaffDvlaVehicle(plate, vehicleId),
    onSuccess: (details) => {
      client.setQueryData(key, details);
      onDvlaChecked?.();
    },
  });

  return (
    <section className="vehicle-checks-record" aria-labelledby={heading}>
      <header className="vehicle-checks-heading">
        <h2 id={heading}><ShieldCheck size={20} aria-hidden="true" /> DVLA vehicle record</h2>
        {canManage && plate && (
          <Button type="button" variant="outline" size="sm" disabled={check.isPending} onClick={() => check.mutate()}>
            <RefreshCw size={15} aria-hidden="true" />
            {check.isPending ? "Checking DVLA…" : data ? "Check DVLA again" : "Check DVLA"}
          </Button>
        )}
      </header>
      {canManage && check.isPending && <span className="sr-only" role="status">Checking DVLA vehicle details</span>}
      {canManage && check.isError && <p className="vehicle-checks-error" role="alert">{dvlaLookupError(check.error)}</p>}
      {canManage && data ? (
        <DvlaResult details={data} />
      ) : tax ? (
        <>
          <dl className="vehicle-checks-facts">
            <div><dt>Tax status</dt><dd>{tax.status ?? "Unavailable"}</dd></div>
            {tax.dueDate && <div><dt>Tax due date</dt><dd>{motDateLabel(tax.dueDate)}</dd></div>}
          </dl>
          <CheckedDate value={tax.checkedAt} />
        </>
      ) : (
        <p className="vehicle-checks-empty">{plate ? "No DVLA details on file." : "Add a valid registration to check DVLA details."}</p>
      )}
    </section>
  );
}

function StockMotRecord({
  vehicleId, plate, mot, canManage, onMotHistory,
}: {
  vehicleId: string;
  plate: string;
  mot: StaffMotSummary;
  canManage: boolean;
  onMotHistory?: (history: MotHistory) => void;
}) {
  const heading = useId();
  const client = useQueryClient();
  const key = ["vehicle-file-dvsa", vehicleId, plate];
  const url = `/api/staff/vehicles/${encodeURIComponent(vehicleId)}/mot-history`;
  const saved = useQuery({
    queryKey: key,
    enabled: canManage && !!plate,
    queryFn: ({ signal }) => customFetch<MotLookup>(`${url}?cacheOnly=true`, { signal }),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const check = useMutation({
    mutationFn: () => customFetch<MotLookup>(url),
    onSuccess: async (result) => {
      await client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData(key, result);
      if (result.status === "available") onMotHistory?.(result.history);
    },
  });
  const history = canManage && saved.data?.status === "available" ? saved.data.history : null;
  const problem = check.error ?? saved.error;
  const registrationMissing = saved.data?.status === "registration_missing";
  const busy = canManage && (saved.isFetching || check.isPending);

  return (
    <section className="vehicle-checks-record" aria-labelledby={heading}>
      <header className="vehicle-checks-heading">
        <h2 id={heading}><ClipboardCheck size={20} aria-hidden="true" /> DVSA MOT history</h2>
        {canManage && plate && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => check.mutate()}>
            <RefreshCw size={15} aria-hidden="true" />
            {check.isPending ? "Checking MOT…" : history ? "Check MOT again" : "Check MOT"}
          </Button>
        )}
      </header>
      {busy && <p className="vehicle-checks-checked" role="status">{check.isPending ? "Checking MOT history…" : "Loading saved MOT history…"}</p>}
      {canManage && problem && <p className="vehicle-checks-error" role="alert">{motLookupError(problem)}</p>}
      {history ? (
        <MotHistoryResults history={history} staff />
      ) : (
        <>
          <dl className="vehicle-checks-facts">
            <div>
              <dt>MOT status</dt>
              <dd>{mot.label}{mot.date && <> <time dateTime={mot.date}>{motDateLabel(mot.date)}</time></>}</dd>
            </div>
            {mot.lastMileage && <div><dt>Last test mileage</dt><dd>{mot.lastMileage}</dd></div>}
          </dl>
          {mot.checkedAt && <CheckedDate value={mot.checkedAt} />}
          {canManage && (!plate || registrationMissing) && <p className="vehicle-checks-empty">Add a valid registration to check MOT history.</p>}
          {canManage && !!plate && !registrationMissing && saved.data?.status === "uncached" && (
            <p className="vehicle-checks-empty">Check MOT to load the test record and mileage.</p>
          )}
          <a href="https://www.gov.uk/check-mot-history" target="_blank" rel="noopener noreferrer" className="vehicle-checks-official-link">
            View MOT history on GOV.UK <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </>
      )}
    </section>
  );
}

export function VehicleFileChecks({
  vehicleId, registration, tax, mot, canManage, onMotHistory, onDvlaChecked,
}: VehicleFileChecksProps) {
  const normalized = registration?.toUpperCase().replace(/[\s-]/g, "") ?? "";
  const plate = isUKNumberPlate(normalized) ? normalized : "";
  const identity = `${vehicleId}:${plate}`;
  return (
    <div className="vehicle-checks">
      <div className="vehicle-checks-grid" key={identity}>
        <StockDvlaRecord vehicleId={vehicleId} plate={plate} tax={tax} canManage={canManage} onDvlaChecked={onDvlaChecked} />
        <StockMotRecord vehicleId={vehicleId} plate={plate} mot={mot} canManage={canManage} onMotHistory={onMotHistory} />
      </div>
    </div>
  );
}
