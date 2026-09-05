import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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

  return displayTitle.replace(/\s{2,}/g, ' ').trim() || fallback || 'Vehicle';
}

/**
 * The registration we are allowed to print on a number plate.
 * Registration bands (e.g. "2019 (69)") are not real plates, so they are never returned.
 */
// UK number plate formats, compared without spaces:
// current "AB12CDE", prefix "A123BCD", suffix "ABC123A", dateless "ABC123" / "123ABC".
const UK_PLATE_PATTERNS = [
  /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/,
  /^[A-Z][0-9]{1,3}[A-Z]{3}$/,
  /^[A-Z]{3}[0-9]{1,3}[A-Z]$/,
  /^[A-Z]{1,3}[0-9]{1,4}$/,
  /^[0-9]{1,4}[A-Z]{1,3}$/,
];

// Registration bands read like "2009 (59 reg)" or "59 reg" — never a plate.
const REGISTRATION_BAND_MARKERS = /\breg\b|[()]/i;

export function isUKNumberPlate(value?: string | null) {
  const raw = (value || '').trim();
  if (!raw || REGISTRATION_BAND_MARKERS.test(raw)) return false;
  const compact = raw.toUpperCase().replace(/[\s-]/g, '');
  if (!compact) return false;
  return UK_PLATE_PATTERNS.some((pattern) => pattern.test(compact));
}

/**
 * Returns a vehicle's real number plate, or '' when we only hold a registration
 * band such as "2009 (59 reg)". Never render a band as if it were a plate.
 */
export function vehicleRegistration(
  vehicle?: {
    plate?: string | null;
    vrm?: string | null;
    registration?: string | null;
    registrationBand?: string | null;
  } | null,
) {
  const actualRegistration = vehicle?.plate?.trim() || vehicle?.vrm?.trim();
  if (actualRegistration) return actualRegistration.toUpperCase();

  const registration = vehicle?.registration?.trim();
  if (registration && isUKNumberPlate(registration)) return registration.toUpperCase();

  return '';
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
