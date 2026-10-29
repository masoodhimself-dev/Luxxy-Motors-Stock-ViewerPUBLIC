import { useEffect, useRef, useState, type RefObject } from "react";
import { customFetch } from "@workspace/api-client-react";
import { firstMotDue } from "@/lib/long-mot";
import type { MotHistory } from "@workspace/vehicle-meta";
import { Button } from "./ui/button";
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
const date = (value: string) =>
  new Date(value.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
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
  const ordered = [...history.tests].sort((a, b) => Date.parse(b.completedDate) - Date.parse(a.completedDate));
  const latest = ordered[0];
  const visibleTests = staff ? ordered : ordered.filter(test => test.result === "PASSED");
  // An older pass must never imply a current pass after a more recent failure.
  const pass = staff ? ordered.find(test => test.result === "PASSED") : latest?.result === "PASSED" ? latest : undefined;
  return (
    <div className="min-w-0 space-y-4" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {history.registration} ·{" "}
            {[history.make, history.model].filter(Boolean).join(" ")}
          </p>
          <p className="text-xs text-muted-foreground">
            DVSA MOT history · Checked {date(history.checkedAt)}
          </p>
        </div>
        {latest && (staff || latest.result === "PASSED") && (
          <span
            className={`rounded-md border px-3 py-2 text-sm font-semibold ${latest.result === "FAILED" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}
          >
            Latest test: {latest.result === "PASSED" ? "Passed" : "Failed"}
          </span>
        )}
      </div>
      {pass?.expiryDate && (
        <p className="text-sm">
          Last passed MOT expiry: {date(pass.expiryDate)}
        </p>
      )}
      {history.recall === "Yes" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          An outstanding safety recall is recorded. Ask the dealership for
          details.
        </p>
      )}
      {firstDue && (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          First MOT due: {date(firstDue)}. No MOT required before this date,
          according to the recorded first-MOT due date.
        </p>
      )}
      {!latest && !firstDue && (
        <p className="text-sm text-muted-foreground">
          No MOT tests were returned. This does not confirm exemption or that an
          MOT is not due.
        </p>
      )}
      {!staff && latest?.result === "FAILED" && <p className="text-sm text-muted-foreground">Please ask the dealership to confirm the current MOT details.</p>}
      {!staff && visibleTests.length > 0 && <h3 className="text-sm font-semibold">Passed MOT tests</h3>}
      {visibleTests.map((test, index) => (
        <details
          key={`${test.completedDate}-${index}`}
          open={index === 0}
          className="rounded-md border border-border p-3"
        >
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
            {date(test.completedDate)} ·{" "}
            {test.result === "PASSED" ? "Passed" : "Failed"}
            {test.mileage && test.mileageUnit
              ? ` · ${Number(test.mileage).toLocaleString("en-GB")} ${test.mileageUnit === "MI" ? "miles" : "km"}`
              : ""}
          </summary>
          {test.expiryDate && (
            <p className="mb-2 text-xs text-muted-foreground">
              Recorded expiry: {date(test.expiryDate)}
            </p>
          )}
          {(!test.mileage || !test.mileageUnit) && (
            <p className="mb-2 text-xs text-muted-foreground">
              Mileage reading not available for this test.
            </p>
          )}
          {test.defects.length ? (
            <details open={staff || undefined} className="mt-2 border-t border-border">
              <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{staff ? "Defect details" : "Advisories & notes"} ({test.defects.length})</summary>
            <ul className="space-y-2 pb-3 text-sm">
              {test.defects.map((defect, i) => (
                <li key={i} className="break-words">
                  <span
                    className={`mr-2 inline-block rounded px-2 py-1 text-xs font-semibold ${defect.dangerous || ["DANGEROUS", "MAJOR", "FAIL"].includes(defect.type.toUpperCase()) ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-950"}`}
                  >
                    {defect.dangerous
                      ? "Dangerous"
                      : defect.type
                          .toLowerCase()
                          .replace(/^./, (s) => s.toUpperCase())}
                  </span>
                  {defect.text}
                </li>
              ))}
            </ul>
            </details>
          ) : (
            <p className="text-sm text-muted-foreground">
              No defect details were supplied for this test.
            </p>
          )}
        </details>
      ))}
      <p className="text-xs leading-5 text-muted-foreground">
        MOT records describe the vehicle at the time of each test. Older
        advisories may have been repaired. This is not a service, finance or
        insurance-history check. Recorded test mileage does not replace the
        advertised mileage.
      </p>
      <a
        href="https://www.gov.uk/check-mot-history"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center text-sm underline"
      >
        View full MOT history on GOV.UK
      </a>
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
          See recorded MOT results, mileage and advisory notices.
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
        className="portal-action-dialog max-w-2xl"
        onCloseAutoFocus={(event) => {
          // Safari does not focus buttons on tap; return explicitly to the opener
          // instead of refocusing the allowance field and reopening its keyboard.
          if (returnFocusRef?.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Check MOT history</DialogTitle>
          <DialogDescription>
            Check a stock car or part exchange. This does not change the
            invoice, allowance, customer or vehicle records.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(
              `/api/staff/mot-history?registration=${encodeURIComponent(registration.trim())}`,
            );
          }}
          className="space-y-3"
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
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {reply?.status === "available" && (
          <MotHistoryResults history={reply.history} staff />
        )}
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
