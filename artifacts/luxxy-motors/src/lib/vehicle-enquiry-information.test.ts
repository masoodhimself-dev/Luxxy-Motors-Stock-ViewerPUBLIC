import { describe, expect, it } from 'vitest';
import type { MotHistory, MotTest } from '@workspace/vehicle-meta';
import type { Car } from './stock-context';
import { vehicleEnquiryFacts, vehicleEnquiryMot } from './vehicle-enquiry-information';

const now = new Date('2026-11-02T12:00:00Z');
const car = (values: Partial<Car> = {}) => ({ id: 'car-a', make: 'Ford', model: 'Focus', plate: 'AB12 CDE', ...values }) as Car;
const passed: MotTest = { completedDate: '2026-10-03T10:00:00Z', expiryDate: '2027-10-02', result: 'PASSED', mileage: '42000', mileageUnit: 'MI', defects: [] };
const history = (values: Partial<MotHistory> = {}): MotHistory => ({ registration: 'AB12CDE', make: 'FORD', model: 'FOCUS', checkedAt: now.toISOString(), recall: 'Unknown', tests: [{ ...passed }], ...values });

describe('enquiry MOT information', () => {
  it('formats the current matching MOT expiry without rewriting the record', () => {
    const record = history();
    const before = JSON.stringify(record);
    expect(vehicleEnquiryMot(car(), record, now)).toEqual({ label: 'MOT expires', value: '2 October 2027' });
    expect(JSON.stringify(record)).toBe(before);
  });

  it('chooses the latest result without mutating unordered tests', () => {
    expect(vehicleEnquiryMot(car(), history({ tests: [{ ...passed, completedDate: '2025-10-01', expiryDate: '2026-10-01' }, passed] }), now))
      .toEqual({ label: 'MOT expires', value: '2 October 2027' });
  });

  it('does not promote an older pass after a later failure or tied conflicting result', () => {
    for (const completedDate of ['2026-11-01', passed.completedDate]) {
      expect(vehicleEnquiryMot(car(), history({ tests: [passed, { ...passed, completedDate, result: 'FAILED', expiryDate: null }] }), now)).toBeNull();
    }
  });

  it.each(['2026-10-31T11:59:59Z', '2026-11-02T12:00:01Z', 'invalid'])('rejects stale, future and invalid check times (%s)', checkedAt => {
    expect(vehicleEnquiryMot(car(), history({ checkedAt }), now)).toBeNull();
  });

  it('accepts the exact freshness boundary and rejects a mismatched or missing registration', () => {
    expect(vehicleEnquiryMot(car(), history({ checkedAt: '2026-11-01T12:00:00Z' }), now)).not.toBeNull();
    expect(vehicleEnquiryMot(car(), history({ registration: 'XY19ZZZ' }), now)).toBeNull();
    expect(vehicleEnquiryMot(car({ plate: null }), history(), now)).toBeNull();
    expect(vehicleEnquiryMot(car(), null, now)).toBeNull();
  });

  it.each(['invalid', '2026-02-30', '2026-13-01', '2026-11-03', '2026-11-02T12:00:01Z'])('does not ignore a malformed or future test (%s)', completedDate => {
    expect(vehicleEnquiryMot(car(), history({ tests: [passed, { ...passed, completedDate }] }), now)).toBeNull();
  });

  it.each([null, 'invalid', '2027-02-30', '2026-11-01', '2026-01-01'])('rejects absent, malformed or expired expiry (%s)', expiryDate => {
    expect(vehicleEnquiryMot(car(), history({ tests: [{ ...passed, expiryDate }] }), now)).toBeNull();
  });

  it('keeps an expiry today valid until the end of the London calendar day', () => {
    const summerNow = new Date('2027-07-01T23:30:00Z');
    expect(vehicleEnquiryMot(car(), history({ checkedAt: summerNow.toISOString(), tests: [{ ...passed, completedDate: '2027-06-30', expiryDate: '2027-07-02' }] }), summerNow))
      .toEqual({ label: 'MOT expires', value: '2 July 2027' });
    expect(vehicleEnquiryMot(car(), history({ checkedAt: summerNow.toISOString(), tests: [{ ...passed, completedDate: '2027-06-30', expiryDate: '2027-07-01' }] }), summerNow)).toBeNull();
  });

  it('uses only an official first due date when no tests exist', () => {
    expect(vehicleEnquiryMot(car(), history({ tests: [], firstMotDueDate: '2027-10-02' }), now))
      .toEqual({ label: 'First MOT due', value: '2 October 2027' });
    for (const firstMotDueDate of [undefined, null, '2026-11-02', '2026-11-01', '2027-02-30']) {
      expect(vehicleEnquiryMot(car(), history({ tests: [], firstMotDueDate }), now)).toBeNull();
    }
    expect(vehicleEnquiryMot(car(), history({ tests: [{ ...passed, result: 'FAILED' }], firstMotDueDate: '2027-10-02' }), now)).toBeNull();
  });
});

describe('compact enquiry vehicle facts', () => {
  it('shows known specification values with sensible number formatting', () => {
    expect(vehicleEnquiryFacts(car({ year: 2016, mileage: 42000, fuel: ' Petrol ', transmission: 'Automatic', engineCC: 999, bodyType: 'Hatchback', colour: 'Blue', doors: 5, seats: 5 })))
      .toEqual([
        { label: 'Year', value: '2016' }, { label: 'Mileage', value: '42,000 miles' }, { label: 'Fuel', value: 'Petrol' },
        { label: 'Transmission', value: 'Automatic' }, { label: 'Engine', value: '1.0L' }, { label: 'Body type', value: 'Hatchback' },
        { label: 'Colour', value: 'Blue' }, { label: 'Doors', value: '5' }, { label: 'Seats', value: '5' },
      ]);
  });

  it('omits missing and placeholder data rather than guessing details', () => {
    expect(vehicleEnquiryFacts(car({ year: 0, mileage: NaN, mileageText: 'Unknown', fuel: 'N/A', transmission: 'Not specified', engineCC: 0, bodyType: '-', colour: 'TBC', doors: -1, seats: 0 }))).toEqual([]);
    expect(vehicleEnquiryFacts(car({ mileage: 0, engineSize: '2.0L' }))).toEqual([{ label: 'Mileage', value: '0 miles' }, { label: 'Engine', value: '2.0L' }]);
  });

  it('includes only safe supplied history summaries and caps the panel at ten facts', () => {
    const facts = vehicleEnquiryFacts(car({ year: 2016, mileage: 42000, fuel: 'Petrol', transmission: 'Automatic', engineSize: '1.0L', bodyType: 'Hatchback', colour: 'Blue', doors: 5, seats: 5, description: 'One owner from new. Full service history. Two keys.' }));
    expect(facts).toHaveLength(10);
    expect(facts.at(-1)).toEqual({ label: 'Owners', value: '1 owner from new' });
    expect(vehicleEnquiryFacts(car({ description: 'Full service history may be available. No keys are supplied.' }))).toEqual([]);
  });
});
