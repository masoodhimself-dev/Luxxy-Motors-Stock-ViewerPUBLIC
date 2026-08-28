import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number, currency: string | null = 'GBP') {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'GBP',
    maximumFractionDigits: 0,
  }).format(price);
}

export function formatMileage(mileage: number) {
  return new Intl.NumberFormat('en-GB').format(mileage) + ' miles';
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
