import type { Car } from './stock-context';
import { stockVehicleIsUlez } from '@workspace/vehicle-meta/stock-filters';

export const ULEZ_CHECK_URL = 'https://tfl.gov.uk/modes/driving/ultra-low-emission-zone/ulez-vrm-checker';
export type VehicleBenefit = { id: 'ulez'; label: string; text: string; note: string; href: string };

/** One supplied-data decision for vehicle information and stock filtering. */
export function vehicleBenefits(car: Car): { ulez: VehicleBenefit | null } {
  const compliant = stockVehicleIsUlez(car);
  return { ulez: compliant ? {
    id: 'ulez', label: 'ULEZ', text: 'ULEZ compliant',
    note: 'Check the vehicle’s ULEZ status before travelling in the zone.', href: ULEZ_CHECK_URL,
  } : null };
}
