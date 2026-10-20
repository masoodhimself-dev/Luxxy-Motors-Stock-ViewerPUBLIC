// Local-only examples. No customer, booking, sale, payment or provider is changed.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SoldVehicleFollowUpReview } from '../src/lib/sold-vehicle-follow-ups';
import { readPreviewEnquiries } from './reservations';
import { previewStock } from './stock';
import { previewStore } from './sales';

let example: SoldVehicleFollowUpReview | undefined;
const exampleId = '00000000-0000-4000-8000-000000000996';
async function fixture() {
  if (example) return example;
  const entries = (await readPreviewEnquiries()).filter(entry => entry.vehicleId && entry.email && !entry.mergedIntoId);
  const entry = entries[0], car = previewStock.cars.find(car => car.id === entry?.vehicleId);
  if (!entry || !car) return null;
  const now = new Date().toISOString(), at = new Date(Date.now() + 3_600_000).toISOString();
  example = { saleId: exampleId, vehicleId: car.id, vehicleTitle: `${car.make} ${car.model} (local example)`,
    registration: car.plate ?? null, imageUrl: car.heroImage ?? null, sold: true, createdAt: now,
    remaining: 1, upcomingAppointments: 1, customers: [{ enquiryId: entry.id, relatedEnquiryIds: [entry.id],
      customerName: `${entry.customerName} (local example)`, email: entry.email, phone: entry.phone ?? null,
      preferredContact: entry.preferredContact ?? null, kind: 'appointment', appointmentAt: at, appointmentRevision: 0,
      appointmentCancelledAt: null, appointments: [{ enquiryId: entry.id, at, revision: 0, cancelledAt: null }], status: 'pending',
      revision: 0, cancelledByReview: false, contactedAt: null, outcome: null, emailStatus: null, urgent: true,
      emailRequestId: '00000000-0000-4000-8000-000000000995' }] };
  return example;
}
export async function soldVehicleFollowUpsPreview(req: IncomingMessage, res: ServerResponse, url: URL) {
  const match = /^\/api\/staff\/sold-vehicle-follow-ups(?:\/([^/]+)(?:\/customers\/([^/]+))?)?$/.exec(url.pathname);
  if (!match) return false;
  const send = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); return true; };
  const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!['127.0.0.1', '::1'].includes(remote) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '') || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`))
    return send(403, { error: 'Customer follow-up preview is loopback-only.' });
  const local = process.env.SOLD_FOLLOW_UP_PREVIEW === 'true' ? await fixture() : null;
  if (!match[1]) return req.method === 'GET'
    ? send(200, { tasks: local?.remaining ? [local] : [], total: local?.remaining ? 1 : 0, generatedAt: new Date().toISOString(), preview: true })
    : send(405, { error: 'Method not allowed.' });
  if (match[1] !== exampleId || !local) {
    if (req.method !== 'GET' || match[2]) return send(403, { error: 'Local preview does not change real customer follow-ups.' });
    try {
      const sale = await previewStore.get(match[1]);
      return send(200, { saleId: sale.id, vehicleId: sale.draft.vehicleId, vehicleTitle: sale.draft.vehicle, registration: sale.draft.registration || null,
        imageUrl: sale.vehicleSnapshot?.imageUrl ?? null, sold: sale.lifecycle?.status === 'sold', createdAt: null, customers: [], remaining: 0, upcomingAppointments: 0, preview: true });
    } catch { return send(404, { error: 'Local sale not found.' }); }
  }
  if (req.method === 'GET' && !match[2]) return send(200, local);
  if (req.method !== 'POST' || !match[2]) return send(405, { error: 'Method not allowed.' });
  const customer = local.customers.find(item => item.enquiryId === match[2]);
  if (!customer) return send(404, { error: 'Local example customer not found.' });
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) return send(413, { error: 'Request too large.' }); }
  let body: { action?: string; expectedRevision?: number; outcome?: string };
  try { body = JSON.parse(raw); } catch { return send(400, { error: 'Check the request.' }); }
  if (body.expectedRevision !== customer.revision) return send(409, { error: 'Refresh the local example.' });
  if (body.action === 'cancel_appointment' && !customer.cancelledByReview) {
    customer.cancelledByReview = true; customer.appointmentCancelledAt = new Date().toISOString(); customer.appointmentRevision += 1;
    customer.appointments?.forEach(item => { item.cancelledAt = customer.appointmentCancelledAt; item.revision += 1; }); local.upcomingAppointments = 0;
  } else if (body.action === 'complete' && body.outcome === 'phone' && customer.cancelledByReview) {
    customer.status = 'contacted'; customer.outcome = 'phone'; customer.contactedAt = new Date().toISOString(); local.remaining = 0;
  } else return send(409, { error: 'Local preview cannot verify email delivery. No real email or booking has been changed.' });
  customer.revision += 1;
  return send(200, local);
}
