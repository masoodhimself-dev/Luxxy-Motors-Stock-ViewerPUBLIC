import { describe, expect, it } from 'vitest';
import { hasExplicitClearHistory, insuranceHistoryLabel, recordedWriteOffCategory, vehicleWriteOffCategory } from './vehicle-history';

describe('supplied vehicle insurance history', () => {
  it.each(['S', 'Cat S', 'Category S', 'Category S recorded'])('recognises %s precisely', (value) => {
    expect(recordedWriteOffCategory(value)).toBe('S');
    expect(insuranceHistoryLabel(value)).toBe('Category S recorded');
  });
  it.each(['None', 'Unknown', 'Not recorded', 'No write-off recorded', 'No structural damage'])('does not infer a category from letters in %s', (value) => {
    expect(recordedWriteOffCategory(value)).toBeNull();
  });
  it('retains uncertainty and only treats explicit clear values as clear', () => {
    expect(hasExplicitClearHistory(null)).toBe(false);
    expect(hasExplicitClearHistory('Unknown')).toBe(false);
    expect(hasExplicitClearHistory('Category C')).toBe(false);
    expect(hasExplicitClearHistory('None')).toBe(true);
    expect(hasExplicitClearHistory('No recorded write-off')).toBe(true);
    expect(insuranceHistoryLabel(null)).toBe('Not provided');
    expect(insuranceHistoryLabel('Category C')).toBe('Category C');
    expect(insuranceHistoryLabel('Cat N')).toBe('Category N recorded');
  });
  it('reads supplied structured categories consistently with the vehicle information section', () => {
    expect(vehicleWriteOffCategory({ specifications: { writeOffCategory: ' Cat S ' } })).toBe('Cat S');
    expect(vehicleWriteOffCategory({ sourceExtras: { writeOffCategory: 'N' } })).toBe('N');
    expect(vehicleWriteOffCategory({ writeOffCategory: 'Unknown', specifications: { writeOffCategory: 'S' } })).toBe('Unknown');
    expect(vehicleWriteOffCategory({ writeOffCategory: ' ', specifications: { writeOffCategory: 2 }, sourceExtras: { writeOffCategory: 'N' } })).toBe('N');
  });
  it('does not treat a description or missing information as a confirmed insurance category', () => {
    expect(vehicleWriteOffCategory({ sourceExtras: { description: 'Car is recorded as Cat S' } })).toBeNull();
    expect(vehicleWriteOffCategory({})).toBeNull();
  });
});
