import { isWebsiteTemplateId } from '@workspace/vehicle-meta/website-templates';
import { sharedStaffPortalPage } from './shared-staff-portal';

export function privateWebsitePreviewBase(pathname = typeof window === 'undefined' ? '' : window.location.pathname) {
  return /^\/platform\/preview\/[a-z0-9][a-z0-9-]{1,62}(?:\/template\/(?:existing|classic|premium|focused|showroom|modern-showroom|grand-touring|forecourt|autodeal|panorama|regent-lane)\/(?:0|[1-9]\d*))?(?=\/|$)/.exec(pathname)?.[0] ?? '';
}

export function privateWebsitePreviewDetails(base = privateWebsitePreviewBase()) {
  const match = /^\/platform\/preview\/([a-z0-9][a-z0-9-]{1,62})(?:\/template\/([a-z-]+)\/(\d+))?$/.exec(base);
  return match ? { dealerId: match[1], template: match[2] ?? null, revision: match[3] ? Number(match[3]) : null } : null;
}

type SharedWebsiteShowcaseRoute =
  | { kind: 'chooser'; base: string }
  | { kind: 'design'; base: string; chooser: string };

export function sharedWebsiteShowcaseRoute(pathname = typeof window === 'undefined' ? '' : window.location.pathname): SharedWebsiteShowcaseRoute | null {
  const match = /^(\/showcase\/[A-Za-z0-9_-]{45,320})(?:\/design\/([a-z-]+)(?=\/|$)|\/?$)/.exec(pathname);
  if (!match) return null;
  const [, chooser, template] = match;
  if (!template) return { kind: 'chooser', base: chooser };
  return isWebsiteTemplateId(template) ? { kind: 'design', base: match[0], chooser } : null;
}

export function websitePreviewBase(pathname = typeof window === 'undefined' ? '' : window.location.pathname) {
  const showcase = sharedWebsiteShowcaseRoute(pathname);
  return showcase?.kind === 'design' ? showcase.base : privateWebsitePreviewBase(pathname);
}

/** Native fragment links must stay inside the current dealership preview. */
export function homeSectionHref(section: string, isHomepage = false) {
  const homePath = isHomepage ? '' : websitePreviewBase() || '/';
  return `${homePath}#${section}`;
}

export function previewPublicRequestPath(path: string) {
  return (websitePreviewBase() || sharedStaffPortalPage()?.base || '') + path;
}

export function previewWebsiteAssetUrl(value: string, dealerOrigin: string | undefined) {
  const base = websitePreviewBase() || sharedStaffPortalPage()?.base;
  if (!base) return value;
  try {
    const url = new URL(value, dealerOrigin || window.location.origin);
    const local = value.startsWith('/') && !value.startsWith('//');
    if (local || url.origin === dealerOrigin) {
      const asset = /^\/api\/website-assets\/[a-f0-9-]{36}$/i.test(url.pathname);
      const demoLogo = url.pathname === '/api/demo-logo';
      if (asset || demoLogo) {
        const variant = demoLogo && url.searchParams.get('variant') === 'footer' ? '?variant=footer' : '';
        return window.location.origin + base + url.pathname + variant;
      }
    }
  } catch { /* Preserve the existing value if this is not a website asset URL. */ }
  return value;
}
