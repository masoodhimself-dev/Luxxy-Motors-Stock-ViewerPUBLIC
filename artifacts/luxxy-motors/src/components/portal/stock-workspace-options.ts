import type { StaffMotSummary } from "@workspace/vehicle-meta";
export type MotFocus = "all" | "expired" | "due30" | "unknown" | "earliest";
export function focusStockMot<T>(
  cars: readonly T[],
  focus: MotFocus,
  summary: (car: T) => StaffMotSummary,
  now = Date.now(),
): T[] {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const end = new Date(Date.parse(`${today}T12:00:00Z`) + 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const rows = cars.filter((car) => {
    const mot = summary(car);
    return (
      focus === "all" ||
      focus === "earliest" ||
      (focus === "expired" && ["expired", "failed"].includes(mot.state)) ||
      (focus === "unknown" && mot.state === "unknown") ||
      (focus === "due30" &&
        mot.date !== null &&
        mot.date >= today &&
        mot.date <= end &&
        mot.state !== "failed")
    );
  });
  return focus === "earliest"
    ? [...rows].sort((a, b) => {
        const left = summary(a),
          right = summary(b);
        const valid = (m: StaffMotSummary) =>
          m.state !== "unknown" &&
          m.state !== "failed" &&
          m.date &&
          /^\d{4}-\d{2}-\d{2}$/.test(m.date)
            ? m.date
            : "9999";
        return String(valid(left)).localeCompare(String(valid(right)));
      })
    : rows;
}
