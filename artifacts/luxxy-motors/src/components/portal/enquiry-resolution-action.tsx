import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch, type Enquiry } from "@workspace/api-client-react";
import { CheckCircle2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { enquirySummaryKey } from "@/lib/enquiry-summary-query";
import { useStaffAccess } from "./dealer-administration";
import { useRefreshDesk, workspaceError } from "./enquiry-workspace-tools";
import "./enquiry-resolution-action.css";

type Resolution = {
  id: string;
  status: "closed";
  workspaceRevision: number;
  updatedAt: string;
  changed: boolean;
};
/** Status only. It never acknowledges email replies, cancels work or sends mail. */
export function EnquiryResolutionAction({
  entry,
  disabled = false,
  linkedCount = 1,
  onDoneNext,
}: {
  entry: Enquiry;
  disabled?: boolean;
  linkedCount?: number;
  onDoneNext?: () => void;
}) {
  const access = useStaffAccess();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const locked = useRef(false),
    button = useRef<HTMLButtonElement>(null);
  const refresh = useRefreshDesk(),
    cache = useQueryClient();
  if (
    access.isError ||
    !access.data?.permissions.includes("sales.manage") ||
    entry.status === "closed"
  )
    return null;
  async function resolve(advance = false) {
    if (locked.current || disabled) return;
    const scope = button.current?.closest(".enquiry-customer-case");
    if (scope?.querySelector('[data-message-dirty="true"]')) {
      setError(
        "Save or discard your reply and private note before changing this enquiry’s status.",
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await customFetch<Resolution>(
        `/api/staff/enquiries/${encodeURIComponent(entry.id)}/resolution`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          responseType: "json",
          body: JSON.stringify({
            expectedRevision: entry.workspaceRevision ?? 0,
            status: "closed",
          }),
        },
      );
      if (
        result.id !== entry.id ||
        result.status !== "closed" ||
        !Number.isSafeInteger(result.workspaceRevision)
      )
        throw new Error("Unexpected resolution response");
      cache.setQueryData<Enquiry[]>(enquirySummaryKey(), (current) =>
        current?.map((item) =>
          item.id === result.id
            ? {
                ...item,
                status: result.status,
                workspaceRevision: result.workspaceRevision,
                updatedAt: result.updatedAt,
              }
            : item,
        ),
      );
      await refresh();
      if (advance) onDoneNext?.();
    } catch (cause) {
      setError(workspaceError(cause));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="enquiry-resolution-control">
      <Button
        ref={button}
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || disabled}
        title={
          linkedCount > 1
            ? "Changes this enquiry only. Linked enquiries keep their own status."
            : undefined
        }
        onClick={() => void resolve()}
      >
        <CheckCircle2 size={15} aria-hidden />
        {busy ? "Saving…" : "Mark done"}
      </Button>
      {onDoneNext && <Button type="button" size="sm" variant="outline" disabled={busy || disabled} onClick={() => void resolve(true)}>Done & next</Button>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
