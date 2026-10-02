// Local-only durable reservation sandbox. Never imported by the production entry point.
import { randomUUID, randomBytes } from 'node:crypto';
import type { Enquiry } from '@workspace/api-client-react';
import { bookingDateIsInWindow, bookingPolicyFromConfig, bookingPolicyError, getSlotsForDate, isValidDateString, slotIsAvailable } from '../../api-server/src/lib/booking-slots';
import { preserveTestDriveBooking } from '../../api-server/src/lib/settings-content';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CreateEnquiryBody, DecideTestDriveBookingBody, RescheduleViewingBody, UpdateDealerSettingsBody } from '../../../lib/api-zod/src/generated/api';
import { createOnlineReservation, reservationView, ReservationError, type ReservationRecord, type ReservationRepository } from '../../api-server/src/lib/online-reservations';
import { previewSettings } from './settings';
import { previewStock } from './stock';
import { leads, previewResponse } from './portal';

type PreviewEnquiry = Enquiry & { manageToken?: string };
export type BookingPreviewState = { reservations: ReservationRecord[]; settings?: typeof previewSettings; enquiries?: PreviewEnquiry[] };
const filename = fileURLToPath(new URL('../../../.local/online-reservations-preview.json', import.meta.url));
let queue: Promise<unknown> = Promise.resolve();
const dealerId = 'local-reservation-preview';
const fixtureId = (id: string) => previewStock.cars.findIndex(car => car.id === id);
const internalId = (id: string) => {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return id;
  const index = fixtureId(id);
  return index >= 0 ? `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` : id;
};
const externalId = (id: string) => previewStock.cars.find(car => internalId(car.id) === id)?.id ?? id;
const publicView = (record: ReservationRecord) => ({ ...reservationView(record), vehicleId: externalId(record.vehicleId) });

async function load(): Promise<BookingPreviewState> {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { reservations: [] }; throw error; }
}
export async function readPreviewSettings() { return (await load()).settings ?? previewSettings; }

async function save(state: BookingPreviewState) {
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
    || path === '/api/enquiries' || path === '/api/enquiries/availability' || path === '/api/test-drive-bookings' || /^\/api\/test-drive-bookings\/[^/]+\/decision$/.test(path) || (path.startsWith('/api/viewings/') && path !== '/api/viewings/sample')
    || path === '/api/stock' || path === '/api/dealer-settings' || path === '/api/leads' || /^\/api\/leads\/[0-9a-f-]{36}(\/events)?$/.test(path);
  if (!handles) return false;
  // LAN access is explicitly enabled for a local preview session, never production.
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const host = new URL(`http://${req.headers.host}`).hostname;
  const loopback = ['127.0.0.1', '::1'].includes(remote)
    && ['127.0.0.1', 'localhost', '[::1]'].includes(host);
  const lanHost = process.env.LUXXY_PREVIEW_LAN_HOST;
  const privateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
  const lan = Boolean(lanHost && privateIpv4.test(lanHost) && host === lanHost
    && (privateIpv4.test(remote) || remote === '127.0.0.1'));
  if (!loopback && !lan) {
    send(res, 403, { error: 'This reservation sandbox is local only.' }); return true;
  }
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
    send(res, 403, { error: 'This reservation sandbox is local only.' }); return true;
  }
  try {
    const result = await serial(async () => {
      const state = await load();
      const settings = state.settings ?? previewSettings;
      const bookingResult = await handlePreviewBooking(req, url, state, settings);
      if (bookingResult) { if (req.method !== "GET") await save(state); return bookingResult; }
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
        const compatible = preserveTestDriveBooking(parsed.data, settings);
        const policyError = bookingPolicyError(compatible.testDriveBooking);
        if (policyError) throw new ReservationError(policyError, 400);
        state.settings = compatible as typeof previewSettings;
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


function previewCalendar(booking: PreviewEnquiry, settings: typeof previewSettings) {
  if (!booking.appointmentAt || booking.appointmentStatus === 'pending') return null;
  const timestamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const start = new Date(booking.appointmentAt);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Local showroom preview//Test drive//EN', `METHOD:${booking.appointmentCancelledAt ? 'CANCEL' : 'PUBLISH'}`, 'BEGIN:VEVENT', `UID:${booking.id}@local-preview`, `SEQUENCE:${booking.appointmentRevision ?? 0}`, `DTSTAMP:${timestamp(new Date())}`, `DTSTART:${timestamp(start)}`, `DTEND:${timestamp(new Date(start.getTime() + (booking.appointmentDurationMinutes ?? 30) * 60_000))}`, `SUMMARY:${escape(`Test drive: ${booking.vehicleTitle ?? settings.identity.name}`)}`, `LOCATION:${escape([settings.address.street, settings.address.city, settings.address.postcode].filter(Boolean).join(', '))}`, `STATUS:${booking.appointmentCancelledAt ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

function publicBooking(booking: PreviewEnquiry, settings: typeof previewSettings) {
  const { manageToken: _token, ...enquiry } = booking;
  return { ...enquiry, calendarIcs: previewCalendar(booking, settings) };
}

function previewManagement(booking: PreviewEnquiry, settings: typeof previewSettings) {
  return { reference: booking.reference, status: booking.appointmentCancelledAt ? 'cancelled' : booking.appointmentStatus === 'pending' ? 'pending' : 'booked', customerName: booking.customerName, appointmentAt: booking.appointmentAt, cancelledAt: booking.appointmentCancelledAt, timezone: 'Europe/London', durationMinutes: booking.appointmentDurationMinutes ?? 30, vehicleTitle: booking.vehicleTitle, vehicleUrl: booking.vehicleUrl, calendarIcs: previewCalendar(booking, settings), canChange: !booking.appointmentCancelledAt && !!booking.appointmentAt && new Date(booking.appointmentAt).getTime() > Date.now() };
}

export async function handlePreviewBooking(req: IncomingMessage, url: URL, state: BookingPreviewState, settings: typeof previewSettings): Promise<{ status: number; data: unknown } | undefined> {
  const path = url.pathname;
  const policy = bookingPolicyFromConfig(settings);
  const enquiries = state.enquiries ??= [];
  const occupied = () => enquiries.filter((entry) => entry.type === 'viewing' && !entry.appointmentCancelledAt).map((entry) => ({ ...entry, appointmentAt: entry.appointmentAt ? new Date(entry.appointmentAt) : null }));
  if (req.method === 'GET' && path === '/api/enquiries/availability') {
    const date = url.searchParams.get('date') ?? '';
    if (!isValidDateString(date) || !bookingDateIsInWindow(date, policy)) throw new ReservationError(`Choose a date within the next ${policy.daysAhead} days.`, 400);
    return { status: 200, data: { date, timezone: 'Europe/London', slots: getSlotsForDate(date, policy).map((slot) => ({ startAt: slot.startAt.toISOString(), label: slot.label, available: slotIsAvailable(slot.startAt, policy, occupied()) })) } };
  }
  if (req.method === 'GET' && (path === '/api/enquiries' || path === '/api/test-drive-bookings')) return { status: 200, data: enquiries.filter((entry) => path === '/api/enquiries' || entry.type === 'viewing').map((entry) => publicBooking(entry, settings)) };
  if (req.method === 'POST' && path === '/api/enquiries') {
    const parsed = CreateEnquiryBody.safeParse(await body(req));
    if (!parsed.success) throw new ReservationError('Please check your contact details and chosen time.', 400);
    const input = parsed.data;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new ReservationError('Please provide a valid email address.', 400);
    if (input.type === 'viewing' && (!input.phone || !/^\+?[0-9]{7,15}$/.test(input.phone.replace(/[\s().\-/]/g, '')))) throw new ReservationError('Please provide a phone number for your test drive.', 400);
    const vehicle = previewStock.cars.find((entry) => entry.id === input.vehicleId);
    if (input.vehicleId && !vehicle) throw new ReservationError('That car is no longer available.', 404);
    if (input.type === 'viewing' && (!vehicle || !input.appointmentAt)) throw new ReservationError('Please choose a car and time.', 400);
    if (input.type !== 'viewing' && input.appointmentAt) throw new ReservationError('Appointments are only available for test drives.', 400);
    if (input.appointmentAt && !slotIsAvailable(input.appointmentAt, policy, occupied())) throw new ReservationError('That test-drive time is no longer available. Please choose another.', 409);
    const id = randomUUID(); const token = randomBytes(24).toString('base64url'); const now = new Date().toISOString();
    const viewing = input.type === 'viewing';
    const enquiry: PreviewEnquiry = { id, dealerId: 'local-preview', reference: `PREVIEW-${id.slice(0, 8).toUpperCase()}`, vehicleId: vehicle?.id ?? null, vehicleTitle: vehicle?.title ?? null, vehicleRegistration: vehicle?.registration ?? null, vehiclePrice: vehicle?.price ?? null, vehicleUrl: vehicle ? `/vehicle/${vehicle.id}` : null, type: input.type, status: 'new', customerName: input.customerName.trim(), email: input.email, phone: input.phone, preferredContact: input.preferredContact, message: input.message, partExchangeRegistration: input.partExchange?.registration ?? null, partExchangeMileage: input.partExchange?.mileage ?? null, partExchangeCondition: input.partExchange?.condition ?? null, appointmentAt: input.appointmentAt?.toISOString() ?? null, appointmentCancelledAt: null, appointmentRevision: 0, appointmentStatus: viewing ? policy.confirmationMode === 'approval' ? 'pending' : 'confirmed' : null, appointmentDurationMinutes: viewing ? policy.durationMinutes : null, appointmentBufferMinutes: viewing ? policy.bufferMinutes : null, manageToken: viewing ? token : undefined, managePath: viewing ? `/viewing/${token}` : null, calendarIcs: null, events: [], customerNotificationStatus: 'not_sent', customerNotificationError: 'Local preview — no email is sent.', customerNotificationSentAt: null, dealerNotificationStatus: 'not_sent', dealerNotificationError: 'Local preview — no email is sent.', dealerNotificationSentAt: null, reminderStatus: 'not_scheduled', reminderError: null, reminderSentAt: null, source: 'local-preview', createdAt: now, updatedAt: now };
    enquiries.unshift(enquiry);
    return { status: 201, data: publicBooking(enquiry, settings) };
  }
  const decision = /^\/api\/test-drive-bookings\/([^/]+)\/decision$/.exec(path);
  if (req.method === 'POST' && decision) {
    const parsed = DecideTestDriveBookingBody.safeParse(await body(req));
    if (!parsed.success) throw new ReservationError('Choose confirm or decline.', 400);
    const booking = enquiries.find((entry) => entry.id === decision[1] && entry.type === 'viewing');
    if (!booking) throw new ReservationError('Test drive not found.', 404);
    if ((booking.appointmentRevision ?? 0) !== parsed.data.expectedRevision) throw new ReservationError('This test drive has changed. Refresh the booking before deciding.', 409);
    if ((parsed.data.decision === 'confirm' && booking.appointmentStatus === 'confirmed' && !booking.appointmentCancelledAt) || (parsed.data.decision === 'decline' && booking.appointmentCancelledAt)) return { status: 200, data: publicBooking(booking, settings) };
    if (booking.appointmentCancelledAt || booking.appointmentStatus !== 'pending' || !booking.appointmentAt || new Date(booking.appointmentAt).getTime() <= Date.now()) throw new ReservationError('Only future pending requests can be confirmed or declined.', 409);
    if (parsed.data.decision === 'confirm') booking.appointmentStatus = 'confirmed'; else booking.appointmentCancelledAt = new Date().toISOString();
    booking.appointmentRevision = (booking.appointmentRevision ?? 0) + 1;
    booking.updatedAt = new Date().toISOString();
    return { status: 200, data: publicBooking(booking, settings) };
  }
  const management = /^\/api\/viewings\/([^/]+)(?:\/(reschedule|cancel))?$/.exec(path);
  if (management) {
    const booking = enquiries.find((entry) => entry.manageToken === management[1]);
    if (!booking) throw new ReservationError('This booking link is no longer valid.', 404);
    if (req.method === 'GET' && !management[2]) return { status: 200, data: previewManagement(booking, settings) };
    if (req.method === 'POST' && management[2] === 'cancel') {
      if (!booking.appointmentCancelledAt) booking.appointmentRevision = (booking.appointmentRevision ?? 0) + 1;
      booking.appointmentCancelledAt ??= new Date().toISOString(); booking.updatedAt = new Date().toISOString();
      return { status: 200, data: previewManagement(booking, settings) };
    }
    if (req.method === 'POST' && management[2] === 'reschedule') {
      const parsed = RescheduleViewingBody.safeParse(await body(req));
      if (!parsed.success) throw new ReservationError('Please choose a new test-drive time.', 400);
      if (!previewManagement(booking, settings).canChange) throw new ReservationError('This booking can no longer be moved.', 400);
      if (!slotIsAvailable(parsed.data.appointmentAt, policy, occupied(), new Date(), booking.id)) throw new ReservationError('That time is no longer available. Please choose another.', 409);
      booking.appointmentRevision = (booking.appointmentRevision ?? 0) + 1;
      booking.appointmentAt = parsed.data.appointmentAt.toISOString(); booking.appointmentStatus = policy.confirmationMode === 'approval' ? 'pending' : 'confirmed'; booking.appointmentDurationMinutes = policy.durationMinutes; booking.appointmentBufferMinutes = policy.bufferMinutes; booking.updatedAt = new Date().toISOString();
      return { status: 200, data: previewManagement(booking, settings) };
    }
  }
  return undefined;
}
