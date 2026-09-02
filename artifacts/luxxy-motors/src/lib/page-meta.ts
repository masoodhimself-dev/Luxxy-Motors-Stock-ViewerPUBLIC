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
 * These tags are written by JavaScript, so they cover browsers, in-app share
 * sheets and crawlers that render pages (Googlebot). Crawlers that do not run
 * JavaScript — WhatsApp, Facebook, Slack, iMessage — are served the API
 * server's `/share/vehicle/:id` page instead; see `getVehicleShareUrl()` in
 * `cta-helpers.ts`.
 */
export interface PageMeta extends PageMetaCopy {
  /** Absolute image URL for link previews. */
  image?: string | null;
  /** Absolute canonical URL. Defaults to the current location. */
  url?: string | null;
  type?: 'website' | 'article';
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
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function currentUrl(): string {
  return typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`;
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
  const url = meta.url || currentUrl();
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
