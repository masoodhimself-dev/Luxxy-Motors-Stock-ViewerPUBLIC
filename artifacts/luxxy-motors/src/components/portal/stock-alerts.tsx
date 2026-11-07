import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowLeft, Bell } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "./portal-ui";
import "./stock-alerts.css";

export const buyerDemandHref = "/portal?section=cars&carsView=buyer-demand";
const stockAlertsSettingsHref = "/portal?section=settings&settingsTab=website&settingsPanel=stock-alerts";
const stockAlertsKey = ["staff-stock-alerts"] as const;

type StockAlertsSummary = {
  enabled: boolean;
  emailReady: boolean;
  totalBuyers: number;
  searches: { label: string; buyers: number }[];
};

const alertStatusLabels = {
  active: "Active",
  pending: "Pending confirmation",
  expired: "Expired",
  stopped: "Stopped",
} as const;
type AlertStatusKey = keyof typeof alertStatusLabels;
type AlertStatusFilter = AlertStatusKey | "all";
type StockAlertRequestsPage = {
  items: {
    id: string;
    label: string;
    status: AlertStatusKey;
    requestedAt: string;
    confirmedAt: string | null;
    expiresAt: string | null;
  }[];
  page: number;
  hasMore: boolean;
};

function useStockAlertsSummary(enabled = true) {
  return useQuery({
    queryKey: stockAlertsKey,
    queryFn: ({ signal }) => customFetch<StockAlertsSummary>("/api/staff/stock-alerts", { signal }),
    enabled,
    retry: false,
  });
}

function AlertStatus({ enabled, emailReady }: Pick<StockAlertsSummary, "enabled" | "emailReady">) {
  return <span className="stock-alerts-state">
    <Bell size={15} aria-hidden="true" />
    {enabled ? emailReady ? "Stock alerts on" : "Email unavailable" : "Stock alerts off"}
  </span>;
}

function StockAlertRequests() {
  const [{ status, page }, setFilters] = useState<{ status: AlertStatusFilter; page: number }>({ status: "active", page: 1 });
  const query = useQuery({
    queryKey: [...stockAlertsKey, "requests", status, page],
    queryFn: ({ signal }) => customFetch<StockAlertRequestsPage>(`/api/staff/stock-alerts/requests?status=${status}&page=${page}`, { signal }),
    retry: false,
  });
  const result = query.data;
  const currentPage = result?.page ?? page;

  return (
    <section className="buyer-demand-panel stock-alert-requests" aria-labelledby="stock-alert-requests-title">
      <header className="stock-alert-requests-heading">
        <h3 id="stock-alert-requests-title" tabIndex={-1}>Stock alert requests</h3>
        <label className="stock-alert-requests-filter">
          <span>Status</span>
          <NativeSelect value={status} onChange={(event) => setFilters({ status: event.currentTarget.value as AlertStatusFilter, page: 1 })}>
            {Object.entries(alertStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            <option value="all">All statuses</option>
          </NativeSelect>
        </label>
      </header>

      {query.isPending ? (
        <p className="buyer-demand-note" role="status">Loading stock alert requests…</p>
      ) : query.isError ? (
        <div className="buyer-demand-note" role="alert">
          <p>Stock alert requests could not load.</p>
          <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Try again</Button>
        </div>
      ) : result?.items.length ? (
        <ul className="stock-alert-requests-list" aria-label="Stock alert requests">
          {result.items.map(({ id, label, status: requestStatus, requestedAt, confirmedAt, expiresAt }) => (
            <li key={id}>
              <div className="stock-alert-request-title">
                <strong>{label}</strong>
                <span className="stock-alert-request-status" data-status={requestStatus}>{alertStatusLabels[requestStatus]}</span>
              </div>
              <dl className="stock-alert-request-dates">
                <div><dt>Last requested</dt><dd><time dateTime={requestedAt}>{formatDate(requestedAt)}</time></dd></div>
                {confirmedAt && <div><dt>Confirmed</dt><dd><time dateTime={confirmedAt}>{formatDate(confirmedAt)}</time></dd></div>}
                {expiresAt && (requestStatus === "active" || requestStatus === "expired") && (
                  <div><dt>{requestStatus === "expired" ? "Expired" : "Expires"}</dt><dd><time dateTime={expiresAt}>{formatDate(expiresAt)}</time></dd></div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p className="buyer-demand-note" role="status">{currentPage === 1 ? "No requests for this status." : "No requests on this page."}</p>
      )}

      {(currentPage > 1 || result?.hasMore) && (
        <nav className="stock-alert-requests-pagination" aria-label="Stock alert pages">
          <Button variant="outline" disabled={currentPage === 1 || query.isFetching} onClick={() => setFilters({ status, page: currentPage - 1 })}>Previous</Button>
          <span role="status">Page {currentPage}</span>
          <Button variant="outline" disabled={!result?.hasMore || query.isFetching} onClick={() => setFilters({ status, page: currentPage + 1 })}>Next</Button>
        </nav>
      )}
    </section>
  );
}

export function BuyerDemandWorkspace({ canChangeSettings }: { canChangeSettings: boolean }) {
  const query = useStockAlertsSummary();
  const summary = query.data;

  return (
    <section className="buyer-demand" aria-labelledby="buyer-demand-title">
      <Link className="buyer-demand-back" href="/portal?section=cars">
        <ArrowLeft size={16} aria-hidden="true" /> Back to cars
      </Link>
      <header className="buyer-demand-heading">
        <div>
          <h2 id="buyer-demand-title">Buyer demand</h2>
          <p>See what buyers are waiting for before you bring in more stock.</p>
        </div>
        <div className="buyer-demand-actions">
          <Button variant="outline" asChild><a href="#stock-alert-requests-title">View requests</a></Button>
          {canChangeSettings && (
            <Button variant="outline" asChild><Link href={stockAlertsSettingsHref}>Stock alert settings</Link></Button>
          )}
        </div>
      </header>

      {query.isPending ? (
        <p className="buyer-demand-message" role="status">Loading buyer demand…</p>
      ) : query.isError ? (
        <div className="buyer-demand-message" role="alert">
          <p>Buyer demand could not load.</p>
          <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Try again</Button>
        </div>
      ) : summary && (
        <div className="buyer-demand-panel">
          <div className="buyer-demand-overview">
            <div>
              <strong className="buyer-demand-total">{summary.totalBuyers.toLocaleString("en-GB")}</strong>
              <span>{summary.totalBuyers === 1 ? "buyer waiting" : "buyers waiting"}</span>
            </div>
            <AlertStatus {...summary} />
          </div>
          {summary.searches.length ? (
            <>
              <div className="buyer-demand-list-heading" aria-hidden="true">
                <span>What buyers are looking for</span><span>Buyers</span>
              </div>
              <ul className="buyer-demand-list" aria-label="What buyers are looking for">
                {summary.searches.map(({ label, buyers }) => (
                  <li key={label}>
                    <span>{label}</span>
                    <strong>{buyers.toLocaleString("en-GB")}<span className="sr-only"> {buyers === 1 ? "buyer" : "buyers"}</span></strong>
                  </li>
                ))}
              </ul>
              <p className="buyer-demand-note">Counts buyers who confirmed their email and have an active alert.</p>
            </>
          ) : (
            <p className="buyer-demand-note">{summary.enabled && summary.emailReady
              ? "Confirmed alerts will appear here when buyers save a search."
              : "Buyers can sign up from the stock page once alerts and email are ready."}</p>
          )}
        </div>
      )}
      <StockAlertRequests />
    </section>
  );
}

export function StockAlertSettings({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [draft, setDraft] = useState<boolean | null>(null);
  const client = useQueryClient();
  const query = useStockAlertsSummary(open);
  const summary = query.data;
  const enabled = draft ?? summary?.enabled ?? false;
  const dirty = draft !== null && draft !== summary?.enabled;
  const update = useMutation({
    mutationFn: (next: boolean) => customFetch<{ enabled: boolean }>("/api/staff/stock-alerts/settings", {
      method: "PUT",
      body: JSON.stringify({ enabled: next }),
      headers: { "Content-Type": "application/json" },
    }),
    onSuccess: (saved) => {
      client.setQueryData<StockAlertsSummary>(stockAlertsKey, (current) => current && { ...current, enabled: saved.enabled });
      setDraft(null);
      void client.invalidateQueries({ queryKey: stockAlertsKey });
      void client.invalidateQueries({ queryKey: ["stock-alert-status"] });
    },
  });

  return (
    <details className="settings-section stock-alerts-setting" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} data-settings-dirty={dirty}>
      <summary>Stock alerts</summary>
      <div className="stock-alerts-setting-body">
        <p>Let buyers save a search when no cars match. Confirmed buyers receive one email on days when matching cars arrive.</p>
        {open && (query.isPending ? (
          <p role="status">Loading stock alert settings…</p>
        ) : query.isError ? (
          <div role="alert">
            <p>Stock alert settings could not load.</p>
            <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Try again</Button>
          </div>
        ) : summary && (
          <>
            <label className="stock-alerts-setting-toggle">
              <span>Offer stock alerts to buyers</span>
              <Switch
                checked={enabled}
                disabled={update.isPending || (!summary.emailReady && !enabled)}
                onCheckedChange={(value) => { update.reset(); setDraft(value); }}
              />
            </label>
            {!summary.emailReady && <p>Buyers can sign up and receive alerts once customer email is ready.</p>}
            <div className="stock-alerts-setting-actions">
              <Button disabled={!dirty || update.isPending || (enabled && !summary.emailReady)} onClick={() => update.mutate(enabled)}>
                {update.isPending ? "Saving…" : "Save stock alert setting"}
              </Button>
              <Link className="buyer-demand-back" href={buyerDemandHref}>View buyer demand</Link>
            </div>
            {update.isError && <p role="alert">The stock alert setting could not be saved. Try again.</p>}
            {update.isSuccess && <p role="status">Stock alerts {update.data.enabled ? "turned on." : "turned off."}</p>}
          </>
        ))}
      </div>
    </details>
  );
}
