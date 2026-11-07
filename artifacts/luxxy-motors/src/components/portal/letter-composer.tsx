import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { customFetch, HttpApiError } from "@workspace/api-client-react";
import { ArrowLeft, CheckCircle2, Download, FileText, Mail, Printer } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDealerFeatures } from "@/lib/dealer-features";
import { requestUuid } from "@/lib/request-uuid";
import { usePopupDraftGuard } from "./popup-draft-guard";

type Letter = {
  recipientName: string;
  postalAddress: string;
  date: string;
  subject: string;
  body: string;
};

type LetterPreview = { pdfUrl: string; imageUrl: string; hash: string };
type PreviewResponse = { pdfBase64: string; previewSvg: string; previewHash: string };
type SendAttempt = { email: string; requestId: string; startedAt: number };
type LetterError = { error?: string; code?: string };

const letterDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});
const retryWindow = 23 * 60 * 60 * 1000;
const knownSendFailures = new Set(["LETTER_EMAIL_UNAVAILABLE", "LETTER_SEND_REJECTED", "LETTER_SEND_RETRY"]);

function apiError(cause: unknown) {
  return cause instanceof HttpApiError ? (cause as HttpApiError<LetterError>) : null;
}

export function LetterComposer({ canEmail, recipient, returnFocusRef, onClose }: {
  canEmail: boolean;
  recipient?: { name: string; email?: string | null };
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const id = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const pendingPreview = useRef<AbortController | null>(null);
  const attempt = useRef<SendAttempt | null>(null);
  const [letter, setLetter] = useState<Letter>(() => ({
    recipientName: recipient?.name ?? "",
    postalAddress: "",
    date: letterDate.format(new Date()),
    subject: "",
    body: "",
  }));
  const [email, setEmail] = useState(recipient?.email ?? "");
  const [preview, setPreview] = useState<LetterPreview>();
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [sendUncertain, setSendUncertain] = useState(false);
  const [sendBlocked, setSendBlocked] = useState(false);
  const features = useDealerFeatures();
  const emailAvailable = canEmail && features.enabled("customerEmails");
  const draftGuard = usePopupDraftGuard({
    dirty: (dirty || sendUncertain) && !sent,
    blocked: () => inFlight.current,
    onClose,
    discardTitle: sendUncertain ? "Close this letter?" : "Discard this letter?",
    discardDescription: sendUncertain
      ? "Email sending is unconfirmed. Check your email provider before sending another copy."
      : "Your letter will be lost.",
    discardLabel: sendUncertain ? "Close letter" : "Discard letter",
  });

  useEffect(() => () => {
    pendingPreview.current?.abort();
  }, []);
  useEffect(() => () => {
    if (preview) {
      URL.revokeObjectURL(preview.pdfUrl);
      URL.revokeObjectURL(preview.imageUrl);
    }
  }, [preview]);
  useEffect(() => {
    if (preview) title.current?.focus();
  }, [preview, sent]);

  function update(field: keyof Letter, value: string) {
    setLetter(current => ({ ...current, [field]: value }));
    setDirty(true);
    setError("");
  }

  async function createPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (![letter.recipientName, letter.subject, letter.body].every(value => value.trim())) {
      setError("Enter the recipient’s name, a subject and your letter.");
      return;
    }
    inFlight.current = true;
    const controller = new AbortController();
    pendingPreview.current = controller;
    setBusy("preview");
    setError("");
    try {
      const result = await customFetch<PreviewResponse>("/api/staff/letters/preview", {
        method: "POST",
        body: JSON.stringify(letter),
        responseType: "json",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!result?.pdfBase64 || !result.previewSvg || !/^[a-f0-9]{64}$/.test(result.previewHash)) {
        throw new Error("Invalid letter preview");
      }
      const bytes = Uint8Array.from(atob(result.pdfBase64), character => character.charCodeAt(0));
      const pdfUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const imageUrl = URL.createObjectURL(new Blob([result.previewSvg], { type: "image/svg+xml" }));
      setPreview({ pdfUrl, imageUrl, hash: result.previewHash });
      setSendBlocked(false);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(apiError(cause)?.data?.error ?? "The letter preview could not be opened. Try again.");
      }
    } finally {
      inFlight.current = false;
      pendingPreview.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  function editLetter() {
    setPreview(undefined);
    setError("");
    setSendBlocked(false);
    attempt.current = null;
    requestAnimationFrame(() => title.current?.focus());
  }

  async function sendLetter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || !emailAvailable || inFlight.current || sent || sendBlocked) return;
    const to = email.trim().toLowerCase();
    if (sendUncertain && attempt.current && Date.now() - attempt.current.startedAt >= retryWindow) {
      setSendBlocked(true);
      setError("The retry window has ended. Check your email provider before sending another copy.");
      return;
    }
    if (!attempt.current || attempt.current.email !== to) {
      try {
        attempt.current = { email: to, requestId: requestUuid(), startedAt: Date.now() };
      } catch {
        setError("This browser could not prepare the email. Open the portal in an up-to-date browser.");
        return;
      }
    }
    inFlight.current = true;
    setBusy("send");
    setError("");
    try {
      const result = await customFetch<{ providerId: string }>("/api/staff/letters/send", {
        method: "POST",
        body: JSON.stringify({
          ...letter, email: to, requestId: attempt.current.requestId, previewHash: preview.hash,
        }),
      });
      if (!result?.providerId) throw new Error("Unconfirmed letter send");
      setSendUncertain(false);
      setSent(true);
    } catch (cause) {
      const failure = apiError(cause);
      const changed = failure?.data?.code === "LETTER_PREVIEW_CHANGED";
      const knownFailure = knownSendFailures.has(failure?.data?.code ?? "");
      const uncertain = sendUncertain || !failure || (failure.status >= 500 && !knownFailure)
        || failure.data?.code === "LETTER_SEND_UNCONFIRMED";
      const requestUsed = failure?.data?.code === "LETTER_REQUEST_USED";
      setSendBlocked(changed || requestUsed);
      setSendUncertain(uncertain);
      setError(uncertain
        ? changed || requestUsed
          ? "Email sending is unconfirmed. Check your email provider before sending another copy."
          : "Email sending is unconfirmed. You can retry this same email without creating a new request."
        : changed
          ? "The letterhead has changed. Go back and make a new preview before emailing."
          : failure?.data?.error ?? "The letter could not be emailed. Check the address and try again.");
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const filename = `letter-${letter.date}.pdf`;
  return (
    <Dialog open onOpenChange={open => { if (!open) draftGuard.requestClose(); }}>
      <DialogContent
        className={preview ? "max-w-5xl gap-5" : "max-w-2xl gap-5"}
        closeDisabled={busy !== null}
        onCloseAutoFocus={event => {
          if (returnFocusRef?.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader>
          <DialogTitle ref={title}>{sent ? "Letter emailed" : preview ? "Review letter" : "Write a letter"}</DialogTitle>
          <DialogDescription>
            {sent ? "Your email provider accepted the letter."
              : preview ? "This A4 PDF is the copy you can print or email."
                : "Your dealership’s letterhead and footer are added automatically."}
          </DialogDescription>
        </DialogHeader>

        {preview ? (
          <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <figure className="hidden min-w-0 self-start rounded-md border border-border bg-muted p-3 md:block">
              <img className="mx-auto max-h-[min(540px,64dvh)] max-w-full rounded-sm border border-border bg-white object-contain"
                src={preview.imageUrl} alt="First page of the A4 letter" />
              <figcaption className="mt-2 text-center text-xs text-muted-foreground">First page · A4</figcaption>
            </figure>
            <div className="grid min-w-0 content-start gap-4">
              <div className="min-w-0 rounded-md border border-border p-4 [overflow-wrap:anywhere]">
                <p className="text-sm text-muted-foreground">Letter for {letter.recipientName}</p>
                <p className="mt-1 font-semibold text-foreground">{letter.subject}</p>
                {letter.postalAddress.trim() && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{letter.postalAddress}</p>}
              </div>
              <details className="rounded-md border border-border bg-muted md:hidden">
                <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">Preview first page</summary>
                <img className="mx-auto mb-3 w-[calc(100%-1.5rem)] rounded-sm border border-border bg-white"
                  src={preview.imageUrl} alt="First page of the A4 letter" />
              </details>
              <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
                <Button asChild size="sm" variant="outline">
                  <a href={preview.pdfUrl} target="_blank" rel="noreferrer">
                    <Printer size={17} aria-hidden /> Open / print PDF
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={preview.pdfUrl} download={filename}><Download size={17} aria-hidden /> Download PDF</a>
                </Button>
              </div>
              {sent ? (
                <p className="flex items-start gap-2 text-sm [overflow-wrap:anywhere]" role="status">
                  <CheckCircle2 size={18} className="shrink-0 text-primary" aria-hidden />
                  <span>Sent to <strong>{attempt.current?.email}</strong> as a PDF attachment.</span>
                </p>
              ) : emailAvailable ? (
                <form className="grid gap-3 border-t border-border pt-4" onSubmit={sendLetter}>
                  <label htmlFor={`${id}-email`} className="text-sm font-semibold">Recipient email</label>
                  <Input id={`${id}-email`} type="email" autoComplete="email" value={email} maxLength={254} required
                    readOnly={sendUncertain} disabled={busy !== null}
                    onChange={event => { setEmail(event.target.value); setError(""); setDirty(true); }} />
                  <p className="text-sm text-muted-foreground">The reviewed letter will be attached as a PDF.</p>
                  <Button type="submit" disabled={sendBlocked} status={busy === "send" ? "loading" : "idle"} loadingLabel="Sending letter…">
                    <span className="inline-flex items-center justify-center gap-2">
                      <Mail size={17} className="shrink-0" aria-hidden /> {sendUncertain ? "Retry same email" : "Email letter"}
                    </span>
                  </Button>
                </form>
              ) : (
                <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                  {canEmail && features.isLoading ? "Checking email access…"
                    : "Email sending is unavailable. You can print or download the letter."}
                </p>
              )}
              {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
            </div>
          </div>
        ) : (
          <form id={`${id}-form`} className="grid gap-4" onSubmit={createPreview}>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <div className="grid min-w-0 gap-1.5">
                <label htmlFor={`${id}-recipient`} className="text-sm font-semibold">Recipient name</label>
                <Input id={`${id}-recipient`} value={letter.recipientName} required maxLength={120} autoComplete="off"
                  disabled={busy !== null} onChange={event => update("recipientName", event.target.value)} />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <label htmlFor={`${id}-date`} className="text-sm font-semibold">Letter date</label>
                <Input id={`${id}-date`} className="min-w-0 max-w-full" type="date" value={letter.date} required
                  disabled={busy !== null} onChange={event => update("date", event.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-address`} className="text-sm font-semibold">Postal address <span className="font-normal text-muted-foreground">(optional)</span></label>
              <Textarea id={`${id}-address`} className="min-h-16" rows={2} value={letter.postalAddress} maxLength={500} autoComplete="off"
                disabled={busy !== null} onChange={event => update("postalAddress", event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-subject`} className="text-sm font-semibold">Subject</label>
              <Input id={`${id}-subject`} value={letter.subject} required maxLength={160}
                disabled={busy !== null} onChange={event => update("subject", event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-body`} className="text-sm font-semibold">Letter</label>
              <Textarea id={`${id}-body`} rows={7} value={letter.body} required maxLength={8000}
                disabled={busy !== null} onChange={event => update("body", event.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          </form>
        )}

        {draftGuard.discardPrompt}
        <DialogFooter>
          {preview ? (
            <>
              {!sent && !sendUncertain && <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={editLetter}>
                <ArrowLeft size={17} aria-hidden /> Back to letter
              </Button>}
              <Button type="button" size="sm" variant={sent ? "default" : "outline"} disabled={busy !== null} onClick={draftGuard.requestClose}>Done</Button>
            </>
          ) : (
            <>
              <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={draftGuard.requestClose}>Cancel</Button>
              <Button type="submit" size="sm" form={`${id}-form`} status={busy === "preview" ? "loading" : "idle"} loadingLabel="Preparing preview…">
                <span className="inline-flex items-center justify-center gap-2">
                  <FileText size={17} className="shrink-0" aria-hidden /> Preview A4
                </span>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
