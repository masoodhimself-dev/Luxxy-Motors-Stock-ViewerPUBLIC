import { vehicleRegistration } from './registration.ts';
import { showroomHoursComplete } from './showroom-hours.ts';

export interface DemoReviewVehicleSource {
  id: string;
  advertId?: string | null;
  title?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  price?: number | null;
  mileage?: number | null;
  fuel?: string | null;
  transmission?: string | null;
  registration?: string | null;
  plate?: string | null;
  vrm?: string | null;
  heroImage?: string | null;
  images?: ReadonlyArray<string | { url?: string | null } | null> | null;
  description?: string | null;
  specifications?: object | null;
  sourceExtras?: Record<string, unknown> | null;
}

export interface DemoReview {
  dealer: { id: string; name: string; platform: 'autotrader' | 'cazoo'; sourceUrl: string; status: string; expiresAt: string; revision: number; settingsRevision: number };
  preview: { path: string; allowed: boolean; reason: string | null };
  details: {
    logoUrl: string; hasLogo: boolean; phone: string; email: string; websiteUrl: string;
    address: { street: string; city: string; region: string; postcode: string; mapsUrl: string };
    hours: { days: string; times: string }[];
    visitInstructions: string; missingFields: string[]; editableDetails: Record<string, unknown> | null;
  };
  stock: {
    count: number; expectedCount: number | null; collectedAt: string | null; importedAt: string | null;
    photosCount: number; noPhotosCount: number; missingInfoCount: number; completeCount: number; countMatches: boolean | null;
    vehicles: { id: string; advertId: string; title: string; registration: string; price: number | null; photoUrl: string | null; photoCount: number; missingPhotos: boolean; missingFields: string[]; previewPath: string }[];
  };
}

export interface DemoReviewInput {
  dealer: Omit<DemoReview['dealer'], 'settingsRevision'> & { settingsRevision?: number };
  config: Record<string, unknown>;
  businessDetails?: Record<string, unknown> | null;
  hasSavedLogo?: boolean;
  vehicles: ReadonlyArray<DemoReviewVehicleSource>;
  latestImport?: { expectedCount: number; scrapedAt: string; receivedAt: string } | null;
  now?: string;
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function text(value: unknown): string {
  const result = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return /^(?:unknown|not (?:supplied|available|known|specified|provided|recorded)|n\/?a|none|null|undefined|tbc|tba|[-–—])$/i.test(result) ? '' : result;
}
function photo(value: unknown): string {
  try {
    const url = new URL(text(value));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function hasOriginalDescription(vehicle: DemoReviewVehicleSource): boolean {
  const extras = object(vehicle.sourceExtras);
  if (Array.isArray(extras.originalAdvertDescriptions)) return extras.originalAdvertDescriptions.some(value => Boolean(text(value)));
  return [vehicle.description, object(vehicle.specifications).description, extras.advertDescription,
    extras.descriptionOrigin === 'generated-facts' ? '' : extras.description].some(value => Boolean(text(value)));
}

/** Convert current published hours for the editor; never reuse an outdated imported schedule. */
function editableHours(hours: DemoReview['details']['hours']) {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const days: Record<string, unknown>[] = names.map((_, day) => ({ day, status: 'unknown' }));
  const dayIndex = (label: string) => names.findIndex(name => name === label || name.slice(0, 3) === label);
  for (const row of hours) {
    const label = row.days.toLowerCase().replace(/[–—]/g, '-');
    let indices: number[] = [];
    const range = /^([a-z]+)\s*(?:-|to)\s*([a-z]+)$/.exec(label);
    if (/^(daily|every day|all week)$/.test(label)) indices = [0, 1, 2, 3, 4, 5, 6];
    else if (range && dayIndex(range[1]) >= 0 && dayIndex(range[2]) >= 0) {
      const start = dayIndex(range[1]), end = dayIndex(range[2]);
      for (let n = 0; n < 7; n++) { const day = (start + n) % 7; indices.push(day); if (day === end) break; }
    } else indices = label.split(/\s*(?:,|&|and)\s*/).map(dayIndex).filter(day => day >= 0);
    const time = /^(\d{2}:\d{2})\s*[-–—]\s*(\d{2}:\d{2})$/.exec(row.times);
    for (const day of indices) days[day] = time ? { day, status: 'open', open: time[1], close: time[2] }
      : /^closed$/i.test(row.times) ? { day, status: 'closed' }
      : /^(?:by appointment(?: only)?|appointment only)$/i.test(row.times) ? { day, status: 'appointment_only' } : { day, status: 'unknown' };
  }
  return days;
}

/** Saved values only: no image requests, provider lookups, stock changes or generated claims. */
export function buildDemoReview(input: DemoReviewInput): DemoReview {
  const { dealer } = input;
  const path = `/platform/preview/${encodeURIComponent(dealer.id)}`;
  const expired = !Number.isFinite(Date.parse(dealer.expiresAt)) || Date.parse(dealer.expiresAt) <= Date.parse(input.now ?? new Date().toISOString());
  const allowed = ['draft', 'active'].includes(dealer.status) && !expired;
  const contact = object(input.config.contact), address = object(input.config.address), presentation = object(input.config.presentation);
  const savedDetails = object(object(input.businessDetails).dealershipDetails);
  const savedLogo = text(object(input.config.identity).logoAsset);
  const logoUrl = savedLogo === '/api/demo-logo' && input.hasSavedLogo ? `${path}/api/demo-logo`
    : /^\/api\/website-assets\/[a-f0-9-]{36}$/i.test(savedLogo) ? `${path}${savedLogo}` : photo(savedLogo);
  const hasLogo = Boolean(logoUrl);
  const details: DemoReview['details'] = {
    hasLogo, logoUrl,
    phone: text(contact.phone), email: text(contact.email), websiteUrl: text(savedDetails.websiteUrl),
    address: { street: text(address.street), city: text(address.city), region: text(address.region), postcode: text(address.postcode), mapsUrl: text(address.mapsUrl) },
    hours: (Array.isArray(input.config.hours) ? input.config.hours : []).map(row => ({ days: text(object(row).days), times: text(object(row).times) })).filter(row => row.days && row.times),
    visitInstructions: text(presentation.visitInstructions), missingFields: [], editableDetails: Object.keys(savedDetails).length ? { ...savedDetails } : null,
  };
  if (details.editableDetails) {
    // Public Settings may have changed since the stock import. Edit what is shown now.
    Object.assign(details.editableDetails, { phone: details.phone, email: details.email,
      about: text(presentation.teamIntroduction), visitInstructions: details.visitInstructions });
    if (details.address.street && details.address.city && details.address.postcode) details.editableDetails.showroomAddress = { sourceUrl: dealer.sourceUrl, checkedAt: savedDetails.checkedAt, ...object(savedDetails.showroomAddress), ...details.address };
    else delete details.editableDetails.showroomAddress;
    if (details.hours.length) details.editableDetails.openingHours = { sourceUrl: dealer.sourceUrl, checkedAt: savedDetails.checkedAt,
      ...object(savedDetails.openingHours), timezone: 'Europe/London', days: editableHours(details.hours) };
    else delete details.editableDetails.openingHours;
    details.editableDetails.includedItems = Array.isArray(presentation.includedItems) ? [...presentation.includedItems] : [];
    for (const [key, field] of [['warranty', 'warrantyDescription'], ['delivery', 'deliveryDescription'], ['partExchange', 'partExchangeDescription']]) {
      const service = object(input.config[key]);
      details.editableDetails[field] = service.enabled === true ? text(service.description) : '';
    }
  }
  if (!hasLogo) details.missingFields.push('Logo');
  if (!details.phone) details.missingFields.push('Phone number');
  if (!details.email) details.missingFields.push('Email address');
  if (!details.address.street || !details.address.city || !details.address.postcode) details.missingFields.push('Showroom address');
  if (!showroomHoursComplete(details.hours)) details.missingFields.push('Opening hours');
  const vehicles = input.vehicles.map(vehicle => {
    const title = text(vehicle.title) || [text(vehicle.make), text(vehicle.model)].filter(Boolean).join(' ');
    const missingFields: string[] = [];
    if (!(text(vehicle.make) && text(vehicle.model)) && (!title || /^(?:used )?(?:car|vehicle)$/i.test(title))) missingFields.push('Vehicle name');
    if (!Number.isInteger(vehicle.year) || vehicle.year! < 1886) missingFields.push('Year');
    if (typeof vehicle.price !== 'number' || !Number.isFinite(vehicle.price) || vehicle.price <= 0) missingFields.push('Price');
    if (typeof vehicle.mileage !== 'number' || !Number.isFinite(vehicle.mileage) || vehicle.mileage < 0) missingFields.push('Mileage');
    if (!text(vehicle.fuel)) missingFields.push('Fuel type');
    if (!text(vehicle.transmission)) missingFields.push('Gearbox');
    const registration = vehicleRegistration(vehicle);
    if (!registration) missingFields.push('Registration');
    if (!hasOriginalDescription(vehicle)) missingFields.push('Advert description');
    const urls = [...new Set([vehicle.heroImage, ...(vehicle.images ?? []).map(image => typeof image === 'string' ? image : image?.url)].map(photo).filter(Boolean))];
    return { id: vehicle.id, advertId: text(vehicle.advertId), title: title || 'Vehicle details missing', registration,
      price: typeof vehicle.price === 'number' && Number.isFinite(vehicle.price) ? vehicle.price : null,
      photoUrl: urls[0] ?? null, photoCount: urls.length, missingPhotos: urls.length === 0, missingFields,
      previewPath: `${path}/vehicle/${encodeURIComponent(vehicle.id)}` };
  });
  const count = vehicles.length;
  const expectedCount = input.latestImport?.expectedCount ?? null;
  return { dealer: { ...dealer, settingsRevision: dealer.settingsRevision ?? 0 }, preview: { path, allowed, reason: allowed ? null : expired ? 'This demo has expired. Extend it before opening the preview.' : 'This demo is not active. Review its status before opening the preview.' }, details,
    stock: { count, expectedCount, collectedAt: input.latestImport?.scrapedAt ?? null, importedAt: input.latestImport?.receivedAt ?? null,
      photosCount: vehicles.reduce((total, vehicle) => total + vehicle.photoCount, 0), noPhotosCount: vehicles.filter(vehicle => vehicle.missingPhotos).length,
      missingInfoCount: vehicles.filter(vehicle => vehicle.missingFields.length > 0).length,
      completeCount: vehicles.filter(vehicle => !vehicle.missingPhotos && !vehicle.missingFields.length).length,
      countMatches: expectedCount === null ? null : count === expectedCount, vehicles } };
}
