import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hasStockAlertCriteria, normaliseStockAlertCriteria, stockAlertCriteriaLabel } from '@workspace/vehicle-meta/stock-filters';

type PreviewAlert = {
  id: string;
  buyer: string;
  criteria: string;
  state: 'pending' | 'active' | 'expired' | 'stopped';
  requestedAt: string;
  confirmedAt: string | null;
  expiresAt: string | null;
  confirmToken: string;
  stopToken: string;
  renewToken: string;
};

const token = () => randomBytes(24).toString('base64url');
const day = 24 * 60 * 60_000;
const alerts: PreviewAlert[] = [
  { criteria: 'Toyota · Automatic · Up to £8,000', state: 'active', daysAgo: 3 },
  { criteria: 'Honda Civic · Petrol · Up to £12,000', state: 'active', daysAgo: 8 },
  { criteria: 'Nissan Leaf · Electric · Up to £6,000', state: 'pending', daysAgo: 0 },
  { criteria: 'Volkswagen Golf · Manual · Up to £7,500', state: 'expired', daysAgo: 65 },
  { criteria: 'Lexus · Hybrid · Up to £10,000', state: 'stopped', daysAgo: 14 },
].map(({ criteria, state, daysAgo }, index) => {
  const requested = Date.now() - daysAgo * day;
  return {
    id: randomUUID(), buyer: `sample-${index}`, criteria, state: state as PreviewAlert['state'],
    requestedAt: new Date(requested).toISOString(),
    confirmedAt: state === 'pending' ? null : new Date(requested).toISOString(),
    expiresAt: state === 'pending' ? null : new Date(requested + 60 * day).toISOString(),
    confirmToken: token(), stopToken: token(), renewToken: token(),
  };
});
let enabled = true;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 12_000) throw new Error('Request too large');
  }
  const body = JSON.parse(text || '{}');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected object');
  return body;
}

/** Opt-in local demonstration. No provider, persistent storage or customer emails. */
export async function stockAlertsPreview(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!/^\/api\/(?:staff\/)?stock-alerts(?:\/|$)/.test(url.pathname)) return false;
  const send = (status: number, value: object) => {
    res.statusCode = status;
    res.end(JSON.stringify(value));
    return true;
  };
  if (process.env.STOCK_ALERTS_PREVIEW !== 'true') {
    return url.pathname === '/api/stock-alerts/status' && req.method === 'GET'
      ? send(200, { enabled: false })
      : false;
  }

  const remote = req.socket.remoteAddress?.replace(/^::ffff:/, '');
  const host = req.headers.host ?? '';
  if (!['127.0.0.1', '::1'].includes(remote ?? '') ||
    !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) ||
    (req.headers.origin && req.headers.origin !== `http://${host}`)) {
    return send(403, { error: 'The stock alert preview is available only on this computer.' });
  }

  if (url.pathname === '/api/stock-alerts/status' && req.method === 'GET') {
    return send(200, { enabled, preview: true });
  }
  if (url.pathname === '/api/staff/stock-alerts' && req.method === 'GET') {
    const counts = new Map<string, number>();
    const active = alerts.filter(alert => alert.state === 'active');
    for (const alert of active) counts.set(alert.criteria, (counts.get(alert.criteria) ?? 0) + 1);
    const searches = [...counts].map(([label, buyers]) => ({ label, buyers })).sort((a, b) => b.buyers - a.buyers);
    return send(200, { enabled, emailReady: true, preview: true, totalBuyers: active.length, searches });
  }
  if (url.pathname === '/api/staff/stock-alerts/requests' && req.method === 'GET') {
    const status = url.searchParams.get('status') ?? 'active';
    const page = Number(url.searchParams.get('page') ?? '1');
    if (!['all', 'active', 'pending', 'expired', 'stopped'].includes(status) || !Number.isInteger(page) || page < 1 || page > 1000) {
      return send(400, { error: 'Choose a valid status and page.' });
    }
    const matching = alerts.filter(alert => status === 'all' || status === alert.state)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id));
    const items = matching.slice((page - 1) * 25, page * 25).map(({ id, criteria, state, requestedAt, confirmedAt, expiresAt }) => ({
      id, label: criteria, status: state, requestedAt, confirmedAt, expiresAt,
    }));
    return send(200, { items, page, hasMore: matching.length > page * 25 });
  }

  try {
    if (url.pathname === '/api/staff/stock-alerts/settings' && req.method === 'PUT') {
      const input = await readBody(req);
      if (typeof input.enabled !== 'boolean') return send(400, { error: 'Choose whether to accept stock alert requests.' });
      enabled = input.enabled;
      return send(200, { enabled });
    }
    if (url.pathname === '/api/stock-alerts' && req.method === 'POST') {
      if (!enabled) return send(503, { error: 'Stock alerts are paused.' });
      const input = await readBody(req);
      if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || !input.filters || typeof input.filters !== 'object' || Array.isArray(input.filters)) {
        return send(400, { error: 'Enter an email address and choose your search filters.' });
      }
      if (alerts.length >= 100) return send(429, { error: 'Restart the preview to clear the sample alerts.' });
      const filters = normaliseStockAlertCriteria(input.filters);
      if (!hasStockAlertCriteria(filters)) return send(400, { error: 'Choose your search filters.' });
      const alert: PreviewAlert = {
        id: randomUUID(),
        buyer: createHash('sha256').update(input.email.trim().toLowerCase()).digest('hex'),
        criteria: stockAlertCriteriaLabel(filters, false),
        state: 'pending',
        requestedAt: new Date().toISOString(),
        confirmedAt: null,
        expiresAt: null,
        confirmToken: token(),
        stopToken: token(),
        renewToken: token(),
      };
      alerts.push(alert);
      return send(202, { preview: true, confirmToken: alert.confirmToken });
    }

    const action = /^\/api\/stock-alerts\/(confirm|stop|renew)$/.exec(url.pathname)?.[1];
    if (action && req.method === 'POST') {
      const input = await readBody(req);
      const key = `${action}Token` as 'confirmToken' | 'stopToken' | 'renewToken';
      const alert = alerts.find(candidate => candidate[key] === input.token);
      if (!alert || (action !== 'confirm' && alert.state === 'pending') || (action !== 'stop' && alert.state === 'stopped')) {
        return send(410, { error: 'This sample link is invalid or has expired.' });
      }
      if (action !== 'stop' && !enabled) return send(503, { error: 'Stock alerts are paused.' });
      if (action === 'confirm') {
        for (const other of alerts) {
          if (other !== alert && other.buyer === alert.buyer && other.state === 'active') other.state = 'stopped';
        }
        alert.state = 'active';
        alert.confirmedAt = new Date().toISOString();
        alert.expiresAt = new Date(Date.now() + 60 * day).toISOString();
      } else if (action === 'stop') {
        alert.state = 'stopped';
      } else {
        alert.state = 'active';
        alert.expiresAt = new Date(Date.now() + 60 * day).toISOString();
      }
      return send(200, { preview: true, stopToken: alert.stopToken, renewToken: alert.renewToken });
    }
  } catch {
    return send(400, { error: 'Check the sample stock alert request.' });
  }
  return send(405, { error: 'This action is unavailable in the stock alert preview.' });
}
