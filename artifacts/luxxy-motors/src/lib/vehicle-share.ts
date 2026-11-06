import { vehiclePrintData } from './vehicle-print-data';
import type { Car } from './stock-context';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle } from './utils';

export function sharePhotos(car: Car): string[] {
  const candidates = [getThumbnailUrl(car), ...car.images.map(image => typeof image === 'string' ? image : image.url)];
  return [...new Set(candidates.filter((url): url is string => Boolean(url) && /^(https?:\/\/|\/(?!\/))/.test(url!)))];
}
export function vehicleSharePriceNote(car: Car) {
  const note = vehiclePrintData(car).priceNote;
  return note && !/^fixed$/i.test(note) ? note : undefined;
}
export function vehicleShareText(car: Car) {
  return [vehicleDisplayTitle(car), car.price != null ? formatPrice(car.price, car.currency) : null, vehicleSharePriceNote(car)].filter(Boolean).join(' · ');
}
export function vehicleShareChannels(car: Car, url: string) {
  const message = `${vehicleShareText(car)}\n${url}`;
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}`,
    email: `mailto:?subject=${encodeURIComponent(vehicleDisplayTitle(car))}&body=${encodeURIComponent(message)}`,
  };
}
export async function copyShareLink(value: string, field: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; }
  } catch { /* A selectable field also works on local HTTP and restricted browsers. */ }
  field?.focus(); field?.select();
  try { return Boolean(field && document.execCommand('copy')); } catch { return false; }
}
export function saveShareBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
