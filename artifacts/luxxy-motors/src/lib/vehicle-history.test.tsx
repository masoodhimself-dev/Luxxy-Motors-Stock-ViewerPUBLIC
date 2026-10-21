import { describe, expect, it } from 'vitest';
import { advertisedWriteOffCategory, hasExplicitClearHistory, insuranceHistoryLabel, recordedWriteOffCategory, vehicleInsuranceDisclosure, vehicleWriteOffCategory } from './vehicle-history';

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

describe('advert insurance disclosure', () => {
  it.each([
    ['This car is recorded as Cat S. Ask for the repair records.', 'S'],
    ['Previously recorded as Category N', 'N'],
    ['The car was classified as a category S by the insurer.', 'S'],
  ])('labels an explicit advert statement separately: %s', (description, category) => {
    expect(advertisedWriteOffCategory(description)).toBe(category);
    const disclosure = vehicleInsuranceDisclosure({}, description)!;
    expect(disclosure.cardLabel).toBe(`Advert states Category ${category}`);
    expect(disclosure.explanation).toContain('has not confirmed that category');
    expect(disclosure.explanation).not.toMatch(/safe to drive|certified|approved|roadworthy/);
  });
  it.each([
    'Seller says Cat S; ask for records.', 'Not recorded as Cat S.', 'Never registered as Category N.',
    'Could be recorded as Cat S.', 'If recorded as Cat S, ask for checks.', 'Recorded as Cat S?',
    'Example: recorded as Category S.', 'Incorrectly recorded as Category N.',
    'Category S unknown.', 'Was recorded as Cat S in error.',
    'Recorded as Cat S. Classified as Cat N.',
    'We accept cars recorded as Category S in part exchange.',
    'Our previous car was recorded as Cat S; this one is HPI clear.',
    'Our previous car was damaged. It was recorded as Category N.',
    'Customers ask about vehicles recorded as Category S.',
    'Recorded as Category S. This car is HPI clear.',
    'Recorded as Cat S. No insurance write-off recorded.',
  ])('does not guess from ambiguous, conflicting or negated copy: %s', description => {
    expect(advertisedWriteOffCategory(description)).toBeNull();
  });
  it('keeps structured history authoritative and does not change filter data', () => {
    expect(vehicleInsuranceDisclosure({writeOffCategory: 'N'}, 'Recorded as Cat S.')?.cardLabel).toBe('Category N recorded');
    expect(vehicleWriteOffCategory({sourceExtras: {description: 'Recorded as Cat S.'}})).toBeNull();
  });
});
