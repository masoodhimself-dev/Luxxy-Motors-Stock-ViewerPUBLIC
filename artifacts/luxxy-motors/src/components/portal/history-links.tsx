import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { DealerRelationships } from "@workspace/vehicle-meta";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { historyDescription } from "./history-display";

function historyHref(
  kind: "vehicle" | "customer",
  id?: string | null,
  record?: string,
) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("section") === "history")
    params.set("section", "notifications");
  if (!params.get("section")) params.set("section", "notifications");
  params.set("contextHistory", kind);
  params.delete("historyVehicle");
  params.delete("historyRecord");
  if (id) params.set("historyVehicle", id);
  if (record) params.set("historyRecord", record);
  return `/portal?${params}`;
}
export const vehicleHistoryHref = (
  vehicleId?: string | null,
  record?: string,
) => historyHref("vehicle", vehicleId, record);
export const customerHistoryHref = (
  recordType: "enquiry" | "reservation" | "sale",
  recordId: string,
) => historyHref("customer", null, `${recordType}:${recordId}`);
/** Contextual read-only history never replaces the current customer or sale workspace. */
export function HistoryLinks({
  vehicleId,
  recordType,
  recordId,
  vehicle = true,
  className = "",
}: {
  vehicleId?: string | null;
  recordType?: "enquiry" | "reservation" | "sale";
  recordId?: string;
  vehicle?: boolean;
  className?: string;
}) {
  const record =
    recordType && recordId ? `${recordType}:${recordId}` : undefined;
  const cls =
    "inline-flex min-h-11 items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-primary hover:bg-secondary";
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {vehicle && (vehicleId || record) && (
        <Link className={cls} href={vehicleHistoryHref(vehicleId, record)}>
          Vehicle history
        </Link>
      )}
      {recordType && recordId && (
        <Link className={cls} href={customerHistoryHref(recordType, recordId)}>
          Customer history
        </Link>
      )}
    </div>
  );
}
export function ContextHistoryDialog() {
  const search = useSearch(),
    [, navigate] = useLocation(),
    params = new URLSearchParams(search);
  const legacy = params.get("section") === "history";
  const kind = legacy
    ? params.get("view") === "customers"
      ? "customer"
      : "vehicle"
    : params.get("contextHistory");
  const open = kind === "customer" || kind === "vehicle";
  const vehicleId =
      params.get("historyVehicle") ?? (legacy ? params.get("vehicleId") : null),
    record =
      params.get("historyRecord") ?? (legacy ? params.get("record") : null);
  const query = useQuery({
    queryKey: ["staff-relationships"],
    queryFn: ({ signal }) =>
      customFetch<DealerRelationships>("/api/staff/relationships", { signal }),
    enabled: open,
    retry: false,
    staleTime: 30_000,
  });
  const vehicle =
    kind === "vehicle"
      ? query.data?.vehicles.find(
          (item) =>
            item.id === vehicleId ||
            Boolean(
              record &&
              item.activities.some(
                (activity) =>
                  `${activity.recordType}:${activity.recordId}` === record,
              ),
            ),
        )
      : undefined;
  const customer =
    kind === "customer"
      ? query.data?.customers.find((item) =>
          Boolean(record && item.recordKeys.includes(record)),
        )
      : undefined;
  const item = vehicle ?? customer,
    activities = item?.activities ?? [];
  function close() {
    const next = new URLSearchParams(search);
    for (const key of ["contextHistory", "historyVehicle", "historyRecord"])
      next.delete(key);
    if (legacy) {
      next.set("section", "notifications");
      next.set("workView", "customers");
      for (const key of ["view", "vehicleId", "record"]) next.delete(key);
    }
    navigate(`/portal?${next}`);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {kind === "customer" ? "Customer history" : "Vehicle history"}
          </DialogTitle>
          <DialogDescription>
            Read-only records for this customer or car. Close to return to your
            work.
          </DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <p role="status">Loading history…</p>
        ) : query.isError ? (
          <>
            <p role="alert">History could not be loaded.</p>
            <Button onClick={() => void query.refetch()}>Try again</Button>
          </>
        ) : !item ? (
          <p>No linked history was found.</p>
        ) : (
          <>
            <h3 className="font-semibold">
              {customer?.name ?? vehicle?.title}
            </h3>
            {customer && (
              <p className="text-sm text-muted-foreground">
                {[customer.email, customer.phone].filter(Boolean).join(" · ")}
              </p>
            )}
            <ol className="divide-y divide-border">
              {activities.map((activity) => (
                <li key={activity.id} className="py-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>{activity.title}</strong>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={activity.occurredAt}
                    >
                      {activity.occurredAt &&
                      Number.isFinite(Date.parse(activity.occurredAt))
                        ? new Date(activity.occurredAt).toLocaleString(
                            "en-GB",
                            {
                              timeZone: "Europe/London",
                              dateStyle: "medium",
                              timeStyle: "short",
                            },
                          )
                        : "Date not recorded"}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">
                    {historyDescription(activity, activities)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {activity.reference}
                    {activity.status
                      ? ` · ${activity.status.replaceAll("_", " ")}`
                      : ""}
                    {activity.amountPence !== null
                      ? ` · ${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(activity.amountPence / 100)}`
                      : ""}
                  </p>
                  {activity.recordType !== "reservation" && (
                    <Link
                      className="mt-2 inline-flex min-h-11 items-center text-sm underline"
                      href={
                        activity.recordType === "sale"
                          ? `/portal?section=sales&saleId=${encodeURIComponent(activity.recordId)}`
                          : `/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(activity.caseId ?? activity.recordId)}`
                      }
                    >
                      Open {activity.recordType === "sale" ? "sale" : "enquiry"}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
            {!activities.length && <p>No activity recorded yet.</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
