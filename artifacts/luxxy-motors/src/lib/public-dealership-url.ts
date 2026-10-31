/** The shell supplies a tenant-verified canonical origin. Never copy query,
 * capability or authentication values into links intended for customers. */
const CANONICAL_SELECTOR = 'meta[name="luxxy-canonical-origin"][data-page-meta]';

function configuredOrigin(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && url.pathname === '/' && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

function isPublicDealershipOrigin(url: URL) {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return url.protocol === 'https:' && !url.port && !url.username && !url.password
    && host.includes('.') && !host.includes(':') && !/^\d+(?:\.\d+){3}$/.test(host)
    && !/(^|\.)(?:localhost|local|lan|internal|test|invalid|example|home|home\.arpa)$/.test(host)
    && !/(^|\.)(?:onrender\.com|replit\.app|replit\.dev|replit\.com|repl\.co|github\.dev|gitpod\.io|gitpod\.dev|vercel\.app|netlify\.app|pages\.dev|nip\.io|sslip\.io|localtest\.me)$/.test(host);
}

const isDemoOrigin = (url: URL) => /(^|\.)demo\./i.test(url.hostname);

/** New public links use the dealership's canonical domain, even when staff
 * open an old demo alias. A live domain also repairs a stale demo/preview shell.
 * Local previews retain their configured public target rather than a LAN URL. */
export function publicDealershipOrigin(doc: Pick<Document, 'querySelector' | 'location'> = document): string {
  const configured = configuredOrigin(doc.querySelector<HTMLMetaElement>(CANONICAL_SELECTOR)?.content);
  const current = new URL(doc.location.origin);
  if (configured) {
    if (isPublicDealershipOrigin(current) && !isDemoOrigin(current)
      && (isDemoOrigin(configured) || !isPublicDealershipOrigin(configured))) return current.origin;
    return configured.origin;
  }
  return current.origin;
}
