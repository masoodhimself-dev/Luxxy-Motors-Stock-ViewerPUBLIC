import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db, dealerSettingsTable, enquiriesTable, vehiclesTable } from "@workspace/db";
import { dealerIntegrationsStore } from "./dealer-integrations-store";
import { addDays, bookingPolicyFromConfig, bookingPressure, dateStringInTimezone, slotIsAvailable, validStaffAppointmentDateTime, withinBookingHours, type BookingPolicy } from "./booking-slots";
import { appointmentDiaryWindow } from "./appointment-diary-window";

export type BookingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class BookingConflict extends Error {}

/** Recheck current stock under a row lock before promising a new or moved test drive. */
export async function ensureBookingVehicleAvailable(tx: BookingTransaction, dealerId: string, vehicleId: string | null) {
  const unavailable = "This car is no longer available for a test drive. Please contact the showroom.";
  if (!vehicleId) throw new BookingConflict(unavailable);
  const [vehicle] = await tx.select().from(vehiclesTable).where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.dealerId, dealerId))).for("update");
  if (!vehicle) throw new BookingConflict(unavailable);
  const { connection } = await dealerIntegrationsStore.readStockConnection(tx);
  const configuredThreshold = Number(process.env.STOCK_MISSING_HIDE_THRESHOLD);
  const missingHideThreshold = Number.isFinite(configuredThreshold) ? configuredThreshold : 2;
  if (vehicle.sourceStatus !== "live" || vehicle.inventoryStatus !== "available" || vehicle.archivedAt != null || vehicle.source !== connection.platform || vehicle.missingCount >= missingHideThreshold || (vehicle.priceReviewRequired && vehicle.sourcePrice == null && vehicle.websitePriceOverride == null)) throw new BookingConflict(unavailable);
}

export async function getBookingPolicy(dealerId: string) {
  const [settings] = await db.select({ config: dealerSettingsTable.config }).from(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, dealerId));
  return bookingPolicyFromConfig(settings?.config);
}

export async function bookingsForDate(dealerId: string, date: string, connection: BookingTransaction | typeof db = db) {
  // Include adjacent dates to account for appointments saved under earlier hours.
  const { from, to } = appointmentDiaryWindow(date);
  return connection.select({ id: enquiriesTable.id, appointmentAt: enquiriesTable.appointmentAt, appointmentDurationMinutes: enquiriesTable.appointmentDurationMinutes, appointmentBufferMinutes: enquiriesTable.appointmentBufferMinutes })
    .from(enquiriesTable).where(and(eq(enquiriesTable.dealerId, dealerId), eq(enquiriesTable.type, "viewing"), isNull(enquiriesTable.appointmentCancelledAt), gte(enquiriesTable.appointmentAt, from), lt(enquiriesTable.appointmentAt, to)));
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
