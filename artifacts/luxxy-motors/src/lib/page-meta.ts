import {
  buildShowroomMeta,
  buildVehicleMeta,
  toAbsoluteUrl,
  type DealerIdentity,
  type PageMetaCopy,
} from '@workspace/vehicle-meta';
import type { Car } from '@/lib/stock-context';

/**
 * Per-route document metadata for the showroom SPA.
 *
 * The server supplies the initial metadata and JSON-LD on normal public URLs.
 * This module keeps browser metadata current during SPA navigation and removes
 * initial vehicle JSON-LD when leaving its route. Existing /share/vehicle/:id
 * links remain supported for messaging previews.
 */
export interface PageMeta extends PageMetaCopy {
  /** Absolute image URL for link previews. */
  image?: string | null;
  /** Optional safe homepage share destination on private pages; public routes use the verified dealership origin. */
  url?: string | null;
  type?: 'website' | 'article';
  /** False for unavailable/error pages, including when reached through SPA navigation. */
  indexable?: boolean;
}

/** Mirrors the fallbacks hardcoded in index.html so both tell the same story. */
export const DEFAULT_PAGE_META: PageMeta = {
  title: 'Luxxy Motors — Used cars in Harrow',
  description:
    'Browse the current used car stock at Luxxy Motors in Harrow. Full photos, specifications and prices on every vehicle.',
  image: null,
  type: 'website',
};

const MANAGED_ATTRIBUTE = 'data-page-meta';

function currentOrigin(): string {
  if (typeof window === 'undefined') return '';
  const configured = document.head.querySelector<HTMLMetaElement>('meta[name="luxxy-canonical-origin"][data-page-meta]')?.content;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) return url.origin;
    } catch { /* Ignore malformed shell metadata. */ }
  }
  return window.location.origin;
}

function upsertTag(selector: string, create: () => HTMLElement, content: string | null) {
  const head = document.head;
  const existing = head.querySelector<HTMLElement>(selector);

  if (!content) {
    // Only remove tags this module owns; the shell's fallbacks stay put.
    if (existing?.hasAttribute(MANAGED_ATTRIBUTE)) existing.remove();
    return;
  }

  const element = existing ?? create();
  if (!element.isConnected) {
    element.setAttribute(MANAGED_ATTRIBUTE, '');
    head.appendChild(element);
  }

  if (element.tagName === 'LINK') element.setAttribute('href', content);
  else element.setAttribute('content', content);
}

function metaByName(name: string, content: string | null) {
  upsertTag(`meta[name="${name}"]`, () => {
    const element = document.createElement('meta');
    element.setAttribute('name', name);
    return element;
  }, content);
}

function metaByProperty(property: string, content: string | null) {
  upsertTag(`meta[property="${property}"]`, () => {
    const element = document.createElement('meta');
    element.setAttribute('property', property);
    return element;
  }, content);
}

export function applyPageMeta(meta: PageMeta) {
  if (typeof document === 'undefined') return;

  const origin = currentOrigin();
  // The server's canonical dealership wins over a verified alias or client URL.
  // Search/filter queries and capability tokens never become preferred public URLs.
  const pathname = window.location.pathname === '/index.html' ? '/' : window.location.pathname.replace(/\/$/, '') || '/';
  const publicPage = ['/', '/stock', '/contact', '/warranty'].includes(pathname) || /^\/vehicle\/[^/]+$/.test(pathname);
  let url = publicPage && meta.indexable !== false ? `${origin}${pathname}` : null;
  // Existing private booking pages explicitly use the homepage for safe share
  // previews. Preserve that behaviour without ever putting their token in tags.
  if (!publicPage && meta.url) {
    try {
      const safeDestination = new URL(meta.url, origin);
      if ([origin, window.location.origin].includes(safeDestination.origin) && safeDestination.pathname === '/' && !safeDestination.search && !safeDestination.hash && !safeDestination.username && !safeDestination.password) url = origin;
    } catch { /* Private URLs remain excluded. */ }
  }
  for (const script of document.head.querySelectorAll<HTMLScriptElement>('script[data-public-page-seo]')) {
    if (meta.indexable === false || script.getAttribute('data-public-page-seo') !== pathname) script.remove();
  }
  const indexing = document.head.querySelector<HTMLMetaElement>('meta[name="luxxy-site-indexing"][data-page-meta]')?.content;
  if (indexing || meta.indexable === false) metaByName('robots', publicPage && meta.indexable !== false && indexing === 'index' ? 'index, follow' : 'noindex, nofollow, noarchive');
  else metaByName('robots', null);
  const image = toAbsoluteUrl(meta.image ?? null, origin);

  document.title = meta.title;
  metaByName('description', meta.description);

  upsertTag('link[rel="canonical"]', () => {
    const element = document.createElement('link');
    element.setAttribute('rel', 'canonical');
    return element;
  }, url || null);

  metaByProperty('og:title', meta.title);
  metaByProperty('og:description', meta.description);
  metaByProperty('og:type', meta.type ?? 'website');
  metaByProperty('og:url', url || null);
  metaByProperty('og:image', image);
  metaByProperty('og:image:alt', image ? meta.title : null);

  metaByName('twitter:card', image ? 'summary_large_image' : 'summary');
  metaByName('twitter:title', meta.title);
  metaByName('twitter:description', meta.description);
  metaByName('twitter:image', image);
}

/** Restores the showroom-wide defaults when a page with its own metadata unmounts. */
export function resetPageMeta() {
  applyPageMeta(DEFAULT_PAGE_META);
}

function dealerIdentity(dealer: {
  identity?: { name?: string | null };
  address?: { city?: string | null; region?: string | null } | null;
}): DealerIdentity {
  return {
    name: dealer.identity?.name ?? null,
    location: dealer.address?.city || dealer.address?.region || null,
  };
}

export function vehiclePageMeta(
  car: Car,
  dealer: Parameters<typeof dealerIdentity>[0],
): PageMeta {
  const identity = dealerIdentity(dealer);
  const meta = buildVehicleMeta(car, {
    name: identity.name,
    location: identity.location || car.dealerLocation,
  });

  return { title: meta.title, description: meta.description, image: meta.image, type: 'article' };
}

export function showroomPageMeta(
  dealer: Parameters<typeof dealerIdentity>[0],
  options: { count?: number | null } = {},
): PageMeta {
  const meta = buildShowroomMeta(dealerIdentity(dealer), options);
  return { title: meta.title, description: meta.description, type: 'website' };
}

export function enquiryPageMeta(
  dealer: Parameters<typeof dealerIdentity>[0],
  options: { heading: string; vehicleName?: string | null },
): PageMeta {
  const identity = dealerIdentity(dealer);
  const dealerName = identity.name?.trim() || 'the showroom';
  const subject = options.vehicleName?.trim();

  return {
    title: [subject ? `${options.heading}: ${subject}` : options.heading, dealerName]
      .filter(Boolean)
      .join(' | '),
    description: subject
      ? `Send an enquiry about the ${subject} at ${dealerName}. We reply with availability, viewing times and next steps.`
      : `Send an enquiry to ${dealerName}. We reply with availability, viewing times and next steps.`,
    type: 'website',
  };
}
