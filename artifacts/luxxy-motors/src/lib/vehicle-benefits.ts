import type { Car } from './stock-context';
import { readVehicleSourceReport } from './vehicle-source-report';

export const ULEZ_CHECK_URL = 'https://tfl.gov.uk/modes/driving/ultra-low-emission-zone/ulez-vrm-checker';
export type VehicleBenefit = { id: 'ulez'; label: string; text: string; note: string; href: string };

/** One supplied-data decision for vehicle information and stock filtering. */
export function vehicleBenefits(car: Car): { ulez: VehicleBenefit | null } {
  const report = readVehicleSourceReport(car)?.ulez;
  const emission = car.emissionClass?.trim().match(/^euro\s*([1-7])(?:\s*[a-e](?:-temp)?(?:-evap)?(?:\s+isc(?:-fcm)?)?)?$/i);
  const fuel = car.fuel?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  const petrol = /^(?:petrol|petrol (?:plug-in )?hybrid|petrol[\s/]electric|hybrid - petrol\/electric)$/.test(fuel);
  const diesel = /^(?:diesel|diesel (?:plug-in )?hybrid|diesel[\s/]electric|hybrid - diesel\/electric)$/.test(fuel);
  const meetsStandard = Boolean(emission && ((petrol && +emission[1] >= 4) || (diesel && +emission[1] >= 6)));
  // An explicit negative result takes priority over a generic emissions comparison.
  const compliant = report ? report.status === 'compliant' : meetsStandard;
  return { ulez: compliant ? {
    id: 'ulez', label: 'ULEZ', text: 'ULEZ compliant',
    note: 'Check the vehicle’s ULEZ status before travelling in the zone.', href: ULEZ_CHECK_URL,
  } : null };
}
