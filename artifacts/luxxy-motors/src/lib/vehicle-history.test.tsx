import { describe, expect, it } from 'vitest';
import { hasExplicitClearHistory, insuranceHistoryLabel, recordedWriteOffCategory } from './vehicle-history';

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
});
