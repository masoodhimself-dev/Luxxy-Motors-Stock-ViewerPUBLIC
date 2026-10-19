import { DealerSvgIcon, type iconNames } from '@/components/icons';
import type { VehicleFeatureIconKey } from '@/lib/vehicle-help';

// This is the only artwork mapping the forthcoming equipment SVGs need to
// replace. The panel does not assume a viewBox, so 48-unit artwork can be used.
const currentArtwork: Partial<Record<VehicleFeatureIconKey, typeof iconNames[number]>> = {
  'parking-front': 'car',
  'parking-rear': 'car',
  parking: 'car',
  'parking-assist': 'car',
  'cruise-control': 'mileage',
  'adaptive-cruise-control': 'mileage',
  'speed-limiter': 'mileage',
  climate: 'settings',
  'air-conditioning': 'settings',
  'heated-seats': 'seats',
  'bluetooth-calls': 'phone',
  'phone-integration': 'phone',
  navigation: 'location',
  isofix: 'seats',
  camera: 'camera',
  'power-socket': 'integration',
  display: 'dashboard',
  connectivity: 'integration',
  'trip-computer': 'fuel',
  service: 'vehicle-preparation',
  exterior: 'car',
  windows: 'doors',
  security: 'security-lock',
  'spare-wheel': 'vehicle-preparation',
  'head-restraint': 'seats',
  'seat-adjustment': 'seats',
  'child-seat-sensor': 'seats',
  'warning-triangle': 'warning',
};

export function VehicleFeatureArtwork({ kind }: { kind: VehicleFeatureIconKey }) {
  return <div className="vehicle-feature-artwork" data-feature-icon={kind} aria-hidden="true">
    <DealerSvgIcon name={currentArtwork[kind] ?? 'information'} size={96} />
  </div>;
}
