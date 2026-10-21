import { expect, it } from 'vitest';
import { showroomHoursComplete } from '@workspace/vehicle-meta';
it('requires every day, rejects conflicts and preserves explicit appointment-only arrangements', () => {
  expect(showroomHoursComplete([{ days: 'Monday–Saturday', times: '08:00–18:00' }, { days: 'Sunday', times: 'Closed' }])).toBe(true);
  expect(showroomHoursComplete([{ days: 'Daily', times: 'By appointment only' }])).toBe(true);
  expect(showroomHoursComplete([{ days: 'Monday', times: '08:00–18:00' }])).toBe(false);
  expect(showroomHoursComplete([{ days: 'Daily', times: '08:00–18:00' }, { days: 'Sunday', times: 'Closed' }])).toBe(false);
  expect(showroomHoursComplete([{ days: 'Daily', times: 'Unknown' }])).toBe(false);
  expect(showroomHoursComplete([{ days: 'Daily', times: '18:00–08:00' }])).toBe(false);
  expect(showroomHoursComplete([{ days: 'Someday', times: 'Closed' }])).toBe(false);
});
