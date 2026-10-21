import type { DealerConfig } from '@/config/dealer';

export function dealershipLocation(address: DealerConfig['address']) {
  const lines = [address?.street, address?.city, address?.region, address?.postcode]
    .map(line => line?.trim()).filter((line): line is string => Boolean(line));
  const isSample = lines.some(line => /\b(sample|example)\b/i.test(line));
  let directions: string | null = null;
  if (!isSample && address?.mapsUrl) {
    try {
      const url = new URL(address.mapsUrl);
      if (['https:', 'http:'].includes(url.protocol)) directions = url.href;
    } catch { /* Keep an invalid settings link off the public page. */ }
  }
  // A locality alone is not a confirmed showroom. Only direct visitors to an
  // actual street address, using the same fallback throughout the public site.
  if (!directions && !isSample && address?.street?.trim() && (address.city?.trim() || address.postcode?.trim())) {
    directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lines.join(', '))}`;
  }
  return { lines, isSample, directions };
}
