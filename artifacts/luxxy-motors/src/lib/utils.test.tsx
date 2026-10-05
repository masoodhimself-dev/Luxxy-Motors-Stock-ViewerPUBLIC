import { describe, expect, it } from 'vitest';
import { isUKNumberPlate, vehicleDisplayTitle, vehicleRegistration, vehicleRegistrationLabel } from '@/lib/utils';

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

  it('skips placeholders and bands in supplied plate fields', () => {
    expect(vehicleRegistration({ plate: 'Not supplied', vrm: 'sd15 dyp' })).toBe('SD15 DYP');
    expect(vehicleRegistration({ plate: '2015 (15 reg)', registrationBand: '2015 (15 reg)' })).toBe('');
  });
});

describe('vehicleRegistrationLabel', () => {
  it('uses the real plate before a registration year or band', () => {
    expect(vehicleRegistrationLabel({ plate: 'sd15 dyp', registration: '2015 (15 reg)', year: 2015 })).toBe('SD15 DYP');
    expect(vehicleRegistrationLabel({ plate: ' ', vrm: 'MP65 FWC', registration: '2016 (65 reg)' })).toBe('MP65 FWC');
  });

  it('keeps registration bands and year fallback when a plate is absent', () => {
    expect(vehicleRegistrationLabel({ registration: '2015 (65 reg)', year: 2015 })).toBe('2015 (65 reg)');
    expect(vehicleRegistrationLabel({ registrationBand: '65', year: 2015 })).toBe('2015 (65 reg)');
    expect(vehicleRegistrationLabel({ registrationBand: '65' })).toBe('65');
    expect(vehicleRegistrationLabel({ registration: 'Not supplied', year: 2015 })).toBe('2015');
    expect(vehicleRegistrationLabel({})).toBe('');
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

describe('vehicleDisplayTitle', () => {
  it('removes the vehicle year from customer-facing titles', () => {
    expect(vehicleDisplayTitle({
      title: '2015 Hyundai i10',
      make: 'Hyundai',
      model: 'i10',
      year: 2015,
    })).toBe('Hyundai i10');

    expect(vehicleDisplayTitle({
      title: 'MG MG ZS 2023',
      make: 'MG',
      model: 'MG ZS',
      year: 2023,
    })).toBe('MG ZS');
  });

  it('does not mistake a numeric model name for the vehicle year', () => {
    expect(vehicleDisplayTitle({
      title: '2021 Peugeot 2008',
      make: 'Peugeot',
      model: '2008',
      year: 2021,
    })).toBe('Peugeot 2008');
  });
});


describe('imported vehicle display labels', () => {
  it('removes a duplicated make without changing the record or a legitimate model', () => {
    const car = { title: '2026 MG MG HS', make: 'MG', model: 'MG HS', year: 2026 };
    expect(vehicleDisplayTitle(car)).toBe('MG HS');
    expect(car.title).toBe('2026 MG MG HS');
    expect(vehicleDisplayTitle({ make: 'Land Rover', model: 'Range Rover Sport' })).toBe('Land Rover Range Rover Sport');
  });
});
