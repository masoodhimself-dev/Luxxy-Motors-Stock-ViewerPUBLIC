import { describe, expect, it } from 'vitest';
import { isUKNumberPlate, vehicleRegistration } from '@/lib/utils';

describe('vehicleRegistration', () => {
  it('prefers the authoritative plate, then the vrm', () => {
    expect(vehicleRegistration({ plate: 'NV24 LNZ', vrm: 'AB12 CDE' })).toBe('NV24 LNZ');
    expect(vehicleRegistration({ plate: '  ', vrm: 'ab12 cde' })).toBe('AB12 CDE');
  });

  it('returns nothing when the vehicle has no registration at all', () => {
    expect(vehicleRegistration(null)).toBe('');
    expect(vehicleRegistration(undefined)).toBe('');
    expect(vehicleRegistration({})).toBe('');
    expect(vehicleRegistration({ plate: null, vrm: null, registration: null })).toBe('');
    expect(vehicleRegistration({ plate: '   ', vrm: '', registration: '  ' })).toBe('');
  });

  it('never renders a registration band as a plate', () => {
    // Band duplicated into the registration column.
    expect(vehicleRegistration({ registration: '2009 (59 reg)', registrationBand: '2009 (59 reg)' })).toBe('');
    // Band present with no band column to compare against.
    expect(vehicleRegistration({ registration: '2009 (59 reg)' })).toBe('');
    // Band that differs from the band column only by whitespace or casing.
    expect(vehicleRegistration({ registration: '2015 (65 REG)', registrationBand: '2015  (65 reg)' })).toBe('');
    expect(vehicleRegistration({ registration: '2024 (24 reg)', registrationBand: null })).toBe('');
  });

  it('accepts a genuine plate held in the registration column', () => {
    expect(vehicleRegistration({ registration: 'nv24 lnz', registrationBand: '2024 (24 reg)' })).toBe('NV24 LNZ');
  });
});

describe('isUKNumberPlate', () => {
  it('recognises the common UK plate formats', () => {
    ['AB12 CDE', 'ab12cde', 'A123 BCD', 'ABC 123A', 'ABC 123', '123 ABC', 'XYZ-1'].forEach((plate) => {
      expect(isUKNumberPlate(plate)).toBe(true);
    });
  });

  it('rejects registration bands and empty values', () => {
    ['2009 (59 reg)', '59 reg', '', '   ', 'Coming soon', '2009'].forEach((value) => {
      expect(isUKNumberPlate(value)).toBe(false);
    });
  });
});
