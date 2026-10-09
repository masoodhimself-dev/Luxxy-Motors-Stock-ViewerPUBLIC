/** The collector and marketplace are distinct: Grok transports either feed. */
export type StockPlatform = 'autotrader' | 'cazoo';
export type StockConnection = { platform: StockPlatform; retailerId: string; sourceUrl: string; enabled: boolean };
const text = (v: unknown) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
type Facts = { title?: string | null; make?: string | null; model?: string | null; variant?: string | null; year?: number | null; mileage?: number | null; fuel?: string | null; transmission?: string | null; price?: number | null; currency?: string | null; dealerName?: string | null; specifications?: Record<string, unknown> | null; sourceExtras?: Record<string, unknown> | null };
/** Deterministic copy from structured facts. No condition, history or availability claims. */
export function factualStockDescription(car: Facts): string | null {
  const name = text(car.title) || [text(car.make), text(car.model)].filter(Boolean).join(' ');
  if (!name) return null;
  const year = typeof car.year === 'number' && Number.isInteger(car.year) && car.year >= 1900 ? String(car.year) : '';
  const heading = [year && !name.includes(year) ? year : '', name].filter(Boolean).join(' ');
  const sentences = [`${heading}${text(car.variant) && !name.toLowerCase().includes(text(car.variant).toLowerCase()) ? ` — ${text(car.variant)}` : ''}.`];
  if (typeof car.mileage === 'number' && Number.isInteger(car.mileage) && car.mileage >= 0) sentences.push(`Recorded mileage: ${car.mileage.toLocaleString('en-GB')} miles.`);
  const mechanics = [text(car.fuel) ? `Fuel: ${text(car.fuel)}` : '', text(car.transmission) ? `Transmission: ${text(car.transmission)}` : ''].filter(Boolean);
  if (mechanics.length) sentences.push(`${mechanics.join('. ')}.`);
  if (typeof car.price === 'number' && Number.isFinite(car.price) && car.price > 0 && (!car.currency || car.currency === 'GBP')) sentences.push(`Priced at £${car.price.toLocaleString('en-GB', { maximumFractionDigits: 2 })}.`);
  return sentences.join(' ');
}
export function stockDescriptionExtras(car: Facts): Record<string, unknown> {
  const extras = { ...(car.sourceExtras ?? {}) };
  // Generated copy must never masquerade as an original advert description.
  if (extras.descriptionOrigin === 'generated-facts') delete extras.description;
  const original = [car.specifications?.description, extras.description, extras.advertDescription].find(v => Boolean(text(v)));
  if (original) { if (extras.descriptionOrigin === 'generated-facts') delete extras.descriptionOrigin; return extras; }
  const description = factualStockDescription(car);
  if (description) { extras.description = description; extras.descriptionOrigin = 'generated-facts'; extras.descriptionTemplateVersion = 1; }
  else { delete extras.descriptionOrigin; delete extras.descriptionTemplateVersion; }
  return extras;
}
