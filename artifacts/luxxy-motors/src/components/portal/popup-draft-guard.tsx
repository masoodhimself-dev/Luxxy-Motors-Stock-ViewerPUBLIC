import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import "./popup-forms.css";

/** Keep an edited staff form open until the user explicitly discards it. */
export function usePopupDraftGuard({
  dirty,
  blocked,
  onClose,
  discardTitle = "Discard your changes?",
  discardDescription = "They have not been saved.",
  discardLabel = "Discard changes",
  enabled = true,
}: {
  dirty: boolean;
  blocked: () => boolean;
  onClose: () => void;
  discardTitle?: string;
  discardDescription?: string;
  discardLabel?: string;
  enabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const prompt = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { if (!enabled || !dirty) setConfirming(false); }, [enabled, dirty]);
  useEffect(() => {
    if (confirming) prompt.current?.focus({ preventScroll: false });
  }, [confirming]);
  function requestClose() {
    if (blocked()) return;
    if (!dirty) {
      onClose();
      return;
    }
    if (!confirming && document.activeElement instanceof HTMLElement)
      previousFocus.current = document.activeElement;
    if (confirming) prompt.current?.focus({ preventScroll: false });
    setConfirming(true);
  }
  function keepEditing() {
    setConfirming(false);
    if (previousFocus.current?.isConnected)
      previousFocus.current.focus({ preventScroll: true });
  }
  const discardPrompt = confirming ? (
    <div className="portal-popup-discard" role="alert" tabIndex={-1} ref={prompt}>
      <p><strong>{discardTitle}</strong> {discardDescription}</p>
      <div>
        <Button type="button" size="sm" variant="outline" disabled={blocked()} onClick={keepEditing}>
          Keep editing
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={blocked()} onClick={() => {
          if (!blocked()) onClose();
        }}>
          {discardLabel}
        </Button>
      </div>
    </div>
  ) : null;
  return { requestClose, discardPrompt };
}
