import { useState } from "react";
import { useAiAssistance } from "@/lib/ai-assistance";
import { Button } from "../ui/button";
export function AiReplyDraft({
  enquiryId,
  onApply,
  disabled,
}: {
  enquiryId: string;
  onApply: (text: string) => void;
  disabled: boolean;
}) {
  const ai = useAiAssistance("staff");
  const [suggestion, setSuggestion] = useState("");
  if (!ai.enabled) return null;
  return (
    <details className="rounded-md border border-border p-3 my-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium py-2">
        Draft a reply with AI
      </summary>
      <p className="text-sm leading-6 text-muted-foreground mb-3">
        Uses the enquiry text and public car and dealership details with OpenAI.
        Contact fields are removed, but check the enquiry for other personal
        information before generating. Nothing is sent to the customer.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || ai.busy || !ai.remaining}
        onClick={async () => {
          const result = await ai.run("reply", { enquiryId });
          if (result) setSuggestion(result.answer);
        }}
      >
        {ai.busy ? "Preparing suggestion…" : "Generate draft"}
      </Button>
      {ai.error && (
        <p role="alert" className="text-sm mt-3">
          {ai.error}
        </p>
      )}
      {suggestion && (
        <section
          aria-label="AI reply suggestion"
          className="border-t border-border mt-3 pt-3"
        >
          <p className="whitespace-pre-line text-sm leading-6">{suggestion}</p>
          <p className="text-xs text-muted-foreground my-3">
            Check every detail. Applying this replaces the message text only; it
            does not save or send it.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              onApply(suggestion);
              setSuggestion("");
            }}
          >
            Replace message with this suggestion
          </Button>
        </section>
      )}
    </details>
  );
}
