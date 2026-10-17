import { addDays, localDateTimeToUtc } from "./booking-slots";

/** Adjacent London dates keep midnight overlaps and clock changes in the check. */
export function appointmentDiaryWindow(date: string) {
  return {
    from: localDateTimeToUtc(addDays(date, -1), 0, 0),
    to: localDateTimeToUtc(addDays(date, 2), 0, 0),
  };
}
