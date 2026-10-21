import { createHmac } from 'node:crypto';
import { canonicalSeoOrigin, dealerSitemapUrls, type DealerSitemapData } from './seo-crawl';
import type { SeoDealerScope } from '../routes/seo';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_MAX_URLS = 500;
type Environment = { INDEXNOW_ENABLED?: string; INDEXNOW_SECRET?: string };
export type IndexNowConfiguration = { host: string; key: string; keyLocation: string; endpoint: string };

function serverSecret(environment: Environment): Buffer | null {
  const raw = environment.INDEXNOW_SECRET?.trim();
  if (!raw) return null;
  const bytes = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex')
    : /^[A-Za-z0-9+/]{43}=$/.test(raw) ? Buffer.from(raw, 'base64') : null;
  return bytes?.length === 32 ? bytes : null;
}

/** Never use an integration/email key as an implicit IndexNow secret. */
export function indexNowConfiguration(scope: SeoDealerScope | null, environment: Environment = process.env): IndexNowConfiguration | null {
  if (environment.INDEXNOW_ENABLED !== 'true' || !scope || scope.demo) return null;
  const secret = serverSecret(environment); if (!secret) return null;
  const origin = canonicalSeoOrigin(scope.origin);
  // Bind the public verification key to both dealer and canonical origin. Knowing
  // one public key cannot derive another dealer's key or reveal the server secret.
  const key = createHmac('sha256', secret).update(JSON.stringify(['indexnow-v1', scope.dealerId, origin])).digest('hex');
  return { endpoint: INDEXNOW_ENDPOINT, host: new URL(origin).hostname, key, keyLocation: `${origin}/${key}.txt` };
}

export function indexNowReadiness(scope: SeoDealerScope | null, environment: Environment = process.env) {
  const configured = Boolean(serverSecret(environment));
  const enabled = environment.INDEXNOW_ENABLED === 'true';
  const configuration = indexNowConfiguration(scope, environment);
  return {
    status: !scope ? 'unavailable' as const : scope.demo ? 'demo_excluded' as const : !enabled ? 'disabled' as const : !configured ? 'not_configured' as const : 'ready' as const,
    enabled: Boolean(configuration), configured, manualOnly: true,
    automaticStockNotifications: false, deletionNotifications: false,
    keyFileUrl: configuration?.keyLocation ?? null,
    maximumUrlsPerSubmission: INDEXNOW_MAX_URLS,
  };
}

export class IndexNowError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export type IndexNowTransport = (url: string, init: RequestInit) => Promise<{ status: number }>;

/** Explicit owner action only. No imports, background jobs or automatic deletions call this. */
export async function submitIndexNow(
  configuration: IndexNowConfiguration,
  scope: SeoDealerScope,
  data: DealerSitemapData,
  transport: IndexNowTransport = fetch,
  timeoutMs = 5000,
) {
  if (scope.demo) throw new IndexNowError('Search notifications are unavailable for demonstrations.', 403, 'DEMO_EXCLUDED');
  const origin = canonicalSeoOrigin(scope.origin);
  // Defend the outbound destination even if a future caller supplies configuration.
  if (configuration.endpoint !== INDEXNOW_ENDPOINT || configuration.host !== new URL(origin).hostname
    || !/^[a-f0-9]{64}$/.test(configuration.key) || configuration.keyLocation !== `${origin}/${configuration.key}.txt`) {
    throw new IndexNowError('Search notification configuration is invalid.', 503, 'INDEXNOW_CONFIGURATION');
  }
  const urlList = dealerSitemapUrls(origin, data);
  if (urlList.length > INDEXNOW_MAX_URLS) throw new IndexNowError(`This manual submission supports up to ${INDEXNOW_MAX_URLS} public pages. Use the sitemap for larger websites.`, 409, 'INDEXNOW_URL_LIMIT');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new IndexNowError('Search notification timed out. Check again later.', 504, 'INDEXNOW_TIMEOUT')); }, Math.min(5000, Math.max(1, timeoutMs)));
    });
    const response = await Promise.race([
      transport(INDEXNOW_ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: configuration.host, key: configuration.key, keyLocation: configuration.keyLocation, urlList }),
      }), timeout,
    ]);
    if (response.status !== 200 && response.status !== 202) {
      throw new IndexNowError('The search engine did not accept this notification. Check configuration and try again later.', 502, 'INDEXNOW_REJECTED');
    }
    return {
      status: response.status === 202 ? 'verification_pending' as const : 'accepted' as const,
      submittedCount: urlList.length, manualOnly: true, indexed: 'unconfirmed' as const,
      message: response.status === 202 ? 'Notification received; the search engine is checking the verification key. Indexing is not confirmed.' : 'Notification accepted. Search engines decide whether and when to crawl or index these pages.',
    };
  } catch (error) {
    if (error instanceof IndexNowError) throw error;
    throw new IndexNowError('Search notification could not be delivered. Try again later.', 502, 'INDEXNOW_UNAVAILABLE');
  } finally { if (timer) clearTimeout(timer); }
}
