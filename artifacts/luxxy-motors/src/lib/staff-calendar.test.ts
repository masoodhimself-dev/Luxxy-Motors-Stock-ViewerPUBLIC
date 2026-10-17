import { describe, expect, it } from 'vitest';
import type { Enquiry } from '@workspace/api-client-react';
import { calendarBookingDate, calendarBookings, calendarDates, calendarRangeLabel, calendarTime, calendarWeekStart, diaryStatus, moveCalendarDate } from './staff-calendar';

const entry = (value: Partial<Enquiry>) => ({ reference: 'ENQ-1', ...value } as Enquiry);
describe('London showroom diary dates', () => {
  it('groups UTC instants by the dealership date rather than the browser date', () => {
    expect(calendarBookingDate(entry({ appointmentAt: '2026-10-16T23:30:00Z' }))).toBe('2026-10-17');
    expect(calendarTime('2026-10-16T23:30:00Z')).toBe('00:30');
    expect(calendarBookingDate(entry({ appointmentAt: '2026-12-01T23:30:00Z' }))).toBe('2026-12-01');
  });
  it('keeps repeated autumn clock-change hours as separate appointments in chronological order', () => {
    const early = entry({ id: 'early', appointmentAt: '2026-10-25T01:30:00+01:00' });
    const late = entry({ id: 'late', appointmentAt: '2026-10-25T01:15:00Z' });
    expect(calendarBookings([late, early]).map(item => item.id)).toEqual(['early', 'late']);
    expect(calendarTime(early.appointmentAt!)).toBe('01:30');
    expect(calendarTime(late.appointmentAt!)).toBe('01:15');
    expect(calendarBookingDate(early)).toBe(calendarBookingDate(late));
  });
  it('builds a Monday-to-Sunday week over month, year and clock changes', () => {
    expect(calendarWeekStart('2027-01-01')).toBe('2026-12-28');
    expect(calendarDates('2026-10-25', 'week')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(calendarDates('2026-10-25', 'day')).toEqual(['2026-10-25']);
  });
  it('uses complete month rows without a needless sixth row', () => {
    const dates = calendarDates('2026-02-15', 'month');
    expect(dates).toHaveLength(35);
    expect(dates[0]).toBe('2026-01-26');
    expect(dates.at(-1)).toBe('2026-03-01');
  });
  it('moves months without skipping February or changing the day unnecessarily', () => {
    expect(moveCalendarDate('2026-01-31', 'month', 1)).toBe('2026-02-28');
    expect(moveCalendarDate('2028-01-31', 'month', 1)).toBe('2028-02-29');
    expect(moveCalendarDate('2026-03-17', 'month', -1)).toBe('2026-02-17');
    expect(moveCalendarDate('2026-10-24', 'week', 1)).toBe('2026-10-31');
    expect(moveCalendarDate('2026-10-24', 'day', 1)).toBe('2026-10-25');
  });
  it('labels ranges clearly even across years', () => {
    expect(calendarRangeLabel('2027-01-01', 'week')).toBe('28 Dec – 3 Jan 2027');
    expect(calendarRangeLabel('2026-10-17', 'month')).toBe('October 2026');
  });
  it('ignores missing or corrupt dates and does not mutate the enquiry list', () => {
    const source = [entry({ id: 'late', appointmentAt: '2026-10-17T11:00:00Z' }), entry({ id: 'bad', appointmentAt: 'bad' }), entry({ id: 'general', appointmentAt: null }), entry({ id: 'early', appointmentAt: '2026-10-17T09:00:00Z' })];
    expect(calendarBookings(source).map(item => item.id)).toEqual(['early', 'late']);
    expect(source[0].id).toBe('late');
  });
  it('preserves cancelled, pending and all existing attendance states', () => {
    expect(diaryStatus(entry({ appointmentCancelledAt: '2026-10-17', attendance: 'completed', appointmentStatus: 'pending' }))).toBe('cancelled');
    expect(diaryStatus(entry({ attendance: 'arrived' }))).toBe('arrived');
    expect(diaryStatus(entry({ attendance: 'completed' }))).toBe('completed');
    expect(diaryStatus(entry({ attendance: 'no_show' }))).toBe('no_show');
    expect(diaryStatus(entry({ attendance: 'scheduled', appointmentStatus: 'pending' }))).toBe('pending');
    expect(diaryStatus(entry({ attendance: 'scheduled', appointmentStatus: 'confirmed' }))).toBe('confirmed');
  });
});
