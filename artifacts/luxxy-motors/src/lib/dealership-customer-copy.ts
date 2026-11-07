import type { DealerConfig } from '@/config/dealer';
import { isMultiChoiceWebsite } from './multi-home-scope';
import { customerDefaultCopy } from './website-content';
import { editableShowroomWeek, showroomWeekRows } from './settings-simplification';

export const appointmentVisitNote = 'Visits are by appointment only. Please arrange a time before travelling.';

export function customerOpeningHours(hours: DealerConfig['hours']) {
  if (!hours?.length) return [];
  const week = editableShowroomWeek(hours);
  if (!week || week.some(day => day.state === 'unknown')) return hours;

  const groups: { first: string; last: string; times: string }[] = [];
  for (const row of showroomWeekRows(week)) {
    const previous = groups.at(-1);
    if (previous?.times === row.times) previous.last = row.days;
    else groups.push({ first: row.days, last: row.days, times: row.times });
  }
  return groups.map(({ first, last, times }) => ({
    days: first === last ? first : `${first} to ${last}`,
    times,
  }));
}

export function warrantySummary(settings: Pick<DealerConfig, 'warranty'>, multiChoice = isMultiChoiceWebsite()) {
  const standardCover = 'Our cars come with a six-month warranty as standard, with options to extend cover up to 36 months.';
  return customerDefaultCopy(
    settings.warranty?.description,
    multiChoice ? standardCover : 'Ask us about the warranty available for your chosen car.',
    multiChoice ? ['Warranty options are available on eligible vehicles.'] : [],
  ).trim();
}
