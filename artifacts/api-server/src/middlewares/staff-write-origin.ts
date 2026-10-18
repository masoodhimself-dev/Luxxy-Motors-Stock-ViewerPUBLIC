import type { Request, Response } from 'express';
import { currentTenant, multiTenantEnabled } from '../lib/tenant-context';
import { siteOrigin } from '../lib/enquiry-links';

type OriginRequest = Pick<Request, 'method'> & { get: (name: string) => string | undefined };
const safeMethod = (method: string) => ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

/** Browser writes must originate on this verified dealership, not a neighbouring tenant. */
export function staffWriteOriginAllowed(req: OriginRequest): boolean {
  if (safeMethod(req.method)) return true;
  const origin = req.get('origin');
  if (origin === undefined) {
    // Preserve approved non-browser callers without weakening browser metadata.
    // Browsers label a sibling dealer's request same-site rather than same-origin.
    const site = req.get('sec-fetch-site')?.toLowerCase();
    return site === undefined || site === 'same-origin' || site === 'none';
  }
  if (!/^https?:\/\/[^\s/?#]+$/i.test(origin)) return false;
  try {
    const source = new URL(origin), tenant = currentTenant();
    if (source.username || source.password || source.pathname !== '/' || source.search || source.hash) return false;
    // Multi-tenant staff routes must already have passed verified host resolution.
    if (multiTenantEnabled() && (!tenant || tenant.kind === 'import')) return false;
    const canonical = new URL(siteOrigin());
    if (source.origin === canonical.origin) return true;
    const host = req.get('host') || '';
    if (!host || /[\s,/@\\?#]/.test(host)) return false;
    const requested = new URL(`${canonical.protocol}//${host}`);
    return (tenant?.kind === 'website' || !multiTenantEnabled()) && source.origin === requested.origin;
  } catch { return false; }
}

export function enforceStaffWriteOrigin(req: Request, res: Response): boolean {
  // Express overloads get('set-cookie'); this guard only reads ordinary headers.
  if (staffWriteOriginAllowed({ method: req.method, get: name => req.get(name) })) return true;
  res.set('Cache-Control', 'no-store').status(403).json({ error: 'Open this action on your dealership website.', code: 'STAFF_ORIGIN_MISMATCH' });
  return false;
}
