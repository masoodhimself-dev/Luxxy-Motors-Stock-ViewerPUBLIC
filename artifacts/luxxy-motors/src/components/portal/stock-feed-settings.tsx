import { useState } from "react";
import { useStaffCars } from "./staff-cars-query";
import { formatDateTime } from "./portal-ui";
import { Button } from "@/components/ui/button";

/** Read-only connection details; opening this never downloads or applies a feed. */
export function StockFeedSettings() {
  const [open, setOpen] = useState(false);
  const query = useStaffCars(open);
  const feed = query.data?.feed;
  return <details className="settings-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Stock connection</summary>
    {open && <div>
      {query.isPending && <p role="status">Loading stock connection…</p>}
      {query.isError && <p role="alert">Stock connection could not load. Try refreshing.</p>}
      {feed && <>
        <p><strong>{feed.source}</strong></p>
        <p>{feed.receivedAt ? <>Last file received {formatDateTime(feed.receivedAt)} (UK)</> : "No completed stock update recorded"}</p>
        <p>{feed.state === "stale" ? "Update overdue" : feed.state === "review" ? "Needs review" : feed.state === "current" ? "Up to date" : "Not yet checked"}</p>
        {feed.scheduled && <p>Checks after 07:10 and 19:10 UK.</p>}
      </>}
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh connection status</Button>
      <p>Reloads saved information. It does not start a stock import or change the schedule.</p>
    </div>}
  </details>;
}
