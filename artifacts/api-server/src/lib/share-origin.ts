import { currentTenant, normaliseTenantHost } from './tenant-context';
import { siteOrigin } from './enquiry-links';

/** Share destinations must use the verified tenant, never client-supplied forwarding headers. */
export function shareRequestOrigin(req: { get: (name: 'host') => string | undefined; secure: boolean }): string {
  const tenant = currentTenant();
  if (tenant) {
    const url = new URL(tenant.canonicalOrigin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.port && url.port !== '443') || !normaliseTenantHost(url.host)) throw new Error('Invalid canonical dealership origin.');
    return url.origin;
  }
  // Published standalone installations have an explicit public origin. Local
  // development can retain its current LAN host for phone/tablet previews.
  if (process.env.PUBLIC_SITE_URL?.trim() || process.env.NODE_ENV === 'production') return siteOrigin();
  const host = req.get('host') || '';
  const url = new URL(`${req.secure ? 'https' : 'http'}://${host}`);
  if ((!normaliseTenantHost(host) && url.hostname !== '[::1]') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !host) throw new Error('Invalid showroom host.');
  return url.origin;
}
