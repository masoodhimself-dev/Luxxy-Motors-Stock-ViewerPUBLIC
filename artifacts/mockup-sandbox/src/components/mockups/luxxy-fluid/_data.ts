import rawStock from './_stock-snapshot.json';

export type CarImage = { url: string; caption: string | null } | string;

export interface Car {
  [key: string]: unknown;
  id: string;
  advertId: string;
  title: string | null;
  variant: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  year: number | null;
  price: number | null;
  priceType: string | null;
  currency: string | null;
  mileage: number | null;
  mileageText: string | null;
  registration: string | null;
  registrationBand: string | null;
  plate: string | null;
  vrm: string | null;
  vrmVerified: boolean | null;
  fuel: string | null;
  transmission: string | null;
  bodyType: string | null;
  engineSize: string | null;
  engineCC: number | null;
  doors: number | null;
  seats: number | null;
  colour: string | null;
  emissionClass: string | null;
  drivetrain: string | null;
  owners: number | null;
  writeOffCategory: string | null;
  advertUrl: string | null;
  dealerName: string | null;
  dealerLocation: string | null;
  imageCount: number | null;
  heroImage: string | null;
  images: CarImage[];
  specifications: Record<string, unknown> | null;
  sourceExtras: Record<string, unknown> | null;
}

export interface StockData {
  schemaVersion: 1;
  dealerName: string | null;
  dealerLocation: string | null;
  count: number;
  scrapedAt: string | null;
  cars: Car[];
}

/**
 * Frozen, read-only response captured from GET /api/stock for this baseline.
 * The sandbox never writes to the API and does not invent vehicle content.
 */
export const stock = rawStock as StockData;

export const dealerConfig = {
  identity: {
    name: 'Luxxy Motors',
    logoText: 'LUXXY MOTORS',
    brandColors: {
      primaryHsl: '222 47% 11%',
      accentHsl: '38 92% 50%',
    },
  },
  contact: {
    phone: '02084729917',
    whatsapp: '+447388831790',
  },
  address: {
    city: 'Harrow',
    region: 'London',
  },
  legal: {
    companyName: 'Luxxy Motors',
  },
  social: {
    instagram: undefined as string | undefined,
    facebook: undefined as string | undefined,
    twitter: undefined as string | undefined,
  },
  hero: {
    announcement: '',
    copy: 'Carefully chosen cars.',
    subcopy: 'Quality used vehicles. Straightforward buying. Exceptional service.',
    primaryCta: 'Browse cars',
    secondaryCta: 'Find my car',
  },
  warranty: {
    enabled: true,
    title: 'Warranty',
    description: 'Warranty options are available on eligible vehicles.',
    ctaLabel: 'Learn About Warranty',
  },
  delivery: {
    enabled: true,
    title: 'Nationwide Delivery',
    description: 'Customers may be able to have their vehicle delivered.',
    ctaLabel: 'Ask About Delivery',
  },
  partExchange: {
    enabled: true,
    title: 'Looking to part exchange your current car?',
    description: 'Give us your registration and mileage and we’ll help you understand what your current car could be worth.',
    ctaLabel: 'Value My Car',
  },
  bookViewing: {
    title: 'Seen something you like?',
    description: 'Arrange a viewing at a time that suits you.',
    ctaLabel: 'Book a Viewing',
  },
  recentHandovers: {
    enabled: false,
    count: 3,
  },
  trustItems: [
    'Warranty available',
    'Nationwide delivery',
    'Carefully selected vehicles',
    'Straightforward buying',
  ],
  whyBuy: [
    { title: 'Quality Vehicles', description: 'Carefully selected used vehicles.' },
    { title: 'Transparent Buying', description: 'Clear vehicle information and straightforward pricing.' },
    { title: 'Warranty Options', description: 'Warranty options available on eligible vehicles.' },
    { title: 'Customer Support', description: 'Support throughout the purchase and handover process.' },
  ],
};

export function cn(...inputs: Array<string | false | null | undefined>) {
  return inputs.filter(Boolean).join(' ');
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
  return `${new Intl.NumberFormat('en-GB').format(mileage)} miles`;
}

export function vehicleDisplayTitle(vehicle?: Pick<Car, 'title' | 'make' | 'model' | 'year'> | null) {
  const fallback = [vehicle?.make, vehicle?.model].filter(Boolean).join(' ').trim();
  const title = vehicle?.title?.trim() || fallback;
  if (!title) return 'Vehicle';

  const displayTitle = vehicle?.year
    ? title.replace(new RegExp(`(^|\\s)${vehicle.year}(?=\\s|$)`, 'g'), ' ')
    : title;

  return displayTitle.replace(/\s{2,}/g, ' ').trim() || fallback || 'Vehicle';
}

const UK_PLATE_PATTERNS = [
  /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/,
  /^[A-Z][0-9]{1,3}[A-Z]{3}$/,
  /^[A-Z]{3}[0-9]{1,3}[A-Z]$/,
  /^[A-Z]{1,3}[0-9]{1,4}$/,
  /^[0-9]{1,4}[A-Z]{1,3}$/,
];
const REGISTRATION_BAND_MARKERS = /\breg\b|[()]/i;

export function isUKNumberPlate(value?: string | null) {
  const raw = (value || '').trim();
  if (!raw || REGISTRATION_BAND_MARKERS.test(raw)) return false;
  const compact = raw.toUpperCase().replace(/[\s-]/g, '');
  return Boolean(compact) && UK_PLATE_PATTERNS.some((pattern) => pattern.test(compact));
}

export function vehicleRegistration(vehicle?: Pick<Car, 'plate' | 'vrm' | 'registration' | 'registrationBand'> | null) {
  const actualRegistration = vehicle?.plate?.trim() || vehicle?.vrm?.trim();
  if (actualRegistration) return actualRegistration.toUpperCase();

  const registration = vehicle?.registration?.trim();
  if (registration && isUKNumberPlate(registration)) return registration.toUpperCase();
  return '';
}

export function getSafeImageUrl(image: CarImage | null | undefined) {
  if (!image) return '';
  return typeof image === 'string' ? image : image.url;
}

export function getThumbnailUrl(car: Car) {
  if (car.heroImage) return car.heroImage;
  const exteriorImage = car.images.find((image) => {
    if (typeof image === 'string' || !image.caption) return false;
    return /front|side|exterior/i.test(image.caption);
  });
  return getSafeImageUrl(exteriorImage || car.images[0]);
}

export function getPhoneHref() {
  return `tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`;
}

export function getVehicleBookingHref(car: Car) {
  return `/enquire?type=viewing&vehicleId=${encodeURIComponent(car.id)}`;
}

export function getVehicleWhatsAppHref(car: Car, request: string) {
  const details = [
    vehicleDisplayTitle(car),
    car.registration || car.plate ? `Registration: ${car.registration || car.plate}` : null,
    car.price ? `Price: ${car.currency || 'GBP'} ${car.price.toLocaleString('en-GB')}` : null,
    `Vehicle link: /vehicle/${encodeURIComponent(car.id)}`,
  ].filter(Boolean);
  const message = `Hello ${dealerConfig.identity.name}, I would like to ${request}:\n${details.join('\n')}`;
  return `https://wa.me/${dealerConfig.contact.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

export function getContactHref(subject?: string) {
  const normalized = (subject || '').toLowerCase();
  const type = normalized.includes('part exchange')
    ? 'part_exchange'
    : normalized.includes('warranty')
      ? 'warranty'
      : normalized.includes('delivery')
        ? 'delivery'
        : normalized.includes('viewing') || normalized.includes('booking')
          ? 'viewing'
          : 'general';
  return `/enquire?type=${type}`;
}

/** Analytics, API writes and visitor tracking are intentionally no-op in the baseline. */
export function trackEvent(_name: string, _payload?: Record<string, unknown>) {}
export function recordBookingIntent(_payload: { source: string; vehicleContext?: boolean }) {}
export function recordContactIntent(_payload: { channel: 'call' | 'whatsapp'; car?: Car; source?: string }) {}

export function scrollToHomeTarget(target: string) {
  document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return Boolean(document.getElementById(target));
}

export function focusHomeTarget(target: string) {
  document.getElementById(target)?.focus();
}

export function flushPendingHomeTarget() {}