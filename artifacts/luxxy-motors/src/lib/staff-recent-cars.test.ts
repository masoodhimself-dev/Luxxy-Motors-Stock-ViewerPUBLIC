import { describe, expect, it } from 'vitest';
import { parseStaffRecentCars, rememberStaffCar, staffRecentCarsKey } from './staff-recent-cars';

describe('staff recent cars', () => {
  it('requires both the dealer and signed-in staff identity, with unambiguous scopes', () => {
    expect(staffRecentCarsKey('dealer-one')).toBeNull();
    expect(staffRecentCarsKey(undefined, 'sam')).toBeNull();
    expect(staffRecentCarsKey('dealer-one', 'sam')).not.toBe(staffRecentCarsKey('dealer-two', 'sam'));
    expect(staffRecentCarsKey('dealer-one', 'sam')).not.toBe(staffRecentCarsKey('dealer-one', 'alex'));
    expect(staffRecentCarsKey('a:b', 'c')).not.toBe(staffRecentCarsKey('a', 'b:c'));
  });
  it('keeps six unique IDs in most recently opened order', () => {
    expect(rememberStaffCar(['a', 'b', 'c', 'd', 'e', 'f'], 'c')).toEqual(['c', 'a', 'b', 'd', 'e', 'f']);
    expect(rememberStaffCar(['a', 'b', 'c', 'd', 'e', 'f'], 'g')).toEqual(['g', 'a', 'b', 'c', 'd', 'e']);
  });
  it('ignores corrupt storage and non-ID records, with no vehicle or customer data', () => {
    for (const value of [null, 'bad', '{}', '"car-one"']) expect(parseStaffRecentCars(value)).toEqual([]);
    expect(parseStaffRecentCars('["car-one", "car-one", null, {"title":"Private"}, "https://other.test", "car-two"]')).toEqual(['car-one', 'car-two']);
  });
});
