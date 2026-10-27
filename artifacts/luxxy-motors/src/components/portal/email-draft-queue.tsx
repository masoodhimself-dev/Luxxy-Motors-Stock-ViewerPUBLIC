import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { FilePenLine, ArrowUpRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
type SavedReply = {
  enquiryId: string;
  version: number;
  status: string;
  source: string;
  subject: string;
  customerName: string;
  vehicleTitle: string | null;
  reference: string;
  updatedAt: string;
};
export function EmailDraftQueue({
  search,
  enquiryId,
  onOpen,
}: {
  search: string;
  enquiryId?: string;
  onOpen: (id: string) => void;
}) {
  const cache = useQueryClient(),
    query = useQuery({
      queryKey: ["staff-email-drafts", enquiryId || "all"],
      queryFn: () =>
        customFetch<{ drafts: SavedReply[]; hasMore: boolean }>(
          `/api/staff/email-drafts${enquiryId ? `?enquiryId=${encodeURIComponent(enquiryId)}` : ''}`,
        ),
      retry: false,
    });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  const rows = (query.data?.drafts ?? []).filter((d) =>
    `${d.customerName} ${d.vehicleTitle || ""} ${d.subject || ""} ${d.reference}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  async function discard(row: SavedReply) {
    if (
      busy ||
      !window.confirm(
        `Discard the saved reply for ${row.customerName}? No email will be sent.`,
      )
    )
      return;
    setBusy(row.enquiryId);
    setError("");
    try {
      await customFetch(
        `/api/staff/enquiries/${row.enquiryId}/email-draft/discard`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedVersion: row.version }),
        },
      );
      await Promise.all([
        query.refetch(),
        cache.invalidateQueries({ queryKey: ["staff-notifications"] }),
      ]);
    } catch {
      setError(
        "Draft could not be discarded. It may have changed; refresh the list.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="email-draft-queue" aria-label="Saved email drafts">
      <div className="email-draft-intro">
        <FilePenLine size={21} aria-hidden="true" />
        <div>
          <h3>Replies in progress</h3>
          <p>
            Shared with your dealership team. Nothing here has been sent unless
            a send status says otherwise.
          </p>
        </div>
      </div>
      {query.isLoading && <p role="status">Loading saved drafts…</p>}
      {query.isError && (
        <div role="alert">
          Drafts could not be loaded.{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {query.data && !rows.length && (
        <div className="email-drafts-empty">
          <h3>{search ? "No matching drafts" : "No saved drafts yet"}</h3>
          <p>
            Choose New email or Prepare reply from an enquiry, then save your
            draft.
          </p>
        </div>
      )}
      {rows.map((row) => (
        <article className="email-draft-row" key={row.enquiryId}>
          <div>
            <span className="email-draft-status">
              {row.status === "draft"
                ? "Not sent · needs review"
                : row.status === "sending"
                  ? "Sending · check history"
                  : "Acceptance unconfirmed · check history"}
            </span>
            <h3>{row.subject || "Untitled reply"}</h3>
            <p>
              <strong>{row.customerName}</strong> ·{" "}
              {row.vehicleTitle || "General enquiry"}
            </p>
            <small>
              Saved{" "}
              {new Date(row.updatedAt).toLocaleString("en-GB", {
                timeZone: "Europe/London",
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              ·{" "}
              {row.source === "template" ? "Template" : "Saved draft — review before sending"}
            </small>
          </div>
          <div className="email-draft-row-actions">
            <Button variant="outline" onClick={() => onOpen(row.enquiryId)}>
              {row.status === "draft" ? "Continue draft" : "Check draft"}
              <ArrowUpRight size={15} aria-hidden="true" />
            </Button>
            {row.status === "draft" && (
              <Button
                variant="ghost"
                disabled={!!busy}
                onClick={() => void discard(row)}
              >
                Discard
              </Button>
            )}
          </div>
        </article>
      ))}
      {query.data?.hasMore && (
        <p className="email-note">
          Showing the 100 most recently saved drafts. Older drafts remain
          available from their enquiries.
        </p>
      )}
    </section>
  );
}
