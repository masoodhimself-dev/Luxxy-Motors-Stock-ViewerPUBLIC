import type { Car } from './stock-context';
import { vehicleInsuranceDisclosure } from './vehicle-history';

export type SourceCheckStatus = 'passed' | 'advisory' | 'failed' | 'unknown';
export type SourceUlezStatus = 'compliant' | 'not_compliant' | 'unknown';
export type VehicleSourceCheck = { name: string; status: SourceCheckStatus; sourceText: string };
export type VehicleSourceReport = {
  version: 1;
  platform: 'cazoo';
  sourceUrl: string;
  capturedAt: string;
  ulez: { status: SourceUlezStatus; sourceText: string } | null;
  history: { caveat: string; checks: VehicleSourceCheck[] } | null;
  recordedDisclosure: ReturnType<typeof vehicleInsuranceDisclosure>;
};
export type VehicleSourceReportCar = Pick<Car, 'advertId' | 'sourceExtras'> &
  Partial<Pick<Car, 'advertUrl' | 'writeOffCategory' | 'specifications'>> & { description?: unknown };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function suppliedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

/** Source links are evidence for this advert only, never arbitrary external URLs. */
function cazooAdvertId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['cazoo.co.uk', 'www.cazoo.co.uk'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash) return null;
    return url.pathname.match(/^\/cars-for-sale\/(\d+)\/?$/)?.[1] ?? null;
  } catch { return null; }
}

function captureTime(value: unknown, now: number): value is string {
  if (typeof value !== 'string') return false;
  // Require an explicit timezone. Round-trip the date separately because Date.parse
  // normalises invalid dates such as 30 February rather than rejecting them.
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, zone] = parts;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day) ||
    Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4)) > 59 || (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Number.isFinite(now) && timestamp <= now + 5 * 60_000;
}

function ulezReport(value: unknown): VehicleSourceReport['ulez'] {
  const source = record(value);
  if (!source || !suppliedText(source.sourceText, 250)) return null;
  const text = source.sourceText.trim().replace(/\s+/g, ' ').toLowerCase();
  const expected: Record<SourceUlezStatus, RegExp> = {
    compliant: /^(?:yes|compliant|ulez compliant)$/,
    not_compliant: /^(?:no|not compliant|non[ -]compliant|ulez (?:not compliant|non[ -]compliant)|not ulez compliant)$/,
    unknown: /^(?:unknown|not (?:available|provided|recorded|confirmed)|unconfirmed)$/,
  };
  if (!(typeof source.status === 'string' && Object.hasOwn(expected, source.status)) ||
    !expected[source.status as SourceUlezStatus].test(text)) return null;
  return { status: source.status as SourceUlezStatus, sourceText: source.sourceText };
}

function historyReport(value: unknown): VehicleSourceReport['history'] {
  const source = record(value);
  if (!source || !suppliedText(source.caveat, 5_000) || !Array.isArray(source.checks) || !source.checks.length || source.checks.length > 40) return null;
  const checks: VehicleSourceCheck[] = [];
  for (const value of source.checks) {
    const check = record(value);
    if (!check || !suppliedText(check.name, 250) || !suppliedText(check.sourceText, 1_000) ||
      !['passed', 'advisory', 'failed', 'unknown'].includes(String(check.status))) return null;
    const status = check.status as SourceCheckStatus;
    const wording = check.sourceText.trim().replace(/\s+/g, ' ').toLowerCase();
    const knownWording: Record<Exclude<SourceCheckStatus, 'unknown'>, RegExp> = {
      passed: /^(?:all passed|passed|pass)$/,
      advisory: /^(?:advisory|advisories|advisory found|advisories found|check (?:the )?readings|requires? (?:review|attention)|review required)$/,
      failed: /^(?:failed|fail|not passed|check failed|issues? found|issues? reported)$/,
    };
    // An adapter's optimistic status must never upgrade ambiguous or conflicting
    // source wording. Retain the original result so staff/customers can read it.
    const conservativeStatus = status === 'unknown' || !knownWording[status].test(wording) ? 'unknown' : status;
    checks.push({ name: check.name, status: conservativeStatus, sourceText: check.sourceText });
  }
  return { caveat: source.caveat, checks };
}

/** Read explicitly attributed source claims without inferring independent checks. */
export function readVehicleSourceReport(car: VehicleSourceReportCar, now = Date.now()): VehicleSourceReport | null {
  const extras = record(car.sourceExtras);
  const source = record(extras?.sourceReport);
  if (extras?.sourcePlatform !== 'cazoo' || !source || source.version !== 1 || source.platform !== 'cazoo' ||
    typeof car.advertId !== 'string' || !/^\d+$/.test(car.advertId) ||
    cazooAdvertId(source.sourceUrl) !== car.advertId ||
    (car.advertUrl != null && cazooAdvertId(car.advertUrl) !== car.advertId) ||
    !captureTime(source.capturedAt, now)) return null;
  const ulez = ulezReport(source.ulez);
  const history = historyReport(source.history);
  if (!ulez && !history) return null;
  const descriptions = [car.description, extras?.description, extras?.advertDescription, car.specifications?.description];
  const description = descriptions.filter((value): value is string => typeof value === 'string').join('\n');
  return {
    version: 1, platform: 'cazoo', sourceUrl: source.sourceUrl as string,
    capturedAt: source.capturedAt, ulez, history,
    recordedDisclosure: vehicleInsuranceDisclosure(car, description),
  };
}
