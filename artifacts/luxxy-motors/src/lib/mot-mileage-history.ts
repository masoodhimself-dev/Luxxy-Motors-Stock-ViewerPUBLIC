import type { MotTest } from '@workspace/vehicle-meta';

/** Validate the calendar day too: Date.parse alone accepts dates such as 30 February. */
export function motTestTime(value: string): number | null {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const calendar = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== day) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function motDateLabel(value: string): string {
  const timestamp = motTestTime(value);
  return timestamp === null ? 'Date not recorded' : new Date(timestamp).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London',
  });
}

export function motMileageValue(value: string | null): number | null {
  const raw = value?.trim() ?? '';
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
  const reading = Number(raw.replaceAll(',', ''));
  return Number.isFinite(reading) && reading >= 0 && reading <= Number.MAX_SAFE_INTEGER ? reading : null;
}

export function motMileageLabel(test: MotTest): string {
  const reading = motMileageValue(test.mileage);
  if (reading === null) return 'Mileage not recorded';
  const value = reading.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return test.mileageUnit === 'MI' ? `${value} miles`
    : test.mileageUnit === 'KM' ? `${value} km` : `${value} (unit not recorded)`;
}

export function newestMotTests(tests: MotTest[]): MotTest[] {
  return [...tests].sort((a, b) => (motTestTime(b.completedDate) ?? -Infinity) - (motTestTime(a.completedDate) ?? -Infinity));
}

export interface MotMileagePoint {
  key: string;
  timestamp: number;
  miles: number;
  test: MotTest;
  decreased: boolean;
}

/** Every point is a real reading. Missing readings break the line, never become zero. */
export function buildMotMileageHistory(tests: MotTest[]) {
  const chronological = [...tests].sort((a, b) => (motTestTime(a.completedDate) ?? Infinity) - (motTestTime(b.completedDate) ?? Infinity));
  const points: MotMileagePoint[] = [];
  const segments: MotMileagePoint[][] = [];
  let segment: MotMileagePoint[] = [];
  let previous: MotMileagePoint | undefined;
  let excludedCount = 0;
  for (const [index, test] of chronological.entries()) {
    const timestamp = motTestTime(test.completedDate);
    const reading = motMileageValue(test.mileage);
    if (timestamp === null || reading === null || !['MI', 'KM'].includes(test.mileageUnit ?? '')) {
      excludedCount++;
      if (segment.length) segments.push(segment);
      segment = [];
      continue;
    }
    const miles = test.mileageUnit === 'KM' ? reading / 1.609344 : reading;
    // A change of units can introduce less than a mile of rounding. Compare the
    // same rounded miles used on the chart, rather than reporting that as a drop.
    const decreased = Boolean(previous && timestamp > previous.timestamp && Math.round(miles) < Math.round(previous.miles));
    // Equal timestamps do not establish which test happened first.
    if (previous?.timestamp === timestamp && segment.length) {
      segments.push(segment);
      segment = [];
    }
    const point = { key: `${test.completedDate}-${index}`, timestamp, miles, test, decreased };
    points.push(point);
    segment.push(point);
    previous = point;
  }
  if (segment.length) segments.push(segment);
  return {
    points, segments, excludedCount,
    hasDecrease: points.some(point => point.decreased),
    convertedKm: points.some(point => point.test.mileageUnit === 'KM'),
  };
}
