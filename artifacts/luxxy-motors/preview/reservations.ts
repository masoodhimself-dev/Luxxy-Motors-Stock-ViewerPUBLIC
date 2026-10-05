// Local-only durable reservation sandbox. Never imported by the production entry point.
import { randomUUID, randomBytes } from 'node:crypto';
import type { Enquiry } from '@workspace/api-client-react';
import { EnquiryMergeError, parseEnquiryMergeInput, planEnquiryMerge, showroomAvailability, vehicleRegistrationLabel } from '@workspace/vehicle-meta';
import { bookingDateIsInWindow, bookingPolicyFromConfig, bookingPolicyError, bookingPressure, getSlotsForDate, isValidDateString, slotIsAvailable, validStaffAppointmentDateTime, withinBookingHours, type BookingPolicy, type OccupiedBooking } from '../../api-server/src/lib/booking-slots';
import { preserveTestDriveBooking } from '../../api-server/src/lib/settings-content';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CreateStaffEnquiryBody, ChangeStaffAppointmentBody, ChangeStaffFollowUpBody, CreateEnquiryBody, DecideTestDriveBookingBody, RescheduleViewingBody, UpdateDealerSettingsBody } from '../../../lib/api-zod/src/generated/api';
import { createOnlineReservation, reservationView, ReservationError, type ReservationRecord, type ReservationRepository } from '../../api-server/src/lib/online-reservations';
import { previewSettings } from './settings';
import { previewStock } from './stock';
import { leads, previewResponse } from './portal';
import { LogEnquiryConversationBody, UpdateEnquiryStatusBody, UpdateEnquiryWorkspaceBody } from '../../../lib/api-zod/src/generated/api';
import { attendanceError, outcomeError } from '../../api-server/src/lib/enquiry-workspace';
import { conversationChange, ConversationError } from '../../api-server/src/lib/enquiry-conversations';
import { roleHasPermission, type StaffRole } from '../../api-server/src/lib/staff-permissions';

let previewStaff = [{ id: 'preview-alex', name: 'Alex' }, { id: 'preview-jamie', name: 'Jamie' }];
function previewAssignment(id?: string | null) {
  if (!id) return { assignedToId: null, assignedToName: null };
  const member = previewStaff.find(member => member.id === id);
  if (!member) throw new ReservationError('Choose a staff member from this dealership.', 400);
  return { assignedToId: member.id, assignedToName: member.name };
}

type PreviewEnquiry = Enquiry & { manageToken?: string; events: Array<Enquiry['events'][number] & { detail?: Record<string, unknown> }> };
function staffException(at: Date, policy: BookingPolicy, booked: OccupiedBooking[], options: { allowOutsideHours?: boolean; allowDoubleBooking?: boolean }, excludeId?: string) {
  if (!validStaffAppointmentDateTime(at)) throw new ReservationError('Choose a future UK time in 15-minute steps, within the next year.', 400);
  const appointmentOutsideHours = !withinBookingHours(at, policy);
  const pressure = bookingPressure(at, policy, booked, excludeId);
  if (appointmentOutsideHours && !options.allowOutsideHours) throw new ReservationError('This is outside normal booking hours. Review and confirm the staff exception.', 409);
  if ((pressure.overlapping || pressure.overCapacity) && !options.allowDoubleBooking) throw new ReservationError('This overlaps another appointment or exceeds daily capacity. Review and confirm the staff exception.', 409);
  return { appointmentOutsideHours, appointmentDoubleBooked: pressure.overlapping, appointmentOverCapacity: pressure.overCapacity };
}
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

async function load(file = filename): Promise<BookingPreviewState> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { reservations: [] }; throw error; }
}
export async function readPreviewSettings() { return (await load()).settings ?? previewSettings; }
export async function readPreviewBookingState() { const state = await load(); return { ...state, enquiries: state.enquiries ?? previewResponse('/api/enquiries', new URLSearchParams()) as PreviewEnquiry[] ?? [] }; }
export async function readPreviewEnquiries() { return (await readPreviewBookingState()).enquiries; }
export async function writePreviewSettings(config: Record<string, unknown>) { await serial(async () => { const state = await load(); state.settings = config as typeof previewSettings; await save(state); }); }

/** Chat uses this queue so a contact update cannot overwrite a simultaneous booking. */
export async function upsertPreviewChatEnquiry(input: import('../../api-server/src/lib/dealer-chat').ChatEnquiryInput, options: { stateFile?: string } = {}) {
  await serial(async () => {
    const state = await load(options.stateFile);
    const enquiries = state.enquiries ?? (previewResponse('/api/enquiries', new URLSearchParams()) as PreviewEnquiry[] ?? []);
    let entry = enquiries.find(enquiry => enquiry.id === input.id);
    const updatingExisting = Boolean(entry);
    if (entry && entry.source !== 'chat') throw new ReservationError('This enquiry belongs to another source.', 409);
    if (!entry) {
      entry = { id: input.id, dealerId: 'local-preview', reference: input.reference, vehicleId: input.vehicle?.id ?? null,
        vehicleTitle: input.vehicle?.title ?? null, vehicleRegistration: input.vehicle?.registration ?? null,
        vehiclePrice: input.vehicle?.price ?? null, vehicleUrl: input.vehicle?.url ?? null, type: 'general', status: 'new',
        customerName: input.name, email: input.email, phone: input.phone, message: input.message, preferredContact: 'email',
        assignedToId: null, assignedToName: null, staffNote: null, attendance: 'scheduled', callOutcome: null, workspaceRevision: 0,
        followUpAt: null, followUpNote: null, followUpCompletedAt: null, followUpRevision: 0,
        appointmentAt: null, appointmentCancelledAt: null, appointmentRevision: 0, appointmentStatus: null,
        appointmentDurationMinutes: null, appointmentBufferMinutes: null, appointmentOutsideHours: false,
        appointmentDoubleBooked: false, appointmentOverCapacity: false, partExchangeRegistration: null,
        partExchangeMileage: null, partExchangeCondition: null, managePath: null, calendarIcs: null,
        customerNotificationStatus: 'not_sent', customerNotificationError: null, customerNotificationSentAt: null,
        dealerNotificationStatus: 'not_sent', dealerNotificationError: null, dealerNotificationSentAt: null,
        reminderStatus: 'not_scheduled', reminderError: null, reminderSentAt: null, source: 'chat',
        createdAt: input.createdAt, updatedAt: input.createdAt, events: [{ id: input.id, kind: 'enquiry_received', actor: 'customer',
          summary: 'Website chat enquiry received', vehicleId: input.vehicle?.id ?? null, vehicleTitle: input.vehicle?.title ?? null,
          vehicleUrl: input.vehicle?.url ?? null, occurredAt: input.createdAt }] } as PreviewEnquiry;
      enquiries.unshift(entry);
    }
    Object.assign(entry, { customerName: input.name, email: input.email, phone: input.phone, message: input.message, workspaceRevision: (entry.workspaceRevision ?? 0) + (updatingExisting ? 1 : 0),
      preferredContact: input.callbackRequested ? 'phone' : input.email ? 'email' : 'phone',
      staffNote: input.callbackRequested && !entry.staffNote?.includes('Customer requested a callback in website chat.') ? [entry.staffNote, 'Customer requested a callback in website chat.'].filter(Boolean).join('\n') : entry.staffNote ?? 'Customer shared contact details in website chat.', updatedAt: new Date().toISOString() });
    state.enquiries = enquiries; await save(state, options.stateFile);
  });
}

async function save(state: BookingPreviewState, file = filename) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
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
    vehicleRegistration: record.vehicleRegistration !== undefined ? record.vehicleRegistration : previewStock.cars.find(car => car.id === externalId(record.vehicleId))?.registration ?? null,
    vehicleUrl: `/vehicle/${externalId(record.vehicleId)}`, vehiclePrice: record.expectedPricePence / 100,
    summary: `Online reservation ${record.reference}. Payment simulated; £0 received.`,
    nextAction: 'Contact customer about online reservation', nextActionDueAt: null,
    appointmentAt: null, depositPence: 0, depositTakenAt: null, owner: null,
    createdAt: record.createdAt, updatedAt: record.createdAt, lastActivityAt: record.createdAt,
  };
}

type MergePreviewOptions = { readMergeStaff?: () => Promise<Array<{ id: string; name: string; role: StaffRole }>> };
export type ReservationPreviewOptions = MergePreviewOptions & { stateFile?: string; readStaffDirectory?: () => Promise<Array<{ id: string; name: string }>> };
export async function reservationPreview(req: IncomingMessage, res: ServerResponse, url: URL, options: ReservationPreviewOptions = {}): Promise<boolean> {
  const path = url.pathname;
  const handles = path === '/api/staff/directory' || path === '/api/reservations' || /^\/api\/reservations\/[^/]+\/cancel$/.test(path)
    || path.startsWith('/api/staff/enquiries') || path === '/api/enquiries' || /^\/api\/enquiries\/[^/]+\/status$/.test(path) || path === '/api/enquiries/availability' || path === '/api/test-drive-bookings' || /^\/api\/test-drive-bookings\/[^/]+\/decision$/.test(path) || (path.startsWith('/api/viewings/') && path !== '/api/viewings/sample')
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
    send(res, 403, { error: 'This service is available only on the authorised network.' }); return true;
  }
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
    send(res, 403, { error: 'This service is available only on the authorised network.' }); return true;
  }
  try {
    const result = await serial(async () => {
      const state = await load(options.stateFile);
      const settings = state.settings ?? previewSettings;
      const { readPreviewStaffDirectory } = await import('./operations');
      previewStaff = await (options.readStaffDirectory?.() ?? readPreviewStaffDirectory());
      const bookingResult = await handlePreviewBooking(req, url, state, settings, options);
      if (bookingResult) { if (req.method !== "GET") await save(state, options.stateFile); return bookingResult; }
      if (req.method === 'GET') {
        if (path === '/api/dealer-settings') return { status: 200, data: settings };
        if (path === '/api/stock') {
          const [{ readPreviewSaleInventory }, { readPreviewPriceOverrides }] = await Promise.all([import('./sales'), import('./operations')]);
          const [saleInventory, prices] = await Promise.all([readPreviewSaleInventory(), readPreviewPriceOverrides()]);
          return { status: 200, data: { ...previewStock, cars: previewStock.cars.map(car => ({ ...car, ...(car.id in prices && prices[car.id] !== null ? { price: prices[car.id] } : {}), inventoryStatus: saleInventory[car.id] ?? (state.reservations.some(item => item.vehicleId === internalId(car.id) && item.status === 'reserved') ? 'reserved' : 'available') })) } };
        }
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
        await save(state, options.stateFile);
        return { status: 200, data: state.settings };
      }
      if (req.method === 'POST' && path === '/api/reservations') {
        const input = await body(req);
        const [{ readPreviewSaleInventory }, { readPreviewPriceOverrides }] = await Promise.all([import('./sales'), import('./operations')]);
        const [saleInventory, prices] = await Promise.all([readPreviewSaleInventory(), readPreviewPriceOverrides()]);
        const repository: ReservationRepository = {
          transaction: async work => work({
            lockRequest: async () => {}, lockVehicle: async () => {},
            findByIdempotencyKey: async key => state.reservations.find(item => item.idempotencyKey === key),
            getSettings: async () => settings.onlineReservation,
            getVehicle: async id => {
              const car = previewStock.cars.find(candidate => internalId(candidate.id) === id);
              return car ? { id, dealerId, source: 'autotrader', inventoryStatus: saleInventory[car.id] ?? (state.reservations.some(item => item.vehicleId === id && item.status === 'reserved') ? 'reserved' : 'available'), sourceStatus: 'live', missingCount: 0, currency: car.currency ?? 'GBP', sourcePrice: car.price, websitePriceOverride: prices[car.id] ?? null, title: car.title, plate: car.plate, vrm: car.vrm, registration: car.registration, registrationBand: car.registrationBand, year: car.year } : undefined;
            },
            hasActiveSale: async id => Boolean(saleInventory[externalId(id)]),
            hasCompetingReservation: async id => state.reservations.some(item => item.vehicleId === id && item.status === 'reserved'),
            create: async record => { state.reservations.unshift(record); },
          }),
        };
        const created = await createOnlineReservation({ ...input, vehicleId: internalId(String(input.vehicleId)) }, { dealerId, paymentMode: 'simulated', nodeEnv: 'development' }, repository);
        await save(state, options.stateFile);
        return { status: created.replayed ? 200 : 201, data: { ...created.reservation, vehicleId: externalId(created.reservation.vehicleId) } };
      }
      if (req.method === 'POST' && /^\/api\/reservations\/[^/]+\/cancel$/.test(path)) {
        const id = path.split('/')[3];
        const record = state.reservations.find(item => item.id === id);
        if (!record) throw new ReservationError('Reservation not found.', 404);
        const { releasePreviewSourceReservation } = await import('./sales');
        try { await releasePreviewSourceReservation(record.id); } catch (error) { throw new ReservationError(error instanceof Error ? error.message : 'The linked sale must be reviewed before cancellation.', (error as { status?: number }).status ?? 409); }
        record.status = 'cancelled';
        await save(state, options.stateFile);
        return { status: 200, data: publicView(record) };
      }
      return { status: 404, data: { error: 'This reservation service is unavailable.' } };
    });
    send(res, result.status, result.data);
  } catch (error) {
    send(res, error instanceof ReservationError ? error.status : 500, { error: error instanceof ReservationError ? error.message : 'The reservation could not be saved. Please try again.' });
  }
  return true;
}


function previewCalendar(booking: PreviewEnquiry, settings: typeof previewSettings) {
  if (!booking.appointmentAt || booking.appointmentCancelledAt || booking.appointmentStatus === 'pending') return null;
  const timestamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const start = new Date(booking.appointmentAt);
  const dealerName = settings.identity.name.trim().replace(/[\r\n/]/g, ' ') || 'Showroom';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${escape(dealerName)}//Test drive//EN`, `METHOD:${booking.appointmentCancelledAt ? 'CANCEL' : 'PUBLISH'}`, 'BEGIN:VEVENT', `UID:${booking.id}@local-preview`, `SEQUENCE:${booking.appointmentRevision ?? 0}`, `DTSTAMP:${timestamp(new Date())}`, `DTSTART:${timestamp(start)}`, `DTEND:${timestamp(new Date(start.getTime() + (booking.appointmentDurationMinutes ?? 30) * 60_000))}`, `SUMMARY:${escape(`Test drive: ${booking.vehicleTitle ?? settings.identity.name}`)}`, `LOCATION:${escape([settings.address.street, settings.address.city, settings.address.postcode].filter(Boolean).join(', '))}`, `STATUS:${booking.appointmentCancelledAt ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

function publicBooking(booking: PreviewEnquiry, settings: typeof previewSettings) {
  const { manageToken: _token, ...enquiry } = booking;
  const notificationError = (value: string | null | undefined) => value && /local preview/i.test(value) ? 'Email delivery is not configured.' : value;
  return { ...enquiry, mergedIntoId: enquiry.mergedIntoId ?? null, mergedAt: enquiry.mergedAt ?? null, mergedBy: enquiry.mergedBy ?? null, source: enquiry.source === 'local-preview' ? 'website' : enquiry.source, assignedToName: enquiry.assignedToName?.replace(/\s*\(preview\)$/, '') ?? enquiry.assignedToName, customerNotificationError: notificationError(enquiry.customerNotificationError), dealerNotificationError: notificationError(enquiry.dealerNotificationError), calendarIcs: previewCalendar(booking, settings) };
}

function previewManagement(booking: PreviewEnquiry, settings: typeof previewSettings) {
  return { reference: booking.reference, status: booking.appointmentCancelledAt ? 'cancelled' : booking.appointmentStatus === 'pending' ? 'pending' : 'booked', customerName: booking.customerName, appointmentAt: booking.appointmentAt, cancelledAt: booking.appointmentCancelledAt, timezone: 'Europe/London', durationMinutes: booking.appointmentDurationMinutes ?? 30, vehicleTitle: booking.vehicleTitle, vehicleUrl: booking.vehicleUrl, calendarIcs: previewCalendar(booking, settings), canChange: !booking.appointmentCancelledAt && !!booking.appointmentAt && new Date(booking.appointmentAt).getTime() > Date.now() };
}

export async function handlePreviewBooking(req: IncomingMessage, url: URL, state: BookingPreviewState, settings: typeof previewSettings, options: MergePreviewOptions = {}): Promise<{ status: number; data: unknown } | undefined> {
  const path = url.pathname;
  const policy = bookingPolicyFromConfig(settings);
  const enquiries = state.enquiries ??= [];
  if (req.method === 'GET' && path === '/api/staff/directory') return { status: 200, data: { currentUserId: 'preview-alex', members: previewStaff } };
  const statusChange = /^\/api\/enquiries\/([^/]+)\/status$/.exec(path);
  if (req.method === 'PATCH' && statusChange) {
    const parsed = UpdateEnquiryStatusBody.safeParse(await body(req));
    if (!parsed.success) throw new ReservationError('Check the enquiry status.', 400);
    const entry = enquiries.find(entry => entry.id === statusChange[1] && entry.dealerId === 'local-preview');
    if (!entry) throw new ReservationError('Enquiry not found.', 404);
    entry.status = parsed.data.status; entry.workspaceRevision = (entry.workspaceRevision ?? 0) + 1; entry.updatedAt = new Date().toISOString();
    return { status: 200, data: publicBooking(entry, settings) };
  }
  const merge = /^\/api\/staff\/enquiries\/([^/]+)\/merge$/.exec(path);
  if (req.method === 'POST' && merge) {
    const staffId = typeof req.headers?.['x-preview-staff-id'] === 'string' ? req.headers['x-preview-staff-id'] : 'preview-alex';
    const { readPreviewChatStaff } = await import('./chat');
    const member = (await (options.readMergeStaff ?? readPreviewChatStaff)()).find(member => member.id === staffId);
    if (!member) throw new ReservationError('Sign in to use the dealer portal.', 401);
    if (!roleHasPermission(member.role, 'sales.manage')) throw new ReservationError('Your staff role does not allow this action.', 403);
    try {
      const input = parseEnquiryMergeInput(await body(req), merge[1]);
      const plan = planEnquiryMerge(input, enquiries.filter(entry => entry.dealerId === 'local-preview'), { id: member.id, name: member.name });
      // Validation finishes before any mutation; the outer serial queue persists all originals and events together.
      for (const change of plan.updates) {
        const entry = enquiries.find(entry => entry.id === change.id)!;
        Object.assign(entry, change.update, { mergedAt: change.update.mergedAt.toISOString(), updatedAt: change.update.updatedAt.toISOString(), ...(change.update.appointmentCancelledAt ? { appointmentCancelledAt: change.update.appointmentCancelledAt.toISOString() } : {}) });
        const event = plan.events.find(event => event.enquiryId === entry.id)!;
        entry.events = [...(entry.events ?? []), { id: randomUUID(), kind: 'records_merged', actor: 'dealer', summary: event.summary, vehicleId: entry.vehicleId, vehicleTitle: entry.vehicleTitle, vehicleUrl: entry.vehicleUrl, note: event.detail.note, staffId: event.detail.staffId, staffName: event.detail.staffName, occurredAt: event.occurredAt.toISOString(), detail: event.detail }];
      }
      return { status: 200, data: { primaryId: plan.primaryId, recordIds: plan.recordIds, cancelledAppointmentIds: plan.cancelledAppointmentIds } };
    } catch (error) { if (error instanceof EnquiryMergeError) throw new ReservationError(error.message, error.status); throw error; }
  }
  const workspaceChange = /^\/api\/staff\/enquiries\/([^/]+)\/workspace$/.exec(path);
  if (req.method === 'PATCH' && workspaceChange) {
    const parsed = UpdateEnquiryWorkspaceBody.safeParse(await body(req));
    if (!parsed.success) throw new ReservationError('Check the enquiry update.', 400);
    const input = parsed.data;
    const entry = enquiries.find(entry => entry.id === workspaceChange[1]);
    if (!entry) throw new ReservationError('Enquiry not found.', 404);
    if ((entry.workspaceRevision ?? 0) !== input.expectedRevision) throw new ReservationError('This enquiry changed. Refresh before saving.', 409);
    if (input.attendance) {
      if (input.expectedAppointmentRevision !== (entry.appointmentRevision ?? 0)) throw new ReservationError('The appointment changed. Refresh before recording attendance.', 409);
      const problem = attendanceError(entry, input.attendance);
      if (problem) throw new ReservationError(problem, 409);
    }
    const problem = outcomeError(entry, input.callOutcome);
    if (problem) throw new ReservationError(problem, 409);
    if (input.assignedToId !== undefined) Object.assign(entry, previewAssignment(input.assignedToId));
    if (input.callOutcome !== undefined) entry.callOutcome = input.callOutcome;
    if (input.staffNote !== undefined) entry.staffNote = input.staffNote?.trim() || null;
    if (input.attendance) entry.attendance = input.attendance;
    entry.workspaceRevision = (entry.workspaceRevision ?? 0) + 1;
    entry.updatedAt = new Date().toISOString();
    return { status: 200, data: publicBooking(entry, settings) };
  }
  const conversation = /^\/api\/staff\/enquiries\/([^/]+)\/conversations$/.exec(path);
  if (req.method === 'POST' && conversation) {
    const staffId = typeof req.headers?.['x-preview-staff-id'] === 'string' ? req.headers['x-preview-staff-id'] : 'preview-alex';
    const member = previewStaff.find(member => member.id === staffId);
    if (!member) throw new ReservationError('Sign in to use the dealer portal.', 401);
    const parsed = LogEnquiryConversationBody.safeParse(await body(req));
    if (!parsed.success) throw new ReservationError('Check the conversation details.', 400);
    const entry = enquiries.find(entry => entry.id === conversation[1] && entry.dealerId === 'local-preview');
    if (!entry) throw new ReservationError('Enquiry not found.', 404);
    try {
      const change = conversationChange(entry, parsed.data, { id: member.id, name: member.name });
      const event = { id: randomUUID(), kind: 'conversation_logged' as const, actor: 'dealer' as const, summary: change.summary, vehicleId: entry.vehicleId, vehicleTitle: entry.vehicleTitle, vehicleUrl: entry.vehicleUrl, occurredAt: change.occurredAt.toISOString(), ...change.detail };
      // No awaiting between validation and mutation; the outer queue saves record + event together.
      Object.assign(entry, change.update, { updatedAt: change.update.updatedAt.toISOString(), ...(parsed.data.followUpAt ? { followUpAt: parsed.data.followUpAt.toISOString() } : {}) });
      entry.events = [...(entry.events ?? []), event];
      return { status: 200, data: publicBooking(entry, settings) };
    } catch (error) { if (error instanceof ConversationError) throw new ReservationError(error.message, error.status); throw error; }
  }
  const occupied = () => enquiries.filter((entry) => entry.type === 'viewing' && !entry.appointmentCancelledAt).map((entry) => ({ ...entry, appointmentAt: entry.appointmentAt ? new Date(entry.appointmentAt) : null }));
  const staffAvailability = /^\/api\/staff\/enquiries\/([^/]+)\/availability$/.exec(path);
  if (req.method === 'GET' && (path === '/api/enquiries/availability' || staffAvailability)) {
    if (staffAvailability && !enquiries.some(entry => entry.id === staffAvailability[1] && entry.type === 'viewing')) throw new ReservationError('Appointment not found.', 404);
    const date = url.searchParams.get('date') ?? '';
    if (!isValidDateString(date) || !bookingDateIsInWindow(date, policy)) throw new ReservationError(`Choose a date within the next ${policy.daysAhead} days.`, 400);
    return { status: 200, data: { date, timezone: 'Europe/London', slots: getSlotsForDate(date, policy).map((slot) => ({ startAt: slot.startAt.toISOString(), label: slot.label, available: slotIsAvailable(slot.startAt, policy, occupied(), new Date(), staffAvailability?.[1]) })) } };
  }
  if (req.method === 'GET' && (path === '/api/enquiries' || path === '/api/test-drive-bookings')) return { status: 200, data: enquiries.filter((entry) => path === '/api/enquiries' || entry.type === 'viewing').map((entry) => publicBooking(entry, settings)) };
  if (req.method === 'POST' && (path === '/api/enquiries' || path === '/api/staff/enquiries')) {
    const staff = path === '/api/staff/enquiries';
    const rawInput = await body(req);
    if (staff && rawInput && Object.prototype.hasOwnProperty.call(rawInput, 'requestCallback')) throw new ReservationError('Website callback requests must use the public enquiry form.', 400);
    const parsed = (staff ? CreateStaffEnquiryBody : CreateEnquiryBody).safeParse(rawInput);
    if (!parsed.success) throw new ReservationError('Please check your contact details and chosen time.', 400);
    const input = parsed.data as ReturnType<typeof CreateStaffEnquiryBody.parse>;
    const requestCallback = !staff && "requestCallback" in input && input.requestCallback === true;
    if (!staff && "requestCallback" in input && input.type !== 'general') throw new ReservationError('Callback requests are only available for general enquiries.', 400);
    if (requestCallback && input.appointmentAt) throw new ReservationError('Callback requests cannot include an appointment.', 400);
    if (input.customerName.trim().length < 2) throw new ReservationError('Please provide the customer’s name.', 400);
    const adHoc = staff && "adHocVehicle" in input ? input.adHocVehicle : null;
    const owner = staff ? previewAssignment('assignedToId' in input ? input.assignedToId : null) : requestCallback ? { assignedToId: null, assignedToName: null } : {};
    const followUpAt = staff && "followUpAt" in input ? input.followUpAt : requestCallback ? showroomAvailability(settings.hours).callbackAt : null;
    const followUpNote = staff && "followUpNote" in input ? input.followUpNote : requestCallback ? 'Website callback requested' : null;
    const staffOptions = staff ? { allowOutsideHours: 'allowOutsideHours' in input ? input.allowOutsideHours : false, allowDoubleBooking: 'allowDoubleBooking' in input ? input.allowDoubleBooking : false } : undefined;
    if (staffOptions && input.type !== 'viewing' && (staffOptions.allowOutsideHours || staffOptions.allowDoubleBooking)) throw new ReservationError('Appointment exceptions apply only to a test drive.', 400);
    if (staff && followUpAt && followUpAt.getTime() <= Date.now()) throw new ReservationError('Choose a future follow-up time.', 400);

    if (adHoc && (input.vehicleId || input.type === 'viewing' || adHoc.title.trim().length < 2)) throw new ReservationError('Use an ad hoc car for an enquiry only, or choose a stock car for a test drive.', 400);
    if ((input.email || (!staff && !requestCallback && (input.type === 'viewing' || !input.preferredContact || input.preferredContact === 'email'))) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email ?? '')) throw new ReservationError('Please provide a valid email address.', 400);
    if ((staff || requestCallback || input.type === 'viewing' || input.preferredContact === 'phone' || input.preferredContact === 'whatsapp' || input.phone) && (!input.phone || !/^\+?[0-9]{7,15}$/.test(input.phone.replace(/[\s().\-/]/g, '')))) throw new ReservationError('Please provide a valid phone number.', 400);
    const sourceVehicle = previewStock.cars.find((entry) => entry.id === input.vehicleId);
    const [{ readPreviewSaleInventory }, { readPreviewPriceOverrides }] = await Promise.all([import('./sales'), import('./operations')]);
    const [saleInventory, prices] = await Promise.all([readPreviewSaleInventory(), readPreviewPriceOverrides()]);
    const vehicle = sourceVehicle ? { ...sourceVehicle, ...(prices[sourceVehicle.id] != null ? { price: prices[sourceVehicle.id] } : {}), inventoryStatus: saleInventory[sourceVehicle.id] ?? sourceVehicle.inventoryStatus } : undefined;
    if (input.vehicleId && !vehicle) throw new ReservationError('That car is no longer available.', 404);
    if (input.type === 'viewing' && vehicle?.inventoryStatus && vehicle.inventoryStatus !== 'available') throw new ReservationError('This car is not available for a test drive.', 409);
    if (input.type === 'viewing' && (!vehicle || !input.appointmentAt)) throw new ReservationError('Please choose a car and time.', 400);
    if (input.type === 'viewing' && vehicle && state.reservations.some(entry => entry.vehicleId === internalId(vehicle.id) && entry.status === 'reserved')) throw new ReservationError('This car is reserved and cannot be booked.', 409);
    if (input.type !== 'viewing' && input.appointmentAt) throw new ReservationError('Appointments are only available for test drives.', 400);
    const exception = input.appointmentAt && staffOptions ? staffException(input.appointmentAt, policy, occupied(), staffOptions) : null;
    const callOutcome = staff ? ('callOutcome' in input ? input.callOutcome : undefined) ?? (input.type === 'viewing' ? 'test_drive_booked' : 'information_given') : requestCallback ? 'callback_requested' : null;
    const outcomeProblem = requestCallback ? null : outcomeError({ appointmentAt: input.appointmentAt, followUpAt }, callOutcome);
    if (outcomeProblem) throw new ReservationError(outcomeProblem, 400);
    if (input.appointmentAt && !staff && !slotIsAvailable(input.appointmentAt, policy, occupied())) throw new ReservationError('That test-drive time is no longer available. Please choose another.', 409);
    const id = randomUUID(); const token = randomBytes(24).toString('base64url'); const now = new Date().toISOString();
    const viewing = input.type === 'viewing';
    const enquiry: PreviewEnquiry = { id, dealerId: 'local-preview', reference: `ENQ-${id.slice(0, 8).toUpperCase()}`, vehicleId: vehicle?.id ?? null, vehicleTitle: vehicle?.title ?? adHoc?.title.trim() ?? null, vehicleRegistration: vehicle ? vehicleRegistrationLabel(vehicle) : adHoc?.registration?.trim().toUpperCase() ?? null, vehiclePrice: vehicle?.price ?? adHoc?.price ?? null, vehicleUrl: vehicle ? `/vehicle/${vehicle.id}` : null, type: input.type, status: staff ? 'contacted' : 'new', customerName: input.customerName.trim(), email: input.email?.trim().toLowerCase() || null, phone: input.phone?.trim().replace(/[\s().\-/]/g, '') || null, preferredContact: staff || requestCallback ? 'phone' : input.preferredContact ?? 'email', message: input.message.trim(), followUpAt: followUpAt?.toISOString() ?? null, followUpNote: followUpAt ? followUpNote?.trim() || null : null, followUpCompletedAt: null, followUpRevision: 0, partExchangeRegistration: input.partExchange?.registration ?? null, partExchangeMileage: input.partExchange?.mileage ?? null, partExchangeCondition: input.partExchange?.condition ?? null, appointmentAt: input.appointmentAt?.toISOString() ?? null, appointmentCancelledAt: null, appointmentRevision: 0, appointmentStatus: viewing ? policy.confirmationMode === 'approval' ? 'pending' : 'confirmed' : null, appointmentDurationMinutes: viewing ? policy.durationMinutes : null, appointmentBufferMinutes: viewing ? policy.bufferMinutes : null, manageToken: viewing ? token : undefined, managePath: viewing ? `/viewing/${token}` : null, calendarIcs: null, events: [], customerNotificationStatus: 'not_sent', customerNotificationError: 'Email delivery is not configured.', customerNotificationSentAt: null, dealerNotificationStatus: 'not_sent', dealerNotificationError: 'Email delivery is not configured.', dealerNotificationSentAt: null, reminderStatus: 'not_scheduled', reminderError: null, reminderSentAt: null, source: staff ? adHoc ? 'phone_ad_hoc' : 'phone' : requestCallback ? 'website_callback' : 'website', createdAt: now, updatedAt: now };
    Object.assign(enquiry, exception ?? { appointmentOutsideHours: false, appointmentDoubleBooked: false, appointmentOverCapacity: false });
    Object.assign(enquiry, owner, { callOutcome, workspaceRevision: 0, attendance: 'scheduled', staffNote: null });
    if (requestCallback) enquiry.events = [{ id: randomUUID(), kind: 'enquiry_received', actor: 'customer', summary: 'Website callback requested', vehicleId: enquiry.vehicleId, vehicleTitle: enquiry.vehicleTitle, vehicleUrl: enquiry.vehicleUrl, occurredAt: now }];
    enquiries.unshift(enquiry);
    return { status: 201, data: publicBooking(enquiry, settings) };
  }
  const followUpChange = /^\/api\/staff\/enquiries\/([^/]+)\/follow-up$/.exec(path);
  if (req.method === 'POST' && followUpChange) {
    const parsed = ChangeStaffFollowUpBody.safeParse(await body(req));
    if (!parsed.success) throw new ReservationError('Check the follow-up details.', 400);
    const input = parsed.data;
    const entry = enquiries.find(entry => entry.id === followUpChange[1]);
    if (!entry) throw new ReservationError('Enquiry not found.', 404);
    if ((entry.followUpRevision ?? 0) !== input.expectedRevision) throw new ReservationError('This follow-up changed. Refresh before editing it.', 409);
    if (input.action === 'schedule' && (!input.followUpAt || input.followUpAt.getTime() <= Date.now())) throw new ReservationError('Choose a future follow-up time.', 400);
    if (input.action !== 'schedule' && (!entry.followUpAt || entry.followUpCompletedAt)) throw new ReservationError('There is no outstanding follow-up to update.', 409);
    entry.followUpAt = input.action === 'schedule' ? input.followUpAt!.toISOString() : input.action === 'cancel' ? null : entry.followUpAt;
    entry.followUpNote = input.action === 'schedule' ? input.followUpNote?.trim() || null : entry.followUpNote;
    entry.followUpCompletedAt = input.action === 'complete' ? new Date().toISOString() : null;
    entry.followUpRevision = (entry.followUpRevision ?? 0) + 1; entry.updatedAt = new Date().toISOString();
    return { status: 200, data: publicBooking(entry, settings) };
  }
  const staffChange = /^\/api\/staff\/enquiries\/([^/]+)\/appointment$/.exec(path);
  if (req.method === 'POST' && staffChange) {
    const parsed = ChangeStaffAppointmentBody.safeParse(await body(req));
    if (!parsed.success) throw new ReservationError('Check the appointment details.', 400);
    const booking = enquiries.find(entry => entry.id === staffChange[1] && entry.type === 'viewing');
    if (!booking) throw new ReservationError('Appointment not found.', 404);
    if ((booking.appointmentRevision ?? 0) !== parsed.data.expectedRevision || !previewManagement(booking, settings).canChange) throw new ReservationError('The appointment changed. Refresh before trying again.', 409);
    if (parsed.data.action === 'reschedule') {
      if (!parsed.data.appointmentAt) throw new ReservationError('Choose a future appointment time.', 400);
      const exception = staffException(parsed.data.appointmentAt, policy, occupied(), parsed.data, booking.id);
      booking.appointmentAt = parsed.data.appointmentAt.toISOString();
      booking.attendance = 'scheduled';
      Object.assign(booking, exception);
      booking.appointmentStatus = policy.confirmationMode === 'approval' ? 'pending' : 'confirmed';
      booking.appointmentDurationMinutes = policy.durationMinutes;
      booking.appointmentBufferMinutes = policy.bufferMinutes;
    } else booking.appointmentCancelledAt = new Date().toISOString();
    booking.appointmentRevision = (booking.appointmentRevision ?? 0) + 1;
    booking.updatedAt = new Date().toISOString();
    return { status: 200, data: publicBooking(booking, settings) };
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
      const currentCar = previewStock.cars.find(car => car.id === booking.vehicleId);
      if (booking.vehicleId && (!currentCar || currentCar.inventoryStatus && currentCar.inventoryStatus !== 'available' || state.reservations.some(entry => entry.vehicleId === internalId(booking.vehicleId!) && entry.status === 'reserved'))) throw new ReservationError('This car is no longer available for online test-drive changes. Please contact the showroom.', 409);
      if (!slotIsAvailable(parsed.data.appointmentAt, policy, occupied(), new Date(), booking.id)) throw new ReservationError('That time is no longer available. Please choose another.', 409);
      booking.appointmentRevision = (booking.appointmentRevision ?? 0) + 1;
      booking.attendance = 'scheduled'; booking.appointmentAt = parsed.data.appointmentAt.toISOString(); booking.appointmentStatus = policy.confirmationMode === 'approval' ? 'pending' : 'confirmed'; booking.appointmentDurationMinutes = policy.durationMinutes; booking.appointmentBufferMinutes = policy.bufferMinutes; booking.appointmentOutsideHours = false; booking.appointmentDoubleBooked = false; booking.appointmentOverCapacity = false; booking.updatedAt = new Date().toISOString();
      return { status: 200, data: previewManagement(booking, settings) };
    }
  }
  return undefined;
}
