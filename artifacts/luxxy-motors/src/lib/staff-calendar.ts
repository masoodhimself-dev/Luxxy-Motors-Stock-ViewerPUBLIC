import type { Enquiry } from '@workspace/api-client-react';
import { londonDate, nextDate } from './test-drive-dates';

export type DiaryView = 'day' | 'week' | 'month';
export type DiaryStatus = 'pending' | 'confirmed' | 'arrived' | 'completed' | 'no_show' | 'cancelled';

/** Date-only arithmetic uses UTC noon; booking instants are always grouped in London time. */
export function calendarWeekStart(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return nextDate(date, -((day + 6) % 7));
}
export function calendarDates(date: string, view: DiaryView) {
  if (view === 'day') return [date];
  if (view === 'week') return Array.from({ length: 7 }, (_, index) => nextDate(calendarWeekStart(date), index));
  const first = calendarWeekStart(`${date.slice(0, 7)}-01`);
  const month = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() + 1, 0);
  const last = month.toISOString().slice(0, 10);
  const length = Math.round((Date.parse(`${last}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86_400_000) + 1;
  return Array.from({ length: Math.ceil(length / 7) * 7 }, (_, index) => nextDate(first, index));
}
export function moveCalendarDate(date: string, view: DiaryView, direction: number) {
  if (view !== 'month') return nextDate(date, direction * (view === 'week' ? 7 : 1));
  const target = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  target.setUTCMonth(target.getUTCMonth() + direction);
  const last = new Date(target);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  target.setUTCDate(Math.min(Number(date.slice(-2)), last.getUTCDate()));
  return target.toISOString().slice(0, 10);
}
export function diaryStatus(entry: Enquiry): DiaryStatus {
  if (entry.appointmentCancelledAt) return 'cancelled';
  if (entry.attendance === 'arrived') return 'arrived';
  if (entry.attendance === 'completed') return 'completed';
  if (entry.attendance === 'no_show') return 'no_show';
  return entry.appointmentStatus === 'pending' ? 'pending' : 'confirmed';
}
export const diaryStatusLabels: Record<DiaryStatus, string> = {
  pending: 'Awaiting approval', confirmed: 'Confirmed', arrived: 'Arrived', completed: 'Visit completed', no_show: 'Did not attend', cancelled: 'Cancelled',
};
export function calendarBookings(entries: readonly Enquiry[]) {
  return entries.filter(entry => entry.appointmentAt && Number.isFinite(Date.parse(entry.appointmentAt)))
    .slice().sort((left, right) => Date.parse(left.appointmentAt!) - Date.parse(right.appointmentAt!) || left.reference.localeCompare(right.reference));
}
export function calendarBookingDate(entry: Enquiry) {
  return londonDate(new Date(entry.appointmentAt!));
}
export function calendarTime(instant: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}
export function calendarDateLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'Europe/London' }).format(new Date(`${date}T12:00:00Z`));
}
export function calendarRangeLabel(date: string, view: DiaryView) {
  if (view === 'day') return calendarDateLabel(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'month') return calendarDateLabel(date, { month: 'long', year: 'numeric' });
  const start = calendarWeekStart(date);
  const end = nextDate(start, 6);
  return `${calendarDateLabel(start, { day: 'numeric', month: 'short' })} – ${calendarDateLabel(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
