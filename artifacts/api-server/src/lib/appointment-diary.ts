import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { db, enquiriesTable } from "@workspace/db";
import { appointmentDiaryWindow } from "./appointment-diary-window";

/** Only fields needed to check and explain clashes; never whole customer timelines. */
export async function readAppointmentDiary(dealerId: string, date: string, connection: typeof db = db) {
  const { from, to } = appointmentDiaryWindow(date);
  return connection.select({
    id: enquiriesTable.id,
    reference: enquiriesTable.reference,
    customerName: enquiriesTable.customerName,
    vehicleTitle: enquiriesTable.vehicleTitle,
    assignedToName: enquiriesTable.assignedToName,
    appointmentAt: enquiriesTable.appointmentAt,
    appointmentDurationMinutes: enquiriesTable.appointmentDurationMinutes,
    appointmentBufferMinutes: enquiriesTable.appointmentBufferMinutes,
  }).from(enquiriesTable).where(and(
    eq(enquiriesTable.dealerId, dealerId),
    eq(enquiriesTable.type, "viewing"),
    isNull(enquiriesTable.appointmentCancelledAt),
    gte(enquiriesTable.appointmentAt, from),
    lt(enquiriesTable.appointmentAt, to),
  )).orderBy(enquiriesTable.appointmentAt, enquiriesTable.id);
}
