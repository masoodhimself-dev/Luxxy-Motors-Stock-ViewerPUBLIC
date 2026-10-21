import type { DealerSettings, DealerTestDriveBooking } from '@workspace/api-client-react';

type DealerHour = DealerSettings['hours'][number];
export const settingsWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export type SettingsHoursDay = { day: number; state: 'open' | 'closed' | 'unknown'; open: string; close: string };
const dayNumber = (label: string) => settingsWeekdays.findIndex(day => day.toLowerCase() === label || day.slice(0, 3).toLowerCase() === label);
function daysFor(label: string): number[] | null {
  const text = label.trim().toLowerCase().replace(/[–—]/g, '-');
  if (/^(daily|every day|all week)$/.test(text)) return [0, 1, 2, 3, 4, 5, 6];
  const range = /^([a-z]+)\s*(?:-|to)\s*([a-z]+)$/.exec(text);
  if (range) {
    const start = dayNumber(range[1]); const end = dayNumber(range[2]);
    if (start < 0 || end < 0) return null;
    const days = [start];
    while (days.at(-1) !== end && days.length < 7) days.push((days.at(-1)! + 1) % 7);
    return days;
  }
  const days = text.split(/\s*(?:,|&|and)\s*/).map(dayNumber);
  return days.length && days.every(day => day >= 0) ? days : null;
}
function clock(label: string): string | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(label.trim().toLowerCase());
  if (!match) return null;
  let hour = +match[1]; const minute = +(match[2] ?? 0);
  if (minute > 59) return null;
  if (match[3]) { if (hour < 1 || hour > 12) return null; hour = hour % 12 + (match[3] === 'pm' ? 12 : 0); }
  else if (hour > 23 || !match[2]) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
/** Nonstandard, overlapping, split and overnight rows stay in the existing text editor. No saved data is rewritten on load. */
export function editableShowroomWeek(hours: readonly DealerHour[]): SettingsHoursDay[] | null {
  const week: SettingsHoursDay[] = settingsWeekdays.map((_, day) => ({ day, state: 'unknown', open: '09:00', close: '18:00' }));
  const seen = new Set<number>();
  for (const row of hours) {
    const days = daysFor(row.days);
    if (!days || days.some(day => seen.has(day))) return null;
    const times = row.times.trim().toLowerCase().replace(/[–—]/g, '-');
    let state: SettingsHoursDay['state']; let open = '09:00'; let close = '18:00';
    if (/^(closed|not open)$/.test(times)) state = 'closed';
    else if (/^(unknown|unconfirmed|not confirmed)$/.test(times)) state = 'unknown';
    else {
      const range = /^(.+?)\s*(?:-|to)\s*(.+?)$/.exec(times);
      const from = range ? clock(range[1]) : null; const until = range ? clock(range[2]) : null;
      if (!from || !until || until <= from) return null;
      state = 'open'; open = from; close = until;
    }
    for (const day of days) { seen.add(day); week[day] = { day, state, open, close }; }
  }
  return week;
}
export function showroomWeekRows(week: readonly SettingsHoursDay[]): DealerHour[] {
  return [1, 2, 3, 4, 5, 6, 0].map(day => {
    const entry = week.find(item => item.day === day)!;
    return { days: settingsWeekdays[day], times: entry.state === 'closed' ? 'Closed' : entry.state === 'unknown' ? 'Unknown' : `${entry.open} – ${entry.close}` };
  });
}
/** A copy is offered only if every day is confirmed and the current booking rules can use it. */
export function showroomBookingCopy(hours: readonly DealerHour[], booking: DealerTestDriveBooking): DealerTestDriveBooking['weeklyHours'] | null {
  const week = editableShowroomWeek(hours);
  if (!week || week.some(day => day.state === 'unknown') || !week.some(day => day.state === 'open')) return null;
  const minutes = (value: string) => +value.slice(0, 2) * 60 + +value.slice(3);
  if (week.some(day => day.state === 'open' && minutes(day.close) - minutes(day.open) < booking.durationMinutes)) return null;
  return week.map(day => ({ day: day.day, enabled: day.state === 'open', open: day.state === 'open' ? day.open : booking.weeklyHours.find(item => item.day === day.day)?.open ?? '10:00', close: day.state === 'open' ? day.close : booking.weeklyHours.find(item => item.day === day.day)?.close ?? '18:00' }));
}
export type DealerSettingsGroup = 'dealership' | 'website' | 'bookings';
export function settingsSectionGroup(section: string): DealerSettingsGroup {
  return section === 'contact' || section === 'legal' ? 'dealership' : section === 'bookings' ? 'bookings' : 'website';
}
