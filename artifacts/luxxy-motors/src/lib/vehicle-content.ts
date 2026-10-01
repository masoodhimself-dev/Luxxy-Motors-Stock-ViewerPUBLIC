import type { Car } from './stock-context';
const headings = new Set(['please note', 'audio and communications', 'drivers assistance', 'driver assistance', 'exterior', 'illumination', 'interior', 'performance', 'safety and security', 'valuable features', 'rare features', 'added extras']);
const clean = (value: string) => value.replace(/\u0092/g, '’').trim();
export function vehicleContent(car: Car) {
  const description = [car.description, car.specifications?.description, car.sourceExtras?.description, car.sourceExtras?.advertDescription]
    .find((value): value is string => typeof value === 'string' && !!value.trim());
  const sources = [car.features, car.specifications?.features, car.sourceExtras?.features, car.sourceExtras?.featureList];
  let features: string[] = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    const seen = new Set<string>();
    features = source.filter((value): value is string => typeof value === 'string').map(clean).filter(value => {
      const key = value.toLowerCase().replace(/:$/, '').trim();
      if (!key || headings.has(key) || seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (features.length) break;
  }
  return {description: description ? clean(description) : undefined, features};
}
