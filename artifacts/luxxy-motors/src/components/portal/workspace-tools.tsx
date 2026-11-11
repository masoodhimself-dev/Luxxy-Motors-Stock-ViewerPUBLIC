import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Search, CheckCircle2, ArrowRight, Download } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { confirmSettingsNavigation } from "@/lib/settings-navigation";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { useStaffAccess } from "./dealer-administration";
import { useStaffCars } from "./staff-cars-query";
import "./workspace-tools.css";

type SearchResult = {
  kind: string;
  id: string;
  title: string;
  detail: string;
  href: string;
};
export function WorkspaceSearch({ appearance = "default" }: { appearance?: "default" | "desk" } = {}) {
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(""),
    [search, setSearch] = useState("");
  const trigger = useRef<HTMLButtonElement>(null),
    [, navigate] = useLocation();
  useEffect(() => {
    const timer = setTimeout(() => setSearch(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const results = useQuery({
    queryKey: ["workspace-search", search],
    enabled: open && search.length >= 2 && search.length <= 120,
    queryFn: ({ signal }) =>
      customFetch<{ results: SearchResult[] }>(
        `/api/staff/workspace/search?q=${encodeURIComponent(search)}`,
        { signal },
      ),
    retry: false,
    staleTime: 15_000,
  });
  return (
    <>
      <Button
        ref={trigger}
        variant="outline"
        className="workspace-search-trigger"
        onClick={() => setOpen(true)}
        aria-label={appearance === "desk" ? "Search by reg, customer or reference" : "Search cars, customers and invoices"}
      >
        <Search size={18} />
        <span>{appearance === "desk" ? "Search by reg, customer or reference" : "Search workspace"}</span>
        {appearance === "desk" && <kbd aria-hidden="true">⌘ K</kbd>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="portal-action-dialog workspace-search-dialog"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Find anything</DialogTitle>
            <DialogDescription>
              Search a registration, customer name or invoice number.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            maxLength={120}
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Search all workspace records"
            placeholder="Registration, customer or invoice"
          />
          {search.length < 2 ? (
            <p>Enter at least 2 characters.</p>
          ) : results.isFetching ? (
            <p role="status">Searching…</p>
          ) : results.isError ? (
            <p role="alert">
              Search could not load.{" "}
              <Button variant="ghost" onClick={() => void results.refetch()}>
                Try again
              </Button>
            </p>
          ) : (
            <ul className="workspace-search-results">
              {results.data?.results.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <a
                    href={r.href}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
                        return;
                      e.preventDefault();
                      if (confirmSettingsNavigation()) {
                        setOpen(false);
                        navigate(r.href);
                      }
                    }}
                  >
                    <small>
                      {r.kind === "car"
                        ? "Car"
                        : r.kind === "sale"
                          ? "Sale / invoice"
                          : "Customer enquiry"}
                    </small>
                    <strong>{r.title}</strong>
                    <span>{r.detail}</span>
                    <ArrowRight size={17} />
                  </a>
                </li>
              ))}
              {!results.data?.results.length && (
                <li>No matching records. Try a registration or surname.</li>
              )}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

type Integrations = {
  resend: { enabled: boolean; apiKeyConfigured: boolean; from: string };
  readiness: { resend: { ready: boolean } };
};
type Leads = {
  enabled: boolean;
  mailbox: string | null;
  receipts: { receivedAt: string; status: string }[];
};
export function OwnerSetup() {
  const access = useStaffAccess(),
    owner = access.data?.role === "owner";
  const { settings } = useDealerSettings(),
    cars = useStaffCars(owner);
  const mail = useQuery({
    queryKey: ["workspace-email-health"],
    enabled: owner,
    queryFn: ({ signal }) =>
      customFetch<Integrations>("/api/dealer-integrations", { signal }),
    retry: false,
  });
  const leads = useQuery({
    queryKey: ["workspace-leads-health"],
    enabled: owner,
    queryFn: ({ signal }) =>
      customFetch<Leads>("/api/staff/cazoo-leads", { signal }),
    retry: false,
  });
  if (!owner) return null;
  const checks = [
    {
      label: "Business phone, email and address",
      done: Boolean(
        settings.contact.phone &&
        settings.contact.email &&
        settings.address?.postcode,
      ),
      href: "dealership",
    },
    {
      label: "Opening hours",
      done: Boolean(settings.hours?.length),
      href: "dealership",
    },
    {
      label: "Stock connected",
      done: cars.data?.feed.state === "current",
      href: "dealership",
    },
    {
      label: "Outgoing email configured",
      done:
        mail.data?.resend.enabled === true &&
        mail.data?.readiness.resend.ready === true,
      href: "emails",
    },
  ];
  const completed = checks.filter((c) => c.done).length;
  return (
    <section
      className="workspace-owner-setup"
      aria-label="Dealership setup and connections"
    >
      <details className="workspace-setup-checklist">
        <summary>
          Setup & connections{" "}
          <span>
            {completed} of {checks.length} checks ready
          </span>
        </summary>
        <div className="workspace-health-grid" aria-label="Connection health">
          <Link href="/portal?section=settings&settingsTab=dealership">
            <strong>Stock</strong>
            <span>
              {cars.isError
                ? "Could not check"
                : cars.isPending
                  ? "Checking…"
                  : cars.data?.feed.state === "current"
                    ? "Up to date"
                    : cars.data?.feed.state === "stale"
                      ? "Update overdue"
                      : cars.data?.feed.state === "review"
                        ? "Needs review"
                        : "Not connected"}
            </span>
            {cars.data?.feed.receivedAt && (
              <small>
                Last file{" "}
                {new Date(cars.data.feed.receivedAt).toLocaleString("en-GB")}
              </small>
            )}
          </Link>
          <Link href="/portal?section=settings&settingsTab=emails">
            <strong>Incoming leads</strong>
            <span>
              {leads.isError
                ? "Could not check"
                : leads.isPending
                  ? "Checking…"
                  : leads.data?.enabled && leads.data.mailbox
                    ? "Mailbox connected"
                    : "Not connected"}
            </span>
            {leads.data?.receipts[0] && (
              <small>
                Last email{" "}
                {new Date(leads.data.receipts[0].receivedAt).toLocaleString(
                  "en-GB",
                )}
              </small>
            )}
          </Link>
          <Link href="/portal?section=settings&settingsTab=emails">
            <strong>Outgoing email</strong>
            <span>
              {mail.isError
                ? "Could not check"
                : mail.isPending
                  ? "Checking…"
                  : !mail.data?.resend.enabled
                    ? "Sending switched off"
                    : mail.data.readiness.resend.ready
                      ? "Configured"
                      : "Needs setup"}
            </span>
            <small>Configuration status; no test email is sent.</small>
          </Link>
        </div>
        <h3>Setup checklist</h3>
        <p>
          Review these before inviting customers. These checks do not publish
          changes or send emails.
        </p>
        <ul>
          {checks.map((c) => (
            <li key={c.label}>
              <CheckCircle2 size={17} aria-hidden />
              <Link href={`/portal?section=settings&settingsTab=${c.href}`}>
                {c.label}
              </Link>
              <span>{c.done ? "Ready" : "To check"}</span>
            </li>
          ))}
          <li>
            <ArrowRight size={17} />
            <Link href="/portal?section=settings&settingsTab=paperwork">
              Check bank details, invoice details and terms
            </Link>
            <span>Review</span>
          </li>
          <li>
            <ArrowRight size={17} />
            <Link href="/portal?section=sales">
              Open Sales and choose “Try with a real car”
            </Link>
            <span>Practice</span>
          </li>
          <li>
            <ArrowRight size={17} />
            <Link href="/portal?section=settings&settingsTab=team">
              Invite your team
            </Link>
            <span>Optional</span>
          </li>
        </ul>
      </details>
    </section>
  );
}

type OperationsReport = {
  from: string;
  to: string;
  enquiries: number;
  testDrivesRequested: number;
  testDrivesCompleted: number;
  carsSold: number;
  receivedPence: number;
  refundsPence: number;
  netReceivedPence: number;
  currentOutstandingPence: number;
  currentCustomerCreditPence: number;
  unreviewedBalances: number;
  generatedAt: string;
};
type JourneyCounts = {
  search: number;
  vehicle: number;
  enquiry: number;
  appointmentRequest: number;
};
type JourneyReport = {
  from: string;
  to: string;
  days: Array<JourneyCounts & { date: string }>;
  totals: JourneyCounts;
};
const money = (p: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    p / 100,
  );
export function OwnerOperationsReport() {
  const access = useStaffAccess(),
    [open, setOpen] = useState(false),
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`),
    [to, setTo] = useState(today),
    [range, setRange] = useState({ from, to }),
    [downloadError, setDownloadError] = useState("");
  const query = useQuery({
    queryKey: ["owner-operations-report", range],
    enabled: open && access.data?.role === "owner",
    queryFn: ({ signal }) =>
      customFetch<OperationsReport>(
        `/api/staff/workspace/report?from=${range.from}&to=${range.to}`,
        { signal },
      ),
    retry: false,
  });
  const journey = useQuery({
    queryKey: ["owner-website-events", range],
    enabled: open && access.data?.role === "owner",
    queryFn: ({ signal }) =>
      customFetch<JourneyReport>(
        `/api/staff/website-journey?from=${range.from}&to=${range.to}`,
        { signal },
      ),
    retry: false,
  });
  if (access.data?.role !== "owner") return null;
  const report = query.data;
  function downloadEvents() {
    const data = journey.data;
    if (!data?.days) return;
    const keys = [
      "search",
      "vehicle",
      "enquiry",
      "appointmentRequest",
    ] as const;
    const rows = [
      [
        "Date",
        "Stock searches",
        "Vehicle views",
        "Enquiry sends",
        "Test-drive requests",
      ],
      ...data.days.map((day) => [
        /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? day.date : "",
        ...keys.map((key) =>
          Number.isSafeInteger(day[key]) && day[key] >= 0 ? day[key] : 0,
        ),
      ]),
    ];
    const csv =
      "\uFEFF" +
      rows
        .map((row) =>
          row.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "website-events.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function download() {
    setDownloadError("");
    try {
      const file = await customFetch<Blob>(
        `/api/staff/workspace/report.csv?from=${range.from}&to=${range.to}`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(file),
        a = document.createElement("a");
      a.href = url;
      a.download = "dealer-operations.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setDownloadError("The report could not be downloaded. Try again.");
    }
  }
  return (
    <details
      className="workspace-operations-report"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        Owner report <span>Enquiries, sales and money received</span>
      </summary>
      {open && (
        <>
          <form
            className="workspace-report-dates"
            onSubmit={(e) => {
              e.preventDefault();
              if (from === range.from && to === range.to) {
                void query.refetch();
                void journey.refetch();
              } else setRange({ from, to });
            }}
          >
            <label>
              From
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                required
              />
            </label>
            <label>
              To
              <Input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </label>
            <Button>Update report</Button>
          </form>
          {query.isFetching ? (
            <p role="status">Loading report…</p>
          ) : query.isError ? (
            <p role="alert">
              The report could not load. Check the dates and try again.
            </p>
          ) : (
            report && (
              <>
                <dl className="workspace-report-totals">
                  {[
                    ["Enquiries received", report.enquiries],
                    ["Test-drive enquiries", report.testDrivesRequested],
                    ["Cars marked sold", report.carsSold],
                    ["Confirmed received", money(report.receivedPence)],
                    ["Confirmed paid out", money(report.refundsPence)],
                    ["Net received", money(report.netReceivedPence)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  Current outstanding across open sales:{" "}
                  <strong>{money(report.currentOutstandingPence)}</strong>.
                  Customer credit:{" "}
                  <strong>{money(report.currentCustomerCreditPence)}</strong>.
                </p>
                <p>
                  Money received is not profit. Pending payments are excluded.
                  Current balances cover open sales across all dates.
                  {report.unreviewedBalances > 0 &&
                    ` ${report.unreviewedBalances} ${report.unreviewedBalances === 1 ? "balance needs" : "balances need"} review and ${report.unreviewedBalances === 1 ? "is" : "are"} excluded.`}
                </p>
                <Button variant="outline" onClick={() => void download()}>
                  <Download size={17} />
                  Download CSV
                </Button>
                {downloadError && <p role="alert">{downloadError}</p>}
                <section
                  className="workspace-website-events"
                  aria-label="Website event counts"
                >
                  <h3>Website activity</h3>
                  <p>
                    Event counts can include repeat visits. They are not unique
                    people or conversion rates.
                  </p>
                  {journey.isFetching ? (
                    <p role="status">Loading website activity…</p>
                  ) : journey.data?.totals ? (
                    <>
                      <dl className="workspace-report-totals">
                        {[
                          ["Stock searches", journey.data.totals.search],
                          ["Vehicle views", journey.data.totals.vehicle],
                          ["Enquiry sends", journey.data.totals.enquiry],
                          [
                            "Test-drive requests",
                            journey.data.totals.appointmentRequest,
                          ],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <Button variant="outline" onClick={downloadEvents}>
                        <Download size={17} />
                        Download website events CSV
                      </Button>
                    </>
                  ) : (
                    <p>Website activity is unavailable for this period.</p>
                  )}
                </section>
              </>
            )
          )}
        </>
      )}
    </details>
  );
}
