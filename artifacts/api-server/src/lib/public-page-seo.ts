import { buildVehicleMeta, formatVehicleName, type VehicleMetaSource } from '@workspace/vehicle-meta';

type ObjectValue = Record<string, unknown>;
export type PublicSeoVehicle = VehicleMetaSource & {
  id: string;
  inventoryStatus?: string | null;
  colour?: string | null;
  doors?: number | null;
  seats?: number | null;
  writeOffCategory?: string | null;
  specifications?: object | null;
  sourceExtras?: ObjectValue | null;
};
export type PublicPageSeo = {
  pathname: string;
  title: string;
  description: string;
  canonical: string | null;
  origin: string | null;
  image: string | null;
  siteName: string;
  siteIndexable: boolean;
  type: 'website' | 'article';
  robots: string;
  status: 200 | 404;
  structuredData: ObjectValue[];
};
export const stablePublicPagePaths = ['/', '/stock', '/contact', '/warranty'] as const;
// Match the non-indexable pages actually mounted by the SPA. An unknown path
// still receives its NotFound UI, but must not look like a valid page to crawlers.
const nonIndexablePagePaths = new Set([
  '/enquire', '/saved', '/compare', '/portal', '/platform', '/join',
  '/phone-share', '/staff-upload', '/enquiry-photo-upload', '/reserve/payment-return',
]);
function isNonIndexablePage(pathname: string): boolean {
  return nonIndexablePagePaths.has(pathname)
    || /^\/portal\/leads\/[^/]+$/.test(pathname)
    || /^\/(?:my-purchase|viewing|sign|customer-details)\/[^/]+$/.test(pathname)
    // Clerk owns its OAuth subroutes. These capability screens also validate
    // their complete URL in the page/API; route status must not reveal tokens.
    || /^\/(?:sign-in|sign-up|verify-invoice)(?:\/|$)/.test(pathname)
    || /^\/test-drive-declaration\//.test(pathname);
}
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const noindex = 'noindex, nofollow, noarchive';

/** Only configured, complete origins are accepted; request Host/forwarding headers are never canonical inputs. */
export function publicSeoOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port || !url.hostname.includes('.')) return null;
    return url.origin;
  } catch { return null; }
}
function imageUrl(value: unknown, origin: string | null): string | null {
  const source = text(value);
  if (!source || !origin) return null;
  try {
    if (!/^https:\/\//i.test(source) && !/^\/(?!\/)/.test(source)) return null;
    const url = new URL(source, origin);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Only unambiguous published weekday/time ranges become machine-readable hours. */
function confirmedOpeningHours(rows: unknown): ObjectValue[] {
  if (!Array.isArray(rows)) return [];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayIndex = (value: string) => days.findIndex(day => [day.toLowerCase(), day.slice(0, 3).toLowerCase()].includes(value.toLowerCase()));
  const clock = (value: string): string | null => {
    const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value.trim());
    if (!match || (!match[2] && !match[3])) return null;
    let hour = Number(match[1]); const minute = Number(match[2] || 0);
    if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
    if (match[3]) hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  };
  const result: ObjectValue[] = [], seen = new Set<number>();
  for (const value of rows) {
    const row = object(value), label = text(row.days).replace(/[–—]/g, '-');
    const span = /^([a-z]+)\s*(?:-|to)\s*([a-z]+)$/i.exec(label);
    let indices: number[];
    if (/^(daily|every day|all week)$/i.test(label)) indices = [0, 1, 2, 3, 4, 5, 6];
    else if (span) {
      const start = dayIndex(span[1]), end = dayIndex(span[2]); if (start < 0 || end < 0) continue;
      indices = [start]; while (indices.at(-1) !== end && indices.length < 7) indices.push((indices.at(-1)! + 1) % 7);
    } else indices = label.split(/\s*(?:,|&|and)\s*/i).map(dayIndex);
    if (!indices.length || indices.some(day => day < 0)) continue;
    if (indices.some(day => seen.has(day))) return []; // Conflicting/duplicate days need dealer confirmation.
    indices.forEach(day => seen.add(day));
    const times = text(row.times).replace(/[–—]/g, '-');
    if (/^(closed|not open)$/i.test(times)) { result.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: indices.map(day => `https://schema.org/${days[day]}`), opens: '00:00', closes: '00:00' }); continue; }
    const range = /^(.+?)\s*(?:-|to)\s*(.+?)$/.exec(times);
    if (!range) continue;
    const opens = clock(range[1]), closes = clock(range[2]);
    if (opens && closes && opens < closes) result.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: indices.map(day => `https://schema.org/${days[day]}`), opens, closes });
  }
  return result;
}

/** Public fields only. This builder never serialises the settings/vehicle objects themselves. */
function dealerSchema(settings: ObjectValue, origin: string, name: string): ObjectValue {
  const address = object(settings.address), contact = object(settings.contact), identity = object(settings.identity);
  const result: ObjectValue = { '@type': 'AutoDealer', '@id': `${origin}/#dealership`, name, url: `${origin}/` };
  const phone = text(contact.phone), email = text(contact.email);
  if (phone) result.telephone = phone;
  if (email) result.email = email;
  const logo = imageUrl(identity.logoAsset, origin);
  if (logo) result.logo = logo;
  // Match the customer UI: a locality by itself or a sample address is not a confirmed showroom.
  const street = text(address.street), city = text(address.city), region = text(address.region), postcode = text(address.postcode);
  if (street && (city || postcode) && ![street, city, region, postcode].some(value => /\b(sample|example)\b/i.test(value))) {
    result.address = { '@type': 'PostalAddress', streetAddress: street, ...(city ? { addressLocality: city } : {}), ...(region ? { addressRegion: region } : {}), ...(postcode ? { postalCode: postcode } : {}) };
  }
  const hours = confirmedOpeningHours(settings.hours);
  if (hours.length) result.openingHoursSpecification = hours;
  return result;
}
function breadcrumb(origin: string, pathname: string, label: string, vehicle = false): ObjectValue {
  const entries = [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` }];
  if (vehicle) entries.push({ '@type': 'ListItem', position: 2, name: 'Browse Stock', item: `${origin}/stock` });
  if (pathname !== '/') entries.push({ '@type': 'ListItem', position: vehicle ? 3 : 2, name: label, item: `${origin}${pathname}` });
  return { '@type': 'BreadcrumbList', '@id': `${origin}${pathname}#breadcrumbs`, itemListElement: entries };
}
function vehicleSchema(vehicle: PublicSeoVehicle, origin: string, pathname: string, dealer: ObjectValue): ObjectValue {
  const name = formatVehicleName(vehicle, { includeVariant: true });
  const description = text(object(vehicle.specifications).description) || text(vehicle.sourceExtras?.description) || text(vehicle.sourceExtras?.advertDescription);
  const category = ['S', 'N'].includes(vehicle.writeOffCategory ?? '') ? `Recorded insurance write-off Category ${vehicle.writeOffCategory}.` : '';
  const result: ObjectValue = { '@type': 'Car', '@id': `${origin}${pathname}#vehicle`, name, url: `${origin}${pathname}` };
  if (description || category) result.description = [description, category && !new RegExp(`\\bcat(?:egory)?\\s*${vehicle.writeOffCategory}\\b`, 'i').test(description) ? category : ''].filter(Boolean).join(' ');
  const images = [vehicle.heroImage, ...(vehicle.images ?? []).map(image => typeof image === 'string' ? image : image?.url)].map(value => imageUrl(value, origin)).filter((value): value is string => Boolean(value));
  if (images.length) result.image = [...new Set(images)].slice(0, 12);
  if (text(vehicle.make)) result.brand = { '@type': 'Brand', name: text(vehicle.make) };
  for (const [key, value] of [['model', vehicle.model], ['fuelType', vehicle.fuel], ['vehicleTransmission', vehicle.transmission], ['bodyType', vehicle.bodyType], ['color', vehicle.colour]] as const) if (text(value)) result[key] = text(value);
  if (typeof vehicle.year === 'number' && Number.isInteger(vehicle.year) && vehicle.year >= 1900) result.vehicleModelDate = String(vehicle.year);
  if (typeof vehicle.mileage === 'number' && Number.isFinite(vehicle.mileage) && vehicle.mileage >= 0) result.mileageFromOdometer = { '@type': 'QuantitativeValue', value: vehicle.mileage, unitCode: 'SMI' };
  if (typeof vehicle.doors === 'number' && vehicle.doors > 0) result.numberOfDoors = vehicle.doors;
  if (typeof vehicle.seats === 'number' && vehicle.seats > 0) result.vehicleSeatingCapacity = vehicle.seats;
  // Reserved cars remain publicly visible, but must not be advertised as immediately in stock.
  if (typeof vehicle.price === 'number' && Number.isFinite(vehicle.price) && vehicle.price > 0 && /^[A-Z]{3}$/.test(vehicle.currency || 'GBP') && ['available', 'reserved'].includes(vehicle.inventoryStatus ?? '')) {
    result.offers = { '@type': 'Offer', url: `${origin}${pathname}`, price: vehicle.price, priceCurrency: vehicle.currency || 'GBP', availability: vehicle.inventoryStatus === 'reserved' ? 'https://schema.org/Reserved' : 'https://schema.org/InStock', seller: { '@id': dealer['@id'] } };
  }
  return result;
}

export function buildPublicPageSeo(input: { pathname: string; canonicalOrigin?: string | null; settings?: unknown; vehicle?: PublicSeoVehicle | null; demo?: boolean }): PublicPageSeo {
  const settings = object(input.settings), identity = object(settings.identity), address = object(settings.address);
  const name = text(identity.name) || 'Our dealership', city = text(address.city) || text(address.region);
  const origin = publicSeoOrigin(input.canonicalOrigin), pathname = input.pathname === '/index.html' ? '/' : input.pathname;
  const isVehicle = /^\/vehicle\/[^/]+\/?$/.test(pathname);
  const normalisedPath = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
  const isPublic = stablePublicPagePaths.includes(normalisedPath as typeof stablePublicPagePaths[number]) || isVehicle;
  const result: PublicPageSeo = { pathname: normalisedPath, siteName: name, siteIndexable: Boolean(origin && !input.demo), title: name, description: '', canonical: null, origin, image: null, type: 'website', robots: noindex, status: 200, structuredData: [] };
  if (!isPublic) {
    if (isNonIndexablePage(normalisedPath)) result.title = `Staff and customer access | ${name}`;
    else {
      result.status = 404;
      result.title = `Page not found | ${name}`;
      result.description = `This page could not be found. Browse the current cars or contact ${name}.`;
    }
    return result;
  }
  result.canonical = origin ? `${origin}${normalisedPath}` : null;
  result.robots = input.demo || !origin ? noindex : 'index, follow';
  let label = 'Home';
  if (isVehicle) {
    if (!input.vehicle || !['available', 'reserved'].includes(input.vehicle.inventoryStatus ?? '')) {
      result.status = 404; result.robots = noindex; result.canonical = null;
      result.title = `Vehicle unavailable | ${name}`; result.description = `This car is not in our current online stock. Browse the current cars at ${name}.`; return result;
    }
    const meta = buildVehicleMeta({ ...input.vehicle, currency: /^[A-Z]{3}$/.test(input.vehicle.currency || 'GBP') ? input.vehicle.currency : 'GBP' }, { name, location: city || undefined });
    result.title = meta.title; result.description = meta.description; result.image = imageUrl(meta.image, origin); result.type = 'article'; label = meta.name;
  } else if (normalisedPath === '/stock') {
    result.title = `Browse Stock | ${name}`; result.description = `Browse the current used car stock at ${name}${city ? ` in ${city}` : ''}. View photos, specifications and prices.`; label = 'Browse Stock';
  } else if (normalisedPath === '/contact') {
    result.title = `Contact us & directions | ${name}`; result.description = `Contact ${name}${city ? ` in ${city}` : ''}. Find our contact details, opening hours and information for your visit.`; label = 'Contact us';
  } else if (normalisedPath === '/warranty') {
    result.title = `Warranty information | ${name}`; result.description = `Ask ${name} about warranty options for your chosen vehicle, policy terms and how to get help.`; label = 'Warranty information';
  } else {
    result.title = `${city ? `Used cars for sale in ${city}` : 'Used cars for sale'} | ${name}`;
    result.description = `Browse the current used car stock at ${name}${city ? ` in ${city}` : ''}. View photos, specifications and prices.`;
  }
  if (!isVehicle) result.image = imageUrl(object(settings.presentation).heroImageUrl, origin) || imageUrl(identity.logoAsset, origin);
  if (!input.demo && origin) {
    const dealer = dealerSchema(settings, origin, name);
    result.structuredData = [dealer, ...(normalisedPath !== '/' ? [breadcrumb(origin, normalisedPath, label, isVehicle)] : []), ...(isVehicle && input.vehicle ? [vehicleSchema(input.vehicle, origin, normalisedPath, dealer)] : [])];
  }
  return result;
}

/** Escape '<' as well as HTML line separators so dealer text cannot terminate the JSON script. */
export const serialisePublicJsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export function renderPublicPageSeo(html: string, seo: PublicPageSeo): string {
  const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i)?.[0];
  if (!head) return html;
  let output = head.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '');
  output = output.replace(/<meta\b[^>]*>/gi, tag => /\b(?:name|property)\s*=\s*["'](?:description|robots|og:[^"']+|twitter:[^"']+|luxxy-canonical-origin|luxxy-site-indexing)["']/i.test(tag) ? '' : tag);
  output = output.replace(/<link\b[^>]*>/gi, tag => /\brel\s*=\s*["']canonical["']/i.test(tag) ? '' : tag);
  output = output.replace(/<script\b(?=[^>]*\bdata-public-page-seo\b)[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const tags = [`<title>${escapeHtml(seo.title)}</title>`];
  const meta = (attribute: 'name' | 'property', key: string, value: string | null) => { if (value) tags.push(`<meta ${attribute}="${key}" content="${escapeHtml(value)}" data-page-meta />`); };
  meta('name', 'description', seo.description); meta('name', 'robots', seo.robots); meta('name', 'luxxy-canonical-origin', seo.origin); meta('name', 'luxxy-site-indexing', seo.siteIndexable ? 'index' : 'noindex');
  if (seo.canonical) tags.push(`<link rel="canonical" href="${escapeHtml(seo.canonical)}" data-page-meta />`);
  meta('property', 'og:site_name', seo.siteName); meta('property', 'og:title', seo.title); meta('property', 'og:description', seo.description); meta('property', 'og:type', seo.type); meta('property', 'og:url', seo.canonical); meta('property', 'og:image', seo.image); meta('property', 'og:image:alt', seo.image ? seo.title : null);
  meta('name', 'twitter:card', seo.image ? 'summary_large_image' : 'summary'); meta('name', 'twitter:title', seo.title); meta('name', 'twitter:description', seo.description); meta('name', 'twitter:image', seo.image);
  if (seo.structuredData.length) tags.push(`<script type="application/ld+json" data-public-page-seo="${escapeHtml(seo.pathname)}">${serialisePublicJsonLd({ '@context': 'https://schema.org', '@graph': seo.structuredData })}</script>`);
  const renderedHead = output.replace(/\s*<\/head\s*>/i, () => `${tags.join('\n')}\n</head>`);
  return html.replace(head, () => renderedHead);
}
