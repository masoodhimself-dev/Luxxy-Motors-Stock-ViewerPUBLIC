import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { get } from 'node:https';
import { isPublicImageAddress } from './vehicle-brochure-images';

export function domainHttpsRedirectAllowed(hostname: string, companions: string[], value: string | undefined): boolean {
  try {
    const location = new URL(String(value));
    return location.protocol === 'https:' && !location.port && !location.username && !location.password && location.hostname !== hostname && companions.includes(location.hostname) && location.pathname === '/api/healthz' && !location.search && !location.hash;
  } catch { return false; }
}

/** No provider secrets, no redirects, pinned public DNS and normal TLS hostname verification. */
export async function domainHttpsReady(hostname: string, companions: string[] = []): Promise<boolean> {
  const signal = AbortSignal.timeout(10_000);
  try {
    const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
      const abort = () => reject(new Error('DNS check timed out.'));
      signal.addEventListener('abort', abort, { once: true });
      lookup(hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(a => !isPublicImageAddress(a.address))) return false;
    const address = addresses[0];
    return await new Promise<boolean>((resolve, reject) => {
      const request = get(`https://${hostname}/api/healthz`, {
        signal, family: address.family,
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        headers: { Accept: 'application/json', 'User-Agent': 'DealerPlatform-DomainCheck/1.0' },
      }, response => {
        if ([301, 308].includes(response.statusCode ?? 0)) {
          // Render's apex/www companion can redirect to the same dealer's canonical host.
          // The redirect is inspected, never followed; the canonical host is tested separately.
          const valid = domainHttpsRedirectAllowed(hostname, companions, response.headers.location);
          response.destroy(); resolve(valid); return;
        }
        if (response.statusCode !== 200) { response.destroy(); resolve(false); return; }
        let body = '';
        response.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(new Error('Unexpected health response.')); });
        response.on('error', reject);
        response.on('end', () => { try { resolve(JSON.parse(body).status === 'ok'); } catch { resolve(false); } });
      });
      request.on('error', reject);
    });
  } catch { return false; }
}
