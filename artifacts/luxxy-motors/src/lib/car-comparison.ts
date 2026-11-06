import type { MotHistory } from '@workspace/vehicle-meta';
import type { Car } from './stock-context';
import { formatPrice } from './utils';
import { vehicleEnquiryFacts, vehicleEnquiryMot } from './vehicle-enquiry-information';
import { prioritiseVehicleFeatures, vehicleContent } from './vehicle-content';
import { vehicleAvailability } from './customer-convenience';

export const MAX_COMPARISON_CARS = 3;
export type ComparisonRow = { key: string; label: string; values: Array<string | null>; feature?: boolean };
const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

/** Missing equipment is unknown, never a claim that the car does not have it. */
export function comparisonRows(cars: Car[], histories: Record<string, MotHistory | null> = {}, now = new Date()): ComparisonRow[] {
  const facts = cars.map(car => new Map(vehicleEnquiryFacts(car).map(fact => [fact.label, fact.value])));
  const rows: ComparisonRow[] = [
    { key: 'price', label: 'Price', values: cars.map(car => {
      if (typeof car.price !== 'number' || !Number.isFinite(car.price) || car.price <= 0) return null;
      const price = formatPrice(car.price, /^[A-Za-z]{3}$/.test(car.currency ?? '') ? car.currency : 'GBP');
      return car.priceType?.trim() ? `${price} (${car.priceType.trim()})` : price;
    }) },
    ...['Year', 'Mileage', 'Transmission', 'Fuel', 'Engine', 'Body type', 'Seats', 'Doors', 'Colour'].map(label => ({
      key: normalise(label), label: label === 'Transmission' ? 'Gearbox' : label,
      values: facts.map(carFacts => carFacts.get(label) ?? null),
    })),
    { key: 'mot', label: 'MOT expiry', values: cars.map(car => {
      const mot = vehicleEnquiryMot(car, histories[car.id], now);
      return mot ? `${mot.label === 'First MOT due' ? 'First due ' : ''}${mot.value}` : null;
    }) },
    { key: 'availability', label: 'Availability', values: cars.map(car => vehicleAvailability(car.inventoryStatus)) },
  ];
  const features = cars.map(car => vehicleContent(car).features);
  const labels = new Map<string, string>();
  for (const feature of prioritiseVehicleFeatures(features.flat())) {
    const key = normalise(feature);
    if (!labels.has(key)) labels.set(key, feature);
  }
  const featureSets = features.map(list => new Set(list.map(normalise)));
  for (const [key, label] of labels) rows.push({
    key: `feature:${key}`, label, feature: true,
    values: featureSets.map(features => features.has(key) ? 'Listed' : null),
  });
  return rows;
}

export function comparisonRowDiffers(row: ComparisonRow): boolean {
  return new Set(row.values.map(value => value === null ? null : normalise(value))).size > 1;
}

/** Drop unavailable cars and duplicates before applying the visible three-car limit. */
export function currentComparisonIds(ids: string[], cars: Car[]): string[] {
  const available = new Set(cars.map(car => car.id));
  return [...new Set(ids)].filter(id => available.has(id)).slice(0, MAX_COMPARISON_CARS);
}
