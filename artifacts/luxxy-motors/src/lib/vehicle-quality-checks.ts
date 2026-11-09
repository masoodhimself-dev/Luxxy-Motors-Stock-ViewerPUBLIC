import type { MotHistory } from '@workspace/vehicle-meta';
import type { Car } from './stock-context';
import { vehicleEnquiryMot } from './vehicle-enquiry-information';
import { readVehicleSourceReport, type VehicleSourceCheck } from './vehicle-source-report';
import { vehicleInsuranceDisclosure } from './vehicle-history';

export type VehicleQualityStatus = 'passed' | 'unknown' | 'attention' | 'not_due';
export type VehicleQualityCheck = { id: string; label: string; status: VehicleQualityStatus; detail?: string };

const definitions = [
  { id: 'hpi', label: 'HPI Check', names: ['hpi check', 'hpi', 'hpi overall check', 'overall hpi check'] },
  { id: 'road-test', label: 'Road test', names: ['road test', 'road-test'] },
  { id: 'bonnet', label: 'Under the bonnet', names: ['under the bonnet'] },
  { id: 'wheels-brakes', label: 'Wheels & brakes', names: ['wheels & brakes', 'wheels and brakes'] },
  { id: 'mot', label: 'MOT', names: [] },
  { id: 'interior', label: 'Interior', names: ['interior'] },
  { id: 'suspension', label: 'Suspension', names: ['suspension'] },
  { id: 'oil', label: 'Oil', names: ['oil'] },
  { id: 'bodywork', label: 'Bodywork', names: ['bodywork', 'body work'] },
  { id: 'multipoint', label: 'Multipoint inspection', names: ['multipoint inspection', 'multi-point inspection', 'multi point inspection'] },
] as const;

const normaliseName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

function namedResult(checks: VehicleSourceCheck[]): Pick<VehicleQualityCheck, 'status' | 'detail'> {
  if (checks.some(check => check.status === 'failed' || check.status === 'advisory'))
    return { status: 'attention', detail: 'The source report records an issue to check with us.' };
  if (!checks.length || checks.some(check => check.status !== 'passed')) return { status: 'unknown' };
  return { status: 'passed' };
}

/** Read recorded categories, including older A/B/C/D codes, without interpreting advert prose. */
function recordedCategories(car: Car) {
  const categories = new Set<string>();
  for (const value of [car.writeOffCategory, car.specifications?.writeOffCategory, car.sourceExtras?.writeOffCategory]) {
    if (typeof value !== 'string') continue;
    const category = value.trim().match(/^(?:cat(?:egory)?\s*[-:]?\s*)?([ABCDNS])(?:\s+recorded)?$/i)?.[1];
    if (category) categories.add(category.toUpperCase());
  }
  return [...categories];
}

/** A disclosed advert category is a reason to read the history, not proof of an independently verified category. */
function advertisedCategories(car: Car) {
  const descriptions = [car.description, car.sourceExtras?.description, car.sourceExtras?.advertDescription, car.specifications?.description]
    .filter((value): value is string => typeof value === 'string');
  const categories = new Set<string>();
  for (const description of descriptions) {
    // Check direct statements with the established disclosure rules. A separate
    // clear-history sentence must not hide an explicit negative disclosure.
    for (const clause of description.split(/[.!;\n\r|]+/)) {
      const disclosed = vehicleInsuranceDisclosure(car, clause);
      if (disclosed) categories.add(disclosed.category);
      // Exact standalone clauses only. Negation, questions, examples and
      // possible categories never match this bare advertised-category form.
      const bare = clause.trim().match(/^cat(?:egory)?\s*[-:]?\s*([NS])$/i)?.[1];
      if (bare) categories.add(bare.toUpperCase());
    }
  }
  return [...categories];
}

/** Recorded per-car results, or an explicitly confirmed dealership policy. Never infer completion from missing records. */
export function vehicleQualityChecks(car: Car, history?: MotHistory | null, now = new Date(), dealerConfirmed = false): VehicleQualityCheck[] {
  const checks = readVehicleSourceReport(car, now.getTime())?.history?.checks ?? [];
  const categories = recordedCategories(car);
  const advertised = categories.length ? [] : advertisedCategories(car);
  let mot: ReturnType<typeof vehicleEnquiryMot> = null;
  try { mot = vehicleEnquiryMot(car, history, now); }
  catch { /* Malformed optional provider data must not become a pass or break the vehicle page. */ }

  return definitions.map<VehicleQualityCheck>(definition => {
    if (definition.id === 'mot') return {
      id: definition.id, label: definition.label,
      status: mot?.label === 'MOT expires' ? 'passed' : mot?.label === 'First MOT due' ? 'not_due' : dealerConfirmed && history == null ? 'passed' : 'unknown',
      ...(mot ? { detail: `${mot.label}: ${mot.value}` } : {}),
    };
    if (definition.id === 'hpi' && categories.length) return {
      id: definition.id, label: definition.label, status: 'attention',
      detail: categories.length === 1 ? `Category ${categories[0]} recorded. Please read the insurance history.`
        : `Recorded categories ${categories.join(' / ')}. Ask us to confirm the insurance history.`,
    };
    if (definition.id === 'hpi' && advertised.length) return {
      id: definition.id, label: definition.label, status: 'attention',
      detail: `Advert states Category ${advertised.join(' / ')}`,
    };
    if (definition.id === 'hpi' && checks.some(check => check.status === 'failed' || check.status === 'advisory'))
      return { id: definition.id, label: definition.label, status: 'attention', detail: 'The source report records an issue to check with us.' };
    const names: readonly string[] = definition.names;
    const matching = checks.filter(check => names.includes(normaliseName(check.name)));
    const result = namedResult(matching);
    return { id: definition.id, label: definition.label, ...result, status: result.status === 'unknown' && dealerConfirmed ? 'passed' : result.status };
  });
}
