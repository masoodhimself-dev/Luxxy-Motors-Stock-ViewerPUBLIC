import { describe, expect, it } from 'vitest';
import type { MotTest } from '@workspace/vehicle-meta';
import { buildMotMileageHistory, motDateLabel, motMileageLabel, motTestTime, newestMotTests } from './mot-mileage-history';

const test = (completedDate: string, mileage: string | null, mileageUnit: MotTest['mileageUnit'] = 'MI'): MotTest => ({ completedDate, mileage, mileageUnit, result: 'PASSED', expiryDate: null, defects: [] });

describe('recorded MOT mileage', () => {
  it('sorts actual test timestamps and retains same-day failure and retest', () => {
    const morning = { ...test('2026-10-02T09:00:00Z', '41000'), result: 'FAILED' as const };
    const afternoon = test('2026-10-02T15:00:00Z', '41002');
    const older = test('2025-10-01', '34000');
    const history = buildMotMileageHistory([afternoon, older, morning]);
    expect(history.points.map(point => point.test)).toEqual([older, morning, afternoon]);
    expect(newestMotTests([morning, older, afternoon])).toEqual([afternoon, morning, older]);
  });

  it('normalises kilometres to miles, retains original units and flags a real later drop', () => {
    const history = buildMotMileageHistory([test('2024-01-01', '80,467.2', 'KM'), test('2025-01-01', '52000'), test('2026-01-01', '49000')]);
    expect(history.points[0].miles).toBeCloseTo(50000);
    expect(history.convertedKm).toBe(true);
    expect(history.hasDecrease).toBe(true);
    expect(history.points.map(point => point.decreased)).toEqual([false, false, true]);
    expect(motMileageLabel(history.points[0].test)).toBe('80,467.2 km');
  });

  it('does not turn missing, malformed, negative or unknown-unit values into chart points', () => {
    const rows = [test('2020-01-01', '1000'), test('2021-01-01', null), test('2022-01-01', 'unknown'), test('2023-01-01', '-3'), test('2024-01-01', '12', 'UNKNOWN' as MotTest['mileageUnit']), test('2025-01-01', '2000'), test('2026-01-01', '3000')];
    const history = buildMotMileageHistory(rows);
    expect(history.points.map(point => point.miles)).toEqual([1000, 2000, 3000]);
    expect(history.excludedCount).toBe(4);
    expect(history.segments.map(segment => segment.map(point => point.miles))).toEqual([[1000], [2000, 3000]]);
  });

  it('validates calendar dates, excludes invalid dates and safely labels them', () => {
    expect(motTestTime('2026-02-30')).toBeNull();
    expect(motTestTime('invalid')).toBeNull();
    expect(motDateLabel('2026-02-30')).toBe('Date not recorded');
    expect(buildMotMileageHistory([test('2026-02-30', '9999')]).points).toEqual([]);
  });

  it('keeps a genuine zero reading and handles no or one reading', () => {
    expect(buildMotMileageHistory([]).points).toEqual([]);
    const history = buildMotMileageHistory([test('2026-01-01', '0')]);
    expect(history.points[0].miles).toBe(0);
    expect(history.segments).toHaveLength(1);
    expect(history.hasDecrease).toBe(false);
    expect(motMileageLabel(history.points[0].test)).toBe('0 miles');
  });

  it('does not claim a later drop for equal timestamps or kilometre conversion rounding', () => {
    const simultaneous = buildMotMileageHistory([test('2026-01-01', '52000'), test('2026-01-01', '51000')]);
    expect(simultaneous.hasDecrease).toBe(false);
    expect(simultaneous.segments).toHaveLength(2);
    expect(buildMotMileageHistory([test('2025-01-01', '50000'), test('2026-01-01', '80467', 'KM')]).hasDecrease).toBe(false);
  });
});
