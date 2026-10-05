import { dateStringInTimezone } from "./booking-slots";

export const callOutcomes = {
  information_given: "Information given",
  test_drive_booked: "Test drive booked",
  callback_requested: "Callback requested",
  no_answer: "No answer",
  not_interested: "Not interested",
} as const;
export type CallOutcome = keyof typeof callOutcomes;
export type Attendance = "scheduled" | "arrived" | "completed" | "no_show";

export function attendanceError(entry: { appointmentAt?: Date | string | null; appointmentCancelledAt?: Date | string | null; appointmentStatus?: string | null; attendance?: string }, next: Attendance, now = new Date()) {
  if (!entry.appointmentAt || entry.appointmentCancelledAt) return "Choose an active appointment before recording attendance.";
  if (entry.appointmentStatus === "pending") return "Confirm the appointment before recording attendance.";
  const start = new Date(entry.appointmentAt);
  if (next === "arrived" && dateStringInTimezone(start) > dateStringInTimezone(now)) return "Arrival can be recorded on the appointment day or afterwards.";
  if (next === "no_show" && start.getTime() > now.getTime()) return "Wait until the appointment time before marking a no-show.";
  if (next === "completed" && entry.attendance !== "arrived") return "Mark the customer as arrived before completing their visit.";
  return null;
}

export function outcomeError(entry: { appointmentAt?: unknown; appointmentCancelledAt?: unknown; followUpAt?: unknown; followUpCompletedAt?: unknown }, outcome?: string | null) {
  if (outcome === "test_drive_booked" && (!entry.appointmentAt || entry.appointmentCancelledAt)) return "Book an appointment before choosing Test drive booked.";
  if (outcome === "callback_requested" && (!entry.followUpAt || entry.followUpCompletedAt)) return "Schedule a follow-up before choosing Callback requested.";
  return null;
}
