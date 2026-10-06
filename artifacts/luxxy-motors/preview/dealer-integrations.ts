// Local settings never contact Resend or Stripe; production imports only the API store.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { emailTemplateVariables, EmailTemplateError } from '@workspace/vehicle-meta';
import { DealerIntegrationsStore, IntegrationSettingsError } from '../../api-server/src/lib/dealer-integrations-store';
import { previewEmailTemplate } from '../../api-server/src/lib/email-template-preview';
export const previewIntegrationsStore = new DealerIntegrationsStore({ filename: fileURLToPath(new URL('../../../.local/dealer-integrations-private.json', import.meta.url)), production: false });
function local(req: IncomingMessage) { const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''), host = new URL(`http://${req.headers.host}`).hostname; const lanHost = process.env.LUXXY_PREVIEW_LAN_HOST, privateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/; return ((['127.0.0.1', '::1'].includes(remote) && ['127.0.0.1', 'localhost', '[::1]'].includes(host)) || Boolean(lanHost && privateIp.test(lanHost) && host === lanHost && (privateIp.test(remote) || remote === '127.0.0.1'))) && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`); }
async function body(req: IncomingMessage) { let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 64_000) throw new IntegrationSettingsError('This settings request is too large.', 413); } try { return JSON.parse(data); } catch { throw new IntegrationSettingsError('Invalid settings request.'); } }
function send(res: ServerResponse, status: number, value: object) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify({ ...value, preview: true })); }
export async function dealerIntegrationsPreview(req: IncomingMessage, res: ServerResponse, url: URL, privateStore: DealerIntegrationsStore = previewIntegrationsStore): Promise<boolean> {
  const integrationPath = /^\/api\/(dealer-integrations|email-templates)(?:\/|$)/.test(url.pathname);
  const paymentPath = ['/api/reservations/payment-readiness', '/api/reservations/checkout', '/api/reservations/payment-status', '/api/staff/stripe-reservations'].includes(url.pathname);
  if (!integrationPath && !paymentPath) return false;
  if (!local(req)) { send(res, 403, { error: 'Private settings are available only on the authorised local network.' }); return true; }
  try {
    if (req.method === 'GET' && url.pathname === '/api/reservations/payment-readiness') send(res, 200, { enabled: false, mode: null, prepared: true });
    else if (req.method === 'GET' && url.pathname === '/api/staff/stripe-reservations') send(res, 200, { reservations: [] });
    else if (url.pathname === '/api/reservations/checkout' || url.pathname === '/api/reservations/payment-status') send(res, 503, { error: 'Email and payment requests are disabled on this server.' });
    else if (req.method === 'GET' && url.pathname === '/api/dealer-integrations/sales-paperwork') send(res, 200, await privateStore.readSalesPaperwork());
    else if (req.method === 'PUT' && url.pathname === '/api/dealer-integrations/sales-paperwork') send(res, 200, await privateStore.updateSalesPaperwork(await body(req)));
    else if (req.method === 'GET' && url.pathname === '/api/dealer-integrations') send(res, 200, await privateStore.readMasked());
    else if (req.method === 'PUT' && url.pathname === '/api/dealer-integrations') send(res, 200, await privateStore.update(await body(req)));
    else if (req.method === 'POST' && url.pathname === '/api/dealer-integrations/validate') send(res, 200, (await privateStore.readMasked()).readiness);
    else if (req.method === 'GET' && url.pathname === '/api/email-templates') send(res, 200, { ...await privateStore.listTemplates(), variables: emailTemplateVariables });
    else if (req.method === 'PUT' && url.pathname === '/api/email-templates') send(res, 200, { ...await privateStore.updateTemplate(await body(req)), variables: emailTemplateVariables });
    else if (req.method === 'PUT' && url.pathname === '/api/email-templates/appearance') send(res, 200, { ...await privateStore.updateAppearance(await body(req)), variables: emailTemplateVariables });
    else if (req.method === 'POST' && /^\/api\/email-templates\/[^/]+\/preview$/.test(url.pathname)) send(res, 200, previewEmailTemplate(url.pathname.split('/')[3]!, await body(req), (await privateStore.listTemplates()).appearance));
    else send(res, 405, { error: 'This settings action is unavailable.' });
  } catch (error) { const known = error instanceof IntegrationSettingsError || error instanceof EmailTemplateError; send(res, known ? error.status : 500, { error: known ? error.message : 'Private settings could not be saved.' }); }
  return true;
}
