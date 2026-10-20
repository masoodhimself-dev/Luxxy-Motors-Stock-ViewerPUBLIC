// Local UI examples only: memory storage, no imports, database, payments or mail.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StockChangeTask } from '../src/lib/stock-change-tasks';
import { readPreviewEnquiries } from './reservations';
import { previewStock } from './stock';

const reviewed = new Set<string>();
const createdAt = new Date().toISOString();
export async function stockChangesPreview(req: IncomingMessage, res: ServerResponse, url: URL) {
  const match = /^\/api\/staff\/stock-change-tasks(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match) return false;
  const send = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); return true; };
  const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!['127.0.0.1', '::1'].includes(remote) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '') ||
    (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) return send(403, { error: 'Stock-change preview is loopback-only.' });
  const tasks: StockChangeTask[] = [];
  if (process.env.STOCK_CHANGES_PREVIEW === 'true') {
    const entries = (await readPreviewEnquiries()).filter(entry => entry.vehicleId && entry.email && entry.status !== 'closed' && !entry.mergedIntoId);
    for (const [index, entry] of entries.slice(0, 2).entries()) {
      const car = previewStock.cars.find(car => car.id === entry.vehicleId);
      if (!car || !car.price) continue;
      const kind = index === 0 ? 'price_drop' : 'missing_stock';
      const id = `local-example-${kind}`;
      tasks.push({ id, kind, status: reviewed.has(id) ? 'reviewed' : 'open', revision: reviewed.has(id) ? 1 : 0,
        createdAt, updatedAt: createdAt, vehicleId: car.id, vehicleTitle: `${car.make} ${car.model} (local example)`, registration: car.plate ?? null,
        imageUrl: car.heroImage ?? car.images[0]?.url ?? null, previousPrice: kind === 'price_drop' ? car.price + 500 : null,
        currentPrice: car.price, reduction: kind === 'price_drop' ? 500 : null, missingCount: kind === 'missing_stock' ? 1 : 0,
        lastSeenAt: createdAt, publiclyVisible: true, urgency: kind === 'missing_stock' ? 'urgent' : 'normal',
        affectedCustomers: [{ enquiryId: entry.id, customerName: entry.customerName, email: entry.email,
          phone: entry.phone, preferredContact: entry.preferredContact ?? null, appointmentAt: entry.appointmentAt ?? null,
          appointmentStatus: entry.appointmentStatus ?? null }],
        upcomingAppointments: kind === 'missing_stock' ? 1 : 0, paidReservations: 0 });
    }
  }
  if (!match[1]) return req.method === 'GET' ? send(200, { tasks: tasks.filter(task => task.status === 'open'), total: tasks.filter(task => task.status === 'open').length, generatedAt: new Date().toISOString(), preview: true }) : send(405, { error: 'Method not allowed.' });
  const task = tasks.find(task => task.id === match[1]);
  if (!task) return send(404, { error: 'Local example not found.' });
  if (req.method === 'GET') return send(200, task);
  if (req.method !== 'PATCH') return send(405, { error: 'Method not allowed.' });
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) return send(413, { error: 'Request too large.' }); }
  let input: { expectedRevision?: unknown; action?: unknown };
  try { input = JSON.parse(raw); } catch { return send(400, { error: 'Check the request.' }); }
  if (input.action !== 'reviewed' || !Number.isSafeInteger(input.expectedRevision)) return send(400, { error: 'Check the review details.' });
  if (input.expectedRevision !== task.revision || task.status !== 'open') return send(409, { error: 'This task changed. Reload the latest details.' });
  reviewed.add(task.id);
  return send(200, { ...task, status: 'reviewed', revision: task.revision + 1 });
}
