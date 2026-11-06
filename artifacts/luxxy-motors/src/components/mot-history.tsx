import { useEffect, useRef, useState, type RefObject } from "react";
import { customFetch } from "@workspace/api-client-react";
import { firstMotDue } from "@/lib/long-mot";
import type { MotHistory } from "@workspace/vehicle-meta";
import { Button } from "./ui/button";
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, CircleAlert } from "./icons";
import { MotMileageChart } from "./mot-mileage-chart";
import { motDateLabel, motMileageLabel, motTestTime, newestMotTests } from "@/lib/mot-mileage-history";
import "./staff-mot-popup.css";
import "./mot-history.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
type Reply =
  | { status: "available"; history: MotHistory }
  | { status: "registration_missing"; message: string };
const date = motDateLabel;
function errorText(cause: unknown) {
  const code = (cause as { data?: { code?: string } })?.data?.code;
  return code === "invalid_registration"
    ? "Enter a complete UK registration number."
    : code === "not_found"
      ? "No MOT history was found. Check the registration; this does not confirm exemption."
      : code === "not_configured"
        ? "MOT history is not connected yet. Please ask the dealership."
        : "MOT history is temporarily unavailable. Please try again later or use GOV.UK.";
}
export function MotHistoryResults({ history, staff = false }: { history: MotHistory; staff?: boolean }) {
  const firstDue = firstMotDue(history);
  const ordered = newestMotTests(history.tests);
  const latest = ordered.find(test => motTestTime(test.completedDate) !== null);
  // A previous pass is part of the history, never the current headline after a failure.
  const expiry = latest?.result === "PASSED" && latest.expiryDate && motTestTime(latest.expiryDate) !== null ? latest.expiryDate : null;
  return (
    <div className="mot-history-results" data-staff={staff}>
      <header className="mot-record-header">
        <div>
          <p className="mot-record-car">{[history.make, history.model].filter(Boolean).join(" ") || history.registration}</p>
          <p className="mot-record-source">{[history.make, history.model].some(Boolean) && <strong>{history.registration}</strong>}
            DVSA MOT history · Checked {date(history.checkedAt)}
          </p>
        </div>
        {latest && <span className="mot-latest-result" data-result={latest.result}>
          {latest.result === 'PASSED' ? <Check size={16} /> : <CircleAlert size={16} />}
          Latest test: {latest.result === "PASSED" ? "Passed" : "Failed"}
        </span>}
      </header>
      {expiry && <p className="mot-record-expiry"><span>MOT expiry</span><strong>{date(expiry)}</strong></p>}
      {staff && history.recall === "Yes" && (
        <p className="mot-record-warning"><AlertTriangle size={18} /><span>An outstanding safety recall is recorded. Ask the dealership for details.</span></p>
      )}
      {firstDue && (
        <p className="mot-record-expiry"><span>First MOT due</span><strong>{date(firstDue)}</strong></p>
      )}
      {!latest && !firstDue && (
        <p className="mot-record-note">
          {ordered.length ? 'No dated MOT tests were returned.' : 'No MOT tests were returned.'} This does not confirm exemption or that an
          MOT is not due.
        </p>
      )}
      {latest?.result === "FAILED" && <p className="mot-record-warning"><CircleAlert size={18} /><span>The latest recorded test failed. Please ask the dealership to confirm the current MOT details.</span></p>}
      <MotMileageChart tests={history.tests} />
      {ordered.length > 0 && <section className="mot-test-history" aria-label="MOT tests">
      <div className="mot-test-history-heading"><h3>MOT tests</h3><span>Newest first</span></div>
      {ordered.map((test, index) => staff ? (
        <details
          key={`${test.completedDate}-${index}`}
          open={index === 0}
          className="mot-test-row"
          data-result={test.result}
        >
          <summary className="mot-test-summary">
            <span className="mot-test-date">{date(test.completedDate)}<small>{test.defects.length ? `${test.defects.length} ${test.defects.length === 1 ? 'note' : 'notes'}` : 'No defects listed'}</small></span>
            <span className="mot-test-result">{test.result === 'PASSED' ? <Check size={15} /> : <CircleAlert size={15} />}{test.result === "PASSED" ? "Passed" : "Failed"}</span>
            <span className="mot-test-mileage">{motMileageLabel(test)}</span>
            <ChevronDown className="mot-test-chevron" size={17} />
          </summary>
          <div className="mot-test-details">
          {test.expiryDate && motTestTime(test.expiryDate) !== null && <p className="mot-test-expiry">Recorded expiry: {date(test.expiryDate)}</p>}
          {test.defects.length ? (
            <ul className="mot-defect-list" aria-label="Defects and advisories">
              {test.defects.map((defect, i) => (
                <li key={i} data-severe={defect.dangerous || ["DANGEROUS", "MAJOR", "FAIL"].includes(defect.type.toUpperCase())}>
                  <span className="mot-defect-type">{defect.dangerous ? "Dangerous" : defect.type.toLowerCase().replace(/^./, (s) => s.toUpperCase()) || 'Note'}</span>
                  <span>{defect.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mot-record-note">No defect details were supplied for this test.</p>
          )}
          </div>
        </details>
      ) : <div key={`${test.completedDate}-${index}`} className="mot-test-row mot-test-row-public" data-result={test.result}>
        <div className="mot-test-summary">
          <span className="mot-test-date">{date(test.completedDate)}</span>
          <span className="mot-test-result">{test.result === 'PASSED' ? <Check size={15} /> : <CircleAlert size={15} />}{test.result === 'PASSED' ? 'Passed' : 'Failed'}</span>
          <span className="mot-test-mileage">{motMileageLabel(test)}</span>
        </div>
      </div>)}
      </section>}
      <footer className="mot-record-footer">
      <p>MOT records show the car at each test.{staff && ' Earlier issues may have been repaired.'} These are recorded test mileages, not the car’s current mileage. This is not a service, finance or insurance-history check.</p>
      <a
        href="https://www.gov.uk/check-mot-history"
        target="_blank"
        rel="noopener noreferrer"
      >
        View full MOT history on GOV.UK<ArrowUpRight size={16} />
      </a>
      </footer>
    </div>
  );
}
function useMotRequest(identity: string) {
  const [busy, setBusy] = useState(false),
    [reply, setReply] = useState<Reply | null>(null),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    request.current?.abort();
    setBusy(false);
    setReply(null);
    setError("");
    return () => request.current?.abort();
  }, [identity]);
  async function load(url: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setReply(null);
    try {
      const result = await customFetch<Reply>(url, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setReply(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return { busy, reply, error, load };
}
export function MotHistoryPanel({
  vehicleId,
  staff = false,
  autoLoad = false,
  onHistory,
}: {
  vehicleId: string;
  staff?: boolean;
  autoLoad?: boolean;
  onHistory?: (history: MotHistory) => void;
}) {
  const { busy, reply, error, load } = useMotRequest(`${staff}:${vehicleId}`);
  useEffect(() => {
    if (autoLoad)
      void load(
        `/api/${staff ? "staff/" : ""}vehicles/${encodeURIComponent(vehicleId)}/mot-history`,
      );
  }, [vehicleId, staff, autoLoad]);
  useEffect(() => {
    if (reply?.status === "available") onHistory?.(reply.history);
  }, [reply, onHistory]);
  return (
    <section
      aria-label="MOT history"
      className={autoLoad ? "min-w-0" : "min-w-0 border-t border-border py-6"}
    >
      {!autoLoad && <h2 className="section-heading mb-3">MOT history</h2>}
      {!autoLoad && (
        <p className="mb-3 text-sm text-muted-foreground">
          {staff ? 'See recorded MOT results, mileage and advisory notices.' : 'Recorded mileage and MOT test results.'}
        </p>
      )}
      {!reply && (
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            void load(
              `/api/${staff ? "staff/" : ""}vehicles/${encodeURIComponent(vehicleId)}/mot-history`,
            )
          }
        >
          {busy ? "Checking MOT history…" : "View MOT history"}
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {reply?.status === "registration_missing" && (
        <p className="text-sm text-muted-foreground">{reply.message}</p>
      )}
      {reply?.status === "available" && (
        <MotHistoryResults history={reply.history} staff={staff} />
      )}
    </section>
  );
}
export function StaffMotLookupDialog({
  onClose,
  initialRegistration = "",
  returnFocusRef,
}: {
  onClose: () => void;
  initialRegistration?: string;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [registration, setRegistration] = useState(initialRegistration);
  const { busy, reply, error, load } = useMotRequest(registration);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="portal-action-dialog staff-mot-dialog"
        onCloseAutoFocus={(event) => {
          // Safari does not focus buttons on tap; return explicitly to the opener
          // instead of refocusing the allowance field and reopening its keyboard.
          if (returnFocusRef?.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader className="staff-mot-heading">
          <DialogTitle>Check MOT history</DialogTitle>
          <DialogDescription>
            Check a stock car or part exchange by registration.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(
              `/api/staff/mot-history?registration=${encodeURIComponent(registration.trim())}`,
            );
          }}
          className="staff-mot-search"
        >
          <label className="block text-sm font-medium">
            Registration number
            <input
              value={registration}
              onChange={(e) => setRegistration(e.target.value.toUpperCase())}
              maxLength={20}
              autoCapitalize="characters"
              autoComplete="off"
              className="mt-2 block min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground"
              placeholder="AB12 CDE"
            />
          </label>
          <Button type="submit" disabled={busy || !registration.trim()}>
            {busy ? "Checking MOT history…" : "Check MOT"}
          </Button>
        </form>
        <div className="staff-mot-results">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {reply?.status === "registration_missing" && <p role="status">{reply.message}</p>}
        {reply?.status === "available" && (
          <MotHistoryResults history={reply.history} staff />
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function PartExchangeMotCheck({
  registration,
}: {
  registration: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        className="w-full"
        aria-label="Check part-exchange MOT"
        disabled={!registration.trim()}
        onClick={() => setOpen(true)}
      >
        Check MOT
      </Button>
      {open && (
        <StaffMotLookupDialog
          returnFocusRef={trigger}
          initialRegistration={registration}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
