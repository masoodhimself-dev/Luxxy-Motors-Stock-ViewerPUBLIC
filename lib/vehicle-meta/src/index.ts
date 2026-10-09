/**
 * Page titles, descriptions and preview images for a single vehicle.
 *
 * Shared on purpose: the SPA writes these strings into `<head>` while a shopper
 * browses, and the API server writes the same strings into the crawler-facing
 * share page that WhatsApp, Facebook and Slack fetch. One implementation keeps
 * the forwarded link preview and the page it opens telling the same story.
 */

export interface VehicleMetaSource {
  title?: string | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  trim?: string | null;
  year?: number | null;
  price?: number | null;
  currency?: string | null;
  mileage?: number | null;
  mileageText?: string | null;
  fuel?: string | null;
  transmission?: string | null;
  bodyType?: string | null;
  heroImage?: string | null;
  images?: ReadonlyArray<VehicleImageSource> | null;
}

export type VehicleImageSource =
  | string
  | { url?: string | null; caption?: string | null }
  | null
  | undefined;

export interface DealerIdentity {
  name?: string | null;
  location?: string | null;
}

export interface PageMetaCopy {
  title: string;
  description: string;
}

export interface VehicleMetaCopy extends PageMetaCopy {
  /** Vehicle name without price or dealer suffix, e.g. "2009 Ford Fiesta 1.4 Zetec". */
  name: string;
  /** Preview photograph, absolute when the source URL is absolute. */
  image: string | null;
}

/** Descriptions longer than this get their closing sentence dropped. */
const DESCRIPTION_LIMIT = 165;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function formatVehiclePrice(
  price?: number | null,
  currency?: string | null,
): string | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: clean(currency) || 'GBP',
    maximumFractionDigits: 0,
  }).format(price);
}

export function formatVehicleMileage(vehicle: VehicleMetaSource): string | null {
  if (typeof vehicle.mileage === 'number' && Number.isFinite(vehicle.mileage) && vehicle.mileage > 0) {
    return `${new Intl.NumberFormat('en-GB').format(vehicle.mileage)} miles`;
  }
  return clean(vehicle.mileageText) || null;
}

/**
 * "2009 Ford Fiesta" — the year first (buyers scan for it), then the feed's own
 * title. Variants such as "1.4 Zetec 5dr Euro 5" are long enough to swamp a
 * link-preview title, so they are opt-in and reserved for descriptions.
 */
export function formatVehicleName(
  vehicle: VehicleMetaSource,
  options: { includeVariant?: boolean } = {},
): string {
  const base =
    clean(vehicle.title) || [clean(vehicle.make), clean(vehicle.model)].filter(Boolean).join(' ');
  const year = typeof vehicle.year === 'number' && vehicle.year > 1900 ? String(vehicle.year) : '';
  const variant = clean(vehicle.variant) || clean(vehicle.trim);

  const parts = [
    year && !contains(base, year) ? year : '',
    base,
    options.includeVariant && variant && !contains(base, variant) ? variant : '',
  ].filter(Boolean);

  return parts.join(' ') || 'Used car';
}

function imageUrl(image: VehicleImageSource): string {
  if (!image) return '';
  return typeof image === 'string' ? clean(image) : clean(image.url);
}

/**
 * The photograph that represents the vehicle: an explicit hero, otherwise the
 * first exterior shot, otherwise the first photo we hold.
 */
export function pickVehicleImage(vehicle: VehicleMetaSource): string | null {
  const hero = clean(vehicle.heroImage);
  if (hero) return hero;

  const images = vehicle.images ?? [];
  const exterior = images.find(
    (image) =>
      image &&
      typeof image !== 'string' &&
      typeof image.caption === 'string' &&
      /front|side|exterior/i.test(image.caption) &&
      imageUrl(image),
  );
  if (exterior) return imageUrl(exterior);

  for (const image of images) {
    const url = imageUrl(image);
    if (url) return url;
  }
  return null;
}

/** Resolves a possibly relative image or page path against the current origin. */
export function toAbsoluteUrl(url: string | null | undefined, origin: string): string | null {
  const value = clean(url);
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  const base = origin.replace(/\/+$/, '');
  return `${base}/${value.replace(/^\/+/, '')}`;
}

function joinSentences(sentences: string[], limit = DESCRIPTION_LIMIT): string {
  const kept: string[] = [];
  for (const sentence of sentences.filter(Boolean)) {
    const candidate = [...kept, sentence].join(' ');
    if (kept.length && candidate.length > limit) break;
    kept.push(sentence);
  }
  return kept.join(' ');
}

export function buildVehicleMeta(
  vehicle: VehicleMetaSource,
  dealer: DealerIdentity = {},
): VehicleMetaCopy {
  const name = formatVehicleName(vehicle);
  const fullName = formatVehicleName(vehicle, { includeVariant: true });
  const priceLabel = formatVehiclePrice(vehicle.price, vehicle.currency);
  const dealerName = clean(dealer.name);
  const where = [dealerName, clean(dealer.location)].filter(Boolean).join(', ');

  const facts = [
    priceLabel,
    formatVehicleMileage(vehicle),
    clean(vehicle.fuel),
    clean(vehicle.transmission),
  ].filter(Boolean);

  const title = [
    [name, priceLabel ?? 'Price on application'].join(' — '),
    dealerName,
  ]
    .filter(Boolean)
    .join(' | ');

  const description = joinSentences([
    where ? `${fullName} for sale at ${where}.` : `${fullName} for sale.`,
    facts.length ? `${facts.join(' · ')}.` : '',
    'Full photos, specification and viewings by appointment.',
  ]);

  return { name, title, description, image: pickVehicleImage(vehicle) };
}

export function buildShowroomMeta(
  dealer: DealerIdentity = {},
  options: { count?: number | null } = {},
): PageMetaCopy {
  const dealerName = clean(dealer.name) || 'Our showroom';
  const location = clean(dealer.location);
  const count = typeof options.count === 'number' && options.count > 0 ? options.count : null;

  const title = [
    location ? `Used cars for sale in ${location}` : 'Used cars for sale',
    dealerName,
  ].join(' | ');

  const description = joinSentences([
    count
      ? `Browse ${count} used ${count === 1 ? 'car' : 'cars'} in stock at ${dealerName}${location ? ` in ${location}` : ''}.`
      : `Browse the current used car stock at ${dealerName}${location ? ` in ${location}` : ''}.`,
    'Full photos, specifications and prices on every vehicle.',
    'Viewings by appointment, nationwide delivery available.',
  ]);

  return { title, description };
}

export * from "./sale-workspace.ts";
export * from "./registration.ts";
export * from './customer-sale.ts';
export * from "./email-templates.ts";
export * from './dealer-relationships.ts';
export * from './dealer-chat.ts';
export * from './showroom-hours.ts';
export * from './enquiry-merge.ts';

export * from "./stock-feed.ts";
