import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import "./dealer-reports.css";

type Period = "30d" | "90d";
type DealerReport = {
  period: Period;
  from: string;
  to: string;
  enquiries: { received: number; newNow: number };
  bookings: { scheduled: number; pending: number };
  sales: null | { completed: number | null };
  popularVehicles: Array<{ vehicleId: string; title: string; enquiries: number }>;
};
const date = (value: string) => new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London",
}).format(new Date(value));

/** One read when opened or the period changes; no tracking or polling. */
export function DealerReports({ scope }: { scope: string }) {
  const [period, setPeriod] = useState<Period>("30d");
  const query = useQuery({
    queryKey: ["dealer-reports", typeof window === "undefined" ? "server" : window.location.origin, scope, period],
    queryFn: ({ signal }) => customFetch<DealerReport>(`/api/dealer-reports?period=${period}`, { signal }),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });
  const report = query.data;
  return <div className="dealer-reports">
    <div className="dealer-reports-header">
      <div><h2>Reports</h2><p>A clear picture from the records your dealership has saved.</p></div>
      <label className="dealer-reports-period">Period <select aria-label="Report period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option></select></label>
    </div>
    {query.isPending && <p className="dealer-reports-state" role="status">Loading your report…</p>}
    {query.isError && <div className="dealer-reports-state" role="alert"><p>We couldn’t load your report. Please try again.</p><Button type="button" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>}
    {report && !query.isError && <>
      <p className="dealer-reports-range">{date(report.from)} to {date(report.to)} (UK time)</p>
      <div className="dealer-reports-grid">
        <section className="dealer-reports-card"><h3>Enquiries</h3><strong>{report.enquiries.received}</strong><p>Enquiry records received in this period, including those added by staff or later merged.</p><p className="dealer-reports-sub"><b>{report.enquiries.newNow}</b> currently marked new · all dates</p></section>
        <section className="dealer-reports-card"><h3>Test drives</h3><strong>{report.bookings.scheduled}</strong><p>Confirmed appointments scheduled in this period.</p><p className="dealer-reports-sub"><b>{report.bookings.pending}</b> pending requests scheduled in this period</p></section>
        {report.sales && <section className="dealer-reports-card"><h3>Completed sales</h3>{report.sales.completed === null ? <p>Sales total unavailable. Review sales records with missing or invalid completion dates.</p> : <><strong>{report.sales.completed}</strong><p>Sales completed in this period.</p></>}</section>}
      </div>
      <section className="dealer-reports-popular"><h3>Cars customers asked about</h3><p>Enquiry records linked to a car during this period, including those added by staff or later merged.</p>{report.popularVehicles.length ? <ol>{report.popularVehicles.map((vehicle) => <li key={vehicle.vehicleId}><span>{vehicle.title}</span><strong>{vehicle.enquiries} {vehicle.enquiries === 1 ? "enquiry" : "enquiries"}</strong></li>)}</ol> : <p className="dealer-reports-empty">No enquiries linked to a car in this period.</p>}</section>
      <p className="dealer-reports-footer">Based on saved dealership records. Appointments are counted by their scheduled date; cancelled appointments are excluded.</p>
    </>}
  </div>;
}
