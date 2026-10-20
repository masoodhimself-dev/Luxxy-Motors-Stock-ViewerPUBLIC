import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  ArrowUpRight,
  CalendarClock,
  CheckCheck,
  Clock3,
  FilePenLine,
  MailWarning,
  CustomerEnquiry,
  RefreshCw,
} from "@/components/icons";
import { notificationsLink } from "@/lib/notifications-navigation";
import { Button } from "@/components/ui/button";
import "./notifications-home.css";
import { DealerDashboard } from "./dealer-administration";
import { useStockChangeTasks } from "@/lib/stock-change-tasks";
import { StockChangeTasks } from "./stock-change-tasks";

const groups = {
  enquiries: { label: "Awaiting a reply", icon: CustomerEnquiry, tone: "info" },
  followups: { label: "Follow-ups due", icon: Clock3, tone: "warning" },
  appointments: {
    label: "Bookings & today",
    icon: CalendarClock,
    tone: "teal",
  },
  drafts: { label: "Saved drafts", icon: FilePenLine, tone: "violet" },
  email: { label: "Email needs attention", icon: MailWarning, tone: "danger" },
};
type Category = keyof typeof groups;
export type Notifications = {
  generatedAt: string;
  counts: Record<Category, number>;
  items: {
    id: string;
    category: Category;
    customer: string;
    vehicle: string | null;
    reference: string;
    at: string;
    detail: string;
    href: string;
    phone?: string | null;
    preview?: string | null;
    enquiryId?: string;
  }[];
  emailAccess: boolean;
  capabilities?: {
    aiDrafts: boolean;
    automaticDrafts: boolean;
    automaticSending: boolean;
  };
};
type NotificationItem = Notifications["items"][number];
const visibleActionLimit = 6;
const londonDay = (value: string) => new Date(value).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
function actionPriority(item: NotificationItem, generatedAt: string) {
  if (item.category === "followups") return 0;
  if (item.category === "email" || /unconfirmed|check before resending/i.test(item.detail)) return 1;
  if (item.category === "appointments") {
    const due = Date.parse(item.at) - Date.parse(generatedAt);
    return londonDay(item.at) === londonDay(generatedAt) && due <= 2 * 60 * 60 * 1000 ? 2 : 3;
  }
  return item.category === "enquiries" ? 4 : 5;
}
function actionTiming(item: NotificationItem, generatedAt: string) {
  const elapsed = Date.parse(generatedAt) - Date.parse(item.at);
  if (!Number.isFinite(elapsed)) return null;
  if (item.category === "followups") {
    const hours = Math.floor(elapsed / 3_600_000);
    return hours >= 24 ? `${Math.floor(hours / 24)}d overdue` : hours >= 1 ? `${hours}h overdue` : "Due now";
  }
  if (item.category === "appointments" && londonDay(item.at) === londonDay(generatedAt)) {
    if (item.detail === "Booking needs approval") return elapsed > 0 ? "Time passed — review request" : "Awaiting approval";
    return elapsed > 0 ? "Check attendance" : `Today ${new Date(item.at).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}`;
  }
  if (item.category === "enquiries" && elapsed >= 24 * 3_600_000) return `Waiting ${Math.floor(elapsed / (24 * 3_600_000))}d`;
  return null;
}
export function useWorkspaceNotifications() {
  return useQuery({
    queryKey: ["staff-notifications"],
    queryFn: () => customFetch<Notifications>("/api/staff/notifications"),
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
export function NotificationsHome({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const client = useQueryClient();
  const query = useWorkspaceNotifications(),
    data = query.data;
  const stockChanges = useStockChangeTasks();
  const stockCount = Math.max(stockChanges.data?.total ?? 0, stockChanges.data?.tasks?.length ?? 0);
  const [filter, setFilter] = useState<Category | "all" | "stock">("all");
  const [expanded, setExpanded] = useState(false);
  const categories = (Object.keys(groups) as Category[]).filter(
    (key) => data?.emailAccess || !["drafts", "email"].includes(key),
  );
  const items = (data?.items ?? []).filter(item => categories.includes(item.category));
  const sortItems = (rows: NotificationItem[]) => [...rows].sort((a,b) => actionPriority(a, data!.generatedAt) - actionPriority(b, data!.generatedAt) || Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const groupItems = (rows: NotificationItem[]) => {
    const cases = new Map<string, NotificationItem>();
    for (const item of sortItems(rows)) {
      const key = item.enquiryId || item.id.split(":")[0];
      if (!cases.has(key)) cases.set(key, item);
    }
    return [...cases.values()];
  };
  const contacts = groupItems(items.filter(item => (item.category === "enquiries" || item.category === "followups") && (filter === "all" || item.category === filter)));
  const visits = sortItems(items.filter(item => item.category === "appointments"));
  const issues = groupItems(items.filter(item => item.category === "email" || (item.category === "drafts" && /unconfirmed|sending|check before resending/i.test(item.detail))));
  const chooseFilter = (next: Category | "all" | "stock") => { setFilter(next); setExpanded(false); };
  const count = categories.reduce((total, key) => total + (data?.counts[key] ?? 0), 0);
  const refresh = (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Refresh day"
      disabled={query.isFetching || stockChanges.isFetching}
      onClick={() => {
        void query.refetch();
        void stockChanges.refetch();
        void client.invalidateQueries({ queryKey: ["dealer-operations"] });
      }}
    >
      <RefreshCw size={15} aria-hidden="true" />
      <span>Refresh</span>
    </Button>
  );
  function actionList(rows: NotificationItem[], kind: "contacts" | "visits" | "email" | "drafts") {
    const visible = expanded ? rows : rows.slice(0, visibleActionLimit);
    return <><ul>{visible.map(item => {
      const id = item.enquiryId || item.id.split(":")[0];
      const href = kind === "visits" ? `/portal?section=notifications&workView=test-drives&enquiryId=${encodeURIComponent(id)}` : notificationsLink(item.href);
      const timing = actionTiming(item, data!.generatedAt);
      return <li key={`${item.category}:${item.id}`} data-tone={groups[item.category].tone}>
        <div className="notifications-record">
          <div className="notifications-record-heading"><span className="notifications-type">{kind === "contacts" ? item.category === "followups" ? "Call today" : "Reply needed" : kind === "email" ? "Check email history before sending again" : item.detail}</span>{timing && <span className="notifications-timing" data-urgent={item.category === "followups"}>{timing}</span>}</div>
          <h4><Link href={href}>{item.customer}<ArrowUpRight size={15} aria-hidden="true" /></Link></h4>
          <p>{item.vehicle || "General enquiry"}</p>
          {kind === "visits" && <time dateTime={item.at}>{new Date(item.at).toLocaleString("en-GB", {timeZone:"Europe/London",dateStyle:"medium",timeStyle:"short"})}</time>}
          {kind === "contacts" && item.preview && <p className="notifications-preview">{item.preview}</p>}
          {kind === "email" && <p className="notifications-preview">{item.detail}</p>}
        </div>
        <div className="notifications-row-actions">
          {kind === "contacts" && item.phone && <a href={`tel:${item.phone.replace(/[^+\d]/g, "")}`}>Call</a>}
          {kind === "contacts" && data!.emailAccess && <Link href={`/portal?section=notifications&workView=email&compose=${encodeURIComponent(id)}`}>Reply</Link>}
          <Link href={href}>{kind === "visits" ? "Review visit" : kind === "email" ? "Check email" : kind === "drafts" ? "Continue draft" : "Open enquiry"}</Link>
        </div>
      </li>;
    })}</ul>{rows.length > visibleActionLimit && <div className="notifications-expand"><Button type="button" variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show all ${rows.length}`}</Button></div>}</>;
  }
  return <section className="notifications-home compact-dealer-desk" aria-label="Workspace notifications">
    {!embedded && <header className="notifications-heading"><h2>Your day</h2></header>}
    <DealerDashboard compact>
      {query.isLoading && <p role="status">Loading your day…</p>}
      {query.isError && <p className="notifications-error" role="alert">Notifications could not be refreshed. Use Refresh to try again.{data && " The last loaded actions are shown below."}</p>}
      {query.isError && !data && !stockChanges.data && refresh}
      {(data || stockChanges.data) && <>
        <div className="desk-filters" aria-label="Notification categories">
          <button type="button" aria-pressed={filter === "all"} onClick={() => chooseFilter("all")}>All work</button>
          {(["enquiries", "followups", "appointments"] as Category[]).filter(key => (data?.counts[key] ?? 0) > 0).map(key => <button key={key} type="button" data-tone={groups[key].tone} aria-pressed={filter === key} onClick={() => chooseFilter(filter === key ? "all" : key)}>{groups[key].label} <b>{data!.counts[key]}</b></button>)}
          {(stockCount > 0 || filter === "stock") && <button type="button" aria-pressed={filter === "stock"} onClick={() => chooseFilter(filter === "stock" ? "all" : "stock")}>Stock changes <b>{stockCount}</b></button>}
          {refresh}
        </div>
      </>}
      {(filter === "all" || filter === "stock") && <StockChangeTasks query={stockChanges} emailAccess={data?.emailAccess === true} showEmpty={filter === "stock"} />}
      {data && filter !== "stock" && <>
        <div className="desk-priorities">
          {filter !== "appointments" && <section className="notifications-feed" aria-label="Customers to contact"><header><h3>Customers to contact <small>{contacts.length}</small></h3></header>
            {actionList(contacts, "contacts")}
            {!contacts.length && <div className="notifications-empty"><CheckCheck size={22} aria-hidden="true"/><h3>No customers waiting</h3><p>New enquiries and due follow-ups appear here.</p></div>}
          </section>}
          {(filter === "all" || filter === "appointments") && <section className="notifications-feed" aria-label="Today’s appointments"><header><h3>Today’s appointments <small>{visits.filter(item => londonDay(item.at) === londonDay(data.generatedAt)).length}</small></h3><Link href="/portal?section=notifications&workView=test-drives&deskView=calendar">Calendar</Link></header>
            {actionList(visits, "visits")}
            {!visits.length && <div className="notifications-empty"><CalendarClock size={22} aria-hidden="true"/><h3>No visits to prepare</h3><p>Today’s visits and booking requests appear here.</p></div>}
          </section>}
        </div>
        {data.emailAccess && <div className="desk-secondary">
          {(data.counts.email > 0 || issues.length > 0) && <details className="notifications-feed desk-email-issues"><summary><MailWarning size={17} aria-hidden="true"/>Email issues · {issues.length}<span>Review delivery problems</span></summary>{actionList(issues,"email")}<Link href="/portal?section=notifications&workView=email">Open email history</Link></details>}
          {data.counts.drafts > 0 && <Link className="desk-drafts" href="/portal?section=notifications&workView=email&view=drafts"><FilePenLine size={17} aria-hidden="true"/>Open saved drafts<ArrowUpRight size={15} aria-hidden="true"/></Link>}
        </div>}
        {count === 0 && stockCount === 0 && query.isSuccess && stockChanges.isSuccess && <p className="desk-clear" role="status">You’re up to date</p>}
        {categories.some(key => data.counts[key] > 8) && <p className="notifications-footnote">Showing up to eight records per category. Open Customers & enquiries, Test drives or Email for the full list.</p>}
        <p className="notifications-updated">Updated {new Date(data.generatedAt).toLocaleTimeString("en-GB", {timeZone:"Europe/London",hour:"2-digit",minute:"2-digit"})} · London time</p>
      </>}
    </DealerDashboard>
  </section>;
}
