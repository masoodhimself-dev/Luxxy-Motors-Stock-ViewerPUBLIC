import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { FilePenLine, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestUuid } from "@/lib/request-uuid";
import "./ai-draft-suggestion.css";

export type AiDraftSuggestionValue = {
  generationId: string;
  subject: string;
  message: string;
  warnings: string[];
};
type AiDraftConfig = {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  model: string;
  dailyLimit: number;
  monthlyLimit: number;
  dailyUsed: number;
  monthlyUsed: number;
};
type GenerationRequest = {
  requestId: string;
  expectedRevision: number;
  expectedVersion: number;
};

function generationError(cause: unknown) {
  const error = cause as { data?: { error?: unknown } } | null;
  return typeof error?.data?.error === "string"
    ? error.data.error
    : "We couldn’t prepare an AI draft. Your message is unchanged. Try again or use a template.";
}

/** Generating is an explicit request; using, saving and sending are separate actions. */
export function AiDraftSuggestion({
  enquiryId,
  expectedRevision,
  expectedVersion,
  draftFingerprint,
  disabled = false,
  onUse,
  onBusyChange,
}: {
  enquiryId: string;
  expectedRevision: number;
  expectedVersion: number;
  draftFingerprint: string;
  disabled?: boolean;
  onUse: (suggestion: AiDraftSuggestionValue) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const cache = useQueryClient();
  const config = useQuery({
    queryKey: ["staff-ai-drafts-config", enquiryId],
    queryFn: () => customFetch<AiDraftConfig>("/api/staff/ai-drafts/config"),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const [disclosure, setDisclosure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState<AiDraftSuggestionValue | null>(
    null,
  );
  const [originalFingerprint, setOriginalFingerprint] = useState("");
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const suggestionHeading = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const request = useRef<GenerationRequest | null>(null);
  const contextKey = `${enquiryId}:${expectedRevision}:${expectedVersion}`;
  const latestContext = useRef(contextKey);
  latestContext.current = contextKey;
  const alive = useRef(true);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      busyCallback.current?.(false);
    };
  }, []);
  useEffect(() => {
    request.current = null;
    setSuggestion(null);
    setDisclosure(false);
    setConfirmReplacement(false);
    setError("");
  }, [contextKey]);
  useEffect(() => {
    if (suggestion) suggestionHeading.current?.focus({ preventScroll: true });
  }, [suggestion]);

  const settings = config.data;
  const exhausted = Boolean(
    settings &&
    (settings.dailyUsed >= settings.dailyLimit ||
      settings.monthlyUsed >= settings.monthlyLimit),
  );
  const available = Boolean(
    settings?.enabled && settings.available && !exhausted,
  );
  const unavailable = config.isError
    ? "AI availability could not be checked. You can still write a reply or use a template."
    : settings?.reason ||
      (exhausted
        ? "The AI draft allowance has been reached. You can still write a reply or use a template."
        : "AI drafts are not enabled for this dealership. You can still write a reply or use a template.");

  async function generate() {
    // A lost response may have consumed the final allowance. Its same-ID retry
    // retrieves that request; it must not require another unused allowance.
    if (inFlight.current || disabled || (!available && !request.current))
      return;
    inFlight.current = true;
    setBusy(true);
    busyCallback.current?.(true);
    setError("");
    setConfirmReplacement(false);
    const startingContext = contextKey;
    const startingFingerprint = draftFingerprint;
    request.current ??= {
      requestId: requestUuid(),
      expectedRevision,
      expectedVersion,
    };
    try {
      const result = await customFetch<AiDraftSuggestionValue>(
        `/api/staff/enquiries/${encodeURIComponent(enquiryId)}/ai-draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.current),
        },
      );
      if (!alive.current || latestContext.current !== startingContext) return;
      if (
        !result ||
        typeof result.generationId !== "string" ||
        typeof result.subject !== "string" ||
        typeof result.message !== "string" ||
        !Array.isArray(result.warnings) ||
        !result.warnings.every((warning) => typeof warning === "string") ||
        result.subject.length > 200 ||
        result.message.length > 12000
      ) {
        throw new Error("Invalid AI draft response");
      }
      setSuggestion(result);
      setOriginalFingerprint(startingFingerprint);
      setDisclosure(false);
      request.current = null;
    } catch (cause) {
      if (alive.current && latestContext.current === startingContext)
        setError(generationError(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setBusy(false);
        busyCallback.current?.(false);
      }
      void cache.invalidateQueries({ queryKey: ["staff-ai-drafts-config"] });
    }
  }
  function accept() {
    if (!suggestion || disabled || busy) return;
    if (draftFingerprint !== originalFingerprint && !confirmReplacement) {
      setConfirmReplacement(true);
      return;
    }
    onUse(suggestion);
    setSuggestion(null);
    setConfirmReplacement(false);
  }
  function discard() {
    setSuggestion(null);
    setConfirmReplacement(false);
    setError("");
    request.current = null;
  }

  return (
    <section
      className="ai-draft-assistant"
      aria-label="AI reply assistant"
      aria-busy={busy}
    >
      <div className="ai-draft-heading">
        <div>
          <FilePenLine size={18} aria-hidden="true" />
          <h3>Reply assistant</h3>
          <span>Draft only</span>
        </div>
        {!suggestion && (
          <Button
            type="button"
            variant="outline"
            disabled={
              disabled ||
              busy ||
              (!available && !request.current) ||
              config.isLoading
            }
            onClick={() => setDisclosure(true)}
          >
            <FilePenLine size={16} aria-hidden="true" />
            {request.current && !disclosure
              ? "Retrieve AI draft"
              : "Draft with AI"}
          </Button>
        )}
      </div>
      {config.isLoading ? (
        <p role="status">Checking AI availability…</p>
      ) : (
        !available && <p className="ai-draft-availability">{unavailable}</p>
      )}
      {settings && available && (
        <p className="ai-draft-usage">
          {settings.dailyUsed} of {settings.dailyLimit} drafts used today ·{" "}
          {settings.monthlyUsed} of {settings.monthlyLimit} this month
        </p>
      )}
      {config.isError && (
        <button
          className="ai-draft-text-button"
          type="button"
          disabled={config.isFetching}
          onClick={() => void config.refetch()}
        >
          Check availability again
        </button>
      )}
      {disclosure && !suggestion && (
        <div className="ai-draft-disclosure">
          <p>
            Your customer’s enquiry message, relevant car details and dealership
            information will be sent to OpenAI to prepare a reply. Attachments
            are not sent.
          </p>
          <p>
            You review the suggestion first. Nothing is saved or emailed
            automatically.
          </p>
          <div className="ai-draft-actions">
            <Button
              type="button"
              disabled={disabled || busy || (!available && !request.current)}
              onClick={() => void generate()}
            >
              {busy ? (
                <>
                  <LoaderCircle
                    size={16}
                    aria-hidden="true"
                    className="ai-draft-spinner"
                  />
                  Preparing draft…
                </>
              ) : error ? (
                "Try AI draft again"
              ) : (
                "Generate draft"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDisclosure(false);
                setError("");
              }}
            >
              Not now
            </Button>
          </div>
        </div>
      )}
      {busy && (
        <p role="status" className="ai-draft-progress">
          Preparing a suggestion. Your current email is unchanged.
        </p>
      )}
      {error && (
        <p role="alert" className="ai-draft-error">
          {error}
        </p>
      )}
      {suggestion && (
        <section className="ai-draft-suggestion" aria-label="Suggested email">
          <p className="ai-draft-review-note">
            AI suggestion · check the facts and wording before using it
          </p>
          <h4 ref={suggestionHeading} tabIndex={-1}>
            {suggestion.subject}
          </h4>
          <div className="ai-draft-copy">{suggestion.message}</div>
          {suggestion.warnings.length > 0 && (
            <div className="ai-draft-warnings">
              <strong>Check before sending</strong>
              <ul>
                {suggestion.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {confirmReplacement && (
            <p role="alert" className="ai-draft-replace-note">
              You’ve edited this email since the suggestion was requested.
              Replace only the subject and message? Your recipient and
              attachments will stay as they are.
            </p>
          )}
          <div className="ai-draft-actions">
            <Button type="button" disabled={disabled || busy} onClick={accept}>
              {confirmReplacement
                ? "Replace subject and message"
                : "Use this draft"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || busy}
              onClick={
                confirmReplacement
                  ? () => setConfirmReplacement(false)
                  : discard
              }
            >
              {confirmReplacement ? "Keep my text" : "Discard suggestion"}
            </Button>
          </div>
        </section>
      )}
    </section>
  );
}
