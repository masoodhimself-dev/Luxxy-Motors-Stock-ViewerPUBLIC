import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export { isUKNumberPlate, vehicleRegistration, vehicleRegistrationLabel } from '@workspace/vehicle-meta';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number, currency: string | null = 'GBP') {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: (currency || 'GBP').toUpperCase(),
    currencyDisplay: 'narrowSymbol',
    useGrouping: true,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function formatPhoneDisplay(phone: string) {
  const compact = phone.replace(/\s/g, '');
  return /^020\d{8}$/.test(compact)
    ? `${compact.slice(0, 3)} ${compact.slice(3, 7)} ${compact.slice(7)}`
    : phone;
}

export function formatMileage(mileage: number) {
  return new Intl.NumberFormat('en-GB').format(mileage) + ' miles';
}

export function vehicleDisplayTitle(vehicle?: {
  title?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
} | null) {
  const fallback = [vehicle?.make, vehicle?.model].filter(Boolean).join(' ').trim();
  const title = vehicle?.title?.trim() || fallback;
  if (!title) return 'Vehicle';

  const displayTitle = vehicle?.year
    ? title.replace(new RegExp(`(^|\\s)${vehicle.year}(?=\\s|$)`, 'g'), ' ')
    : title;

  let cleaned = displayTitle.replace(/\s{2,}/g, ' ').trim();
  // Some imported titles repeat the make at the start of the model (e.g. MG MG HS).
  // Normalise the label only; retain the original stock record and all model words.
  const make = vehicle?.make?.trim();
  if (make && cleaned.toLowerCase().startsWith(`${make} ${make} `.toLowerCase())) {
    cleaned = cleaned.slice(make.length + 1);
  }
  return cleaned || fallback || 'Vehicle';
}

// Ensure remote images don't fail due to referrers
export function getSafeImageUrl(img: string | { url: string; caption?: string | null }) {
  if (!img) return '';
  return typeof img === 'string' ? img : img.url;
}

export function getThumbnailUrl(car: any): string {
  if (!car) return '';
  if (car.heroImage) return car.heroImage;
  
  const images = car.images || [];
  if (!images.length) return '';

  // 1. Try to find an image matching exterior/front/side
  const exteriorImg = images.find((img: any) => {
    if (typeof img === 'string') return false;
    if (!img.caption) return false;
    return /front|side|exterior/i.test(img.caption);
  });
  
  if (exteriorImg) return typeof exteriorImg === 'string' ? exteriorImg : exteriorImg.url;
  
  // 2. Fallback to first image
  const first = images[0];
  return typeof first === 'string' ? first : first.url;
}
