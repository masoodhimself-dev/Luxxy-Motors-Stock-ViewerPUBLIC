import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { DealerRelationships } from "@workspace/vehicle-meta";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  BookmarkCheck,
  CalendarClock,
  CarFront,
  ChevronRight,
  FileText,
  History,
  Mail,
  MessageSquare,
  NotebookPen,
  Phone,
  RefreshCw,
  Search,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "./relationships-panel.css";

type Vehicle = DealerRelationships["vehicles"][number];
type Customer = DealerRelationships["customers"][number];
type Activity = Vehicle["activities"][number];
type Counts = Vehicle["counts"];
type View = "vehicles" | "customers";
type TimelineFilter =
  "all" | "enquiries" | "appointments" | "reservations" | "sales" | "chat";

const filters: { id: TimelineFilter; label: string }[] = [
  { id: "all", label: "All activity" },
  { id: "enquiries", label: "Enquiries" },
  { id: "appointments", label: "Appointments" },
  { id: "reservations", label: "Reservations" },
  { id: "sales", label: "Sales" },
  { id: "chat", label: "Chat" },
];
const kindLabels: Record<Activity["kind"], string> = {
  enquiry: "Enquiry",
  appointment: "Appointment",
  follow_up: "Follow-up",
  reservation: "Reservation",
  sale: "Sale",
  payment: "Payment",
  document: "Document",
  note: "Note",
  chat: "Chat",
};
const activityIcons = {
  enquiry: MessageSquare,
  appointment: CalendarClock,
  follow_up: CalendarClock,
  reservation: BookmarkCheck,
  sale: CarFront,
  payment: Banknote,
  document: FileText,
  note: NotebookPen,
  chat: MessageSquare,
};
const recordLabels: Record<Activity["recordType"], string> = {
  enquiry: "Enquiry",
  reservation: "Reservation",
  sale: "Sale file",
};
const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});
const shortDate = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Europe/London",
});
const currency = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

function readableDate(value: string | null, withTime = true) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return (withTime ? dateTime : shortDate).format(new Date(value));
}
function readableStatus(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase());
}
function money(value: number | null) {
  return value !== null && Number.isFinite(value)
    ? currency.format(value / 100)
    : null;
}
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}
function includesSearch(values: (string | null | undefined)[], term: string) {
  const words = term.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = values.filter(Boolean).join(" ").toLocaleLowerCase();
  // Registration and telephone searches also work without the stored spaces.
  const compactText = text.replace(/[^\p{L}\p{N}@]/gu, "");
  return words.every((word) => {
    const compactWord = word.replace(/[^\p{L}\p{N}@]/gu, "");
    return (
      text.includes(word) ||
      (compactWord.length > 0 && compactText.includes(compactWord))
    );
  });
}
function matchesFilter(activity: Activity, filter: TimelineFilter) {
  if (filter === "all") return true;
  if (filter === "chat") return activity.kind === "chat";
  if (filter === "appointments") return activity.kind === "appointment";
  if (filter === "sales")
    return (
      activity.recordType === "sale" ||
      activity.kind === "payment" ||
      activity.kind === "document"
    );
  if (filter === "enquiries")
    return activity.recordType === "enquiry" && activity.kind !== "appointment";
  return (
    activity.recordType === "reservation" &&
    activity.kind !== "payment" &&
    activity.kind !== "document"
  );
}
function CountSummary({ counts }: { counts: Counts }) {
  return (
    <dl className="relationship-counts">
      {[
        ["Enquiries", counts.enquiries],
        ["Appointments", counts.appointments],
        ["Reservations", counts.reservations],
        ["Sales", counts.sales],
      ].map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function CompactCounts({
  counts,
  activityCount,
}: {
  counts: Counts;
  activityCount: number;
}) {
  const values = [
    [counts.enquiries, "enquiry", "enquiries"],
    [counts.appointments, "appointment", "appointments"],
    [counts.reservations, "reservation", "reservations"],
    [counts.sales, "sale", "sales"],
  ] as const;
  const visible = values.filter(([count]) => count > 0);
  return visible.length ? (
    <span className="relationship-list-counts">
      {visible.map(([count, one, many]) => (
        <span key={one}>
          {count} {count === 1 ? one : many}
        </span>
      ))}
    </span>
  ) : (
    <span className="relationship-list-counts">
      {activityCount
        ? `${activityCount} recorded ${activityCount === 1 ? "event" : "events"}`
        : "No recorded activity"}
    </span>
  );
}
function ActivityDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const long = description.length > 260 || description.split("\n").length > 4;
  const preview = description
    .slice(0, 260)
    .replace(/\s+\S*$/, "")
    .trimEnd();
  if (!description.trim()) return null;
  return (
    <div className="relationship-description">
      <p id={id}>{long && !expanded ? `${preview}…` : description}</p>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Read full message"}
        </button>
      )}
    </div>
  );
}
function Timeline({
  activities,
  filter,
  onFilterChange,
}: {
  activities: Activity[];
  filter: TimelineFilter;
  onFilterChange: (filter: TimelineFilter) => void;
}) {
  const visible = useMemo(
    () =>
      activities
        .filter((activity) => matchesFilter(activity, filter))
        .sort(
          (a, b) =>
            (Date.parse(b.occurredAt) || 0) - (Date.parse(a.occurredAt) || 0),
        ),
    [activities, filter],
  );
  return (
    <section
      className="relationship-timeline"
      aria-label="Activity history"
      data-testid="history-timeline"
    >
      <div className="relationship-timeline-heading">
        <div>
          <p className="relationship-kicker">The full picture</p>
          <h3>Activity timeline</h3>
        </div>
        <span>
          {activities.length} recorded{" "}
          {activities.length === 1 ? "event" : "events"}
        </span>
      </div>
      <div
        className="relationship-filters"
        role="group"
        aria-label="Filter activity timeline"
      >
        {filters.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={filter === item.id}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {!visible.length ? (
        <div className="relationship-empty relationship-timeline-empty">
          <History aria-hidden="true" />
          <h4>
            {activities.length
              ? "No activity in this category"
              : "No activity recorded yet"}
          </h4>
          <p>
            {activities.length
              ? "Choose another category to review the rest of this history."
              : "Enquiries, appointments, reservations and sales will appear here when they are recorded."}
          </p>
          {activities.length > 0 && (
            <button type="button" onClick={() => onFilterChange("all")}>
              Show all activity
            </button>
          )}
        </div>
      ) : (
        <ol className="relationship-events">
          {visible.map((activity) => {
            const Icon = activityIcons[activity.kind];
            const timestamp = readableDate(activity.occurredAt);
            const amount = money(activity.amountPence);
            return (
              <li
                key={activity.id}
                className="relationship-event"
                data-testid={`relationship-activity-${activity.id}`}
              >
                <span
                  className={`relationship-event-icon relationship-event-icon-${activity.kind}`}
                >
                  <Icon aria-hidden="true" />
                </span>
                <article className="relationship-event-content">
                  <div className="relationship-event-meta">
                    <span className="relationship-kind">
                      {kindLabels[activity.kind]}
                    </span>
                    {activity.status && (
                      <span className="relationship-status">
                        {readableStatus(activity.status)}
                      </span>
                    )}
                    {timestamp && (
                      <time dateTime={activity.occurredAt}>{timestamp}</time>
                    )}
                  </div>
                  <div className="relationship-event-title">
                    <h4>{activity.title}</h4>
                    {amount && <strong>{amount}</strong>}
                  </div>
                  <p className="relationship-record-reference">
                    {recordLabels[activity.recordType]}
                    {activity.reference && (
                      <>
                        {" "}
                        · <span>{activity.reference}</span>
                      </>
                    )}
                  </p>
                  <ActivityDescription description={activity.description} />
                  {activity.url && (
                    <Link
                      href={activity.url}
                      className="relationship-source-link"
                    >
                      Open {activity.kind === 'chat' ? 'conversation' : recordLabels[activity.recordType].toLowerCase()}
                      <ArrowUpRight aria-hidden="true" />
                    </Link>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      )}
      {visible.length > 0 && (
        <p className="relationship-time-note">
          Dates and times shown in London time.
        </p>
      )}
    </section>
  );
}

export function RelationshipsPanel() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const view: View =
    params.get("view") === "customers" ||
    (!params.has("view") && params.has("customerId"))
      ? "customers"
      : "vehicles";
  const requestedId = params.get(
    view === "vehicles" ? "vehicleId" : "customerId",
  );
  const requestedRecord = params.get("record");
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const query = useQuery({
    queryKey: ["staff-relationships"],
    queryFn: ({ signal }) =>
      customFetch<DealerRelationships>("/api/staff/relationships", { signal }),
    retry: false,
    staleTime: 30_000,
  });
  const data = query.data;
  const vehicle =
    view === "vehicles"
      ? (data?.vehicles.find((item) => item.id === requestedId) ??
        (requestedRecord
          ? data?.vehicles.find((item) =>
              item.activities.some(
                (activity) =>
                  `${activity.recordType}:${activity.recordId}` ===
                  requestedRecord,
              ),
            )
          : undefined))
      : undefined;
  const customer =
    view === "customers"
      ? (data?.customers.find((item) => item.id === requestedId) ??
        (requestedRecord
          ? data?.customers.find((item) =>
              item.recordKeys.includes(requestedRecord),
            )
          : undefined))
      : undefined;
  const selected = vehicle ?? customer;
  const selectionRequested = Boolean(requestedId || requestedRecord);
  const selectionKey = `${view}:${selected?.id ?? requestedId ?? requestedRecord ?? ""}`;
  useEffect(() => {
    setTerm("");
  }, [view]);
  useEffect(() => {
    setFilter("all");
  }, [selectionKey]);
  function showProfile(nextView: View, id?: string, record?: string) {
    const next = new URLSearchParams({ section: "history", view: nextView });
    if (id) next.set(nextView === "vehicles" ? "vehicleId" : "customerId", id);
    if (record) next.set("record", record);
    navigate(`/portal?${next.toString()}`);
  }
  const visibleVehicles =
    data?.vehicles.filter((item) =>
      includesSearch(
        [
          item.title,
          item.registration,
          ...item.activities.map((activity) => activity.reference),
        ],
        term,
      ),
    ) ?? [];
  const visibleCustomers =
    data?.customers.filter((item) =>
      includesSearch(
        [
          item.name,
          item.email,
          item.phone,
          ...item.activities.map((activity) => activity.reference),
        ],
        term,
      ),
    ) ?? [];
  const total =
    (view === "vehicles" ? data?.vehicles.length : data?.customers.length) ?? 0;
  const visibleCount =
    view === "vehicles" ? visibleVehicles.length : visibleCustomers.length;
  const listLabel = view === "vehicles" ? "vehicles" : "customers";
  const linkedCustomers = vehicle
    ? (data?.customers.filter((item) =>
        vehicle.customerIds.includes(item.id),
      ) ?? [])
    : [];
  const linkedVehicles = customer
    ? (data?.vehicles.filter((item) => customer.vehicleIds.includes(item.id)) ??
      [])
    : [];
  const updatedAt = readableDate(data?.generatedAt ?? null);

  return (
    <section
      className="relationships-panel"
      aria-label="Vehicle and customer history"
      data-testid="history-panel"
    >
      <header className="relationship-heading">
        <div>
          <p className="relationship-kicker">Connected records</p>
          <h2>Vehicle &amp; customer history</h2>
          <p>
            Follow every recorded enquiry, appointment and sale, from the car or
            the customer's point of view.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw
            className={query.isFetching ? "relationship-refreshing" : ""}
            aria-hidden="true"
          />
          {query.isFetching ? "Refreshing…" : "Refresh history"}
        </Button>
      </header>
      <nav className="relationship-views" aria-label="History views">
        <button
          type="button"
          aria-current={view === "vehicles" ? "page" : undefined}
          onClick={() => showProfile("vehicles")}
        >
          <CarFront aria-hidden="true" />
          Vehicle history{data && <span>{data.vehicles.length}</span>}
        </button>
        <button
          type="button"
          aria-current={view === "customers" ? "page" : undefined}
          onClick={() => showProfile("customers")}
        >
          <Users aria-hidden="true" />
          Customer history{data && <span>{data.customers.length}</span>}
        </button>
      </nav>
      {query.isError && (
        <div className="relationship-error" role="alert">
          <strong>
            {data
              ? "History could not be refreshed."
              : "History could not be loaded."}
          </strong>
          <p>
            {data
              ? "The last loaded records are still shown. Try refreshing again."
              : "Please try again to retrieve your dealership records."}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            Try again
          </Button>
        </div>
      )}
      {!data && query.isPending && (
        <div className="relationship-loading" role="status">
          <History aria-hidden="true" />
          <p>Loading vehicle and customer history…</p>
        </div>
      )}
      {data && (
        <div
          className={`relationship-workspace ${selectionRequested ? "has-selection" : ""}`}
        >
          <section
            className="relationship-directory"
            aria-label={
              view === "vehicles" ? "Vehicle histories" : "Customer histories"
            }
          >
            <div className="relationship-directory-heading">
              <div>
                <h3>
                  {view === "vehicles" ? "Find a vehicle" : "Find a customer"}
                </h3>
                <p>
                  {view === "vehicles"
                    ? "Search by vehicle, registration or reference."
                    : "Search by name, email, phone or reference."}
                </p>
              </div>
              <label className="relationship-search">
                <span className="sr-only">
                  {view === "vehicles"
                    ? "Search vehicle history"
                    : "Search customer history"}
                </span>
                <Search aria-hidden="true" />
                <Input
                  type="search"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder={
                    view === "vehicles"
                      ? "Vehicle or registration"
                      : "Name or contact details"
                  }
                />
              </label>
              <p className="relationship-results" role="status">
                {term.trim()
                  ? `${visibleCount} of ${total} ${listLabel}`
                  : `${total} ${listLabel} with recorded history`}
              </p>
            </div>
            {view === "customers" && (
              <p className="relationship-grouping-note">
                Contact profiles bring together records with matching contact
                details. Review the grouping note in each profile.
              </p>
            )}
            {visibleCount === 0 ? (
              <div className="relationship-empty">
                <Search aria-hidden="true" />
                <h3>
                  {term.trim()
                    ? "No matching histories"
                    : view === "vehicles"
                      ? "No vehicle history yet"
                      : "No customer history yet"}
                </h3>
                <p>
                  {term.trim()
                    ? "Try another name, registration, contact detail or reference."
                    : "History appears as enquiries, reservations and sales are recorded."}
                </p>
                {term.trim() && (
                  <button type="button" onClick={() => setTerm("")}>
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <ul className="relationship-profile-list">
                {view === "vehicles"
                  ? visibleVehicles.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="relationship-profile-row"
                          aria-current={
                            vehicle?.id === item.id ? "true" : undefined
                          }
                          onClick={() => showProfile("vehicles", item.id)}
                          data-testid={`relationship-vehicle-${item.id}`}
                        >
                          {item.imageUrl && (
                            <img
                              className="relationship-row-image"
                              src={item.imageUrl}
                              alt=""
                              loading="lazy"
                            />
                          )}
                          <span className="relationship-row-copy">
                            <strong>{item.title}</strong>
                            <span className="relationship-row-facts">
                              {item.registration && (
                                <span className="relationship-registration">
                                  {item.registration}
                                </span>
                              )}
                              {item.status && (
                                <span>{readableStatus(item.status)}</span>
                              )}
                            </span>
                            <CompactCounts
                              counts={item.counts}
                              activityCount={item.activities.length}
                            />
                            {readableDate(item.lastActivityAt, false) && (
                              <span className="relationship-last-activity">
                                Latest{" "}
                                {readableDate(item.lastActivityAt, false)}
                              </span>
                            )}
                          </span>
                          <ChevronRight
                            className="relationship-row-chevron"
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    ))
                  : visibleCustomers.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="relationship-profile-row"
                          aria-current={
                            customer?.id === item.id ? "true" : undefined
                          }
                          onClick={() =>
                            showProfile(
                              "customers",
                              item.id,
                              item.recordKeys[0],
                            )
                          }
                          data-testid={`relationship-customer-${item.id}`}
                        >
                          <span
                            className="relationship-avatar"
                            aria-hidden="true"
                          >
                            {initials(item.name) || <UserRound />}
                          </span>
                          <span className="relationship-row-copy">
                            <strong>{item.name}</strong>
                            {item.email && (
                              <span className="relationship-row-contact">
                                {item.email}
                              </span>
                            )}
                            {item.phone && (
                              <span className="relationship-row-contact">
                                {item.phone}
                              </span>
                            )}
                            <CompactCounts
                              counts={item.counts}
                              activityCount={item.activities.length}
                            />
                            {readableDate(item.lastActivityAt, false) && (
                              <span className="relationship-last-activity">
                                Latest{" "}
                                {readableDate(item.lastActivityAt, false)}
                              </span>
                            )}
                          </span>
                          <ChevronRight
                            className="relationship-row-chevron"
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    ))}
              </ul>
            )}
          </section>
          {selectionRequested && (
            <div className="relationship-detail">
              <button
                type="button"
                className="relationship-back"
                onClick={() => showProfile(view)}
              >
                <ArrowLeft aria-hidden="true" />
                Back to {view === "vehicles" ? "vehicles" : "customers"}
              </button>
              {!selected ? (
                <div className="relationship-missing">
                  <h3>This history could not be found</h3>
                  <p>
                    The linked record may no longer be available. Choose a
                    profile from the current histories.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => showProfile(view)}
                  >
                    Browse {listLabel}
                  </Button>
                </div>
              ) : (
                <>
                  <article
                    className="relationship-profile"
                    aria-label={
                      vehicle
                        ? "Selected vehicle history"
                        : "Selected customer history"
                    }
                  >
                    <header className="relationship-profile-heading">
                      {vehicle?.imageUrl && (
                        <img
                          className="relationship-profile-image"
                          src={vehicle.imageUrl}
                          alt={vehicle.title}
                        />
                      )}
                      {customer && (
                        <span
                          className="relationship-avatar relationship-avatar-large"
                          aria-hidden="true"
                        >
                          {initials(customer.name) || <UserRound />}
                        </span>
                      )}
                      <div>
                        <p className="relationship-kicker">
                          {vehicle ? "Vehicle history" : "Contact profile"}
                        </p>
                        <h3>{vehicle?.title ?? customer?.name}</h3>
                        {vehicle && (
                          <div className="relationship-profile-facts">
                            {vehicle.registration && (
                              <span className="relationship-registration">
                                {vehicle.registration}
                              </span>
                            )}
                            {vehicle.status && (
                              <span className="relationship-status">
                                {readableStatus(vehicle.status)}
                              </span>
                            )}
                            {money(vehicle.pricePence) && (
                              <strong>{money(vehicle.pricePence)}</strong>
                            )}
                          </div>
                        )}
                        {customer && (
                          <div className="relationship-contact-details">
                            {customer.email && (
                              <a href={`mailto:${customer.email}`}>
                                <Mail aria-hidden="true" />
                                {customer.email}
                              </a>
                            )}
                            {customer.phone && (
                              <a href={`tel:${customer.phone}`}>
                                <Phone aria-hidden="true" />
                                {customer.phone}
                              </a>
                            )}
                          </div>
                        )}
                        {readableDate(selected.lastActivityAt) && (
                          <p className="relationship-latest">
                            Latest recorded activity ·{" "}
                            {readableDate(selected.lastActivityAt)}
                          </p>
                        )}
                      </div>
                    </header>
                    {customer?.matchingNote && (
                      <p className="relationship-match-note">
                        <Users aria-hidden="true" />
                        <span>{customer.matchingNote}</span>
                      </p>
                    )}
                    <CountSummary counts={selected.counts} />
                  </article>
                  {linkedCustomers.length > 0 && (
                    <section
                      className="relationship-connections"
                      aria-label="Interested customers"
                    >
                      <h3>
                        Interested customers{" "}
                        <span>{linkedCustomers.length}</span>
                      </h3>
                      <div>
                        {linkedCustomers.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() =>
                              showProfile(
                                "customers",
                                item.id,
                                item.recordKeys[0],
                              )
                            }
                          >
                            <span
                              className="relationship-avatar"
                              aria-hidden="true"
                            >
                              {initials(item.name) || <UserRound />}
                            </span>
                            <span>
                              <strong>{item.name}</strong>
                              {item.email && <small>{item.email}</small>}
                            </span>
                            <ArrowUpRight aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  {linkedVehicles.length > 0 && (
                    <section
                      className="relationship-connections"
                      aria-label="Cars in this history"
                    >
                      <h3>
                        Cars in this history{" "}
                        <span>{linkedVehicles.length}</span>
                      </h3>
                      <div>
                        {linkedVehicles.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => showProfile("vehicles", item.id)}
                          >
                            {item.imageUrl && (
                              <img src={item.imageUrl} alt="" loading="lazy" />
                            )}
                            <span>
                              <strong>{item.title}</strong>
                              {item.registration && (
                                <small>{item.registration}</small>
                              )}
                            </span>
                            <ArrowUpRight aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  <Timeline
                    key={selectionKey}
                    activities={selected.activities}
                    filter={filter}
                    onFilterChange={setFilter}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
      {data && updatedAt && (
        <p className="relationship-updated">
          Records updated {updatedAt} · London time
        </p>
      )}
    </section>
  );
}
