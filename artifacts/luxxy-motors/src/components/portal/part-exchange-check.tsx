import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { formatRegistrationPlate, isUKNumberPlate, type MotHistory } from "@workspace/vehicle-meta";
import { AlertCircle, ChevronDown, Search } from "lucide-react";
import { MotHistoryResults } from "@/components/mot-history";
import { Button } from "@/components/ui/button";
import { firstMotDue } from "@/lib/long-mot";
import { buildMotMileageHistory, motDateLabel, motMileageLabel, motTestTime, newestMotTests } from "@/lib/mot-mileage-history";
import { DvlaResult, type DvlaVehicleDetails } from "./dvla-vehicle-check";
import "./part-exchange-check.css";

type Provider = "dvla" | "dvsa";
type Source = "both" | Provider;
type LookupFailure = { status: "not_found" | "busy" | "unavailable" | "not_configured" };
type LookupResult = {
  registration: string;
  dvla?: { status: "available"; details: DvlaVehicleDetails } | LookupFailure;
  dvsa?: { status: "available"; history: MotHistory; estimate: { mileage: number } | null } | LookupFailure;
};

type PartExchangeCheckProps = {
  registration: string;
  reportedRegistration?: string | null;
  reportedMileage?: number | null;
  onInsertText?: (text: string) => void;
};

function normalisePlate(value?: string | null) {
  return value?.toUpperCase().replace(/[\s-]/g, "") ?? "";
}

const mileageLabel = (value: number) => `${value.toLocaleString("en-GB")} miles`;

function expiryLabel(value?: string | null) {
  return value && motTestTime(value) !== null ? motDateLabel(value) : null;
}

function ProviderIssue({ provider, failure, retry, pending }: {
  provider: Provider;
  failure: LookupFailure;
  retry: (provider: Provider) => void;
  pending: boolean;
}) {
  const label = provider.toUpperCase();
  const message = {
    not_found: `${label} found no record for this registration.`,
    busy: `${label} is busy. Try again shortly.`,
    unavailable: `${label} details are temporarily unavailable.`,
    not_configured: `${label} is not connected.`,
  }[failure.status];

  return (
    <div className="px-check-provider">
      <p role="status">{message}</p>
      {(failure.status === "busy" || failure.status === "unavailable") && (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => retry(provider)}>
          Retry {label}
        </Button>
      )}
    </div>
  );
}

function ResultDetails({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="px-check-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>{label} <ChevronDown size={16} aria-hidden /></summary>
      {open && children}
    </details>
  );
}

function CombinedResult({ result, reportedMileage, onInsertText }: {
  result: LookupResult;
  reportedMileage: number | null;
  onInsertText?: (text: string) => void;
}) {
  const dvla = result.dvla?.status === "available" ? result.dvla.details : undefined;
  const dvsa = result.dvsa?.status === "available" ? result.dvsa : undefined;
  const history = dvsa?.history;
  if (!dvla && !history) return null;

  const datedTests = newestMotTests(history?.tests ?? []).filter(test => motTestTime(test.completedDate) !== null);
  const latest = datedTests[0];
  const lastPass = datedTests.find(test => test.result === "PASSED" && expiryLabel(test.expiryDate));
  const recordedExpiry = expiryLabel(lastPass?.expiryDate);
  const firstDue = expiryLabel(firstMotDue(history ?? null));
  const dvlaExpiry = expiryLabel(dvla?.motExpiry);
  const { points } = buildMotMileageHistory(datedTests);
  const lastReading = points.at(-1);
  const lastTestMileage = lastReading ? Math.round(lastReading.miles) : null;
  const mileageMismatch = reportedMileage != null && lastTestMileage != null && reportedMileage < lastTestMileage;
  const convertedMileage = lastReading?.test.mileageUnit === "KM" && lastTestMileage != null
    ? mileageLabel(lastTestMileage) : null;
  const expiryMismatch = recordedExpiry && dvlaExpiry && recordedExpiry !== dvlaExpiry;
  const estimate = dvsa?.estimate;
  const plate = formatRegistrationPlate(result.registration);
  const title = [history?.make ?? dvla?.make, history?.model].filter(Boolean).join(" ");
  const taxStatus = dvla?.taxStatus;
  const vehicleMarkers = [dvla?.markedAsScrapped && "Marked as scrapped", dvla?.markedForExport && "Marked for export"].filter(Boolean);

  return (
    <section className="px-check-result" aria-label="Part-exchange result">
      <header className="px-check-vehicle">
        <strong className="px-check-name">{title || "Vehicle check"}</strong>
        <span className="px-check-plate">{plate}</span>
      </header>
      <dl className="px-check-facts">
        {lastReading && (
          <div>
            <dt>Last MOT reading</dt>
            <dd><strong>{motMileageLabel(lastReading.test)}</strong><small>{motDateLabel(lastReading.test.completedDate)} · DVSA</small></dd>
          </div>
        )}
        {(latest || firstDue || recordedExpiry || dvlaExpiry || dvla?.motStatus) && (
          <div>
            <dt>{latest ? "Latest MOT test" : firstDue ? "First MOT due" : "MOT record"}</dt>
            <dd>
              {latest ? <>
                <strong data-failed={latest.result === "FAILED" || undefined}>{latest.result === "FAILED" ? "Failed" : "Passed"}</strong>
                <small>{motDateLabel(latest.completedDate)} · DVSA</small>
              </> : firstDue ? <strong>{firstDue}</strong>
                : <strong>{dvla?.motStatus || dvlaExpiry}</strong>}
              {recordedExpiry ? <small>{lastPass !== latest ? "Expiry from earlier pass" : "MOT expiry"} {recordedExpiry}</small>
                : !firstDue && dvlaExpiry && <small>{latest || dvla?.motStatus ? `Expiry ${dvlaExpiry} · DVLA` : "Expiry · DVLA"}</small>}
              {!latest && !firstDue && dvla?.motStatus && !dvlaExpiry && <small>DVLA</small>}
            </dd>
          </div>
        )}
        {taxStatus && (
          <div>
            <dt>Tax status</dt>
            <dd><strong>{taxStatus}</strong><small>DVLA</small></dd>
          </div>
        )}
        {reportedMileage != null && (
          <div>
            <dt>Customer mileage</dt>
            <dd><strong>{mileageLabel(reportedMileage)}</strong></dd>
          </div>
        )}
      </dl>
      {history && !latest && !firstDue && <p className="px-check-note">DVSA returned no dated MOT tests.</p>}
      {mileageMismatch && (
        <div className="px-check-notice">
          <AlertCircle size={17} aria-hidden />
          <div>
            <strong>Confirm the current odometer reading</strong>
            <p>The customer’s mileage is lower than the last MOT reading{convertedMileage ? ` (about ${convertedMileage} after converting from km)` : ""}.</p>
            {onInsertText && (
              <Button type="button" size="sm" variant="outline" onClick={() => onInsertText(`Could you confirm the current odometer reading for your part exchange (${plate})? A photo of the dashboard mileage would be helpful.`)}>
                Add to reply draft
              </Button>
            )}
          </div>
        </div>
      )}
      {expiryMismatch && <p className="px-check-note">Confirm MOT expiry. DVSA recorded {recordedExpiry} and DVLA shows {dvlaExpiry}.</p>}
      {vehicleMarkers.length > 0 && <p className="px-check-note">{vehicleMarkers.join(" · ")} · DVLA</p>}
      {estimate && (
        <ResultDetails label="View mileage estimate">
          <p><strong>{mileageLabel(estimate.mileage)}</strong> estimated from MOT history and rounded to the nearest 1,000. Ask for the current odometer reading.</p>
          {onInsertText && !mileageMismatch && (
            <Button type="button" size="sm" variant="outline" onClick={() => onInsertText(`For your part exchange (${plate}), MOT history gives an estimated ${mileageLabel(estimate.mileage)}. Could you confirm the current odometer reading?`)}>
              Add mileage estimate to reply
            </Button>
          )}
        </ResultDetails>
      )}
      {history && (
        <ResultDetails label="View MOT history">
          <MotHistoryResults history={history} staff />
        </ResultDetails>
      )}
      {dvla && (
        <ResultDetails label="View vehicle details">
          <DvlaResult details={dvla} />
        </ResultDetails>
      )}
    </section>
  );
}

function Lookup({ registration, reportedMileage, reportedRegistration, onInsertText }: PartExchangeCheckProps) {
  const [result, setResult] = useState<LookupResult>();
  const valid = isUKNumberPlate(registration);
  const customerMileage = normalisePlate(reportedRegistration) === registration &&
    typeof reportedMileage === "number" && Number.isFinite(reportedMileage) && reportedMileage >= 0 ? reportedMileage : null;
  const lookup = useMutation({
    mutationFn: async (source: Source) => {
      const next = await customFetch<LookupResult>("/api/staff/part-exchange/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source === "both" ? { registration } : { registration, source }),
        responseType: "json",
      });
      if (next.registration !== registration) throw new Error("Registration does not match");
      return next;
    },
    onSuccess(next, source) {
      setResult(previous => source === "both" ? next : { ...previous, ...next });
    },
  });

  return (
    <div className="px-check">
      <Button type="button" size="sm" variant={result ? "outline" : "default"} disabled={!valid || lookup.isPending} onClick={() => lookup.mutate("both")}>
        <Search size={16} aria-hidden />
        {lookup.isPending && lookup.variables === "both" ? "Checking part exchange…" : result ? "Check again" : "Check part exchange"}
      </Button>
      {lookup.isPending && <span role="status" className="sr-only">Checking {lookup.variables === "both" ? "DVLA and DVSA" : lookup.variables?.toUpperCase()}</span>}
      {!result && customerMileage != null && <p className="px-check-note">Customer supplied {mileageLabel(customerMileage)}.</p>}
      {lookup.isError && <p className="px-check-note" role="alert">The check couldn’t finish. Try again.</p>}
      {result && <CombinedResult result={result} reportedMileage={customerMileage} onInsertText={onInsertText} />}
      {(["dvsa", "dvla"] as const).map(provider => {
        const failure = result?.[provider];
        return failure && failure.status !== "available" && (
          <ProviderIssue key={provider} provider={provider} failure={failure} pending={lookup.isPending} retry={lookup.mutate} />
        );
      })}
    </div>
  );
}

export function PartExchangeCheck(props: PartExchangeCheckProps) {
  const registration = normalisePlate(props.registration);
  return <Lookup {...props} key={registration} registration={registration} />;
}
