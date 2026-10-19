import {
  Armchair, Camera, CarFront, ChevronDown, CircleGauge, MapPin, Phone,
  Radio, SlidersHorizontal, Smartphone, type DealerIcon,
} from '@/components/icons';
import { vehicleFeatureDetails, type VehicleFeatureIconKey } from '@/lib/vehicle-help';
import { VehicleFeature } from './customer-help';
import './vehicle-equipment-list.css';

// Compact interface glyphs remain readable at 24px. Equipment illustrations
// belong in the explanation panel, rather than being shrunk into this list.
const compactFeatureIcons: Partial<Record<VehicleFeatureIconKey, DealerIcon>> = {
  'parking-front': CarFront,
  'parking-rear': CarFront,
  parking: CarFront,
  'parking-assist': CarFront,
  'cruise-control': CircleGauge,
  'adaptive-cruise-control': CircleGauge,
  'speed-limiter': CircleGauge,
  climate: SlidersHorizontal,
  'air-conditioning': SlidersHorizontal,
  'heated-seats': Armchair,
  'bluetooth-calls': Phone,
  'bluetooth-audio': Radio,
  'phone-integration': Smartphone,
  navigation: MapPin,
  isofix: Armchair,
  camera: Camera,
};

function compactIconForFeature(feature: string) {
  const details = vehicleFeatureDetails(feature);
  if (!details) return undefined;
  // A telephone keypad has a useful explanation, but is a minor equipment
  // detail rather than a Bluetooth calling highlight.
  if (details.icon === 'bluetooth-calls' && !/bluetooth/i.test(feature)) return undefined;
  return compactFeatureIcons[details.icon];
}

export function VehicleEquipmentList({ features }: { features: string[] }) {
  const highlights: { feature: string; Icon: DealerIcon }[] = [];
  const more: string[] = [];
  for (const feature of features) {
    const Icon = compactIconForFeature(feature);
    if (Icon) highlights.push({ feature, Icon });
    else more.push(feature);
  }

  return <div className="vehicle-equipment-groups">
    {highlights.length > 0 && <ul className="vehicle-equipment-list vehicle-equipment-highlights" aria-label="Feature highlights">
      {highlights.map(({ feature, Icon }) => <li key={feature}>
        <VehicleFeature feature={feature} icon={<Icon size={24} className="vehicle-equipment-icon" aria-hidden="true" />} />
      </li>)}
    </ul>}
    {more.length > 0 && <details className="vehicle-equipment-more vehicle-equipment-text-group" open={highlights.length === 0 ? true : undefined}>
      <summary>
        <span>More equipment</span>{' '}
        <span className="vehicle-equipment-count">{more.length} {more.length === 1 ? 'feature' : 'features'}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <ul className="vehicle-equipment-list vehicle-equipment-text-list" aria-label="More equipment">
        {more.map(feature => <li key={feature}><VehicleFeature feature={feature} /></li>)}
      </ul>
    </details>}
  </div>;
}
