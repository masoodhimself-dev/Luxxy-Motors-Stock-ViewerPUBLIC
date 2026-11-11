import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarDays, ChevronRight, CreditCard, Mail, MessageSquare, ShieldCheck } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { londonDate, nextDate, bookingDateLabel } from "@/lib/test-drive-dates";
import { vehicleDisplayTitle, vehicleRegistration } from "@/lib/utils";
import { calendarHref, notificationsLink } from "@/lib/notifications-navigation";
import { motTestTime } from "@/lib/mot-mileage-history";
import { Button } from "@/components/ui/button";
import { workspaceStatus } from "./cars-workspace-model";
import { useStaffCars, type StaffCar } from "./staff-cars-query";
import "./today-workspace.css";

const salesHref = "/portal?section=sales";
const enquiryHref = "/portal?section=notifications&workView=customers";
const carsHref = "/portal?section=cars";
const taskLimit = 8;

type CustomerWork = {
  category: "enquiries" | "followups" | "appointments" | "drafts" | "email";
  id: string;
  enquiryId: string;
  customer: string | null;
  vehicle: string | null;
  reference: string | null;
  at: string;
  detail: string;
  href: string;
};
type Notifications = {
  generatedAt: string;
  counts: Partial<Record<CustomerWork["category"], number>>;
  items: CustomerWork[];
};
type SaleSummary = {
  id: string;
  reference: string;
  updatedAt: string;
  listAttention: string;
  listLedgerKnown: boolean;
  listBalance: number;
  draft: { customer: string; vehicle: string; registration: string; vehicleId?: string | null };
  listHandover?: {
    method: "collection" | "delivery";
    status: string;
    scheduledDate?: string;
    timeWindow?: string;
  } | null;
};
type SalesAttention = { sales: SaleSummary[]; hasMore: boolean };
type Kind = "customers" | "sales" | "stock";
type Task = {
  key: string;
  kind: Kind;
  icon: typeof MessageSquare;
  title: string;
  context: string;
  label: string;
  tone?: "warning" | "urgent";
  action: string;
  href: string;
  priority: number;
  at: string;
};

const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const timeLabel = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const shortDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short",
});

export function useTodayNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ["staff-notifications"],
    queryFn: ({ signal }) => customFetch<Notifications>("/api/staff/notifications", { signal }),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
    retry: false,
  });
}

function bookingHref(item: CustomerWork) {
  return `/portal?section=notifications&workView=test-drives&enquiryId=${encodeURIComponent(item.enquiryId)}`;
}

function customerTask(item: CustomerWork, today: string): Task | null {
  const name = item.customer || "customer";
  const context = [item.vehicle, item.reference].filter(Boolean).join(" · ");
  const base = {
    key: `${item.category}:${item.id}`, kind: "customers" as const, context,
    at: item.at, icon: MessageSquare, href: notificationsLink(item.href),
  };
  switch (item.category) {
    case "enquiries":
      return { ...base, title: `Reply to ${name}`, label: "Needs reply", action: "Open enquiry", priority: 1 };
    case "followups":
      return { ...base, title: `Follow up with ${name}`, label: "Due", tone: "warning", action: "Open enquiry", priority: 1 };
    case "appointments": {
      if (item.detail !== "Booking needs approval") return null;
      const date = new Date(item.at);
      const dueToday = Number.isFinite(date.getTime()) && londonDate(date) === today;
      return {
        ...base, icon: CalendarDays, title: `Confirm ${name === "customer" ? "test-drive request" : `${name}’s test drive`}`,
        context: [item.vehicle, Number.isFinite(date.getTime()) ? `${shortDate.format(date)} at ${timeLabel.format(date)}` : null].filter(Boolean).join(" · "),
        label: dueToday ? "Due today" : "Awaiting approval", tone: "warning", action: "Open booking",
        href: bookingHref(item), priority: dueToday ? 0 : 2,
      };
    }
    case "drafts":
      return { ...base, icon: Mail, title: `Review draft for ${name}`, label: "Draft", action: "Open draft", priority: 3 };
    case "email":
      return { ...base, icon: Mail, title: `Review email for ${name}`, label: "Needs review", tone: "warning", action: "Open email", priority: 1 };
  }
}

function saleHref(sale: SaleSummary, action: string) {
  return `${salesHref}&saleId=${encodeURIComponent(sale.id)}&saleAction=${action}`;
}

function saleTask(sale: SaleSummary, permissions: { canManage: boolean; canRecordPayments: boolean; canHandover: boolean }): Task | null {
  const reason = sale.listAttention;
  const payment = reason === "Payment to confirm" || reason === "Payment history to review" || reason === "Payment request due";
  const handover = reason === "Collection due" || reason === "Delivery due" || reason === "Delivery to rearrange";
  if (!reason || (payment ? !permissions.canRecordPayments : handover ? !permissions.canHandover : !permissions.canManage)) return null;
  const balance = sale.listLedgerKnown && sale.listBalance > 0 ? `${currency.format(sale.listBalance / 100)} due` : null;
  return {
    key: `sale:${sale.id}`, kind: "sales", icon: CreditCard,
    title: reason, context: [sale.draft.customer, sale.draft.vehicle, balance || sale.reference].filter(Boolean).join(" · "),
    label: handover ? "Handover" : payment ? "Payment" : "Needs review",
    tone: "warning", action: "Open sale", priority: 1, at: sale.updatedAt ?? "",
    href: saleHref(sale, payment ? "payments" : handover ? "handover" : "next"),
  };
}

function stockTask(car: StaffCar, today: string, monthAhead: string): Task | null {
  const stock = workspaceStatus(car);
  const mot = car.staff.mot;
  if ((stock !== "available" && stock !== "reserved") || !mot) return null;
  const urgent = mot.state === "expired" || mot.state === "failed";
  if (!urgent && ((mot.state !== "due" && mot.state !== "first_due") || !mot.date || mot.date > monthAhead)) return null;
  const due = mot.date ? new Date(`${mot.date}T12:00:00Z`) : null;
  return {
    key: `car:${car.id}`, kind: "stock", icon: ShieldCheck,
    title: mot.state === "failed" ? "Review failed MOT" : urgent ? "Review expired MOT" : "Review upcoming MOT",
    context: [vehicleDisplayTitle(car), vehicleRegistration(car), due && Number.isFinite(due.getTime()) && mot.state !== "failed" ? shortDate.format(due) : null].filter(Boolean).join(" · "),
    label: mot.state === "failed" ? "Failed" : urgent ? "Expired" : mot.date === today ? "Due today" : "Due soon",
    tone: urgent ? "urgent" : "warning", action: "Open vehicle file",
    href: `${carsHref}&carId=${encodeURIComponent(car.id)}`,
    priority: urgent ? 0 : 3, at: mot.date ?? mot.checkedAt ?? "",
  };
}

function TaskRow({ task }: { task: Task }) {
  const titleId = useId();
  return (
    <li className="today-task">
      <span className="today-task-icon"><task.icon size={17} aria-hidden="true" /></span>
      <div className="today-task-copy"><strong id={titleId}>{task.title}</strong>{task.context && <p>{task.context}</p>}</div>
      <div className="today-task-actions">
        <span className="today-badge" data-tone={task.tone}>{task.label}</span>
        <Link href={task.href} className="today-task-link" aria-describedby={titleId}>
          {task.action}<ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

export function TodayWorkspace({ notifications, canManage, canRecordPayments, canHandover, accessLoading, retryAccess }: {
  notifications: ReturnType<typeof useTodayNotifications>;
  canManage: boolean;
  canRecordPayments: boolean;
  canHandover: boolean;
  accessLoading: boolean;
  retryAccess?: () => unknown;
}) {
  const [filter, setFilter] = useState<Kind | "all">("all");
  const canReadSaleTasks = canManage || canRecordPayments || canHandover;
  const sales = useQuery({
    queryKey: ["sale-workspace", "today-attention"],
    queryFn: ({ signal }) => customFetch<SalesAttention>("/api/sale-workspace?queue=attention", { signal }),
    enabled: canReadSaleTasks,
    retry: false,
    refetchOnMount: "always",
  });
  const stock = useStaffCars(canManage || canHandover);
  const stockEnabled = canManage || canHandover;
  const now = new Date(notifications.data?.generatedAt ?? Date.now());
  const today = londonDate(Number.isFinite(now.getTime()) ? now : new Date());
  const monthAhead = nextDate(today, 30);
  const items = notifications.data?.items ?? [];
  const salesRows = sales.data?.sales ?? [];
  const cars = stock.data?.cars ?? [];
  const tasks = [
    ...(canManage ? items.map(item => customerTask(item, today)) : []),
    ...salesRows.map(row => saleTask(row, { canManage, canRecordPayments, canHandover })),
    ...(canManage ? cars.map(car => stockTask(car, today, monthAhead)) : []),
  ].filter((task): task is Task => task !== null)
    .sort((a, b) => a.priority - b.priority || a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
  const filtered = filter === "all" ? tasks : tasks.filter(task => task.kind === filter);
  const handovers = canHandover ? salesRows.flatMap(sale => {
    const schedule = sale.listHandover;
    if (!schedule?.scheduledDate || motTestTime(schedule.scheduledDate) === null ||
      schedule.scheduledDate < today || !["Booked", "On the way"].includes(schedule.status)) return [];
    return [{ sale, schedule, day: schedule.scheduledDate }];
  }).sort((a, b) => a.day.localeCompare(b.day) || (a.schedule.timeWindow ?? "").localeCompare(b.schedule.timeWindow ?? "")) : [];
  const nextHandover = handovers.find(entry => entry.day > today);
  const handoverCar = nextHandover && cars.find(car => car.id === nextHandover.sale.draft.vehicleId);
  const appointments = [
    ...items.flatMap(item => {
      const date = new Date(item.at);
      if (item.category !== "appointments" || !Number.isFinite(date.getTime()) || londonDate(date) !== today) return [];
      return [{
        key: `booking:${item.id}`, time: timeLabel.format(date), dateTime: item.at, title: item.customer || "Test drive",
        context: [item.detail === "Booking needs approval" ? "Awaiting approval" : "Test drive", item.vehicle].filter(Boolean).join(" · "),
        href: bookingHref(item),
      }];
    }),
    ...handovers.filter(entry => entry.day === today).map(({ sale, schedule, day }) => ({
      key: `handover:${sale.id}`, time: schedule.timeWindow || "Time to confirm", dateTime: day, title: sale.draft.customer || sale.reference,
      context: [schedule.method === "delivery" ? "Delivery" : "Collection", sale.draft.vehicle].filter(Boolean).join(" · "),
      href: saleHref(sale, "handover"),
    })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const loading = accessLoading || notifications.isLoading || (canReadSaleTasks && sales.isLoading) || (stockEnabled && stock.isLoading);
  const failures: { label: string; retry: () => unknown }[] = [];
  if (retryAccess) failures.push({ label: "Staff access", retry: retryAccess });
  if (notifications.isError) failures.push({ label: "Inbox and appointments", retry: notifications.refetch });
  if (canReadSaleTasks && sales.isError) failures.push({ label: "Sales", retry: sales.refetch });
  if (stockEnabled && stock.isError) failures.push({ label: "Stock", retry: stock.refetch });
  const partial = sales.data?.hasMore || (canManage && Object.entries(notifications.data?.counts ?? {}).some(([kind, count]) => kind !== "appointments" && count > 8));
  const moreHref = filter === "sales" ? salesHref : filter === "stock" ? carsHref : enquiryHref;

  return (
    <div className="today-workspace">
      <header className="today-page-heading">
        <p className="today-date"><time dateTime={today}>{bookingDateLabel(today)}</time></p>
        <h2>Today</h2>
        {!loading && !failures.length && <p className="today-summary">
          {tasks.length ? `${tasks.length}${partial ? "+" : ""} ${tasks.length === 1 && !partial ? "job needs" : "jobs need"} attention.` : "You’re up to date."}
          {" "}{appointments.length} {appointments.length === 1 ? "appointment" : "appointments"}
          {(notifications.data?.counts?.appointments ?? 0) > 8 ? " shown." : " today."}
        </p>}
      </header>
      {failures.length > 0 && (
        <div className="today-feedback" role="status">
          <p>{failures.map(failure => failure.label).join(", ")} could not be refreshed.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => failures.forEach(failure => void failure.retry())}>Try again</Button>
        </div>
      )}
      <div className="today-layout">
        <section className="today-surface" aria-labelledby="today-attention-heading">
          <div className="today-section-heading">
            <h3 id="today-attention-heading">Needs attention</h3>
            {!loading && <span className="today-count">
              {filtered.length > taskLimit ? `${taskLimit} of ${filtered.length}` : `${filtered.length} ${filtered.length === 1 ? "job" : "jobs"}`}
            </span>}
          </div>
          <div className="today-filters" aria-label="Filter jobs">
            {([
              ["all", "All work", true],
              ["customers", "Customers", canManage],
              ["sales", "Sales", canReadSaleTasks],
              ["stock", "Stock", canManage],
            ] as const).filter(([, , visible]) => visible).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
          {filtered.length > 0
            ? <ul className="today-tasks">{filtered.slice(0, taskLimit).map(task => <TaskRow task={task} key={task.key} />)}</ul>
            : <p className="today-empty" role="status">{loading ? "Loading today’s work…" : failures.length ? "No jobs loaded for this view." : filter === "all" ? "Nothing needs attention right now." : "No jobs in this view."}</p>}
          {(filtered.length > taskLimit || partial) && (
            <div className="today-overflow">
              {filter === "all" ? <>
                {canManage && <Link href={enquiryHref}>Inbox</Link>}
                {canReadSaleTasks && <Link href={salesHref}>Sales</Link>}
                {canManage && <Link href={carsHref}>Stock</Link>}
              </> : <Link href={moreHref}>View all {filter === "customers" ? "enquiries" : filter}</Link>}
            </div>
          )}
        </section>
        <aside className="today-aside" aria-label="Appointments and handover">
          <section className="today-surface" aria-labelledby="today-appointments-heading">
            <div className="today-section-heading"><h3 id="today-appointments-heading">Today’s appointments</h3><Link href={calendarHref}>Calendar</Link></div>
            {appointments.length ? (
              <ul className="today-appointments">
                {appointments.map(item => (
                  <li key={item.key}><Link href={item.href}>
                    <time dateTime={item.dateTime}>{item.time}</time>
                    <span><strong>{item.title}</strong><small>{item.context}</small></span>
                  </Link></li>
                ))}
              </ul>
            ) : <p className="today-empty">{notifications.isLoading || (canHandover && sales.isLoading) ? "Loading appointments…" : notifications.isError || (canHandover && sales.isError) ? "Open Calendar to check appointments." : "No appointments are booked for today."}</p>}
          </section>
          {nextHandover && (
            <section className="today-surface today-handover" aria-labelledby="today-handover-heading">
              {handoverCar?.heroImage && <img src={handoverCar.heroImage} alt={vehicleDisplayTitle(handoverCar)} loading="lazy" />}
              <div className="today-section-heading">
                <div>
                  <h3 id="today-handover-heading">{nextHandover.schedule.method === "delivery" ? "Upcoming delivery" : "Upcoming collection"}</h3>
                  <p>{[
                    nextHandover.sale.draft.vehicle,
                    bookingDateLabel(nextHandover.day),
                    nextHandover.schedule.timeWindow,
                  ].filter(Boolean).join(" · ")}</p>
                </div>
                <Link href={saleHref(nextHandover.sale, "handover")}>View sale</Link>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
