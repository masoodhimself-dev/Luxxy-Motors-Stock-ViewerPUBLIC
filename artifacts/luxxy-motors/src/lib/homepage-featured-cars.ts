import type { Car } from './stock-context';
import { getThumbnailUrl } from './utils';

const status = (value: unknown) => String(value ?? '').trim().toLowerCase();
const unavailable = new Set(['sold', 'hidden', 'archived', 'withdrawn']);

/** Check the supplied thumbnail only; never fetch images or infer photographic quality. */
function hasVehiclePhoto(car: Car): boolean {
  const thumbnail = getThumbnailUrl(car)?.trim();
  if (!thumbnail || /[\u0000-\u001f\\]/.test(thumbnail) ||
    !/^(https?:\/\/|\/(?!\/)|\.\.?\/)/i.test(thumbnail)) return false;
  try {
    const url = new URL(thumbnail, 'https://local-image.invalid');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    if (/(^|\.)(placeholder\.com|placehold\.(co|it)|dummyimage\.com)$/i.test(url.hostname)) return false;
    const path = decodeURIComponent(url.pathname);
    return !/(^|[\/_.-])(placeholder|no[ _-]?(?:image|photo)s?|(?:image|photo)[ _-]not[ _-]available|(?:photo[ _-])?coming[ _-]soon)(?=[\/_.-]|$)/i.test(path);
  } catch {
    return false;
  }
}

/** Homepage only: staff picks lead, then available photographed stock spans the price range. */
export function homepageFeaturedCars(cars: readonly Car[], manualIds: readonly string[] = []): Car[] {
  const publicCars = cars.filter(car => !unavailable.has(status(car.inventoryStatus)));
  const byId = new Map(publicCars.map(car => [car.id, car]));
  const manual = [...new Set(manualIds)].flatMap(id => {
    const car = byId.get(id);
    return car ? [car] : [];
  });
  const selected = new Set(manual.map(car => car.id));
  const automatic = publicCars.filter(car => {
    const availability = status(car.inventoryStatus);
    const sourceStatus = status(car.sourceStatus);
    const websiteStatus = status(car.sourceExtras?.websiteSourceStatus);
    return !selected.has(car.id) && (!availability || availability === 'available') &&
      !['missing', 'withdrawn'].includes(sourceStatus) &&
      !['missing', 'withdrawn'].includes(websiteStatus) && hasVehiclePhoto(car);
  });
  const buckets = new Map<number, Car[]>();
  const unpriced: Car[] = [];
  for (const car of automatic) {
    if (car.price === null || !Number.isFinite(car.price) || car.price <= 0) {
      unpriced.push(car);
      continue;
    }
    const bucket = buckets.get(car.price) ?? [];
    bucket.push(car);
    buckets.set(car.price, bucket);
  }
  const prices = [...buckets.keys()].sort((a, b) => b - a);
  const mixed: Car[] = [];
  for (let turn = 0; prices.length; turn++) {
    // Highest first, then affordable, then middle; repeat without shuffling equal prices.
    const index = turn % 3 === 0 ? 0 : turn % 3 === 1 ? prices.length - 1 : Math.floor((prices.length - 1) / 2);
    const bucket = buckets.get(prices[index])!;
    mixed.push(bucket.shift()!);
    if (!bucket.length) prices.splice(index, 1);
  }
  return [
    ...manual.filter(car => status(car.inventoryStatus) !== 'reserved'),
    ...mixed,
    ...unpriced,
    // Preserve the existing reserved-last rule, including staff-selected cars.
    ...manual.filter(car => status(car.inventoryStatus) === 'reserved'),
  ];
}
