import { describe, expect, it } from 'vitest';
import type { Car } from './stock-context';
import { stockCardSellingPoints } from './stock-card-presentation';

const car = (values: Partial<Car>) => values as Car;

describe('compact stock selling points', () => {
  it('prioritises explicit description facts before structured history and equipment', () => {
    expect(stockCardSellingPoints(car({ description: 'Heated front seats. Reversing camera.', features: ['Apple CarPlay'], sourceExtras: { serviceHistory: 'Full' } })))
      .toEqual(['Rear camera', 'Heated seats']);
  });

  it('fills a remaining place from structured features and never adds more than two', () => {
    expect(stockCardSellingPoints(car({ description: 'Full service history.', features: ['Heated Front Seats', 'Reversing Camera', 'Apple CarPlay'] })))
      .toEqual(['Full service history', 'Rear camera']);
  });

  it('uses existing source fallbacks without extracting complete advert sentences', () => {
    expect(stockCardSellingPoints(car({ sourceExtras: { advertDescription: 'Excellent choice. Full service history, call the showroom to arrange a visit.', featureList: ['Bluetooth Audio'] } })))
      .toEqual(['Full service history', 'Bluetooth']);
  });

  it.each([
    ['Full service history', 'Full service history'], ['Full dealership service history', 'Full service history'], ['FSH', 'Full service history'],
    ['Verified service history', 'Service history verified'], ['Service history is verified', 'Service history verified'],
  ])('only summarises explicit service wording: %s', (description, expected) => {
    expect(stockCardSellingPoints(car({ description }))).toEqual([expected]);
  });

  it.each([
    'No service history', 'Not full service history', 'Full service history unavailable', 'May have full service history',
    'Full service history will be provided', 'Service history needs verifying', 'Service history', 'Recently serviced',
    'Service history not verified', 'Is the full service history available?',
    'Full service history cannot be verified.', 'This car lacks full service history.', 'Lacking full service history.',
    'Full service history is unverifiable.', 'Full service history is unconfirmed.', 'Full service history is unsubstantiated.',
    'Full service history is uncertain.', 'Full service history paperwork lost.', 'Full service history is incomplete.',
  ])('does not strengthen uncertain or negative history: %s', description => {
    expect(stockCardSellingPoints(car({ description }))).toEqual([]);
  });

  it.each([
    ['3 month warranty included', '3-month warranty included'], ['Includes a 6-month warranty', '6-month warranty included'],
    ['Comes with twelve months warranty', '12-month warranty included'], ["One year's warranty included", '1-year warranty included'],
    ['Warranty is included for 2 years', '2-year warranty included'], ['Warranty included', 'Warranty included'],
  ])('shows only explicitly included warranty and a supplied duration: %s', (description, expected) => {
    expect(stockCardSellingPoints(car({ description }))).toEqual([expected]);
  });

  it.each([
    'No warranty', 'Warranty available', '3 month warranty available', 'Extended warranty offered', '3 month warranty',
    'Warranty included at extra cost', 'Warranty included subject to approval', 'Warranty included. It costs extra.',
    'Warranty included. Terms and exclusions apply.', 'Warranty included. Optional extra.', 'Warranty included. At an extra cost.',
    'Warranty included only when purchasing the protection package.', 'Warranty included on request.',
    'Warranty included only with the premium package.', 'Warranty included. This is optional.',
    'Warranty included. Only when purchasing a protection package.', 'Warranty included. On request.',
    'Warranty included. A purchase is required.', 'Warranty included. A charge applies.',
    '0 month warranty included', '3 month or 3000 mile warranty included',
  ])('does not promise a conditional, optional or invalid warranty: %s', description => {
    expect(stockCardSellingPoints(car({ description }))).toEqual([]);
  });

  it('uses source history shapes and keeps qualified source claims out', () => {
    expect(stockCardSellingPoints(car({ sourceExtras: { historyExtras: { serviceHistory: { description: 'Full dealership service history' } }, featureList: ['3 month warranty included', 'Heated Front Seats'] } })))
      .toEqual(['Full service history', '3-month warranty included']);
    expect(stockCardSellingPoints(car({ sourceExtras: { serviceHistory: 'Full service history not supplied' } }))).toEqual([]);
  });

  it('honours description negatives even when imported features contradict them', () => {
    expect(stockCardSellingPoints(car({ description: 'No warranty. Rear camera does not work. No full service history.', features: ['Warranty included', 'Reversing Camera', 'Heated Front Seats'], sourceExtras: { serviceHistory: 'Full' } })))
      .toEqual(['Heated seats']);
    expect(stockCardSellingPoints(car({ description: 'Full service history cannot be verified. Warranty included on request.', sourceExtras: { serviceHistory: 'Full' }, features: ['Warranty included', 'Reversing Camera'] })))
      .toEqual(['Rear camera']);
  });

  it('does not separate a feature from a following qualification', () => {
    expect(stockCardSellingPoints(car({ description: 'Heated front seats. They do not work. Apple CarPlay.' }))).toEqual(['Apple CarPlay']);
    expect(stockCardSellingPoints(car({ description: 'Full service history; not available to inspect.', features: ['Bluetooth'] }))).toEqual(['Bluetooth']);
  });

  it('does not let a contradictory feature entry promote the same topic', () => {
    expect(stockCardSellingPoints(car({ features: ['Reversing Camera', 'Rear camera missing', 'No heated seats', 'Apple CarPlay', 'Bluetooth'] })))
      .toEqual(['Apple CarPlay', 'Bluetooth']);
  });

  it.each(['Optional Apple CarPlay', 'CarPlay compatible', 'Sat nav preparation', 'Heated seats removed', 'Bluetooth unavailable', 'Non-functioning cruise control', 'Faulty climate control', 'No rear parking sensors', 'Sunroof blind'])('rejects qualified equipment: %s', feature => {
    expect(stockCardSellingPoints(car({ features: [feature] }))).toEqual([]);
    expect(stockCardSellingPoints(car({ description: feature }))).toEqual([]);
  });

  it('deduplicates equivalent supplied labels and selects practical equipment', () => {
    expect(stockCardSellingPoints(car({ features: ['Rear-View Camera', 'Reversing Camera', 'Heated Front Seats', 'Heated Rear Seats', 'Chrome trim'] })))
      .toEqual(['Rear camera', 'Heated seats']);
  });

  it.each([['Rear-View Camera', 'Rear camera'], ['360° Camera', '360° camera'], ['Surround View Camera', '360° camera'], ['Parking Camera', 'Parking camera']])('preserves the supplied camera type without assuming its position: %s', (feature, expected) => {
    expect(stockCardSellingPoints(car({ features: [feature] }))).toEqual([expected]);
  });

  it('never repeats ULEZ, engine, owner or MOT facts from the badge row', () => {
    expect(stockCardSellingPoints(car({ description: 'One owner. ULEZ compliant. 999cc engine. Long MOT until October 2027.', owners: 1, engineCC: 999, fuel: 'Petrol', emissionClass: 'Euro 6' })))
      .toEqual([]);
  });

  it('handles empty, unfamiliar and malformed source data without invented claims', () => {
    expect(stockCardSellingPoints(car({}))).toEqual([]);
    expect(stockCardSellingPoints(car({ description: 'Beautiful car, drives well. Finance available.', sourceExtras: { featureList: ['Exterior', null, 42, 'Factory code ABC'], serviceHistory: {} } }))).toEqual([]);
    expect(stockCardSellingPoints(car({ features: ['Alloy wheels', 'Tinted glass'] }))).toEqual([]);
  });

  it('treats simple HTML and uppercase source text as evidence without leaking markup', () => {
    expect(stockCardSellingPoints(car({ description: '<p>FULL SERVICE HISTORY</p><p>HEATED FRONT SEATS</p>' })))
      .toEqual(['Full service history', 'Heated seats']);
  });

  it('does not mutate the vehicle or supplied feature order', () => {
    const features = Object.freeze(['Bluetooth', 'Rear parking sensors', 'Apple CarPlay']);
    const source = Object.freeze(car({ features, sourceExtras: Object.freeze({ serviceHistory: 'Full' }) }));
    const before = JSON.stringify(source);
    expect(stockCardSellingPoints(source)).toEqual(['Full service history', 'Apple CarPlay']);
    expect(JSON.stringify(source)).toBe(before);
  });
});
