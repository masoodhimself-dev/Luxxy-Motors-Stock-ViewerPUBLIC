import { useEffect, useId, useRef, useState } from "react";
import { FilePenLine, X } from "@/components/icons";
import { useAiAssistance } from "@/lib/ai-assistance";
import { Button } from "../ui/button";
import "./ai-reply-draft.css";

export function AiReplyDraft({
  enquiryId,
  onApply,
  disabled,
  compact = false,
  message = "",
}: {
  enquiryId: string;
  onApply: (text: string) => void;
  disabled: boolean;
  compact?: boolean;
  message?: string;
}) {
  const ai = useAiAssistance("staff");
  const [suggestion, setSuggestion] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [notice, setNotice] = useState("");
  const explanationId = useId();
  const current = useRef({ message, disabled });
  current.current = { message, disabled };
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  if (!ai.enabled) return null;

  async function generate() {
    const result = await ai.run("reply", { enquiryId });
    if (!result || !active.current) return;
    setNotice("");
    if (compact && !current.current.message.trim() && !current.current.disabled) {
      onApply(result.answer);
      setSuggestion("");
      setNotice("AI draft added. Check the details before sending.");
    } else {
      setSuggestion(result.answer);
    }
  }
  const explanation = (
    <p id={explanationId} className={compact ? "ai-reply-explanation" : "text-sm leading-6 text-muted-foreground mb-3"}>
      Uses the enquiry text and public car and dealership details with OpenAI.
      Contact fields are removed, but check the enquiry for other personal
      information before generating. Nothing is sent to the customer.
    </p>
  );
  const action = (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      className={compact ? "ai-reply-action" : undefined}
      disabled={disabled || ai.busy || !ai.remaining}
      title={compact ? "Uses this enquiry and public car details with OpenAI. Review before sending." : undefined}
      onClick={() => void generate()}
    >
      {compact && <FilePenLine size={16} aria-hidden />}
      {ai.busy ? "Preparing draft…" : compact ? "Draft with AI" : "Generate draft"}
    </Button>
  );
  const result = (
    <>
      {ai.error && <p role="alert" className={compact ? "ai-reply-explanation ai-reply-error" : "text-sm mt-3"}>{ai.error}</p>}
      {notice && <p role="status" className="ai-reply-notice">{notice}</p>}
      {suggestion && (
        <section aria-label="AI reply suggestion" className={compact ? "ai-reply-suggestion" : "border-t border-border mt-3 pt-3"}>
          {compact && <header><strong>Suggested reply</strong><Button type="button" size="icon" variant="ghost" aria-label="Dismiss AI suggestion" onClick={() => setSuggestion("")}><X size={16} aria-hidden /></Button></header>}
          <p className="whitespace-pre-line text-sm leading-6">{suggestion}</p>
          <p className={compact ? "ai-reply-replace-note" : "text-xs text-muted-foreground my-3"}>
            {compact ? "Your message is unchanged. Check the details before replacing it." : "Check every detail. Applying this replaces the message text only; it does not save or send it."}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              onApply(suggestion);
              setSuggestion("");
              setNotice("AI draft added. Check the details before sending.");
            }}
          >
            {compact ? "Replace message" : "Replace message with this suggestion"}
          </Button>
        </section>
      )}
    </>
  );
  if (compact) return (
    <div className="ai-reply-draft--compact">
      {action}
      <Button type="button" variant="ghost" size="icon" className="ai-reply-info" aria-label="About AI drafts" aria-expanded={showInfo} aria-controls={explanationId} onClick={() => setShowInfo(value => !value)}>i</Button>
      {showInfo && explanation}
      {result}
    </div>
  );
  return (
    <details className="rounded-md border border-border p-3 my-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium py-2">Draft a reply with AI</summary>
      {explanation}
      {action}
      {result}
    </details>
  );
}
