import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, type Enquiry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useStaffAccess } from "./dealer-administration";

type Eligibility = {
  id: string;
  expectedRevision: number;
  canDelete: boolean;
  reason: string | null;
};
function errorText(error: unknown) {
  const data = (error as { data?: { error?: unknown } } | null)?.data;
  return typeof data?.error === "string"
    ? data.error
    : "Could not confirm deletion. Refresh the enquiries before trying again.";
}

/** The server rechecks permissions and linked records under lock before deleting. */
export function DeleteEnquiry({
  entry,
  onDeleted,
}: {
  entry: Enquiry;
  onDeleted?: (id: string) => void;
}) {
  const candidate = Boolean(onDeleted);
  const access = useStaffAccess(candidate);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [needsRecheck, setNeedsRecheck] = useState(false);
  const locked = useRef(false);
  const checkId = useId();
  useEffect(() => {
    setOpen(false);
    setConfirmed(false);
    setFailure("");
    setNeedsRecheck(false);
  }, [entry.id, entry.workspaceRevision]);
  const path = `/api/staff/enquiries/${encodeURIComponent(entry.id)}/deletion`;
  const eligibility = useQuery({
    queryKey: ["enquiry-deletion", entry.id, entry.workspaceRevision],
    enabled:
      open &&
      candidate &&
      !access.isError &&
      access.data?.permissions.includes("sales.manage") === true,
    queryFn: async () => {
      const value = await customFetch<Eligibility>(path, { cache: "no-store" });
      if (
        !value ||
        value.id !== entry.id ||
        !Number.isSafeInteger(value.expectedRevision) ||
        value.expectedRevision < 0 ||
        typeof value.canDelete !== "boolean"
      )
        throw new Error("Invalid deletion check.");
      return value;
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  if (
    !candidate ||
    access.isError ||
    !access.data?.permissions.includes("sales.manage")
  )
    return null;
  const changed =
    eligibility.data &&
    eligibility.data.expectedRevision !== (entry.workspaceRevision ?? 0);
  const allowed =
    eligibility.data?.canDelete === true &&
    !changed &&
    !eligibility.isError &&
    !eligibility.isFetching &&
    !needsRecheck;
  function changeOpen(value: boolean) {
    if (locked.current) return;
    setOpen(value);
    setConfirmed(false);
    setFailure("");
    setNeedsRecheck(false);
  }
  async function remove() {
    if (!confirmed || !allowed || locked.current || !eligibility.data) return;
    locked.current = true;
    setBusy(true);
    setFailure("");
    let deleted = false;
    try {
      const result = await customFetch<{ deleted: boolean; id: string }>(path, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: eligibility.data.expectedRevision,
          confirmDelete: true,
        }),
      });
      if (result.deleted !== true || result.id !== entry.id)
        throw new Error("Unexpected deletion response.");
      deleted = true;
    } catch (error) {
      setFailure(errorText(error));
      setConfirmed(false);
      setNeedsRecheck(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
    if (deleted) {
      setOpen(false);
      onDeleted?.(entry.id);
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive"
        >
          Delete enquiry
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this enquiry?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes this enquiry and its emails, confirmed
            WhatsApp messages and notes. Invoices, payments, saved sales and
            bookings are protected. Deletion cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="min-w-0 break-words rounded border bg-muted/40 p-3 text-sm">
          <p className="font-semibold">{entry.customerName}</p>
          <p>{entry.vehicleTitle || "General showroom enquiry"}</p>
          {entry.reference && <p>{entry.reference}</p>}
        </div>
        {eligibility.isFetching && (
          <p role="status" className="text-sm">
            Checking linked records…
          </p>
        )}
        {eligibility.isError && (
          <p role="alert" className="text-sm text-destructive">
            We could not check whether this enquiry is safe to delete.
          </p>
        )}
        {changed && (
          <p role="alert" className="text-sm text-destructive">
            This enquiry has changed. Close this window and refresh the
            enquiries before deleting.
          </p>
        )}
        {eligibility.data && !eligibility.data.canDelete && (
          <p role="alert" className="text-sm">
            {eligibility.data.reason ||
              "This enquiry has protected records and cannot be deleted."}
          </p>
        )}
        {allowed && (
          <label
            htmlFor={checkId}
            className="flex min-h-11 cursor-pointer items-start gap-3 text-sm"
          >
            <input
              id={checkId}
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-destructive"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I understand this permanently removes this enquiry and its
              conversation history.
            </span>
          </label>
        )}
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
        {(eligibility.isError || needsRecheck) && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || eligibility.isFetching}
            onClick={async () => {
              setConfirmed(false);
              const result = await eligibility.refetch();
              if (result.isSuccess) {
                setNeedsRecheck(false);
                setFailure("");
              }
            }}
          >
            Check again
          </Button>
        )}
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel disabled={busy}>Keep enquiry</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={!allowed || !confirmed || busy}
            onClick={() => void remove()}
          >
            {busy ? "Deleting…" : "Delete permanently"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
