export const bookingTimezone = "Europe/London";

const bookingStartHour = 10;
const bookingEndHour = 18;
const slotMinutes = 30;
const bookingWindowDays = 30;

export function datePartsInTimezone(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: bookingTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function dateStringInTimezone(value: Date) {
  const parts = datePartsInTimezone(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isValidDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function bookingDateIsInWindow(dateValue: string) {
  const today = dateStringInTimezone(new Date());
  return dateValue >= today && dateValue <= addDays(today, bookingWindowDays);
}

export function localDateTimeToUtc(dateValue: string, hour: number, minute: number) {
  const rough = new Date(
    `${dateValue}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  );
  const parts = datePartsInTimezone(rough);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMinutes = (localAsUtc - rough.getTime()) / 60000;
  return new Date(rough.getTime() - offsetMinutes * 60000);
}

export function formatSlotLabel(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: bookingTimezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

export function formatAppointmentLabel(value: Date | null) {
  if (!value) return "an unscheduled time";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: bookingTimezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(value);
}

export function getSlotsForDate(dateValue: string) {
  const weekday = new Date(`${dateValue}T00:00:00.000Z`).getUTCDay();
  if (weekday === 0) return [];
  const slots: Array<{ startAt: Date; label: string }> = [];
  for (let minutes = bookingStartHour * 60; minutes < bookingEndHour * 60; minutes += slotMinutes) {
    const startAt = localDateTimeToUtc(dateValue, Math.floor(minutes / 60), minutes % 60);
    slots.push({ startAt, label: formatSlotLabel(startAt) });
  }
  return slots;
}

export function validBookingDateTime(appointmentAt: Date) {
  if (Number.isNaN(appointmentAt.getTime()) || appointmentAt.getTime() <= Date.now()) {
    return false;
  }
  const parts = datePartsInTimezone(appointmentAt);
  const dateValue = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  if (!bookingDateIsInWindow(dateValue) || parts.second !== 0) return false;
  return getSlotsForDate(dateValue).some(
    (slot) => slot.startAt.getTime() === appointmentAt.getTime(),
  );
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && (error as { code?: string }).code === "23505") {
    return true;
  }
  if ("cause" in error) {
    return isUniqueViolation((error as { cause?: unknown }).cause);
  }
  return false;
}

export function constraintName(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  if (
    "constraint" in error &&
    typeof (error as { constraint?: unknown }).constraint === "string"
  ) {
    return (error as { constraint: string }).constraint;
  }
  if ("cause" in error) return constraintName((error as { cause?: unknown }).cause);
  return null;
}
