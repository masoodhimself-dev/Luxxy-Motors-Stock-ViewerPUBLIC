// Local-only durable reservation sandbox. Never imported by the production entry point.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { UpdateDealerSettingsBody } from '../../../lib/api-zod/src/generated/api';
import { createOnlineReservation, reservationView, ReservationError, type ReservationRecord, type ReservationRepository } from '../../api-server/src/lib/online-reservations';
import { previewSettings } from './settings';
import { previewStock } from './stock';
import { leads, previewResponse } from './portal';

type State = { reservations: ReservationRecord[]; settings?: typeof previewSettings };
const filename = fileURLToPath(new URL('../../../.local/online-reservations-preview.json', import.meta.url));
let queue: Promise<unknown> = Promise.resolve();
const dealerId = 'local-reservation-preview';
const fixtureId = (id: string) => previewStock.cars.findIndex(car => car.id === id);
const internalId = (id: string) => {
  const index = fixtureId(id);
  return index >= 0 ? `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` : id;
};
const externalId = (id: string) => previewStock.cars.find(car => internalId(car.id) === id)?.id ?? id;
const publicView = (record: ReservationRecord) => ({ ...reservationView(record), vehicleId: externalId(record.vehicleId) });

async function load(): Promise<State> {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { reservations: [] }; throw error; }
}
async function save(state: State) {
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(`${filename}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(`${filename}.tmp`, filename);
}
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}
async function body(req: IncomingMessage) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 32_768) throw new ReservationError('Request is too large.', 413);
  }
  try { return JSON.parse(data); } catch { throw new ReservationError('Invalid request.', 400); }
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}
function leadView(record: ReservationRecord) {
  return {
    ...leads[0], id: record.id, stage: record.status === 'reserved' ? 'reserved' : 'qualifying',
    customerName: record.customerName, email: record.email, phone: record.phone,
    vehicleId: externalId(record.vehicleId), vehicleTitle: record.vehicleTitle,
    vehicleRegistration: previewStock.cars.find(car => car.id === externalId(record.vehicleId))?.registration ?? null,
    vehicleUrl: `/vehicle/${externalId(record.vehicleId)}`, vehiclePrice: record.expectedPricePence / 100,
    summary: `Online reservation ${record.reference}. Payment simulated; £0 received.`,
    nextAction: 'Contact customer about online reservation', nextActionDueAt: null,
    appointmentAt: null, depositPence: 0, depositTakenAt: null, owner: null,
    createdAt: record.createdAt, updatedAt: record.createdAt, lastActivityAt: record.createdAt,
  };
}

export async function reservationPreview(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;
  const handles = path === '/api/reservations' || /^\/api\/reservations\/[^/]+\/cancel$/.test(path)
    || path === '/api/stock' || path === '/api/dealer-settings' || path === '/api/leads' || /^\/api\/leads\/[0-9a-f-]{36}(\/events)?$/.test(path);
  if (!handles) return false;
  // Preview fixtures have no real authentication. Keep their writable sandbox on loopback only.
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
    || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)) {
    send(res, 403, { error: 'This reservation sandbox is local only.' }); return true;
  }
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
    send(res, 403, { error: 'This reservation sandbox is local only.' }); return true;
  }
  try {
    const result = await serial(async () => {
      const state = await load();
      const settings = state.settings ?? previewSettings;
      if (req.method === 'GET') {
        if (path === '/api/dealer-settings') return { status: 200, data: settings };
        if (path === '/api/stock') return { status: 200, data: { ...previewStock, cars: previewStock.cars.map(car => ({ ...car, inventoryStatus: state.reservations.some(item => item.vehicleId === internalId(car.id) && item.status === 'reserved') ? 'reserved' : 'available' })) } };
        if (path === '/api/reservations') return { status: 200, data: { reservations: state.reservations.map(record => ({ ...publicView(record), customerName: record.customerName, email: record.email, phone: record.phone, leadId: record.id })) } };
        if (path === '/api/leads') {
          const stored = state.reservations.map(leadView).filter(lead => (!url.searchParams.get('search') || `${lead.customerName} ${lead.vehicleTitle}`.toLowerCase().includes(url.searchParams.get('search')!.toLowerCase())) && (!url.searchParams.get('stage') || ['all', 'open', lead.stage].includes(url.searchParams.get('stage')!)));
          return { status: 200, data: [...stored, ...(previewResponse(path, url.searchParams) as unknown[])] };
        }
        const record = state.reservations.find(item => path.startsWith(`/api/leads/${item.id}`));
        if (record) return { status: 200, data: path.endsWith('/events') ? [{ id: record.id, type: 'note_added', actorType: 'customer', actor: record.customerName, body: leadView(record).summary, payload: { reservation: publicView(record) }, occurredAt: record.createdAt }] : { lead: leadView(record), deal: null, enquiryMessage: leadView(record).summary, activities: [] } };
      }
      if (req.method === 'PATCH' && path === '/api/dealer-settings') {
        const parsed = UpdateDealerSettingsBody.safeParse(await body(req));
        if (!parsed.success) throw new ReservationError('Please check your settings.', 400);
        if (parsed.data.onlineReservation?.enabled && !parsed.data.onlineReservation.terms.trim()) throw new ReservationError('Add reservation terms before enabling online reservations.', 400);
        state.settings = parsed.data as typeof previewSettings;
        await save(state);
        return { status: 200, data: state.settings };
      }
      if (req.method === 'POST' && path === '/api/reservations') {
        const input = await body(req);
        const repository: ReservationRepository = {
          transaction: async work => work({
            lockRequest: async () => {}, lockVehicle: async () => {},
            findByIdempotencyKey: async key => state.reservations.find(item => item.idempotencyKey === key),
            getSettings: async () => settings.onlineReservation,
            getVehicle: async id => {
              const car = previewStock.cars.find(candidate => internalId(candidate.id) === id);
              return car ? { id, dealerId, source: 'autotrader', inventoryStatus: state.reservations.some(item => item.vehicleId === id && item.status === 'reserved') ? 'reserved' : 'available', sourceStatus: 'live', missingCount: 0, currency: car.currency ?? 'GBP', sourcePrice: car.price, websitePriceOverride: null, title: car.title } : undefined;
            },
            hasActiveSale: async () => false,
            hasCompetingReservation: async id => state.reservations.some(item => item.vehicleId === id && item.status === 'reserved'),
            create: async record => { state.reservations.unshift(record); },
          }),
        };
        const created = await createOnlineReservation({ ...input, vehicleId: internalId(String(input.vehicleId)) }, { dealerId, paymentMode: 'simulated', nodeEnv: 'development' }, repository);
        await save(state);
        return { status: created.replayed ? 200 : 201, data: { ...created.reservation, vehicleId: externalId(created.reservation.vehicleId) } };
      }
      if (req.method === 'POST' && /^\/api\/reservations\/[^/]+\/cancel$/.test(path)) {
        const id = path.split('/')[3];
        const record = state.reservations.find(item => item.id === id);
        if (!record) throw new ReservationError('Reservation not found.', 404);
        record.status = 'cancelled';
        await save(state);
        return { status: 200, data: publicView(record) };
      }
      return { status: 404, data: { error: 'Not available in the local reservation preview.' } };
    });
    send(res, result.status, result.data);
  } catch (error) {
    send(res, error instanceof ReservationError ? error.status : 500, { error: error instanceof ReservationError ? error.message : 'The local reservation could not be saved. Please try again.' });
  }
  return true;
}
