const BOOKING_TIME_ZONE = 'Europe/London';

const weekdayNames = [
  ['sunday', 'sun'],
  ['monday', 'mon'],
  ['tuesday', 'tue', 'tues'],
  ['wednesday', 'wed'],
  ['thursday', 'thu', 'thur', 'thurs'],
  ['friday', 'fri'],
  ['saturday', 'sat'],
] as const;

export type DealerHour = {
  days: string;
  times: string;
};

export type UpcomingVisitDate = {
  date: string;
  dateLabel: string;
  relativeLabel: string;
  times: string;
};

function weekdayIndex(value: string) {
  const normalized = value.toLowerCase();
  return weekdayNames.findIndex((names) => names.some((name) => normalized === name || normalized.startsWith(name)));
}

function parseWeekdays(value: string) {
  const tokens = value.toLowerCase().match(/\b(?:sun(?:day)?|mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thu(?:rs?|r?sday)?|fri(?:day)?|sat(?:urday)?)\b/g) ?? [];
  const indexes = tokens.map(weekdayIndex).filter((index) => index >= 0);
  if (indexes.length === 0) return [];

  const isRange = /[-–—]|\bto\b/.test(value.toLowerCase()) && indexes.length >= 2;
  if (!isRange) return [...new Set(indexes)];

  const days: number[] = [];
  const start = indexes[0];
  const end = indexes[1];
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = (start + offset) % 7;
    days.push(day);
    if (day === end) break;
  }
  return days;
}

function dateKeyInLondon(value: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BOOKING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BOOKING_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function relativeLabel(value: string, today: string) {
  if (value === today) return 'Today';
  if (value === addDays(today, 1)) return 'Tomorrow';
  return dateLabel(value).split(' ')[0];
}

export function getUpcomingVisitDates(
  hours: DealerHour[],
  now = new Date(),
  count = 4,
): UpcomingVisitDate[] {
  const schedule = new Map<number, string>();
  for (const hour of hours) {
    for (const day of parseWeekdays(hour.days)) {
      if (!schedule.has(day)) schedule.set(day, hour.times);
    }
  }

  if (schedule.size === 0 || count <= 0) return [];

  const today = dateKeyInLondon(now);
  const dates: UpcomingVisitDate[] = [];
  for (let offset = 0; offset <= 21 && dates.length < count; offset += 1) {
    const date = addDays(today, offset);
    const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
    const times = schedule.get(weekday);
    if (!times) continue;

    dates.push({
      date,
      dateLabel: dateLabel(date),
      relativeLabel: relativeLabel(date, today),
      times,
    });
  }

  return dates;
}