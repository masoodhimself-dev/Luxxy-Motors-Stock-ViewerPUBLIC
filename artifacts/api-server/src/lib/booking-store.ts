import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db, dealerSettingsTable, enquiriesTable } from "@workspace/db";
import { addDays, bookingPolicyFromConfig, bookingPressure, dateStringInTimezone, localDateTimeToUtc, slotIsAvailable, validStaffAppointmentDateTime, withinBookingHours, type BookingPolicy } from "./booking-slots";

export type BookingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class BookingConflict extends Error {}

export async function getBookingPolicy(dealerId: string) {
  const [settings] = await db.select({ config: dealerSettingsTable.config }).from(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, dealerId));
  return bookingPolicyFromConfig(settings?.config);
}

export async function bookingsForDate(dealerId: string, date: string, connection: BookingTransaction | typeof db = db) {
  // Include adjacent dates to account for appointments saved under earlier hours.
  return connection.select({ id: enquiriesTable.id, appointmentAt: enquiriesTable.appointmentAt, appointmentDurationMinutes: enquiriesTable.appointmentDurationMinutes, appointmentBufferMinutes: enquiriesTable.appointmentBufferMinutes })
    .from(enquiriesTable).where(and(eq(enquiriesTable.dealerId, dealerId), eq(enquiriesTable.type, "viewing"), isNull(enquiriesTable.appointmentCancelledAt), gte(enquiriesTable.appointmentAt, localDateTimeToUtc(addDays(date, -1), 0, 0)), lt(enquiriesTable.appointmentAt, localDateTimeToUtc(addDays(date, 2), 0, 0))));
}

export async function lockBookingDays(tx: BookingTransaction, dealerId: string, appointments: Date[]) {
  const days = [...new Set(appointments.flatMap((date) => [-1, 0, 1].map((offset) => addDays(dateStringInTimezone(date), offset))))].sort();
  for (const day of days) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`test-drive:${dealerId}:${day}`}, 0))`);
}

export async function ensureBookingAvailable(tx: BookingTransaction, dealerId: string, appointmentAt: Date, policy: BookingPolicy, excludeId?: string) {
  const bookings = await bookingsForDate(dealerId, dateStringInTimezone(appointmentAt), tx);
  if (!slotIsAvailable(appointmentAt, policy, bookings, new Date(), excludeId)) throw new BookingConflict("That test-drive time is no longer available. Please choose another.");
}

export async function checkStaffAppointment(tx: BookingTransaction, dealerId: string, appointmentAt: Date, policy: BookingPolicy, options: { allowOutsideHours?: boolean; allowDoubleBooking?: boolean }, excludeId?: string) {
  if (!validStaffAppointmentDateTime(appointmentAt)) throw new BookingConflict("Choose a future UK time in 15-minute steps, within the next year.");
  const outsideHours = !withinBookingHours(appointmentAt, policy);
  const pressure = bookingPressure(appointmentAt, policy, await bookingsForDate(dealerId, dateStringInTimezone(appointmentAt), tx), excludeId);
  if (outsideHours && !options.allowOutsideHours) throw new BookingConflict("This is outside normal booking hours. Review and confirm the staff exception.");
  if ((pressure.overlapping || pressure.overCapacity) && !options.allowDoubleBooking) throw new BookingConflict("This overlaps another appointment or exceeds daily capacity. Review and confirm the staff exception.");
  return { appointmentOutsideHours: outsideHours, appointmentDoubleBooked: pressure.overlapping, appointmentOverCapacity: pressure.overCapacity };
}
