import type { RequestHandler } from 'express';

/** These routes never belong in a public dealer search result. Not an auth boundary. */
export const SEO_PRIVATE_PREFIXES = [
  '/portal', '/platform', '/sign-in', '/sign-up', '/staff-upload', '/my-purchase',
  '/verify-invoice', '/viewing', '/test-drive-declaration', '/reserve', '/saved',
  '/compare', '/enquire', '/sign', '/customer-details',
] as const;

export function isPrivateSeoPath(pathname: string): boolean {
  const path = pathname.split('?')[0].toLowerCase();
  return SEO_PRIVATE_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

/** Mount before tenancy so platform/login shells and rejected requests are covered too. */
export const seoPrivatePageHeaders: RequestHandler = (req, res, next) => {
  if (isPrivateSeoPath(req.path)) {
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
  }
  next();
};

export function canonicalSeoOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || (url.port && url.port !== '443')) {
    throw new Error('A canonical HTTPS dealership origin is required.');
  }
  return url.origin;
}

export const blockedRobotsText = 'User-agent: *\nDisallow: /\n';

export function dealerRobotsText(origin: string): string {
  const canonical = canonicalSeoOrigin(origin);
  return [
    'User-agent: *', 'Allow: /', 'Disallow: /api/',
    // These two read-only endpoints are public page images, including retained
    // demo logos after conversion to a live dealer. Other API data stays excluded.
    'Allow: /api/website-assets/', 'Allow: /api/demo-logo', 'Disallow: /share/',
    ...SEO_PRIVATE_PREFIXES.map(path => `Disallow: ${path}`),
    '', `Sitemap: ${canonical}/sitemap.xml`, '',
  ].join('\n');
}

export type SeoSitemapVehicle = { id: string; lastmod?: string | Date | null };
export type DealerSitemapData = {
  vehicles: SeoSitemapVehicle[];
  warrantyEnabled?: boolean;
  /** A persisted publication timestamp, never the current request/import-check time. */
  settingsLastmod?: string | Date | null;
};

export function escapeSitemapXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function lastmod(value: string | Date | null | undefined, now: Date): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  // Never announce invented freshness or a corrupt/future timestamp to crawlers.
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime()) return undefined;
  return date.toISOString();
}

function sitemapEntries(data: DealerSitemapData, now: Date): { path: string; changed?: string }[] {
  const settingsChanged = lastmod(data.settingsLastmod, now);
  const entries: { path: string; changed?: string }[] = [
    { path: '/', changed: settingsChanged },
    // Stock changes independently of settings; omit lastmod without a publication timestamp.
    { path: '/stock' },
    { path: '/contact', changed: settingsChanged },
    ...(data.warrantyEnabled ? [{ path: '/warranty', changed: settingsChanged }] : []),
  ];
  const seen = new Set<string>();
  for (const vehicle of data.vehicles) {
    // Existing vehicle routes use UUID IDs. Ignore accidental paths/query strings.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vehicle.id) || seen.has(vehicle.id)) continue;
    seen.add(vehicle.id);
    entries.push({ path: `/vehicle/${encodeURIComponent(vehicle.id)}`, changed: lastmod(vehicle.lastmod, now) });
  }
  return entries;
}

/** Shared allowlist for the sitemap and explicit manual search-engine notifications. */
export function dealerSitemapUrls(origin: string, data: DealerSitemapData): string[] {
  const canonical = canonicalSeoOrigin(origin);
  return sitemapEntries(data, new Date()).map(entry => canonical + entry.path);
}

/** Only known stable pages and the loader's current public stock may enter the sitemap. */
export function dealerSitemapXml(origin: string, data: DealerSitemapData, now = new Date()): string {
  const canonical = canonicalSeoOrigin(origin);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries(data, now).map(({ path, changed }) => `  <url><loc>${escapeSitemapXml(canonical + path)}</loc>${changed ? `<lastmod>${changed}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}
