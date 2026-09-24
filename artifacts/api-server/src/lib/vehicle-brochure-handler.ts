import { createHash } from 'node:crypto';
import { selectBrochurePhotos, brochureOptions, brochureFilename, brochurePhotos, renderVehicleBrochure, type BrochureDealer, type BrochureVehicle, type LoadedPhoto, type BrochurePhoto } from './vehicle-brochure';
import { loadBrochurePhotos } from './vehicle-brochure-images';

export type BrochureResult = { status: number; headers: Record<string, string>; body: Buffer | string };
export function createBrochureHandler(dependencies: {
  findVehicle: (id: string) => Promise<BrochureVehicle | null>;
  readDealer: () => Promise<BrochureDealer>;
  loadPhotos?: (photos: BrochurePhoto[]) => Promise<LoadedPhoto[]>;
  preview?: boolean;
}) {
  const cache = new Map<string, { expires: number; bytes: Buffer }>();
  let active = 0;
  const error = (status: number, body: string): BrochureResult => ({ status, body, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  return async (id: string, origin: string): Promise<BrochureResult> => {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) return error(400, 'Invalid vehicle link. Return to the showroom and choose a car.');
    if (active >= 2) return { ...error(503, 'The vehicle PDF service is busy. Please try again shortly.'), headers: { ...error(503, '').headers, 'Retry-After': '10' } };
    active++;
    try {
      // Always check current visibility before using the cache: sold/hidden stock must not leak.
      const vehicle = await dependencies.findVehicle(id);
      if (!vehicle) return error(404, 'This vehicle is no longer available. Return to the showroom for current stock.');
      const dealer = await dependencies.readDealer();
      const vehicleUrl = origin ? `${origin}/vehicle/${encodeURIComponent(id)}` : '';
      const key = createHash('sha256').update(JSON.stringify({ vehicle, dealer, vehicleUrl, preview: dependencies.preview })).digest('hex');
      const cached = cache.get(key);
      let bytes = cached && cached.expires > Date.now() ? cached.bytes : undefined;
      if (!bytes) {
        const photos = brochurePhotos(vehicle);
        const options = brochureOptions(dealer.brochure);
        const loaded = await (dependencies.loadPhotos ?? ((items) => loadBrochurePhotos(items, process.env.VEHICLE_PDF_IMAGE_HOSTS)))(selectBrochurePhotos(photos, options.includeGallery ? options.photoLimit : 1));
        bytes = renderVehicleBrochure({ vehicle, dealer, vehicleUrl, photos: loaded, totalPhotos: photos.length, preview: dependencies.preview });
        for (const [oldKey, value] of cache) if (value.expires <= Date.now()) cache.delete(oldKey);
        let size = [...cache.values()].reduce((sum, entry) => sum + entry.bytes.length, 0);
        while (cache.size && (size + bytes.length > 32_000_000 || cache.size >= 4)) {
          const oldest = cache.keys().next().value!;
          size -= cache.get(oldest)!.bytes.length; cache.delete(oldest);
        }
        if (bytes.length <= 32_000_000) cache.set(key, { bytes, expires: Date.now() + 5 * 60_000 });
      }
      return {
        status: 200, body: bytes,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${brochureFilename(vehicle)}"`,
          'Content-Length': String(bytes.length),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      };
    } catch { return error(503, 'We could not prepare this vehicle PDF. Please try again, or contact the showroom.'); }
    finally { active--; }
  };
}

/** Only the URL origin goes into the PDF link; credentials and paths are never accepted. */
export function brochureOrigin(host: string | undefined, forwardedProto?: string): string {
  if (!host || !/^(?:[a-zA-Z0-9.-]+|\[::1\])(?::\d{1,5})?$/.test(host)) return '';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const protocol = local && forwardedProto !== 'https' ? 'http' : 'https';
  try { return new URL(`${protocol}://${host}`).origin; } catch { return ''; }
}
