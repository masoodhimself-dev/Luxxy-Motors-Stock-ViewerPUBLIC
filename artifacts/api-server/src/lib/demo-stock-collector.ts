import { createHmac } from 'node:crypto';
import { z } from 'zod/v4';
import { platformStockUploadLimit } from './platform-stock-upload';
import { normaliseTenantHost } from './tenant-context';

const dealerPath = /^\/dealers\/(?:[a-z0-9-]+\/)*[a-z0-9-]+-(\d{1,24})\/?$/i;

export function autoTraderDealerLink(value: string) {
  try {
    const url = new URL(value);
    const match = dealerPath.exec(url.pathname);
    if (!match || url.protocol !== 'https:' || url.port || url.username || url.password ||
        !['autotrader.co.uk', 'www.autotrader.co.uk'].includes(url.hostname)) return null;
    return { sourceUrl: `https://www.autotrader.co.uk${url.pathname.replace(/\/$/, '')}`, retailerId: match[1] };
  } catch {
    return null;
  }
}

type DemoStockCollector = { url: URL; token: string };
type CallbackKey = { id: string; validUntil: number };
type GrokWebhook = DemoStockCollector & {
  mode: 'grok-webhook';
  callbackHost: string;
  retailerIds: ReadonlySet<string>;
} & ({ callbackAuth: 'proof'; callbackSigningKey: string } | { callbackAuth: 'demo-onboarding'; callbackKey?: CallbackKey });
type CallbackJob = { id: string; retailer_id: string; expires_at: Date };

export function demoStockCollectorConfig(): (DemoStockCollector & { mode: 'sync' }) | GrokWebhook | null {
  const token = process.env.DEMO_STOCK_COLLECTOR_TOKEN?.trim();
  try {
    const url = new URL(process.env.DEMO_STOCK_COLLECTOR_URL ?? '');
    if (!token || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    const mode = process.env.DEMO_STOCK_COLLECTOR_MODE?.trim() || 'sync';
    if (mode === 'sync') return { url, token, mode };
    if (mode !== 'grok-webhook') return null;
    const callbackAuth = process.env.DEMO_STOCK_CALLBACK_AUTH?.trim() || 'proof';
    const callbackHost = normaliseTenantHost(process.env.STOCK_IMPORT_API_HOST || process.env.PLATFORM_ADMIN_HOST || '');
    const configuredRetailers = process.env.DEMO_STOCK_COLLECTOR_RETAILER_IDS;
    const retailers = configuredRetailers === undefined
      ? [process.env.DEMO_STOCK_COLLECTOR_RETAILER_ID?.trim() ?? '']
      : configuredRetailers.split(',').map(id => id.trim());
    if (!callbackHost || retailers.some(id => !/^\d{1,24}$/.test(id))) return null;
    const retailerIds = new Set(retailers);
    if (callbackAuth === 'demo-onboarding') {
      const id = process.env.DEMO_STOCK_CALLBACK_KEY_ID?.trim() ?? '';
      const expiry = process.env.DEMO_STOCK_CALLBACK_KEY_VALID_UNTIL?.trim() ?? '';
      if (!id && !expiry) return { url, token, mode, callbackAuth, callbackHost, retailerIds };
      const validUntil = Date.parse(expiry);
      if (!z.uuid().safeParse(id).success || !z.iso.datetime({ offset: true }).safeParse(expiry).success ||
          !Number.isFinite(validUntil) || validUntil <= Date.now()) return null;
      return { url, token, mode, callbackAuth, callbackHost, retailerIds, callbackKey: { id: id.toLowerCase(), validUntil } };
    }
    if (callbackAuth !== 'proof') return null;
    const callbackSigningKey = (process.env.DEMO_STOCK_CALLBACK_SIGNING_KEY?.trim() ||
      process.env.SESSION_SECRET?.trim() || '');
    if (callbackSigningKey.length < 32 || callbackSigningKey === token ||
        callbackSigningKey === 'replace-with-a-long-random-secret') return null;
    return { url, token, mode, callbackAuth, callbackSigningKey, callbackHost, retailerIds };
  } catch {
    return null;
  }
}

export function demoStockCallbackProof(collector: Extract<GrokWebhook, { callbackAuth: 'proof' }>, job: CallbackJob) {
  const message = JSON.stringify([
    'dealeros/grok-demo-stock-callback/v1', collector.callbackHost, job.id, job.retailer_id, job.expires_at.toISOString(),
  ]);
  return createHmac('sha256', collector.callbackSigningKey).update(message).digest('base64url');
}

export class DemoStockCollectorError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function collectDemoStock(
  collector: DemoStockCollector,
  dealer: NonNullable<ReturnType<typeof autoTraderDealerLink>>,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(45_000);
  try {
    const response = await fetch(collector.url, {
      method: 'POST',
      redirect: 'error',
      signal: timeout,
      headers: {
        Authorization: `Bearer ${collector.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(dealer),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      if ([403, 404].includes(response.status)) {
        throw new DemoStockCollectorError(422, 'The stock connection could not access this retailer. Check the dealer link and stock access, or upload a complete JSON export.');
      }
      throw new DemoStockCollectorError(502, 'The stock connection could not collect this dealer’s cars. Try again or upload a complete JSON export.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let json = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > platformStockUploadLimit) {
          throw new DemoStockCollectorError(413, 'This stock export exceeds 5 MB. Ask the stock provider for a smaller complete export.');
        }
        json += decoder.decode(value, { stream: true });
      }
      return JSON.parse(json + decoder.decode()) as unknown;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof DemoStockCollectorError) throw error;
    if (timeout.aborted) {
      throw new DemoStockCollectorError(504, 'Collecting stock took too long. Try again or upload a complete JSON export.');
    }
    throw new DemoStockCollectorError(502, 'The stock connection did not return a usable export. Try again or upload a complete JSON export.');
  }
}

/** A missing acknowledgement is ambiguous. The routine may still deliver the callback. */
export async function requestGrokDemoStock(
  collector: GrokWebhook,
  job: CallbackJob & { source_url: string },
): Promise<boolean | null> {
  try {
    const response = await fetch(collector.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
      headers: {
        Authorization: `Bearer ${collector.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jobId: job.id,
        sourceUrl: job.source_url,
        retailerId: job.retailer_id,
        ...(collector.callbackAuth === 'proof' ? { callbackProof: demoStockCallbackProof(collector, job) } : {}),
      }),
    });
    await response.body?.cancel();
    if (response.status === 200) return true;
    return response.status < 500 ? false : null;
  } catch {
    return null;
  }
}
