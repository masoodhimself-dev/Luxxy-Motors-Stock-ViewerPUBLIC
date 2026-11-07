import type { Car } from './stock-context';
import { vehicleInsuranceDisclosure } from './vehicle-history';

export type SourceCheckStatus = 'passed' | 'advisory' | 'failed' | 'unknown';
import { ulezReport, validatedCazooSourceReport, type SourceUlezStatus } from '@workspace/vehicle-meta/stock-source-ulez';
export type { SourceUlezStatus } from '@workspace/vehicle-meta/stock-source-ulez';
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
  const source = validatedCazooSourceReport(car, now);
  if (!source) return null;
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
