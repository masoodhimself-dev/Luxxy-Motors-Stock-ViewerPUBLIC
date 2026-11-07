import type { Car } from './stock-context';
import { stockVehicleUlezEvidence } from '@workspace/vehicle-meta/stock-filters';

export const ULEZ_CHECK_URL = 'https://tfl.gov.uk/modes/driving/ultra-low-emission-zone/ulez-vrm-checker';
export type VehicleBenefit = { id: 'ulez'; label: string; text: string; note: string; href: string };

/** One supplied-data decision for vehicle information and stock filtering. */
export function vehicleBenefits(car: Car): { ulez: VehicleBenefit | null } {
  const evidence = stockVehicleUlezEvidence(car);
  return { ulez: evidence ? {
    id: 'ulez',
    label: 'ULEZ',
    text: evidence === 'advert' ? 'Listed as ULEZ compliant' : 'ULEZ compliant',
    note: evidence === 'advert'
      ? 'This status comes from the dealer’s advert. Check it with TfL before travelling in the zone.'
      : 'Check the vehicle’s ULEZ status before travelling in the zone.',
    href: ULEZ_CHECK_URL,
  } : null };
}
