import type { MotHistory } from "@workspace/vehicle-meta";
function ukToday(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value
  );
}
/** Fresh DVSA records only; an older pass must never override a later failure. */
export function longMot(history: MotHistory | null, now = new Date()) {
  if (!history) return null;
  const checked = Date.parse(history.checkedAt);
  if (
    !Number.isFinite(checked) ||
    checked > now.getTime() ||
    now.getTime() - checked > 86400000
  )
    return null;
  const latest = [...history.tests].sort(
    (a, b) => Date.parse(b.completedDate) - Date.parse(a.completedDate),
  )[0];
  if (
    latest?.result !== "PASSED" ||
    !latest.expiryDate ||
    latest.completedDate.slice(0, 10) > ukToday(now)
  )
    return null;
  const expiry = new Date(latest.expiryDate.slice(0, 10) + "T12:00:00Z");
  if (!validDay(latest.expiryDate.slice(0, 10))) return null;
  const today = new Date(ukToday(now) + "T12:00:00Z");
  let months =
    (expiry.getUTCFullYear() - today.getUTCFullYear()) * 12 +
    expiry.getUTCMonth() -
    today.getUTCMonth();
  if (expiry.getUTCDate() < today.getUTCDate()) months--;
  return months >= 9 ? { months, expiryDate: latest.expiryDate } : null;
}

/** A provider-supplied first due date is safer than calculating vehicle exemptions. */
export function firstMotDue(history: MotHistory | null, now = new Date()) {
  if (!history || history.tests.length || !history.firstMotDueDate) return null;
  const checked = Date.parse(history.checkedAt);
  if (
    !Number.isFinite(checked) ||
    checked > now.getTime() ||
    now.getTime() - checked > 86400000
  )
    return null;
  const due = history.firstMotDueDate;
  if (!validDay(due) || due <= ukToday(now)) return null;
  return due;
}
