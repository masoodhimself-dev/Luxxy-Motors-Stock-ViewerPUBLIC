import type { Car } from './stock-context';
export function arrivalTime(car: Car): number | null {
  const value = car.listedAt ?? car.firstListedAt ?? car.dateAdded;
  if (typeof value !== 'string') return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : null;
}
export function stockHighlights(car: Car): string[] {
  const raw = car.features ?? car.specifications?.features ?? car.sourceExtras?.features;
  return Array.isArray(raw) ? [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length <= 70 && /panoramic|heated seats|rear.*camera|parking sensors|apple carplay|android auto|cruise control|satellite navigation/i.test(v) && !/without|not fitted|no /i.test(v)))].slice(0, 2) : [];
}
export function shortTrim(car: Car): string {
  const text = (car.trim || car.variant || '').replace(/\bEuro\s*\d[^ ]*/gi, '').replace(/\(s\/s\)/gi, '').replace(/\b\d(?:dr|door)\b/gi, '').replace(/\s+/g, ' ').trim();
  return text.length > 65 ? text.slice(0, 62).trim() + '…' : text;
}
export function stockRegistrationYear(car: Car): string {
  const band = car.registrationBand?.trim() || '';
  const year = car.year ? String(car.year) : '';
  const number = band.match(/\b(\d{2})\s*reg\b/i)?.[1] || (/^\d{2}$/.test(band) ? band : '');
  return [year, number ? '(' + number + ' reg)' : ''].filter(Boolean).join(' ');
}
