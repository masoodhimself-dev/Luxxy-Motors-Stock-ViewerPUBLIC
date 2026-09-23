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
  return { lines, isSample, directions };
}
