import { isUKNumberPlate } from '@/lib/utils';

/** Display only: never changes the registration saved to a vehicle or form. */
export function formatRegistrationPlate(value?: string | null): string {
  if (!isUKNumberPlate(value)) return '';
  const compact = value!.toUpperCase().replace(/[\s-]/g, '');
  const patterns = [
    /^([A-Z]{2}\d{2})([A-Z]{3})$/, // current: MM00 MMM
    /^([A-Z]\d{1,3})([A-Z]{3})$/, // prefix: M222 MMM
    /^([A-Z]{3})(\d{1,3}[A-Z])$/, // suffix
    /^([A-Z]{1,3})(\d{1,4})$/, // dateless / NI: MMM 3333
    /^(\d{1,4})([A-Z]{1,3})$/,
  ];
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match) return `${match[1]} ${match[2]}`;
  }
  return value!.trim().toUpperCase().replace(/\s+/g, ' ');
}
