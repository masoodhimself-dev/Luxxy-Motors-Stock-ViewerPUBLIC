import { createHash } from 'node:crypto';
import { brochurePhotos, type BrochurePhoto, type BrochureVehicle, type LoadedPhoto } from './vehicle-brochure';
import { imageDimensions, loadBrochurePhotos, permittedBrochureImage } from './vehicle-brochure-images';

const MAX_IMAGE_BYTES = 2_000_000;
const MAX_CACHE_BYTES = 12_000_000;
const OFFICIAL_IMAGE_HOSTS = new Set(['m.atcdn.co.uk', 'cdn.images.autoexposure.co.uk']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ImageResult = { status: number; headers: Record<string, string>; body: Buffer | string };

/** An image already published on this dealership's current vehicle, never an arbitrary proxy. */
export function permittedVehicleSheetImage(source: unknown): source is string {
  if (typeof source !== 'string' || !source || source.length > 2048 || source !== source.trim() || /[\u0000-\u0020\u007f]/.test(source)) return false;
  const url = permittedBrochureImage(source);
  return !!url && !new URL(source).hash && OFFICIAL_IMAGE_HOSTS.has(url.hostname);
}

export function createVehicleSheetImageHandler(dependencies: {
  /** Production supplies findPublicVehicle, which is scoped to the resolved tenant. */
  findVehicle: (id: string) => Promise<BrochureVehicle | null>;
  loadPhotos?: (photos: BrochurePhoto[]) => Promise<LoadedPhoto[]>;
  now?: () => number;
}) {
  const cache = new Map<string, { bytes: Buffer; type: string; until: number }>();
  const now = dependencies.now ?? Date.now;
  let active = 0;
  const error = (status: number, body: string): ImageResult => ({ status, body, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  return async (dealerId: string, id: string, source: unknown): Promise<ImageResult> => {
    if (!UUID.test(id) || !permittedVehicleSheetImage(source)) return error(400, 'Invalid vehicle photograph.');
    if (active >= 3) return { ...error(503, 'Vehicle photographs are busy. Please try again shortly.'), headers: { ...error(503, '').headers, 'Retry-After': '10' } };
    active++;
    try {
      // Recheck visibility and exact membership even on a cache hit. This also
      // prevents another dealership or a removed image reusing cached bytes.
      const vehicle = await dependencies.findVehicle(id);
      if (!vehicle) return error(404, 'Vehicle not found.');
      const photo = brochurePhotos(vehicle).find(item => item.url === source);
      if (!photo) return error(404, 'Vehicle photograph not found.');
      const key = createHash('sha256').update(JSON.stringify([dealerId, id, source])).digest('hex');
      let entry = cache.get(key);
      if (!entry || entry.until <= now()) {
        // The existing loader pins public DNS, verifies TLS, refuses redirects,
        // bounds streamed bytes and validates JPEG/PNG pixel dimensions.
        const [loaded] = await (dependencies.loadPhotos ?? (photos => loadBrochurePhotos(photos, '', 10_000)))([photo]);
        if (!loaded?.bytes || loaded.url !== source || loaded.bytes.length > MAX_IMAGE_BYTES) return error(503, 'Vehicle photograph is temporarily unavailable.');
        const bytes = Buffer.from(loaded.bytes);
        const dimensions = imageDimensions(bytes);
        if (!dimensions) return error(503, 'Vehicle photograph is temporarily unavailable.');
        entry = { bytes, type: dimensions.format === 'PNG' ? 'image/png' : 'image/jpeg', until: now() + 5 * 60_000 };
        for (const [oldKey, oldEntry] of cache) if (oldEntry.until <= now()) cache.delete(oldKey);
        let size = [...cache.values()].reduce((sum, value) => sum + value.bytes.length, 0);
        while (cache.size && (cache.size >= 12 || size + entry.bytes.length > MAX_CACHE_BYTES)) {
          const oldest = cache.keys().next().value!;
          size -= cache.get(oldest)!.bytes.length; cache.delete(oldest);
        }
        cache.set(key, entry);
      }
      return { status: 200, body: entry.bytes, headers: {
        'Content-Type': entry.type, 'Content-Length': String(entry.bytes.length),
        'Cache-Control': 'private, max-age=30', 'Vary': 'Host',
        'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
      } };
    } catch { return error(503, 'Vehicle photograph is temporarily unavailable.'); }
    finally { active--; }
  };
}
