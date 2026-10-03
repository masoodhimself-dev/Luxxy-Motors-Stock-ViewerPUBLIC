export const bookingTimezone = "Europe/London";

export type BookingPolicy = {
  enabled: boolean;
  durationMinutes: number;
  bufferMinutes: number;
  minimumNoticeHours: number;
  dailyCapacity: number;
  daysAhead: number;
  blockedDates: string[];
  weeklyHours: Array<{ day: number; enabled: boolean; open: string; close: string }>;
  instructions: string;
  confirmationMode: "instant" | "approval";
};

export const defaultBookingPolicy: BookingPolicy = {
  enabled: true, durationMinutes: 30, bufferMinutes: 0, minimumNoticeHours: 0,
  dailyCapacity: 16, daysAhead: 30, blockedDates: [], instructions: "", confirmationMode: "instant",
  weeklyHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: day !== 0, open: "10:00", close: "18:00" })),
};

export function bookingPolicyFromConfig(config: unknown): BookingPolicy {
  const value = config && typeof config === "object" && "testDriveBooking" in config ? config.testDriveBooking : undefined;
  return value && typeof value === "object" ? { ...defaultBookingPolicy, ...value } as BookingPolicy : defaultBookingPolicy;
}

export function bookingPolicyError(policy?: BookingPolicy): string | null {
  if (!policy) return null;
  if (new Set(policy.weeklyHours.map(({ day }) => day)).size !== 7) return "Set booking hours once for each day of the week.";
  if (policy.weeklyHours.some(({ enabled, open, close }) => enabled && open >= close)) return "Booking closing times must be after opening times.";
  if (policy.weeklyHours.some(({ enabled, open, close }) => enabled && timeMinutes(close) - timeMinutes(open) < policy.durationMinutes)) return "Allow enough time for a full test drive within each day's booking hours.";
  if (policy.blockedDates.some((date) => !isValidDateString(date))) return "Choose valid dates to block from bookings.";
  return null;
}

function timeMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export type OccupiedBooking = { id?: string; appointmentAt: Date | null; appointmentDurationMinutes?: number | null; appointmentBufferMinutes?: number | null };

/** Pending and confirmed appointments both hold their time until cancelled. */
export function slotIsAvailable(startAt: Date, policy: BookingPolicy, booked: OccupiedBooking[], now = new Date(), excludeId?: string) {
  if (!validBookingDateTime(startAt, policy, now)) return false;
  const active = booked.filter((entry) => entry.id !== excludeId || !excludeId);
  const date = dateStringInTimezone(startAt);
  if (active.filter((entry) => entry.appointmentAt && dateStringInTimezone(entry.appointmentAt) === date).length >= policy.dailyCapacity) return false;
  const start = startAt.getTime();
  const end = start + (policy.durationMinutes + policy.bufferMinutes) * 60_000;
  return !active.some((entry) => {
    if (!entry.appointmentAt) return false;
    const occupiedStart = entry.appointmentAt.getTime();
    const occupiedEnd = occupiedStart + ((entry.appointmentDurationMinutes ?? 30) + (entry.appointmentBufferMinutes ?? 0)) * 60_000;
    return start < occupiedEnd && occupiedStart < end;
  });
}

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

export function bookingDateIsInWindow(dateValue: string, policy = defaultBookingPolicy, now = new Date()) {
  const today = dateStringInTimezone(now);
  return dateValue >= today && dateValue <= addDays(today, policy.daysAhead);
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

export function getSlotsForDate(dateValue: string, policy = defaultBookingPolicy) {
  if (!policy.enabled || policy.blockedDates.includes(dateValue) || !isValidDateString(dateValue)) return [];
  const weekday = new Date(`${dateValue}T00:00:00.000Z`).getUTCDay();
  const hours = policy.weeklyHours.find(({ day }) => day === weekday);
  if (!hours?.enabled) return [];
  const slots: Array<{ startAt: Date; label: string }> = [];
  const step = policy.durationMinutes + policy.bufferMinutes;
  const closeMinutes = timeMinutes(hours.close);
  const closingAt = localDateTimeToUtc(dateValue, Math.floor(closeMinutes / 60), closeMinutes % 60);
  if (step <= 0) return slots;
  for (let minutes = timeMinutes(hours.open); minutes + policy.durationMinutes <= timeMinutes(hours.close); minutes += step) {
    const startAt = localDateTimeToUtc(dateValue, Math.floor(minutes / 60), minutes % 60);
    if (startAt.getTime() + policy.durationMinutes * 60_000 > closingAt.getTime()) continue;
    const actual = datePartsInTimezone(startAt);
    // A clock-change gap must never turn into a different local appointment.
    if (actual.hour !== Math.floor(minutes / 60) || actual.minute !== minutes % 60) continue;
    slots.push({ startAt, label: formatSlotLabel(startAt) });
  }
  return slots;
}

export function validBookingDateTime(appointmentAt: Date, policy = defaultBookingPolicy, now = new Date()) {
  if (Number.isNaN(appointmentAt.getTime()) || appointmentAt.getTime() <= now.getTime() + policy.minimumNoticeHours * 3_600_000) return false;
  const dateValue = dateStringInTimezone(appointmentAt);
  if (!bookingDateIsInWindow(dateValue, policy, now)) return false;
  return getSlotsForDate(dateValue, policy).some((slot) => slot.startAt.getTime() === appointmentAt.getTime());
}

/** Staff may arrange a time outside public slots, but never a past or implausibly distant time. */
export function validStaffAppointmentDateTime(value: Date, now = new Date()) {
  if (Number.isNaN(value.getTime()) || value.getTime() <= now.getTime() || value.getTime() > now.getTime() + 366 * 86_400_000) return false;
  const parts = datePartsInTimezone(value);
  return parts.second === 0 && parts.minute % 15 === 0;
}

export function withinBookingHours(value: Date, policy: BookingPolicy) {
  if (!policy.enabled) return false;
  const date = dateStringInTimezone(value);
  if (policy.blockedDates.includes(date)) return false;
  const parts = datePartsInTimezone(value);
  const hours = policy.weeklyHours.find(item => item.day === new Date(`${date}T12:00:00Z`).getUTCDay());
  if (!hours?.enabled) return false;
  const start = parts.hour * 60 + parts.minute;
  return start >= timeMinutes(hours.open) && start + policy.durationMinutes <= timeMinutes(hours.close);
}

/** Capacity and overlap are separate so the diary can label the actual exception. */
export function bookingPressure(value: Date, policy: BookingPolicy, booked: OccupiedBooking[], excludeId?: string) {
  const active = booked.filter(item => item.id !== excludeId && item.appointmentAt);
  const sameDay = active.filter(item => dateStringInTimezone(item.appointmentAt!) === dateStringInTimezone(value));
  const start = value.getTime();
  const end = start + (policy.durationMinutes + policy.bufferMinutes) * 60_000;
  const overlapping = active.some(item => {
    const occupiedStart = item.appointmentAt!.getTime();
    const occupiedEnd = occupiedStart + ((item.appointmentDurationMinutes ?? 30) + (item.appointmentBufferMinutes ?? 0)) * 60_000;
    return start < occupiedEnd && occupiedStart < end;
  });
  return { overlapping, overCapacity: sameDay.length >= policy.dailyCapacity };
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
