import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { customFetch, HttpApiError } from "@workspace/api-client-react";
import { ArrowLeft, CheckCircle2, Mail, Send } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDealerFeatures } from "@/lib/dealer-features";
import { requestUuid } from "@/lib/request-uuid";
import { CustomerEmailPreview } from "./customer-email-preview";
import { usePopupDraftGuard } from "./popup-draft-guard";

type EmailDraft = { email: string; subject: string; body: string };
type EmailPreview = { email: string; subject: string; html: string; text: string; previewHash: string };
type SendAttempt = { requestId: string; startedAt: number };
type EmailError = { error?: string; code?: string };
const retryWindow = 23 * 60 * 60 * 1000;
const knownFailures = new Set(["EMAIL_SEND_RETRY", "EMAIL_SEND_REJECTED", "EMAIL_UNAVAILABLE"]);

function apiError(cause: unknown) {
  return cause instanceof HttpApiError ? (cause as HttpApiError<EmailError>) : null;
}

export function DirectEmailComposer({ returnFocusRef, onClose }: {
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const id = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const previewRequest = useRef<AbortController | null>(null);
  const attempt = useRef<SendAttempt | null>(null);
  const [draft, setDraft] = useState<EmailDraft>({ email: "", subject: "", body: "" });
  const [review, setReview] = useState<{ draft: EmailDraft; preview: EmailPreview }>();
  const [busy, setBusy] = useState<"review" | "send" | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [sendBlocked, setSendBlocked] = useState(false);
  const features = useDealerFeatures();
  const emailAvailable = features.enabled("customerEmails");
  const guard = usePopupDraftGuard({
    dirty: !sent && (uncertain || Boolean(draft.email || draft.subject || draft.body)),
    blocked: () => inFlight.current,
    onClose,
    discardTitle: uncertain ? "Close this email?" : "Discard this email?",
    discardDescription: uncertain
      ? "Email sending is unconfirmed. Check your email provider before sending another copy."
      : "Your message will be lost.",
    discardLabel: uncertain ? "Close email" : "Discard email",
  });

  useEffect(() => () => previewRequest.current?.abort(), []);
  useEffect(() => {
    if (review) title.current?.focus();
  }, [review, sent]);

  function update(field: keyof EmailDraft, value: string) {
    setDraft(current => ({ ...current, [field]: value }));
    setError("");
  }

  async function reviewEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const input = {
      email: draft.email.trim().toLowerCase(),
      subject: draft.subject.trim(),
      body: draft.body.trim(),
    };
    if (!input.email || !input.subject || !input.body) {
      setError("Enter an email address, a subject and your message.");
      return;
    }
    const controller = new AbortController();
    previewRequest.current = controller;
    inFlight.current = true;
    setBusy("review");
    setError("");
    try {
      const preview = await customFetch<EmailPreview>("/api/staff/email/compose/preview", {
        method: "POST",
        body: JSON.stringify(input),
        responseType: "json",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!preview?.email || !preview.subject || typeof preview.text !== "string" || !/^[a-f0-9]{64}$/.test(preview.previewHash)) {
        throw new Error("Invalid email preview");
      }
      setReview({ draft: input, preview });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(apiError(cause)?.data?.error ?? "Could not open the email preview. Try again.");
      }
    } finally {
      inFlight.current = false;
      previewRequest.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  function editEmail() {
    setReview(undefined);
    setError("");
    setSendBlocked(false);
    attempt.current = null;
    requestAnimationFrame(() => title.current?.focus());
  }

  async function sendEmail() {
    if (!review || !emailAvailable || inFlight.current || sent || sendBlocked) return;
    if (uncertain && attempt.current && Date.now() - attempt.current.startedAt >= retryWindow) {
      setSendBlocked(true);
      setError("The retry window has ended. Check your email provider before sending another copy.");
      return;
    }
    try {
      attempt.current ??= { requestId: requestUuid(), startedAt: Date.now() };
    } catch {
      setError("This browser could not prepare the email. Open the portal in an up-to-date browser.");
      return;
    }
    inFlight.current = true;
    setBusy("send");
    setError("");
    try {
      const result = await customFetch<{ providerId: string }>("/api/staff/email/compose/send", {
        method: "POST",
        body: JSON.stringify({
          ...review.draft,
          previewHash: review.preview.previewHash,
          requestId: attempt.current.requestId,
        }),
        responseType: "json",
      });
      if (!result?.providerId) throw new Error("Unconfirmed email send");
      setUncertain(false);
      setSent(true);
    } catch (cause) {
      const failure = apiError(cause);
      const code = failure?.data?.code ?? "";
      const changed = code === "EMAIL_PREVIEW_CHANGED";
      const requestUsed = code === "EMAIL_REQUEST_USED";
      const unconfirmed = uncertain || !failure || (failure.status >= 500 && !knownFailures.has(code))
        || code === "EMAIL_SEND_UNCONFIRMED";
      setSendBlocked(changed || requestUsed);
      setUncertain(unconfirmed);
      if (unconfirmed) {
        setError(changed || requestUsed
          ? "Email sending is unconfirmed. Check your email provider before sending another copy."
          : "Email sending is unconfirmed. You can retry the same email.");
      } else {
        setError(changed
          ? "The email design has changed. Go back and review the email again."
          : failure?.data?.error ?? "The email could not be sent. Try again.");
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) guard.requestClose(); }}>
      <DialogContent
        className={`flex flex-col gap-5 overflow-hidden ${review && !sent ? "max-w-3xl" : "max-w-2xl"}`}
        closeDisabled={busy !== null}
        onCloseAutoFocus={event => {
          if (returnFocusRef?.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus({ preventScroll: true });
          }
        }}>
        <DialogHeader className="shrink-0">
          <DialogTitle ref={title}>{sent ? "Email sent" : review ? "Review email" : "Write an email"}</DialogTitle>
          <DialogDescription>
            {sent ? "Your email provider accepted the message."
              : review ? "Check the address and message before sending."
                : "Send a message from your dealership’s email account."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 min-w-0 space-y-4 overflow-y-auto px-1 py-1">
          {sent && review ? (
            <p role="status" className="flex items-start gap-2 text-sm [overflow-wrap:anywhere]">
              <CheckCircle2 size={18} className="shrink-0 text-primary" aria-hidden />
              <span>Sent to <strong>{review.preview.email}</strong>.</span>
            </p>
          ) : review ? (
            <div className="grid min-w-0 gap-4">
              <dl className="grid gap-x-4 gap-y-1 rounded-md border border-border px-4 py-3 text-sm [overflow-wrap:anywhere] sm:grid-cols-[auto_minmax(0,1fr)]">
                <dt className="text-muted-foreground">To</dt><dd className="font-medium">{review.preview.email}</dd>
                <dt className="text-muted-foreground">Subject</dt><dd className="font-medium">{review.preview.subject}</dd>
              </dl>
              <CustomerEmailPreview html={review.preview.html} text={review.preview.text} />
              {!emailAvailable && <p role="status" className="text-sm text-muted-foreground">
                {features.isLoading ? "Checking email access…" : "Email sending is unavailable for this dealership."}
              </p>}
            </div>
          ) : (
            <form id={`${id}-form`} className="grid gap-4" onSubmit={reviewEmail}>
              <div className="grid gap-1.5">
                <label htmlFor={`${id}-email`} className="text-sm font-semibold">Recipient email</label>
                <Input id={`${id}-email`} type="email" autoComplete="off" value={draft.email} maxLength={254} required
                  disabled={busy !== null} onChange={event => update("email", event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor={`${id}-subject`} className="text-sm font-semibold">Subject</label>
                <Input id={`${id}-subject`} value={draft.subject} maxLength={200} required
                  disabled={busy !== null} onChange={event => update("subject", event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor={`${id}-body`} className="text-sm font-semibold">Message</label>
                <Textarea id={`${id}-body`} rows={7} value={draft.body} maxLength={12000} required
                  disabled={busy !== null} onChange={event => update("body", event.target.value)} />
              </div>
            </form>
          )}
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          {guard.discardPrompt}
        </div>
        <DialogFooter className="shrink-0">
          {sent ? (
            <Button type="button" size="sm" onClick={guard.requestClose}>Done</Button>
          ) : review ? (
            <>
              {uncertain
                ? <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={guard.requestClose}>Close</Button>
                : <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={editEmail}>
                  <ArrowLeft size={17} aria-hidden /> Edit email
                </Button>}
              <Button type="button" size="sm" disabled={!emailAvailable || sendBlocked} onClick={() => void sendEmail()}
                status={busy === "send" ? "loading" : "idle"} loadingLabel="Sending email…">
                <span className="inline-flex items-center justify-center gap-2">
                  <Send size={17} className="shrink-0" aria-hidden /> {uncertain ? "Retry same email" : "Send email"}
                </span>
              </Button>
            </>
          ) : (
            <>
              <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={guard.requestClose}>Cancel</Button>
              <Button type="submit" size="sm" form={`${id}-form`}
                status={busy === "review" ? "loading" : "idle"} loadingLabel="Preparing preview…">
                <span className="inline-flex items-center justify-center gap-2">
                  <Mail size={17} className="shrink-0" aria-hidden /> Review email
                </span>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
