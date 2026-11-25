import path from 'node:path';
import { isVehiclePagePath } from '@workspace/vehicle-meta';
import { serialisePublicJsonLd } from './public-page-seo';

const assetRoot = '/borz-template';
const pageFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/stock', 'used-cars.html'],
  ['/categories', 'categories.html'],
  ['/compare', 'compare.html'],
  ['/saved', 'wishlist.html'],
  ['/finance', 'finance.html'],
  ['/sell-your-car', 'sell-your-car.html'],
  ['/sourcing', 'sourcing.html'],
  ['/about', 'about.html'],
  ['/contact', 'contact.html'],
  ['/cookie-policy', 'cookie-policy.html'],
]);
const filePaths = new Map([...pageFiles].filter(([route]) => route !== '/index.html').map(([route, file]) => [file, route]));
filePaths.set('enquire.html', '/enquire');
const resources = /^(?:assets\/(?:css|js|img|fonts)\/|original-assets\/(?:images|fonts)\/)(?:[a-z0-9_-]+\/)*[a-z0-9_-][a-z0-9_.-]*\.(?:css|js|svg|png|jpe?g|webp|gif|ico|woff2)$/i;

export function borzPage(pathname: string): string | undefined {
  return isVehiclePagePath(pathname) ? 'vehicle.html' : pageFiles.get(pathname.replace(/\/$/, '') || '/');
}

/** Public resources do not contain dealer data. The HTML shells are selected after tenant resolution. */
export function borzDirectoryAccess(pathname: string): 'outside' | 'asset' | 'blocked' {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return 'outside';
  }
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/')).replace(/\/$/, '');
  const folded = normalized.toLowerCase();
  if (folded !== assetRoot && !folded.startsWith(assetRoot + '/')) return 'outside';
  return normalized === pathname && normalized.startsWith(assetRoot + '/') && resources.test(normalized.slice(assetRoot.length + 1))
    ? 'asset' : 'blocked';
}

export type BorzFrontendConfig = {
  basePath: string;
  readOnly: boolean;
  tenantKey: string;
  canonicalOrigin?: string;
  vehicleId?: string;
  vehicleUrl?: string;
  settingsUrl: string;
  stockUrl: string;
  featuresUrl: string;
};

export function renderBorzPage(html: string, config: BorzFrontendConfig): string {
  const rewritten = html.replace(/(\s(?:href|src|action|poster)=["'])([^"'<>]*)(["'])/gi, (original, start, value: string, end) => {
    if (resources.test(value)) return start + assetRoot + '/' + value + end;
    const suffix = value.search(/[?#]/);
    const file = suffix < 0 ? value : value.slice(0, suffix);
    const target = filePaths.get(file) ?? (file === 'vehicle.html' ? '/stock' : undefined);
    return target ? start + config.basePath + target + (suffix < 0 ? '' : value.slice(suffix)) + end : original;
  });
  // The value is JSON escaped against terminating scripts. Dealer records
  // remain in the normal tenant-scoped endpoints instead of in shared HTML.
  return rewritten.replace(/<head\b[^>]*>/i, head => head + '<script>window.BORZ_CONFIG=' + serialisePublicJsonLd(config) + ';</script>');
}
