// Staff history for the authorised local preview. Never imported by the production server.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildDealerRelationships, vehicleRegistrationLabel, type DealerRelationships } from '../../../lib/vehicle-meta/src/index.ts';
import { readPreviewBookingState } from './reservations.ts';
import { previewStore } from './sales.ts';
import { readPreviewPriceOverrides, readPreviewStaffDirectory } from './operations.ts';
import { previewStock } from './stock.ts';
import { readPreviewChatRecords } from './chat.ts';

export async function readPreviewRelationships(): Promise<DealerRelationships> {
  const [booking, sales, prices, chats] = await Promise.all([readPreviewBookingState(), previewStore.list(), readPreviewPriceOverrides(), readPreviewChatRecords()]);
  return buildDealerRelationships({
    vehicles: previewStock.cars.map(car => ({ id: car.id, title: car.title,
      registration: vehicleRegistrationLabel(car), pricePence: typeof (prices[car.id] ?? car.price) === 'number' ? Math.round((prices[car.id] ?? car.price)! * 100) : null,
      imageUrl: car.heroImage ?? car.images?.[0]?.url ?? null,
      status: car.inventoryStatus === 'sold' ? 'sold' : booking.reservations.some(r => r.vehicleId === car.id && r.status === 'reserved') ? 'reserved' : car.sourceStatus === 'missing' ? 'missing' : car.inventoryStatus ?? 'available' })),
    enquiries: booking.enquiries ?? [],
    enquiryEvents: (booking.enquiries ?? []).flatMap(e => (e.events ?? []).map(event => ({ ...event, enquiryId: e.id }))),
    reservations: booking.reservations,
    sales,
    chats: chats.map(({ conversation: chat, messages }) => ({ id: chat.id, reference: chat.reference, enquiryId: chat.enquiryId, status: chat.status,
      vehicleId: chat.vehicle?.id, vehicleTitle: chat.vehicle?.title, vehicleRegistration: chat.vehicle?.registration,
      createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages })),
  });
}

function authorisedLocalRequest(req: IncomingMessage): boolean {
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  let host: string;
  try { host = new URL(`http://${req.headers.host}`).hostname; } catch { return false; }
  const loopback = ['127.0.0.1', '::1'].includes(remote) && ['127.0.0.1', 'localhost', '[::1]'].includes(host);
  const lanHost = process.env.LUXXY_PREVIEW_LAN_HOST;
  const privateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
  const lan = Boolean(lanHost && privateIpv4.test(lanHost) && host === lanHost && (privateIpv4.test(remote) || remote === '127.0.0.1'));
  return (loopback || lan) && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`);
}
function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data));
}
export async function relationshipsPreview(req: IncomingMessage, res: ServerResponse, url: URL, read = readPreviewRelationships, readStaff = readPreviewStaffDirectory): Promise<boolean> {
  if (url.pathname !== '/api/staff/relationships') return false;
  if (!authorisedLocalRequest(req)) { send(res, 403, { error: 'This service is available only on the authorised network.' }); return true; }
  try {
    const staffId = typeof req.headers['x-preview-staff-id'] === 'string' ? req.headers['x-preview-staff-id'] : 'preview-alex';
    if (!(await readStaff()).some(member => member.id === staffId)) { send(res, 401, { error: 'Sign in with an active staff account to use the dealer portal.' }); return true; }
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); send(res, 405, { error: 'Customer and vehicle history is read-only.' }); return true; }
    send(res, 200, await read());
  }
  catch { send(res, 500, { error: 'Customer and vehicle history could not be loaded. Please try again.' }); }
  return true;
}
