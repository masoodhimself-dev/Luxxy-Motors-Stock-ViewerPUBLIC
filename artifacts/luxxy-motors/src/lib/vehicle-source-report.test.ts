import { describe, expect, it } from 'vitest';
import { readVehicleSourceReport, type VehicleSourceReportCar } from './vehicle-source-report';

const now = Date.parse('2026-10-24T20:00:00Z');
const sourceUrl = 'https://www.cazoo.co.uk/cars-for-sale/80238245/';
function sourceReport() {
  return {
    version: 1, platform: 'cazoo', sourceUrl, capturedAt: '2026-10-24T20:01:35+01:00',
    ulez: { status: 'compliant', sourceText: 'Yes' },
    history: { caveat: 'Guidance only. CAP HPI.', checks: [
      { name: 'Not stolen', status: 'passed', sourceText: 'All passed' },
      { name: 'Outstanding finance', status: 'unknown', sourceText: 'Not available' },
    ] },
  };
}
function car(report: unknown = sourceReport(), overrides: Partial<VehicleSourceReportCar> = {}): VehicleSourceReportCar {
  return { advertId: '80238245', advertUrl: sourceUrl, sourceExtras: { sourcePlatform: 'cazoo', sourceReport: report }, ...overrides };
}

describe('Cazoo source report evidence', () => {
  it('preserves original text, independent unknown checks and the exact source date', () => {
    const report = sourceReport();
    report.history.caveat = 'Guidance only.\nCAP HPI. Ask the dealer.';
    const parsed = readVehicleSourceReport(car(report), now);
    expect(parsed).toMatchObject({ platform: 'cazoo', capturedAt: report.capturedAt, sourceUrl, ulez: report.ulez, history: report.history });
    expect(parsed?.recordedDisclosure).toBeNull();
  });

  it.each([
    'https://www.cazoo.co.uk.evil.example/cars-for-sale/80238245/',
    'https://cazoo.co.uk@evil.example/cars-for-sale/80238245/',
    'https://person:secret@www.cazoo.co.uk/cars-for-sale/80238245/',
    'http://www.cazoo.co.uk/cars-for-sale/80238245/',
    'https://www.cazoo.co.uk:8443/cars-for-sale/80238245/',
    'https://www.cazoo.co.uk/cars-for-sale/99999999/',
    'https://www.cazoo.co.uk/cars-for-sale/80238245/?next=https://evil.example',
    'javascript:alert(1)',
  ])('rejects an unsafe or mismatched source link: %s', sourceUrl => {
    expect(readVehicleSourceReport(car({ ...sourceReport(), sourceUrl }), now)).toBeNull();
  });

  it('requires the car advert URL to agree if present, but accepts a missing optional advert URL', () => {
    expect(readVehicleSourceReport(car(sourceReport(), { advertUrl: 'https://www.cazoo.co.uk/cars-for-sale/999/' }), now)).toBeNull();
    expect(readVehicleSourceReport(car(sourceReport(), { advertUrl: null }), now)).not.toBeNull();
    expect(readVehicleSourceReport(car({ ...sourceReport(), sourceUrl: 'https://cazoo.co.uk/cars-for-sale/80238245' }), now)).not.toBeNull();
  });

  it.each([
    '2026-10-24', '2026-10-24T20:01:35', 'not a date', '2026-02-30T12:00:00Z',
    '2026-10-24T25:00:00Z', '2026-10-24T20:10:00Z', '2026-10-24T20:00:00+14:15',
  ])('rejects invalid, timezone-free or future capture timestamps: %s', capturedAt => {
    expect(readVehicleSourceReport(car({ ...sourceReport(), capturedAt }), now)).toBeNull();
  });

  it('allows five minutes of clock skew, with no invented expiration for dated source evidence', () => {
    expect(readVehicleSourceReport(car({ ...sourceReport(), capturedAt: '2026-10-24T20:05:00Z' }), now)).not.toBeNull();
    expect(readVehicleSourceReport(car({ ...sourceReport(), capturedAt: '2026-10-24T20:05:01Z' }), now)).toBeNull();
    expect(readVehicleSourceReport(car({ ...sourceReport(), capturedAt: '2025-10-24T20:00:00Z' }), now)).not.toBeNull();
  });

  it.each([
    undefined, null, {}, { ...sourceReport(), version: 2 }, { ...sourceReport(), platform: 'autotrader' },
  ])('omits unsupported report envelopes', report => {
    const input = car();
    input.sourceExtras!.sourceReport = report;
    expect(readVehicleSourceReport(input, now)).toBeNull();
  });

  it('does not use a Cazoo report on another marketplace or infer ULEZ from ordinary vehicle facts', () => {
    expect(readVehicleSourceReport(car(sourceReport(), { sourceExtras: { sourcePlatform: 'autotrader', sourceReport: sourceReport() } }), now)).toBeNull();
    expect(readVehicleSourceReport(car(undefined, { sourceExtras: { sourcePlatform: 'cazoo' }, specifications: { ulez: true, co2: 108, fuel: 'Hybrid', euro: 6 } }), now)).toBeNull();
  });

  it.each([
    ['compliant', 'No'], ['compliant', 'Not ULEZ compliant'], ['not_compliant', 'Yes'],
    ['compliant', 'Yes, but not confirmed'], ['unknown', 'Yes'], ['unknown', '–'], ['bogus', 'Yes'],
  ])('omits contradictory or unsupported ULEZ wording (%s / %s) while keeping valid history', (status, sourceText) => {
    expect(readVehicleSourceReport(car({ ...sourceReport(), ulez: { status, sourceText } }), now)).toMatchObject({ ulez: null, history: sourceReport().history });
  });

  it.each([
    ['compliant', 'ULEZ Compliant'], ['not_compliant', 'No'], ['not_compliant', 'Not ULEZ compliant'],
    ['unknown', 'Not confirmed'],
  ])('retains explicit %s ULEZ statements with original wording', (status, sourceText) => {
    expect(readVehicleSourceReport(car({ ...sourceReport(), ulez: { status, sourceText } }), now)?.ulez).toEqual({ status, sourceText });
  });

  it('does not convert source history results into an independent clear-history field', () => {
    const input = car();
    const before = JSON.stringify(input);
    expect(readVehicleSourceReport(input, now)?.history?.checks[0]).toEqual(sourceReport().history.checks[0]);
    expect(JSON.stringify(input)).toBe(before);
    expect(input.writeOffCategory).toBeUndefined();
  });

  it.each([
    ['passed', 'Unknown'], ['passed', 'Not available'], ['passed', 'Failed'], ['passed', 'No issues apparently'],
    ['passed', 'All passed, except mileage'], ['failed', 'Passed'], ['advisory', 'All passed'], ['advisory', 'Unconfirmed'],
  ])('demotes contradictory or unsupported history classification (%s / %s) without losing the source wording', (status, sourceText) => {
    const history = { caveat: 'Guidance only', checks: [{ name: 'Not stolen', status, sourceText }] };
    expect(readVehicleSourceReport(car({ ...sourceReport(), history }), now)?.history?.checks).toEqual([
      { name: 'Not stolen', status: 'unknown', sourceText },
    ]);
  });

  it.each([
    ['passed', 'All passed'], ['passed', 'Passed'], ['failed', 'Failed'], ['failed', 'Issue found'],
    ['advisory', 'Advisory'], ['advisory', 'Check the readings'], ['unknown', 'All passed'],
  ])('preserves supported conservative history classification (%s / %s)', (status, sourceText) => {
    const history = { caveat: 'Guidance only', checks: [{ name: 'Not stolen', status, sourceText }] };
    expect(readVehicleSourceReport(car({ ...sourceReport(), history }), now)?.history?.checks).toEqual([
      { name: 'Not stolen', status, sourceText },
    ]);
  });

  it.each([
    { caveat: '', checks: sourceReport().history.checks },
    { caveat: 'Guidance only', checks: [] },
    { caveat: 'Guidance only', checks: [{ name: 'Not stolen', status: 'verified', sourceText: 'All passed' }] },
    { caveat: 'Guidance only', checks: [{ name: '', status: 'passed', sourceText: 'All passed' }] },
  ])('omits incomplete history without discarding valid ULEZ evidence', history => {
    expect(readVehicleSourceReport(car({ ...sourceReport(), history }), now)).toMatchObject({ history: null, ulez: sourceReport().ulez });
  });

  it('retains known structured and original-description write-off disclosures beside passed source checks', () => {
    expect(readVehicleSourceReport(car(sourceReport(), { writeOffCategory: 'S' }), now)?.recordedDisclosure?.label).toBe('Category S');
    expect(readVehicleSourceReport(car(sourceReport(), { description: 'This car was recorded as Category N.' }), now)?.recordedDisclosure?.label).toBe('Advert states Category N');
  });
});
