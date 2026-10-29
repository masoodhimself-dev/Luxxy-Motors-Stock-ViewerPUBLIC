import { useState } from 'react';
import {
  Armchair, Camera, CarFront, ChevronDown, CircleGauge, MapPin, Phone,
  Radio, SlidersHorizontal, Smartphone, type DealerIcon,
} from '@/components/icons';
import { vehicleFeatureDetails, type VehicleFeatureIconKey } from '@/lib/vehicle-help';
import { VehicleFeature } from './customer-help';
import './vehicle-equipment-list.css';
import { prominentVehicleFeatures, groupVehicleEquipment } from '@/lib/vehicle-content';

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
  const [expanded, setExpanded] = useState(false);
  const unique = [...new Set(features)];
  const highlights = prominentVehicleFeatures(unique, 6);
  const more = unique.filter(feature => !highlights.includes(feature));
  const groups = groupVehicleEquipment(unique);
  return <div className="vehicle-equipment-groups">
    {!expanded && highlights.length > 0 && <ul className="vehicle-equipment-list vehicle-equipment-highlights" aria-label="Feature highlights">
      {highlights.map(feature => {
        const Icon = compactIconForFeature(feature);
        return <li key={feature}><VehicleFeature feature={feature} icon={Icon ? <Icon size={24} className="vehicle-equipment-icon" aria-hidden="true" /> : undefined} /></li>;
      })}
    </ul>}
    {more.length > 0 && <details open={expanded} className="vehicle-equipment-more vehicle-equipment-text-group">
      <summary onClick={event => { event.preventDefault(); setExpanded(value => !value); }}><span>{expanded ? "Show less equipment" : "View all equipment"}</span><span className="vehicle-equipment-count">{unique.length} {unique.length === 1 ? 'feature' : 'features'}</span><ChevronDown size={16} aria-hidden="true" /></summary>
      {groups.map(group => <section key={group.label} className="vehicle-equipment-category" aria-label={group.label}>
        <h3 className="text-sm font-semibold">{group.label}</h3>
        <ul className="vehicle-equipment-list vehicle-equipment-text-list" aria-label={group.label}>
          {group.features.map(feature => <li key={feature}><VehicleFeature feature={feature} /></li>)}
        </ul>
      </section>)}
    </details>}
  </div>;
}
