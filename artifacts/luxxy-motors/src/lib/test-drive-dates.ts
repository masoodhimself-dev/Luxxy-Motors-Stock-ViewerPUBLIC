import type { DealerTestDriveBooking } from "@workspace/api-client-react";

export const bookingTimezone = "Europe/London";
export const defaultBookingSettings: DealerTestDriveBooking = {
  enabled: true,
  durationMinutes: 30,
  bufferMinutes: 0,
  minimumNoticeHours: 0,
  dailyCapacity: 16,
  daysAhead: 30,
  blockedDates: [],
  instructions: "",
  confirmationMode: "instant",
  weeklyHours: Array.from({ length: 7 }, (_, day) => ({
    day,
    enabled: day !== 0,
    open: "10:00",
    close: "18:00",
  })),
};
export function londonDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: bookingTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function nextDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function availableBookingDates(
  config: DealerTestDriveBooking,
  now = new Date(),
) {
  const today = londonDate(now);
  return Array.from({ length: config.daysAhead + 1 }, (_, index) =>
    nextDate(today, index),
  ).filter(
    (date) =>
      !config.blockedDates.includes(date) &&
      config.weeklyHours.some(
        (hours) =>
          hours.enabled &&
          hours.day === new Date(`${date}T12:00:00Z`).getUTCDay(),
      ),
  );
}
export function bookingDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: bookingTimezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00Z`));
}
export function appointmentLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: bookingTimezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(value));
}
