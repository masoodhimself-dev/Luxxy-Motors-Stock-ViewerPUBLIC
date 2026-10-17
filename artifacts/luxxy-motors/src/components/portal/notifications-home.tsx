import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  Bell,
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

const groups = {
  enquiries: { label: "Awaiting a reply", icon: MessageSquare },
  followups: { label: "Follow-ups due", icon: Clock3 },
  appointments: { label: "Bookings & today", icon: CalendarClock },
  drafts: { label: "Saved drafts", icon: FilePenLine },
  email: { label: "Email needs attention", icon: MailWarning },
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
  capabilities?: { aiDrafts: boolean; automaticDrafts: boolean; automaticSending: boolean };
};
export function useWorkspaceNotifications() {
  return useQuery({
    queryKey: ["staff-notifications"],
    queryFn: () => customFetch<Notifications>("/api/staff/notifications"),
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
export function NotificationsHome({ embedded = false }: { embedded?: boolean } = {}) {
  const query = useWorkspaceNotifications(),
    data = query.data;
  const [filter, setFilter] = useState<Category | "all">("all");
  const categories = (Object.keys(groups) as Category[]).filter(
    (key) => data?.emailAccess || !["drafts", "email"].includes(key),
  );
  const rows = (data?.items ?? []).filter(
    (item) => filter === "all" || filter === item.category,
  );
  const count = data
    ? categories.reduce((total, key) => total + data.counts[key], 0)
    : 0;
  return (
    <section
      className="notifications-home"
      aria-label="Workspace notifications"
    >
      <header className="notifications-heading">
        {!embedded && <div>
          <p className="notifications-kicker">
            <Bell size={15} aria-hidden="true" />
            Your working day
          </p>
          <h2>Notifications</h2>
          <p>See what needs attention, then pick up where you left off.</p>
        </div>}
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </Button>
      </header>
      {query.isLoading && <p role="status">Loading your next actions…</p>}
      {query.isError && (
        <p className="notifications-error" role="alert">
          Notifications could not be refreshed. Use Refresh to try again.
          {data && " The last loaded actions are shown below."}
        </p>
      )}
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
                  aria-pressed={filter === key}
                  onClick={() => setFilter(filter === key ? "all" : key)}
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
                  <p>Opening an item does not mark the work as complete.</p>
                </div>
                {filter !== "all" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setFilter("all")}
                  >
                    Show all
                  </Button>
                )}
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
              <ul>
                {rows.map((item) => {
                  const Icon = groups[item.category].icon;
                  return (
                    <li key={`${item.category}:${item.id}`}>
                      <span
                        className={`notifications-icon notifications-icon-${item.category}`}
                      >
                        <Icon size={20} aria-hidden="true" />
                      </span>
                      <div className="notifications-record">
                        <span className="notifications-type">
                          {item.detail}
                        </span>
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
              {categories.some(
                (key) =>
                  (filter === "all" || key === filter) && data.counts[key] > 8,
              ) && (
                <p className="notifications-footnote">
                  Showing the first eight actions in each category. Open
                  Enquiries or Email for the full list.
                </p>
              )}
            </section>
            <aside className="notifications-sidebar">
              <article>
                <FilePenLine size={22} aria-hidden="true" />
                <h3>Prepare now. Send when ready.</h3>
                <p>
                  Save a reply against the customer, add vehicle photos or an
                  invoice, then review it before sending.
                </p>
                {data.emailAccess && (
                  <Link href="/portal?section=notifications&workView=email&view=drafts">
                    Open saved drafts
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                )}
              </article>
              <article className="notifications-quiet-note">
                <h3>{data.emailAccess && data.capabilities?.aiDrafts ? 'AI reply drafts' : 'AI preparation'}</h3>
                <p>
                  {data.emailAccess && data.capabilities?.aiDrafts
                    ? 'Choose Draft with AI when preparing a reply. Check the suggestion, make any changes, then review and send it yourself. Automatic sending is off.'
                    : 'AI drafting and new automatic email sending are off. Saved drafts give your team a place to review future suggestions.'}
                </p>
              </article>
              <Link
                className="notifications-overview-link"
                href="/portal?section=overview"
              >
                View dealership overview
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </aside>
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
    </section>
  );
}
