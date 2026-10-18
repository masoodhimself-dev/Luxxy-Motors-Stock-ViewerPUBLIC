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
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { notificationsLink } from "@/lib/notifications-navigation";
import { Button } from "@/components/ui/button";
import "./notifications-home.css";
import { DealerDashboard } from "./dealer-administration";

const groups = {
  enquiries: { label: "Awaiting a reply", icon: MessageSquare, tone: "info" },
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
  const [filter, setFilter] = useState<Category | "all">("all");
  const [expanded, setExpanded] = useState(false);
  const categories = (Object.keys(groups) as Category[]).filter(
    (key) => data?.emailAccess || !["drafts", "email"].includes(key),
  );
  const rows = (data?.items ?? []).filter(
    (item) =>
      categories.includes(item.category) &&
      (filter === "all" || filter === item.category),
  ).sort((a, b) => actionPriority(a, data!.generatedAt) - actionPriority(b, data!.generatedAt) || Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const visibleRows = expanded ? rows : rows.slice(0, visibleActionLimit);
  const chooseFilter = (next: Category | "all") => { setFilter(next); setExpanded(false); };
  const count = data
    ? categories.reduce((total, key) => total + data.counts[key], 0)
    : 0;
  const refresh = (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Refresh day"
      disabled={query.isFetching}
      onClick={() => {
        void query.refetch();
        void client.invalidateQueries({ queryKey: ["dealer-operations"] });
      }}
    >
      <RefreshCw size={15} aria-hidden="true" />
      Refresh
    </Button>
  );
  return (
    <section
      className="notifications-home"
      aria-label="Workspace notifications"
    >
      {!embedded && (
        <header className="notifications-heading">
          <h2>Your day</h2>
        </header>
      )}
      <DealerDashboard compact>
        {query.isLoading && <p role="status">Loading your next actions…</p>}
        {query.isError && (
          <p className="notifications-error" role="alert">
            Notifications could not be refreshed. Use Refresh to try again.
            {data && " The last loaded actions are shown below."}
          </p>
        )}
        {query.isError && !data && refresh}
        {data && (
          <>
            <div
              className="notifications-metrics"
              aria-label="Notification categories"
            >
              {categories.map((key) => {
                const Icon = groups[key].icon;
                return (
                  <button
                    type="button"
                    key={key}
                    data-tone={
                      data.counts[key] > 0 ? groups[key].tone : "neutral"
                    }
                    aria-pressed={filter === key}
                    onClick={() => chooseFilter(filter === key ? "all" : key)}
                  >
                    <Icon size={19} aria-hidden="true" />
                    <strong>{data.counts[key]}</strong>
                    <span>{groups[key].label}</span>
                  </button>
                );
              })}
            </div>
            <div className="notifications-layout">
              <section
                className="notifications-feed"
                aria-label="Actions needing attention"
              >
                <header>
                  <div>
                    <h3>
                      {filter === "all"
                        ? "Your next actions"
                        : groups[filter].label}
                    </h3>
                    <p className="notifications-feed-intro">{filter === "all" ? "Due work first, then visits and replies." : `${data.counts[filter]} ${data.counts[filter] === 1 ? "action" : "actions"} in this category`}</p>
                  </div>
                  <div className="notifications-feed-controls">
                    {filter !== "all" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => chooseFilter("all")}
                      >
                        Show all
                      </Button>
                    )}
                    {refresh}
                  </div>
                </header>
                {!rows.length && (
                  <div className="notifications-empty">
                    <CheckCheck size={28} aria-hidden="true" />
                    <h3>
                      {filter === "all"
                        ? "You’re up to date"
                        : "Nothing here right now"}
                    </h3>
                    <p>
                      {count === 0
                        ? "New enquiries, due follow-ups and saved drafts will appear here."
                        : "Choose another category to see your other actions."}
                    </p>
                  </div>
                )}
                <ul id="notifications-action-list">
                  {visibleRows.map((item) => {
                    const Icon = groups[item.category].icon;
                    const timing = actionTiming(item, data.generatedAt);
                    return (
                      <li
                        key={`${item.category}:${item.id}`}
                        data-tone={groups[item.category].tone}
                      >
                        <span
                          className={`notifications-icon notifications-icon-${item.category}`}
                        >
                          <Icon size={20} aria-hidden="true" />
                        </span>
                        <div className="notifications-record">
                          <div className="notifications-record-heading"><span className="notifications-type">{item.detail}</span>{timing && <span className="notifications-timing" data-urgent={item.category === "followups"}>{timing}</span>}</div>
                          <h4>
                            <Link href={notificationsLink(item.href)}>
                              {item.customer}
                              <ArrowUpRight size={16} aria-hidden="true" />
                            </Link>
                          </h4>
                          <p>
                            {item.vehicle || "General enquiry"}
                            <span> · {item.reference}</span>
                          </p>
                          <time dateTime={item.at}>
                            {new Date(item.at).toLocaleString("en-GB", {
                              timeZone: "Europe/London",
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </time>
                        </div>
                        {item.category === "enquiries" && data.emailAccess && (
                          <Link
                            className="notifications-reply"
                            href={`/portal?section=notifications&workView=email&compose=${encodeURIComponent(item.id)}`}
                          >
                            Prepare reply
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {rows.length > visibleActionLimit && <div className="notifications-expand"><span>Showing {visibleRows.length} of {rows.length} loaded actions</span><Button type="button" variant="ghost" size="sm" aria-expanded={expanded} aria-controls="notifications-action-list" onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show all ${rows.length} actions`}</Button></div>}
                {categories.some(
                  (key) =>
                    (filter === "all" || key === filter) &&
                    data.counts[key] > 8,
                ) && (
                  <p className="notifications-footnote">
                    Each category loads up to eight actions. Open
                    Customers & enquiries or Email for the full list.
                  </p>
                )}
              </section>
            </div>
            <p className="notifications-updated">
              Updated{" "}
              {new Date(data.generatedAt).toLocaleTimeString("en-GB", {
                timeZone: "Europe/London",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · London time
            </p>
          </>
        )}
      </DealerDashboard>
    </section>
  );
}
