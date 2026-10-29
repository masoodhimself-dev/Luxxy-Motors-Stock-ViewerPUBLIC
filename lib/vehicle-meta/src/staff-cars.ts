import type { MotHistory } from "./mot-history";
export type StaffMotSummary = {
  state: "current" | "due" | "expired" | "failed" | "first_due" | "unknown";
  tone: "green" | "amber" | "red" | "grey";
  label: string;
  date: string | null;
  checkedAt: string | null;
  lastMileage: string | null;
};
export type StaffCarChange = {
  kind: "arrival" | "price" | "photos" | "details";
  label: string;
  at: string;
  before?: number;
  after?: number;
};
export type StaffCarMeta = {
  source: "cazoo" | "autotrader";
  sourceStatus: string;
  inventoryStatus: string;
  published: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  archivedAt: string | null;
  mot: StaffMotSummary;
  changes: StaffCarChange[];
  sale: { id: string; reference: string; status: string } | null;
};
export type StaffCarsFeed = {
  source: string;
  receivedAt: string | null;
  appliedAt: string | null;
  state: "current" | "review" | "stale" | "unknown";
  scheduled: boolean;
};
const ukDay = (value: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
const validDay = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
/** Staff-only summary. No inference from a registration band or manufacture year. */
export function staffMotSummary(
  history: MotHistory | null,
  now = new Date(),
): StaffMotSummary {
  const unknown: StaffMotSummary = {
    state: "unknown",
    tone: "grey",
    label: "MOT not checked",
    date: null,
    checkedAt: null,
    lastMileage: null,
  };
  if (!history) return unknown;
  const checked = Date.parse(history.checkedAt);
  if (
    !Number.isFinite(checked) ||
    checked > now.getTime() ||
    now.getTime() - checked > 86400000
  )
    return {
      ...unknown,
      label: "MOT check needed",
      checkedAt: history.checkedAt,
    };
  const today = ukDay(now),
    tests = history.tests
      .filter(
        (t) =>
          Number.isFinite(Date.parse(t.completedDate)) &&
          t.completedDate.slice(0, 10) <= today,
      )
      .sort(
        (a, b) => Date.parse(b.completedDate) - Date.parse(a.completedDate),
      );
  if (
    history.tests.some(
      (t) =>
        !Number.isFinite(Date.parse(t.completedDate)) ||
        t.completedDate.slice(0, 10) > today,
    )
  )
    return {
      ...unknown,
      checkedAt: history.checkedAt,
      label: "MOT check needed",
    };
  const latest = tests[0];
  const lastMileage =
    latest?.mileage && latest.mileageUnit
      ? `${Number(latest.mileage).toLocaleString("en-GB")} ${latest.mileageUnit === "MI" ? "miles" : "km"}`
      : null;
  const base = { checkedAt: history.checkedAt, lastMileage };
  if (latest?.result === "FAILED")
    return {
      ...base,
      state: "failed",
      tone: "red",
      label: "Latest MOT failed",
      date: latest.completedDate.slice(0, 10),
    };
  const due =
    latest?.expiryDate?.slice(0, 10) ??
    (!tests.length ? history.firstMotDueDate : null);
  if (!due || !validDay(due))
    return { ...unknown, ...base, label: "MOT date unavailable" };
  if (due < today)
    return {
      ...base,
      state: "expired",
      tone: "red",
      label: latest ? "MOT expired" : "First MOT overdue",
      date: due,
    };
  const threshold = new Date(today + "T12:00:00Z"),
    day = threshold.getUTCDate();
  threshold.setUTCDate(1);
  threshold.setUTCMonth(threshold.getUTCMonth() + 6);
  const last = new Date(
    Date.UTC(threshold.getUTCFullYear(), threshold.getUTCMonth() + 1, 0),
  ).getUTCDate();
  threshold.setUTCDate(Math.min(day, last));
  const soon = due <= threshold.toISOString().slice(0, 10);
  if (!latest)
    return {
      ...base,
      state: "first_due",
      tone: soon ? "amber" : "green",
      label: "First MOT due",
      date: due,
    };

  return {
    ...base,
    state: soon ? "due" : "current",
    tone: soon ? "amber" : "green",
    label: soon ? "MOT due" : "MOT until",
    date: due,
  };
}
