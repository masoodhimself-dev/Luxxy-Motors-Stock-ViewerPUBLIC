export const showroomTimezone = 'Europe/London';
export type ShowroomHoursItem = { days: string; times: string };
export type ShowroomAvailability = { state: 'open' | 'closed' | 'unknown'; nextOpeningAt: Date | null; closesAt: Date | null; callbackAt: Date | null };
type Interval = { open: number; close: number };
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const localFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: showroomTimezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function localParts(at: Date) {
  const parts = Object.fromEntries(localFormatter.formatToParts(at).map(part => [part.type, part.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, minute: +parts.hour * 60 + +parts.minute };
}
function dayNumber(value: string) { return weekdays.findIndex(day => day === value || day.slice(0, 3) === value); }
function daysFromLabel(value: string): number[] | null {
  const label = value.trim().toLowerCase().replace(/[–—]/g, '-');
  if (/^(daily|every day|all week|monday\s*-\s*sunday)$/.test(label)) return [0, 1, 2, 3, 4, 5, 6];
  const range = /^([a-z]+)\s*(?:-|to)\s*([a-z]+)$/.exec(label);
  if (range) {
    const start = dayNumber(range[1]); const end = dayNumber(range[2]);
    if (start < 0 || end < 0) return null;
    const result = [start];
    while (result.at(-1) !== end && result.length < 7) result.push((result.at(-1)! + 1) % 7);
    return result;
  }
  const result = label.split(/\s*(?:,|&|and)\s*/).map(dayNumber);
  return result.length && result.every(day => day >= 0) ? result : null;
}
function clockMinute(value: string): number | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(value.trim().toLowerCase());
  if (!match) return null;
  let hour = +match[1]; const minute = +(match[2] ?? 0);
  if (minute > 59) return null;
  if (match[3]) { if (hour < 1 || hour > 12) return null; hour = hour % 12 + (match[3] === 'pm' ? 12 : 0); }
  else if (hour > 23 || !match[2]) return null;
  return hour * 60 + minute;
}
function intervalFromLabel(value: string): Interval | null | undefined {
  const label = value.trim().toLowerCase().replace(/[–—]/g, '-');
  if (/^(closed|not open)$/.test(label)) return null;
  const range = /^(.+?)\s*(?:-|to)\s*(.+?)$/.exec(label);
  if (!range) return undefined;
  const open = clockMinute(range[1]); const close = clockMinute(range[2]);
  return open !== null && close !== null && close > open ? { open, close } : undefined;
}
/** Convert a London calendar time without assuming GMT or BST. */
function londonTime(year: number, month: number, day: number, minute: number): Date | null {
  const wallTime = Date.UTC(year, month - 1, day, Math.floor(minute / 60), minute % 60);
  // London uses UTC or UTC+1. Check both, which also rejects a nonexistent spring-forward time.
  for (const offset of [60, 0]) {
    const candidate = new Date(wallTime - offset * 60_000);
    const local = localParts(candidate);
    if (local.year === year && local.month === month && local.day === day && local.minute === minute) return candidate;
  }
  return null;
}
/** Uses published showroom hours only; ambiguous text never invents an opening. */
export function showroomAvailability(hours: readonly ShowroomHoursItem[] | null | undefined, now = new Date()): ShowroomAvailability {
  const unknown: ShowroomAvailability = { state: 'unknown', nextOpeningAt: null, closesAt: null, callbackAt: null };
  if (!hours?.length || !Number.isFinite(now.getTime())) return unknown;
  const schedule: Array<Interval | null | undefined> = Array(7).fill(undefined);
  const seen = new Set<number>();
  for (const row of hours) {
    if (!row || typeof row.days !== 'string' || typeof row.times !== 'string') return unknown;
    const days = daysFromLabel(row.days);
    if (!days) return unknown;
    const interval = intervalFromLabel(row.times);
    for (const day of days) { if (seen.has(day)) return unknown; seen.add(day); schedule[day] = interval; }
  }
  const local = localParts(now);
  const calendar = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const today = schedule[calendar.getUTCDay()];
  if (today === undefined) return unknown;
  const closesAt = today ? londonTime(local.year, local.month, local.day, today.close) : null;
  if (today && local.minute >= today.open && local.minute < today.close) return { state: 'open', nextOpeningAt: null, closesAt, callbackAt: new Date(now) };
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(calendar.getTime() + offset * 86_400_000);
    const interval = schedule[date.getUTCDay()];
    if (interval === undefined) return { state: 'closed', nextOpeningAt: null, closesAt, callbackAt: null };
    if (!interval || (offset === 0 && local.minute >= interval.open)) continue;
    const opening = londonTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), interval.open);
    if (!opening) return { state: 'closed', nextOpeningAt: null, closesAt, callbackAt: null };
    return { state: 'closed', nextOpeningAt: opening, closesAt, callbackAt: opening };
  }
  return { state: 'closed', nextOpeningAt: null, closesAt, callbackAt: null };
}
