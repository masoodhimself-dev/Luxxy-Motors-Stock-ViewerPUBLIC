// Opt-in local UI examples only: memory storage, no imports, database, payments or mail.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StockChangeCustomerOutcome, StockChangeSettings, StockChangeTask } from '../src/lib/stock-change-tasks';
import { readPreviewEnquiries } from './reservations';
import { previewStock } from './stock';

const reviewed = new Set<string>();
const outcomes = new Map<string, StockChangeCustomerOutcome>();
const contacted = new Map<string, string>();
let settings: StockChangeSettings = { minimumReduction: 100, contactIntervalDays: 7, revision: 0 };
const createdAt = new Date().toISOString();
const key = (taskId: string, enquiryId: string) => `${taskId}:${enquiryId}`;
const lastKey = (vehicleId: string, enquiryId: string) => `${vehicleId}:${enquiryId}`;
type Options = { readEnquiries?: typeof readPreviewEnquiries; enabled?: boolean };
async function allTasks(options: Options = {}): Promise<StockChangeTask[]> {
  if (!(options.enabled ?? process.env.STOCK_CHANGES_PREVIEW === 'true')) return [];
  const entries = (await (options.readEnquiries ?? readPreviewEnquiries)()).filter(entry => entry.vehicleId && (entry.email || entry.phone) && entry.status !== 'closed' && !entry.mergedIntoId);
  const vehicleIds = [...new Set(entries.map(entry => entry.vehicleId))].slice(0, 2);
  return vehicleIds.flatMap((vehicleId, index) => {
    const car = previewStock.cars.find(car => car.id === vehicleId);
    if (!car?.price) return [];
    const kind = index === 0 ? 'price_drop' : 'missing_stock';
    const id = `00000000-0000-4000-8000-00000000f00${index + 1}`;
    const reduction = kind === 'price_drop' ? 500 : null;
    return [{ id, kind, status: reviewed.has(id) ? 'reviewed' : 'open', revision: reviewed.has(id) ? 1 : 0,
      createdAt, updatedAt: createdAt, vehicleId: car.id, vehicleTitle: `${car.make} ${car.model} (local example)`, registration: car.plate ?? null,
      imageUrl: car.heroImage ?? car.images[0]?.url ?? null, previousPrice: kind === 'price_drop' ? car.price + 500 : null,
      currentPrice: car.price, reduction, missingCount: kind === 'missing_stock' ? 1 : 0,
      lastSeenAt: createdAt, publiclyVisible: true, availableForPriceUpdate: true, urgency: kind === 'missing_stock' ? 'urgent' : 'normal',
      affectedCustomers: entries.filter(entry => entry.vehicleId === vehicleId).map(entry => {
        const lastContactedAt = contacted.get(lastKey(car.id, entry.id)) ?? null;
        const nextContactAt = lastContactedAt ? new Date(Date.parse(lastContactedAt) + settings.contactIntervalDays * 86400000).toISOString() : null;
        const below = kind === 'price_drop' && (reduction ?? 0) < settings.minimumReduction;
        const recent = kind === 'price_drop' && Boolean(nextContactAt && Date.parse(nextContactAt) > Date.now());
        return { enquiryId: entry.id, customerName: entry.customerName, email: entry.email, phone: entry.phone,
          preferredContact: entry.preferredContact ?? null, appointmentAt: entry.appointmentAt ?? null,
          appointmentStatus: entry.appointmentStatus ?? null,
          outcome: outcomes.get(key(id, entry.id)) ?? { status: 'pending', revision: 0, channel: null, followUpAt: null, note: null, updatedAt: null },
          outreach: { suggested: !below && !recent, reason: below ? 'below_minimum_reduction' : recent ? 'recently_contacted' : null, lastContactedAt, nextContactAt },
        };
      }),
      upcomingAppointments: kind === 'missing_stock' ? 1 : 0, paidReservations: 0, priceDropSettings: { ...settings } } satisfies StockChangeTask];
  });
}
export async function readPreviewStockChangeTask(id: string, options: Options = {}) {
  return (await allTasks(options)).find(task => task.id === id) ?? null;
}
export async function recordPreviewStockChangeContact(taskId: string, enquiryId: string, channel: 'email' | 'whatsapp' | 'call') {
  const task = await readPreviewStockChangeTask(taskId);
  if (!task || !task.affectedCustomers.some(customer => customer.enquiryId === enquiryId)) return false;
  const previous = outcomes.get(key(taskId, enquiryId));
  const now = new Date().toISOString();
  outcomes.set(key(taskId, enquiryId), { status: 'contacted', revision: (previous?.revision ?? 0) + 1, channel, followUpAt: null, note: null, updatedAt: now });
  contacted.set(lastKey(task.vehicleId, enquiryId), now);
  return true;
}
export async function stockChangesPreview(req: IncomingMessage, res: ServerResponse, url: URL, options: Options = {}) {
  const match = /^\/api\/staff\/stock-change-tasks(?:\/([^/]+)(?:\/customers\/([^/]+))?)?$/.exec(url.pathname);
  const preferences = url.pathname === '/api/staff/stock-change-settings';
  if (!match && !preferences) return false;
  const send = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); return true; };
  const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!['127.0.0.1', '::1'].includes(remote) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '') ||
    (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) return send(403, { error: 'Stock-change preview is loopback-only.' });
  async function input() {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) throw new Error('Request too large.'); }
    return JSON.parse(raw) as Record<string, unknown>;
  }
  if (preferences) {
    if (req.method === 'GET') return send(200, settings);
    if (req.method !== 'PUT') return send(405, { error: 'Method not allowed.' });
    let body: Record<string, unknown>;
    try { body = await input(); } catch { return send(400, { error: 'Check the request.' }); }
    if (!Number.isInteger(body.minimumReduction) || Number(body.minimumReduction) < 0 || Number(body.minimumReduction) > 1000000 || !Number.isInteger(body.contactIntervalDays) || Number(body.contactIntervalDays) < 0 || Number(body.contactIntervalDays) > 365 || !Number.isSafeInteger(body.revision)) return send(400, { error: 'Check the price update preferences.' });
    if (body.revision !== settings.revision) return send(409, { error: 'These preferences changed. Reload before saving.' });
    settings = { minimumReduction: Number(body.minimumReduction), contactIntervalDays: Number(body.contactIntervalDays), revision: settings.revision + 1 };
    return send(200, settings);
  }
  const tasks = await allTasks(options);
  if (!match?.[1]) {
    const shown = tasks.filter(task => task.status === 'open' && (task.kind !== 'price_drop' || (task.reduction ?? 0) >= settings.minimumReduction || task.upcomingAppointments || task.paidReservations || task.affectedCustomers.some(customer => customer.outcome?.status === 'follow_up')));
    return req.method === 'GET' ? send(200, { tasks: shown, total: shown.length, generatedAt: new Date().toISOString(), preview: true }) : send(405, { error: 'Method not allowed.' });
  }
  const task = tasks.find(task => task.id === match[1]);
  if (!task) return send(404, { error: 'Local example not found.' });
  if (req.method === 'GET' && !match[2]) return send(200, task);
  if (req.method !== 'PATCH') return send(405, { error: 'Method not allowed.' });
  let body: Record<string, unknown>;
  try { body = await input(); } catch { return send(400, { error: 'Check the request.' }); }
  if (body.expectedRevision !== task.revision || task.status !== 'open') return send(409, { error: 'This task changed. Reload the latest details.' });
  if (match[2]) {
    const customer = task.affectedCustomers.find(customer => customer.enquiryId === match[2]);
    if (!customer) return send(404, { error: 'Customer not found.' });
    if (body.expectedCustomerRevision !== customer.outcome?.revision) return send(409, { error: 'This customer outcome changed. Reload before saving.' });
    if (!['contacted', 'not_needed', 'follow_up'].includes(String(body.action)) || (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 2000))) return send(400, { error: 'Check the customer outcome.' });
    if (body.action === 'contacted' && !['call', 'email', 'whatsapp'].includes(String(body.channel))) return send(400, { error: 'Choose the contact channel.' });
    if (body.action === 'follow_up' && (typeof body.followUpAt !== 'string' || !Number.isFinite(Date.parse(body.followUpAt)) || Date.parse(body.followUpAt) <= Date.now())) return send(400, { error: 'Choose a future follow-up.' });
    const now = new Date().toISOString();
    outcomes.set(key(task.id, customer.enquiryId), { status: body.action as StockChangeCustomerOutcome['status'], revision: (customer.outcome?.revision ?? 0) + 1, channel: body.action === 'contacted' ? body.channel as 'call' | 'email' | 'whatsapp' : null, followUpAt: body.action === 'follow_up' ? String(body.followUpAt) : null, note: typeof body.note === 'string' ? body.note.trim() || null : null, updatedAt: now });
    if (body.action === 'contacted') contacted.set(lastKey(task.vehicleId, customer.enquiryId), now);
    return send(200, await readPreviewStockChangeTask(task.id, options));
  }
  if (body.action !== 'reviewed' || !Number.isSafeInteger(body.expectedRevision)) return send(400, { error: 'Check the review details.' });
  if (task.kind === 'price_drop' && task.affectedCustomers.some(customer => ['pending', 'follow_up'].includes(customer.outcome?.status ?? 'pending'))) return send(409, { error: 'Record each customer outcome before marking reviewed.' });
  reviewed.add(task.id);
  return send(200, { ...task, status: 'reviewed', revision: task.revision + 1 });
}
