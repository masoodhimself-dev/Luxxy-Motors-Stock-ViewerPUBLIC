import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import type { SaleWorkspaceRecord } from "@workspace/vehicle-meta";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  CreditCard,
  LoaderCircle,
  ShieldCheck,
  Truck,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { requestUuid } from "@/lib/request-uuid";
import "./sale-final-review.css";

type FinalReview = NonNullable<SaleWorkspaceRecord["finalReview"]>;
export type SaleFinalReviewProps = {
  sale: SaleWorkspaceRecord;
  onSaved: (sale: SaleWorkspaceRecord) => void;
  onNavigate?: (field: string) => void;
  /** Parent deal editor must save pending changes before reviewing the saved revision. */
  disabled?: boolean;
  /** Explicit payments.record permission; viewing a deal alone is insufficient. */
  canReview?: boolean;
};
const fieldLabels: Record<string, string> = {
  deal: "Deal",
  customer: "Customer",
  vehicle: "Vehicle",
  payments: "Payments",
  invoices: "Invoices",
  handover: "Collection and delivery",
};
const checks = [
  { label: "Totals and delivery charges", Icon: FileText },
  { label: "Confirmed payments and balance", Icon: CreditCard },
  { label: "Customer, car and documents", Icon: ShieldCheck },
  { label: "Collection or delivery details", Icon: Truck },
];
export function SaleFinalReview({
  sale,
  onSaved,
  onNavigate,
  disabled = false,
  canReview = false,
}: SaleFinalReviewProps) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [checked, setChecked] = useState<SaleWorkspaceRecord | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false),
    [overrideReason, setOverrideReason] = useState(""),
    [overrideConfirmed, setOverrideConfirmed] = useState(false),
    [overriding, setOverriding] = useState(false);
  const overrideAttempt = useRef<{
    saleId: string;
    revision: number;
    reason: string;
    requestId: string;
  } | null>(null);
  const latest = useRef(sale);
  latest.current = sale;
  const latestDisabled = useRef(disabled);
  latestDisabled.current = disabled;
  const inFlight = useRef(false),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setChecked(null);
    setError("");
    setBusy(false);
    inFlight.current = false;
    setOverrideOpen(false);
    setOverrideReason("");
    setOverrideConfirmed(false);
    setOverriding(false);
    overrideAttempt.current = null;
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [sale.id]);
  useEffect(() => {
    if (!canReview) {
      generation.current++;
      controller.current?.abort();
      inFlight.current = false;
      setBusy(false);
      setOverrideOpen(false);
      setOverriding(false);
    }
  }, [canReview]);
  const displayed =
    checked?.id === sale.id && checked.revision >= sale.revision
      ? checked
      : sale;
  const review = displayed.finalReview;
  const contextStale =
    displayed.finalReviewContextStale ||
    (sale.id === displayed.id &&
      sale.revision === displayed.revision &&
      sale.finalReview?.id === review?.id &&
      sale.finalReviewContextStale);
  const stale =
    !!review &&
    (review.reviewedRevision !== displayed.revision || !!contextStale);
  const unsaved = canReview && disabled;
  const passed = !stale && review?.status === "passed" && !unsaved && !error;
  const status = busy
    ? "checking"
    : stale || (unsaved && !!review)
      ? "stale"
      : error
        ? "unavailable"
        : (review?.status ?? "ready");
  const title = {
    checking: overriding
      ? "Saving staff override…"
      : "Please wait while AI checks the sale…",
    stale: "The sale has changed",
    passed: "Checks passed",
    overridden: "Staff override",
    attention: "Needs attention",
    unavailable: "Unable to check",
    ready: "Final checks",
  }[status];
  const summary = busy
    ? overriding
      ? "Recording your decision in the sale history."
      : "Checking totals, payments, documents and collection or delivery details."
    : status === "stale"
      ? unsaved
        ? "Save your changes, then run the final checks again."
        : contextStale
          ? "The delivery evidence, terms or vehicle details changed. Run the checks again before continuing."
          : "The previous check is for an earlier version. Run the checks again before continuing."
      : error
        ? "Your saved deal is kept. Retry the checks before continuing."
        : review?.summary ||
          "Check the saved deal before issuing the final invoice or completing handover.";
  async function run() {
    if (inFlight.current || disabled || !canReview) return;
    const requested = {
      id: displayed.id,
      revision: displayed.revision,
      baselineRevision: sale.revision,
    };
    const current = ++generation.current,
      requestController = new AbortController();
    controller.current = requestController;
    const timeout = window.setTimeout(() => requestController.abort(), 35_000);
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await customFetch<{
        sale: SaleWorkspaceRecord;
        review: FinalReview;
      }>(`/api/sale-operations/${requested.id}/final-review`, {
        method: "POST",
        signal: requestController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: requested.revision }),
      });
      if (current !== generation.current || latest.current.id !== requested.id)
        return;
      if (
        latest.current.revision !== requested.revision &&
        latest.current.revision !== requested.baselineRevision
      ) {
        setError(
          "The sale changed while the checks were running. Review the saved changes and run the checks again.",
        );
        return;
      }
      if (latestDisabled.current) {
        setError(
          "The deal has unsaved changes. Save them and run the checks again.",
        );
        return;
      }
      const savedReview = result.sale?.finalReview;
      if (
        result.sale?.id !== requested.id ||
        !Number.isSafeInteger(result.sale.revision) ||
        result.sale.revision < requested.revision ||
        !savedReview ||
        !Array.isArray(savedReview.issues) ||
        typeof savedReview.summary !== "string" ||
        savedReview.reviewedRevision !== result.sale.revision ||
        !["passed", "attention", "unavailable", "overridden"].includes(
          savedReview.status,
        ) ||
        savedReview.id !== result.review?.id
      )
        throw new Error("Invalid final check result");
      setChecked(result.sale);
      onSaved(result.sale);
    } catch (error) {
      if (current !== generation.current || latest.current.id !== requested.id)
        return;
      const message = (error as { data?: { error?: unknown } })?.data?.error;
      setError(
        typeof message === "string"
          ? message
          : "The final check could not be completed. Your saved deal is kept. Try again.",
      );
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  async function saveOverride(e: React.FormEvent) {
    e.preventDefault();
    const reason = overrideReason.trim();
    if (
      inFlight.current ||
      disabled ||
      !canReview ||
      !overrideConfirmed ||
      reason.length < 5
    )
      return;
    const requested = {
      id: displayed.id,
      revision: displayed.revision,
      baselineRevision: sale.revision,
    };
    if (
      !overrideAttempt.current ||
      overrideAttempt.current.saleId !== requested.id ||
      overrideAttempt.current.revision !== requested.revision ||
      overrideAttempt.current.reason !== reason
    )
      overrideAttempt.current = {
        saleId: requested.id,
        revision: requested.revision,
        reason,
        requestId: requestUuid(),
      };
    const attempt = overrideAttempt.current;
    const current = ++generation.current,
      requestController = new AbortController();
    controller.current = requestController;
    const timeout = window.setTimeout(() => requestController.abort(), 35_000);
    inFlight.current = true;
    setBusy(true);
    setOverriding(true);
    setError("");
    try {
      const result = await customFetch<{
        sale: SaleWorkspaceRecord;
        review: FinalReview;
      }>(`/api/sale-operations/${requested.id}/override-final-review`, {
        method: "POST",
        signal: requestController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: requested.revision,
          requestId: attempt.requestId,
          confirm: true,
          reason,
        }),
      });
      if (current !== generation.current || latest.current.id !== requested.id)
        return;
      if (
        latest.current.revision !== requested.revision &&
        latest.current.revision !== requested.baselineRevision
      ) {
        setError(
          "The sale changed while the override was saving. Review the saved changes before continuing.",
        );
        return;
      }
      if (latestDisabled.current) {
        setError(
          "The deal has unsaved changes. Save them before recording the override.",
        );
        return;
      }
      const savedReview = result.sale?.finalReview;
      if (
        result.sale?.id !== requested.id ||
        !Number.isSafeInteger(result.sale.revision) ||
        result.sale.revision < requested.revision ||
        savedReview?.status !== "overridden" ||
        savedReview.reviewedRevision !== result.sale.revision ||
        savedReview.id !== result.review?.id ||
        !savedReview.override?.actor ||
        !savedReview.override.reason
      )
        throw new Error("Invalid override result");
      setChecked(result.sale);
      onSaved(result.sale);
      setOverrideOpen(false);
      setOverrideConfirmed(false);
      overrideAttempt.current = null;
    } catch (cause) {
      if (current !== generation.current || latest.current.id !== requested.id)
        return;
      const message = (cause as { data?: { error?: unknown } })?.data?.error;
      setError(
        typeof message === "string"
          ? message
          : "The override could not be saved. Your deal is kept; retry the same request.",
      );
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) {
        inFlight.current = false;
        setBusy(false);
        setOverriding(false);
      }
    }
  }
  return (
    <section
      className={`sale-final-review sale-final-review--${status}`}
      aria-label="Final sale checks"
      aria-busy={busy}
    >
      <div className="sale-final-review-heading">
        <span className="sale-final-review-mark" aria-hidden="true">
          {busy ? (
            <LoaderCircle className="sale-final-review-loader" />
          ) : passed ? (
            <CheckCircle2 />
          ) : status === "attention" || status === "unavailable" ? (
            <AlertCircle />
          ) : (
            <ShieldCheck />
          )}
        </span>
        <div className="sale-final-review-copy">
          <h3 role="status" aria-live="polite">
            {title}
          </h3>
          <p>{summary}</p>
        </div>
        {canReview && (
          <Button
            type="button"
            variant={passed ? "outline" : "default"}
            disabled={busy || disabled}
            onClick={() => void run()}
          >
            {busy
              ? overriding
                ? "Saving…"
                : "Checking…"
              : passed
                ? "Check again"
                : review?.status === "unavailable" || error
                  ? "Retry checks"
                  : "Run final checks"}
          </Button>
        )}
      </div>
      <ul className="sale-final-review-checks" aria-label="What is checked">
        {checks.map(({ label, Icon }) => (
          <li key={label}>
            <Icon size={16} />
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {error && !overrideOpen && (
        <p className="sale-final-review-error" role="alert">
          {error}
        </p>
      )}
      {canReview && !busy && status !== "passed" && status !== "overridden" && (
        <div className="sale-final-review-override-action">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setOverrideOpen(true);
              setError("");
            }}
          >
            {status === "ready" ? "Skip AI check" : "Continue without AI"}
          </Button>
          <p>Your name and reason will be recorded.</p>
        </div>
      )}
      {!busy && status === "overridden" && review?.override && (
        <p className="sale-final-review-override-record">
          Recorded by {review.override.actor}: {review.override.reason}
        </p>
      )}
      {!busy && status === "overridden" && review?.override?.ignoredReview && (
        <details className="sale-final-review-ignored">
          <summary>AI advice overridden</summary>
          <p>{review.override.ignoredReview.summary}</p>
          <ul>
            {review.override.ignoredReview.issues.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </details>
      )}
      {!busy && status !== "stale" && review && !!review.issues.length && (
        <ul className="sale-final-review-issues" aria-label="Check results">
          {review.issues.map((issue, index) => (
            <li
              key={`${issue.field}-${index}`}
              className={`sale-final-review-issue--${issue.severity}`}
            >
              <span className="sale-final-review-issue-label">
                {status === "overridden"
                  ? "Staff reviewed this issue"
                  : issue.severity === "error"
                    ? "Fix before continuing"
                    : "Please check"}
              </span>
              <p>{issue.message}</p>
              {onNavigate && (
                <button type="button" onClick={() => onNavigate(issue.field)}>
                  Open {fieldLabels[issue.field] ?? "deal"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!busy && canReview && disabled && !review && (
        <p className="sale-final-review-help">
          Save the deal before running the final checks.
        </p>
      )}
      {!canReview && (
        <p className="sale-final-review-help">
          You can view these results. A staff member with payment permissions
          must run the checks or record an override.
        </p>
      )}
      {!busy && status !== "stale" && review && (
        <p className="sale-final-review-help">
          Checked{" "}
          {new Date(review.checkedAt).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {review.status === "passed"
            ? ". New changes will need another check."
            : "."}
        </p>
      )}
      <Dialog
        open={overrideOpen && canReview}
        onOpenChange={(open) => {
          if (!busy) setOverrideOpen(open);
        }}
      >
        <DialogContent closeDisabled={overriding}>
          <DialogHeader>
            <DialogTitle>Continue without AI review?</DialogTitle>
            <DialogDescription>
              Record why you are continuing. Totals, payments and required
              details must still pass the system checks.
            </DialogDescription>
          </DialogHeader>
          <form
            className="sale-final-review-override-form"
            onSubmit={saveOverride}
          >
            <label>
              Reason for override
              <textarea
                value={overrideReason}
                required
                minLength={5}
                maxLength={1000}
                disabled={busy}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            </label>
            <label className="sale-final-review-override-confirm">
              <input
                type="checkbox"
                required
                checked={overrideConfirmed}
                disabled={busy}
                onChange={(e) => setOverrideConfirmed(e.target.checked)}
              />
              I have reviewed this sale and want to continue without the AI
              review.
            </label>
            {error && (
              <p className="sale-final-review-error" role="alert">
                {error}
              </p>
            )}
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOverrideOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  disabled ||
                  !overrideConfirmed ||
                  overrideReason.trim().length < 5
                }
              >
                {overriding ? "Saving override…" : "Record staff override"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
