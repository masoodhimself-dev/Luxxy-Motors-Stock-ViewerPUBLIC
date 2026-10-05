import { showroomAvailability, showroomTimezone } from '@workspace/vehicle-meta';
import type { DealerHour } from './upcoming-visit-dates';

const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: showroomTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export function showroomOpeningLabel(at: Date | string, now = new Date()) {
  const date = typeof at === 'string' ? new Date(at) : at;
  if (!Number.isFinite(date.getTime())) return null;
  const today = dateKey(now);
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const day = dateKey(date) === today ? 'today'
    : dateKey(date) === dateKey(tomorrow) ? 'tomorrow'
      : new Intl.DateTimeFormat('en-GB', { timeZone: showroomTimezone, weekday: 'long', day: 'numeric', month: 'short' }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: showroomTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${day} at ${time} (UK time)`;
}

export function showroomHours(hours: DealerHour[], now = new Date()) {
  const available = showroomAvailability(hours, now);
  const closingTime = available.closesAt
    ? new Intl.DateTimeFormat('en-GB', { timeZone: showroomTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(available.closesAt)
    : null;
  return {
    state: available.state,
    next: available.nextOpeningAt ? showroomOpeningLabel(available.nextOpeningAt, now) : null,
    closingTime,
  };
}
