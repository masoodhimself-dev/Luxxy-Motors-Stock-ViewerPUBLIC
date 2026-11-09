import { customFetch } from '@workspace/api-client-react';
import type { Car } from './stock-context';
import type { DealerConfig } from '@/config/dealer';
import { checkedVehicleSheetCar } from '@/components/vehicle-print';
import { formatPrice, formatMileage, vehicleDisplayTitle } from './utils';
import { sharePhotos, vehicleSharePriceNote } from './vehicle-share';

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function decode(blob: Blob, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const url = URL.createObjectURL(blob);
  try { const image = new Image(); image.src = url; await abortable(image.decode(), signal); return image; }
  finally { URL.revokeObjectURL(url); }
}
export type VehicleShareImageFormat = 'square' | 'portrait';
export const vehicleShareImageSize = (format: VehicleShareImageFormat) => format === 'portrait' ? { width: 1080, height: 1920 } : { width: 1200, height: 1200 };

/** Compose supplied photography and current facts locally. No image generation or AI call. */
export async function createVehicleShareImage(car: Car, photo: string, dealer: DealerConfig, url: string, signal: AbortSignal, format: VehicleShareImageFormat = 'square'): Promise<Blob> {
  let fresh: Car;
  try { fresh = checkedVehicleSheetCar(await customFetch<unknown>(`/api/vehicles/${encodeURIComponent(car.id)}`, { cache: 'no-store', signal }), car.id); }
  catch { throw new Error('We couldn’t check the current price and availability. Please try again.'); }
  if (!sharePhotos(fresh).includes(photo)) throw new Error('This photo has changed. Close Share and try again.');
  const endpoint = `/api/vehicles/${encodeURIComponent(car.id)}/sheet-image?source=${encodeURIComponent(photo)}`;
  const response = await fetch(endpoint, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('The photo could not be prepared. Try another photo.');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('The photo could not be prepared.');
  const image = await decode(blob, signal);
  const canvas = document.createElement('canvas');
  const dimensions = vehicleShareImageSize(format); canvas.width = dimensions.width; canvas.height = dimensions.height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image downloads are unavailable in this browser.');
  const portrait = format === 'portrait';
  ctx.scale(dimensions.width / 1200, dimensions.width / 1200);
  const height = dimensions.height * 1200 / dimensions.width;
  const photoHeight = portrait ? 1333 : 800;
  const offset = photoHeight - 800;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1200, height);
  // Contain the complete photo: no crop removes part of the advertised car.
  ctx.fillStyle = '#f2f3f3'; ctx.fillRect(0, 0, 1200, photoHeight);
  const ratio = Math.min(1200 / image.naturalWidth, photoHeight / image.naturalHeight);
  const width = image.naturalWidth * ratio, imageHeight = image.naturalHeight * ratio;
  ctx.drawImage(image, (1200 - width) / 2, (photoHeight - imageHeight) / 2, width, imageHeight);
  if (document.fonts) await abortable(document.fonts.ready, signal);
  const fitText = (text: string, x: number, y: number, width: number, size: number, weight = 600) => {
    do { ctx.font = `${weight} ${size--}px "Multi Montserrat", Montserrat, Arial, sans-serif`; } while (ctx.measureText(text).width > width && size > 19);
    ctx.fillText(text, x, y + offset, width);
  };
  ctx.fillStyle = '#202020'; fitText(vehicleDisplayTitle(fresh), 48, 875, 1104, 48, 700);
  ctx.fillStyle = '#606060'; fitText([fresh.year, fresh.mileage != null ? formatMileage(fresh.mileage) : null, fresh.transmission].filter(Boolean).join(' · '), 48, 924, 1104, 25, 400);
  ctx.fillStyle = '#202020'; fitText(fresh.price != null ? formatPrice(fresh.price, fresh.currency) : 'Price on application', 48, 996, 700, 52, 700);
  const priceNote = vehicleSharePriceNote(fresh);
  if (priceNote) { ctx.fillStyle = '#606060'; fitText(priceNote, 780, 996, 372, 25, 400); }
  ctx.strokeStyle = '#dedede'; ctx.beginPath(); ctx.moveTo(48, 1038 + offset); ctx.lineTo(1152, 1038 + offset); ctx.stroke();
  // Use only a same-origin supplied logo, with dealership name as the reliable fallback.
  let logoDrawn = false;
  if (dealer.identity.logoAsset) {
    try {
      const logoUrl = new URL(dealer.identity.logoAsset, location.origin);
      if (logoUrl.origin === location.origin) {
        const logoResponse = await fetch(logoUrl, { signal, credentials: 'same-origin' });
        if (logoResponse.ok) {
          const logo = await decode(await logoResponse.blob(), signal);
          const scale = Math.min(330 / logo.naturalWidth, 64 / logo.naturalHeight);
          if (logoUrl.searchParams.get('theme') === 'light') { ctx.fillStyle = '#202020'; ctx.fillRect(40, height - 138, logo.naturalWidth * scale + 16, logo.naturalHeight * scale + 16); }
          ctx.drawImage(logo, 48, height - 130, logo.naturalWidth * scale, logo.naturalHeight * scale); logoDrawn = true;
        }
      }
    } catch { /* The dealer's name remains visible if an optional logo cannot be used. */ }
  }
  if (!logoDrawn) { ctx.fillStyle = '#202020'; fitText(dealer.identity.name, 48, height - 90 - offset, 420, 28, 700); }
  ctx.fillStyle = '#606060'; fitText(url.replace(/^https?:\/\//, ''), 48, height - 30 - offset, 1104, 23, 400);
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  return await abortable(new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The image could not be saved.')), 'image/png')), signal);
}
