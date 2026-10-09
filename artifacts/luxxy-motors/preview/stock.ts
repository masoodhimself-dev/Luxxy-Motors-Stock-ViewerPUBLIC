import { stockDescriptionExtras } from "@workspace/vehicle-meta";
import { createHash } from 'node:crypto';
import type { StockData } from '../src/lib/stock-context';
import snapshot from './grok-stock-10045264.json';
import pendingMissing from './stock-history/missing-first-check.json';
const cars = [...snapshot.cars, ...pendingMissing];

// User-supplied Paramount snapshot for local review only. Never imported by the
// production entry point. Stable IDs keep reservations tied to the correct car.
export const previewStock = {
  schemaVersion: 1,
  dealerName: snapshot.dealerName,
  dealerLocation: snapshot.cars[0]?.dealerLocation ?? null,
  scrapedAt: snapshot.scrapedAt,
  count: cars.length,
  cars: cars.map(car => {
    const digest = createHash('sha256').update(`${snapshot.retailerId}:${car.advertId}`).digest('hex');
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const images = car.images.filter((image, index, all) => all.findIndex(other => other.url === image.url) === index);
    return { ...car, sourceExtras: stockDescriptionExtras(car), id, images, imageCount: images.length };
  }),
} as StockData;
