import { currentTenant } from './tenant-context';

/** Match the published website identity, never an editable dealer name or fallback host. */
export function usesShippedMultiChoiceLogo(dealerId: string | undefined, canonicalOrigin: string): boolean {
  const tenant = currentTenant();
  if (!dealerId || !tenant || tenant.dealerId !== dealerId) return false;
  try {
    const url = new URL(canonicalOrigin), tenantUrl = new URL(tenant.canonicalOrigin);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash &&
      ['multichoicemotors.co.uk', 'www.multichoicemotors.co.uk'].includes(url.hostname) && tenantUrl.origin === url.origin && tenantUrl.pathname === '/' && !tenantUrl.search && !tenantUrl.hash && !tenantUrl.username && !tenantUrl.password;
  } catch { return false; }
}
