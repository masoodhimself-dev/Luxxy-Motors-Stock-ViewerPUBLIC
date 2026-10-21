import { describe, expect, it } from 'vitest';
import { editableShowroomWeek, showroomWeekRows, showroomBookingCopy, settingsSectionGroup } from './settings-simplification';
import { previewSettings } from '../../preview/settings';

describe('safe showroom timetable editing', () => {
  const hours = [{ days: 'Mon – Saturday', times: '8 am to 6 pm' }, { days: 'Sunday', times: 'Closed' }];
  it('parses grouped hours and preserves unknown days without treating them as closed', () => {
    expect(editableShowroomWeek(hours)?.find(day => day.day === 1)).toEqual({ day: 1, state: 'open', open: '08:00', close: '18:00' });
    const partial = editableShowroomWeek([{ days: 'Monday', times: '09:00 – 18:00' }])!;
    expect(partial.find(day => day.day === 0)?.state).toBe('unknown');
    expect(showroomWeekRows(partial).find(day => day.days === 'Sunday')?.times).toBe('Unknown');
    expect(hours).toEqual([{ days: 'Mon – Saturday', times: '8 am to 6 pm' }, { days: 'Sunday', times: 'Closed' }]);
  });
  it('retains ambiguous, overlapping, split and overnight legacy formats for text editing', () => {
    for (const rows of [
      [{ days: 'Monday', times: 'By appointment' }],
      [{ days: 'Monday', times: '09:00 – 12:00, 13:00 – 18:00' }],
      [{ days: 'Monday', times: '22:00 – 02:00' }],
      [{ days: 'Monday', times: '09:00 – 18:00' }, { days: 'Mon', times: 'Closed' }],
      [{ days: 'Bank holidays', times: 'Closed' }],
    ]) expect(editableShowroomWeek(rows)).toBeNull();
  });
  it('previews booking hours without changing booking rules or the source timetable', () => {
    const booking = structuredClone(previewSettings.testDriveBooking!);
    const original = structuredClone(booking);
    const copy = showroomBookingCopy(hours, booking)!;
    expect(copy.find(day => day.day === 1)).toMatchObject({ enabled: true, open: '08:00', close: '18:00' });
    expect(copy.find(day => day.day === 0)?.enabled).toBe(false);
    expect(booking).toEqual(original);
    expect(showroomBookingCopy([{ days: 'Monday', times: '09:00 – 18:00' }], booking)).toBeNull();
    expect(showroomBookingCopy([{ days: 'Daily', times: '09:00 – 09:15' }], { ...booking, durationMinutes: 30 })).toBeNull();
    expect(showroomBookingCopy([{ days: 'Daily', times: 'Closed' }], booking)).toBeNull();
  });
  it('maps saved section links to their new areas', () => {
    expect(settingsSectionGroup('contact')).toBe('dealership');
    expect(settingsSectionGroup('legal')).toBe('dealership');
    expect(settingsSectionGroup('bookings')).toBe('bookings');
    expect(settingsSectionGroup('presentation')).toBe('website');
  });
});
