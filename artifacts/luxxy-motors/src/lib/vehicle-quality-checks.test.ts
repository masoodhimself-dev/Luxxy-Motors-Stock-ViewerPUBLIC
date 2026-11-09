import { describe, expect, it } from 'vitest';
import type { MotHistory, MotTest } from '@workspace/vehicle-meta';
import type { Car } from './stock-context';
import { vehicleQualityChecks } from './vehicle-quality-checks';

const now = new Date('2026-11-07T12:00:00Z');
const advert = 'https://www.cazoo.co.uk/cars-for-sale/80238245/';
type SourceCheck = { name: string; status: string; sourceText: string };
const passed = (name: string): SourceCheck => ({ name, status: 'passed', sourceText: 'All passed' });
function car(checks?: SourceCheck[], extra: Partial<Car> = {}): Car {
  return { id: 'quality-car', make: 'Ford', model: 'Focus', plate: 'AB12 CDE', advertId: '80238245', advertUrl: advert,
    ...(checks ? { sourceExtras: { sourcePlatform: 'cazoo', sourceReport: { version: 1, platform: 'cazoo', sourceUrl: advert, capturedAt: '2026-11-07T11:55:00Z', history: { caveat: 'Results supplied by the source for this advert.', checks } } } } : {}), ...extra } as Car;
}
const passedMot: MotTest = { completedDate: '2026-10-03T10:00:00Z', expiryDate: '2027-10-02', result: 'PASSED', mileage: '42000', mileageUnit: 'MI', defects: [] };
const history = (extra: Partial<MotHistory> = {}): MotHistory => ({ registration: 'AB12CDE', make: 'FORD', model: 'FOCUS', checkedAt: now.toISOString(), recall: 'Unknown', tests: [{ ...passedMot }], ...extra });
const status = (input: Car, id: string, mot?: MotHistory | null) => vehicleQualityChecks(input, mot, now).find(check => check.id === id)!;

describe('per-car quality results', () => {
  it('keeps the screenshot order and leaves every missing check unknown', () => {
    const rows = vehicleQualityChecks(car(), undefined, now);
    expect(rows.map(row => row.label)).toEqual(['HPI Check', 'Road test', 'Under the bonnet', 'Wheels & brakes', 'MOT', 'Interior', 'Suspension', 'Oil', 'Bodywork', 'Multipoint inspection']);
    expect(rows.every(row => row.status === 'unknown')).toBe(true);
  });

  it('uses only explicit named results, and never promotes description promises, inspection tasks or HPI subchecks', () => {
    const input = car([passed('Not stolen'), passed('Outstanding finance'), passed('Not written off'), passed('Inspection'), passed('Road test preparation')], {
      description: 'HPI clear. Multipoint inspection passed. Road test passed. MOT until 2027.',
      preparation: { tasks: { inspection: 'completed', mot: 'completed', servicing: 'completed' } },
    });
    expect(vehicleQualityChecks(input, undefined, now).every(row => row.status === 'unknown')).toBe(true);
    const named = car(['HPI Check', 'Road test', 'Under the bonnet', 'Wheels & brakes', 'Interior', 'Suspension', 'Oil', 'Body work', 'Multipoint inspection', 'MOT'].map(passed));
    expect(vehicleQualityChecks(named, undefined, now).filter(row => row.id !== 'mot').every(row => row.status === 'passed')).toBe(true);
    expect(status(named, 'mot').status).toBe('unknown');
  });

  it('combines duplicate results conservatively across whitespace, case and equivalent names', () => {
    expect(status(car([passed('  ROAD   TEST  '), passed('Road-test')]), 'road-test').status).toBe('passed');
    expect(status(car([passed('Bodywork'), { name: 'Body work', status: 'unknown', sourceText: 'Not recorded' }]), 'bodywork').status).toBe('unknown');
    for (const result of [{ status: 'failed', sourceText: 'Failed' }, { status: 'advisory', sourceText: 'Requires attention' }]) {
      expect(status(car([passed('Wheels & brakes'), { name: 'Wheels and brakes', ...result }]), 'wheels-brakes').status).toBe('attention');
    }
    expect(status(car([passed('Oil'), { name: 'Oil', status: 'passed', sourceText: 'Not verified' }]), 'oil').status).toBe('unknown');
  });

  it('rejects mismatched, malformed and future source evidence', () => {
    const input = car([passed('Road test')]);
    expect(status({ ...input, advertId: '9999' }, 'road-test').status).toBe('unknown');
    expect(status({ ...input, advertUrl: 'https://cazoo.co.uk/cars-for-sale/9999/' }, 'road-test').status).toBe('unknown');
    for (const sourceReport of [null, {}, { ...(input.sourceExtras!.sourceReport as object), sourceUrl: 'https://cazoo.co.uk.evil.test/cars-for-sale/80238245/' },
      { ...(input.sourceExtras!.sourceReport as object), capturedAt: '2026-11-07T12:06:00Z' },
      { ...(input.sourceExtras!.sourceReport as object), history: { caveat: 'Source report', checks: [null] } }])
      expect(status({ ...input, sourceExtras: { ...input.sourceExtras, sourceReport } }, 'road-test').status).toBe('unknown');
  });

  it.each(['A', 'B', 'C', 'D', 'N', 'S'])('prioritises recorded Category %s over an overall HPI pass', category => {
    const input = car([passed('HPI Check')], { writeOffCategory: `Category ${category}` });
    expect(status(input, 'hpi')).toMatchObject({ status: 'attention', detail: `Category ${category} recorded. Please read the insurance history.` });
  });

  it('keeps a recorded category visible even without a source report and across conflicting structured fields', () => {
    expect(status(car(undefined, { sourceExtras: { writeOffCategory: 'Cat N' } }), 'hpi').status).toBe('attention');
    expect(status(car([passed('HPI')], { writeOffCategory: 'clear', specifications: { writeOffCategory: 'S' } }), 'hpi')).toMatchObject({ status: 'attention', detail: expect.stringContaining('Category S') });
    expect(status(car([passed('HPI')], { writeOffCategory: 'Category S', specifications: { writeOffCategory: 'Category N' } }), 'hpi').detail).toContain('S / N');
  });

  it('uses a fresh matching current MOT result without treating it as proof of other mechanical checks', () => {
    const input = car();
    expect(status(input, 'mot', history())).toMatchObject({ status: 'passed', detail: 'MOT expires: 2 October 2027' });
    expect(vehicleQualityChecks(input, history(), now).filter(row => row.id !== 'mot').every(row => row.status === 'unknown')).toBe(true);
    expect(status(input, 'mot', history({ tests: [], firstMotDueDate: '2027-10-02' }))).toMatchObject({ status: 'not_due', detail: 'First MOT due: 2 October 2027' });
  });

  it('never promotes stale, failed, expired, mismatched or malformed MOT records to a pass', () => {
    const input = car([passed('MOT')], { description: 'MOT passed until October 2027.' });
    for (const record of [history({ checkedAt: '2026-11-06T11:59:59Z' }), history({ checkedAt: '2026-11-07T12:00:01Z' }), history({ registration: 'XY19ZZZ' }),
      history({ tests: [{ ...passedMot, expiryDate: '2026-11-06' }] }), history({ tests: [passedMot, { ...passedMot, completedDate: '2026-11-06', result: 'FAILED', expiryDate: null }] }),
      history({ tests: [null] as unknown as MotTest[] }), history({ tests: [{ ...passedMot, completedDate: '2026-11-08' }] })])
      expect(status(input, 'mot', record).status).toBe('unknown');
  });

  it('does not modify source checks or optional MOT records', () => {
    const input = car([passed('HPI Check'), passed('Road test')]), record = history(), before = JSON.stringify({ input, record });
    vehicleQualityChecks(input, record, now);
    expect(JSON.stringify({ input, record })).toBe(before);
  });

  it('uses explicit dealer confirmation for completed checks without applying it to other dealerships', () => {
    expect(vehicleQualityChecks(car(), undefined, now, true).every(row => row.status === 'passed')).toBe(true);
    expect(vehicleQualityChecks(car(), null, now, true).every(row => row.status === 'passed')).toBe(true);
    expect(vehicleQualityChecks(car(), null, now).every(row => row.status === 'unknown')).toBe(true);
  });

  it('never lets dealer confirmation override a recorded category or a reported issue', () => {
    const input = car([{ name: 'Wheels & brakes', status: 'failed', sourceText: 'Failed' }], { writeOffCategory: 'S' });
    const rows = vehicleQualityChecks(input, null, now, true);
    expect(rows.find(row => row.id === 'hpi')).toMatchObject({ status: 'attention', detail: expect.stringContaining('Category S') });
    expect(rows.find(row => row.id === 'wheels-brakes')?.status).toBe('attention');
    const finance = car([{ name: 'Outstanding finance', status: 'advisory', sourceText: 'Review required' }]);
    expect(vehicleQualityChecks(finance, undefined, now, true).find(row => row.id === 'hpi')?.status).toBe('attention');
  });

  it('preserves the real Nissan Leaf advert’s bare Cat N disclosure before dealer confirmation', () => {
    const input = car(undefined, { make: 'Nissan', model: 'Leaf', writeOffCategory: null,
      description: 'Full service history. Two keys. Nationwide delivery service is available. Cat n' });
    expect(vehicleQualityChecks(input, null, now, true).find(row => row.id === 'hpi'))
      .toMatchObject({ status: 'attention', detail: 'Advert states Category N' });
  });

  it('recognises explicit advertised categories in supplied description fields and direct recorded statements', () => {
    const inputs = [
      car(undefined, { sourceExtras: { description: 'Our used car. Category S' } }),
      car(undefined, { sourceExtras: { advertDescription: 'Cat N\nTwo keys supplied.' } }),
      car(undefined, { specifications: { description: 'Ready to view. Cat N' } }),
      car(undefined, { description: 'This car was recorded as Category S.' }),
      car([passed('HPI')], { description: 'HPI clear. This vehicle was recorded as Cat N.' }),
    ];
    for (const input of inputs) expect(vehicleQualityChecks(input, null, now, true).find(row => row.id === 'hpi'))
      .toMatchObject({ status: 'attention', detail: expect.stringMatching(/^Advert states Category [NS]$/) });
  });

  it('does not turn negated, possible or queried categories into advertised facts, or prose into a pass', () => {
    for (const description of ['Not Cat N', 'Category S?', 'Could be Cat N', 'Never recorded as Category N', 'HPI clear']) {
      expect(status(car(undefined, { description }), 'hpi').status).toBe('unknown');
    }
  });

  it('does not replace a stale, conflicting or invalid supplied MOT record with a dealer-confirmed pass', () => {
    for (const record of [history({ checkedAt: '2026-11-06T11:59:59Z' }), history({ tests: [{ ...passedMot, result: 'FAILED' }] }),
      history({ tests: [{ ...passedMot, expiryDate: '2026-11-06' }] }), history({ registration: 'XY19ZZZ' }), history({ tests: [null] as unknown as MotTest[] })])
      expect(vehicleQualityChecks(car(), record, now, true).find(row => row.id === 'mot')?.status).toBe('unknown');
    expect(vehicleQualityChecks(car(), history({ tests: [], firstMotDueDate: '2027-10-02' }), now, true).find(row => row.id === 'mot')?.status).toBe('not_due');
  });
});
