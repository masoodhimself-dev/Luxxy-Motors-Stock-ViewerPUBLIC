import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { addDays, dateStringInTimezone, defaultBookingPolicy, getSlotsForDate, type BookingPolicy } from "../../api-server/src/lib/booking-slots";
import { handlePreviewBooking, type BookingPreviewState } from "./reservations";
import { previewSettings } from "./settings";
import { previewStock } from "./stock";
const policy = (overrides: Partial<BookingPolicy> = {}): BookingPolicy => ({ ...structuredClone(defaultBookingPolicy), ...overrides });

async function call(state: BookingPreviewState, settings: typeof previewSettings, method: string, path: string, data?: object) {
  const req = Readable.from(data ? [JSON.stringify(data)] : []) as IncomingMessage;
  req.method = method;
  const result = await handlePreviewBooking(req, new URL(path, "http://localhost"), state, settings);
  assert.ok(result); return result as { status: number; data: any };
}

test('legacy enquiry labels are neutral in responses while stored identifiers and history remain unchanged', async () => {
  const state: BookingPreviewState = { reservations: [] };
  const settings = { ...previewSettings, testDriveBooking: policy() };
  await call(state, settings, 'POST', '/api/staff/enquiries', { vehicleId: null, type: 'general', customerName: 'Legacy record test', preferredContact: 'phone', email: null, phone: '07700900123', message: 'Existing enquiry', appointmentAt: null, assignedToId: 'preview-alex' });
  const entry = state.enquiries![0];
  entry.reference = 'PREVIEW-EXISTING'; entry.source = 'local-preview'; entry.assignedToName = 'Alex (preview)'; entry.customerNotificationError = 'Local preview — no email is sent.';
  const displayed = (await call(state, settings, 'GET', '/api/enquiries')).data[0];
  assert.equal(displayed.reference, 'PREVIEW-EXISTING'); assert.equal(displayed.source, 'website'); assert.equal(displayed.assignedToName, 'Alex'); assert.equal(displayed.customerNotificationError, 'Email delivery is not configured.');
  assert.equal(entry.source, 'local-preview'); assert.equal(entry.assignedToName, 'Alex (preview)'); assert.equal(entry.customerNotificationError, 'Local preview — no email is sent.');
});

test('new customer and staff enquiries snapshot the supplied plate and preserve existing registration records', async () => {
  const state: BookingPreviewState = { reservations: [] };
  const settings = { ...previewSettings, testDriveBooking: policy() };
  const vehicle = previewStock.cars[0];
  const original = { plate: vehicle.plate, vrm: vehicle.vrm, registration: vehicle.registration, registrationBand: vehicle.registrationBand };
  const payload = { vehicleId: vehicle.id, type: 'general', customerName: 'Registration Test', preferredContact: 'phone', email: null, phone: '07700900123', message: 'Please call about this car', appointmentAt: null };
  try {
    Object.assign(vehicle, { plate: ' ab12 cde ', vrm: 'XY34 ZZZ', registration: '2019 (19 reg)', registrationBand: '19' });
    const customer = await call(state, settings, 'POST', '/api/enquiries', payload);
    assert.equal(customer.data.vehicleRegistration, 'AB12 CDE');
    vehicle.plate = ' '; vehicle.vrm = ' xy34 zzz ';
    const staff = await call(state, settings, 'POST', '/api/staff/enquiries', payload);
    assert.equal(staff.data.vehicleRegistration, 'XY34 ZZZ');
    vehicle.vrm = null; vehicle.registration = ' ab12 cde ';
    assert.equal((await call(state, settings, 'POST', '/api/enquiries', payload)).data.vehicleRegistration, 'AB12 CDE');
    vehicle.registration = '2019 (19 reg)';
    assert.equal((await call(state, settings, 'POST', '/api/enquiries', payload)).data.vehicleRegistration, '2019 (19 reg)');
    const historical = state.enquiries!.find(entry => entry.id === customer.data.id)!;
    historical.vehicleRegistration = '2018 (18 reg)';
    vehicle.plate = 'ZZ99 ZZZ';
    const listed = (await call(state, settings, 'GET', '/api/enquiries')).data;
    assert.equal(listed.find((entry: { id: string }) => entry.id === customer.data.id).vehicleRegistration, '2018 (18 reg)');
    assert.equal(listed.find((entry: { id: string }) => entry.id === staff.data.id).vehicleRegistration, 'XY34 ZZZ');
    assert.equal(historical.vehicleRegistration, '2018 (18 reg)');
  } finally {
    Object.assign(vehicle, original);
  }
});

test("local booking lifecycle holds pending capacity, confirms, reschedules and releases cancellation", async () => {
  const state: BookingPreviewState = { reservations: [] };
  const config = policy({ confirmationMode: "approval", dailyCapacity: 1 });
  const settings = { ...previewSettings, testDriveBooking: config };
  let day = addDays(dateStringInTimezone(new Date()), 1);
  while (!getSlotsForDate(day, config).length) day = addDays(day, 1);
  const availability = await call(state, settings, "GET", `/api/enquiries/availability?date=${day}`);
  const first = availability.data.slots[0]; const second = availability.data.slots[1];
  const payload = { vehicleId: previewStock.cars[0].id, type: "viewing", customerName: "Synthetic Customer", email: "synthetic@example.test", phone: "07700900123", preferredContact: "email", message: "Test only", appointmentAt: first.startAt };
  const booked = await call(state, settings, "POST", "/api/enquiries", payload);
  assert.equal(booked.status, 201); assert.equal(booked.data.appointmentStatus, "pending"); assert.equal(booked.data.calendarIcs, null); assert.equal(booked.data.customerNotificationStatus, "not_sent");
  assert.match(booked.data.reference, /^ENQ-/); assert.equal(booked.data.source, 'website'); assert.equal(booked.data.customerNotificationError, 'Email delivery is not configured.');
  assert.equal((await call(state, settings, "GET", `/api/enquiries/availability?date=${day}`)).data.slots.some((slot: { available: boolean }) => slot.available), false);
  await assert.rejects(call(state, settings, "POST", "/api/enquiries", { ...payload, appointmentAt: second.startAt }), /no longer available/);
  const confirmed = await call(state, settings, "POST", `/api/test-drive-bookings/${booked.data.id}/decision`, { decision: "confirm", expectedRevision: 0 });
  assert.equal(confirmed.data.appointmentStatus, "confirmed"); assert.match(confirmed.data.calendarIcs, /STATUS:CONFIRMED/);
  assert.ok(confirmed.data.calendarIcs.includes(`PRODID:-//${settings.identity.name}//Test drive//EN`));
  assert.ok(confirmed.data.calendarIcs.includes(`UID:${booked.data.id}@local-preview`));
  const path = `/api${booked.data.managePath}`.replace('/viewing/', '/viewings/');
  assert.equal((await call(state, settings, "GET", path)).data.status, "booked");
  const moved = await call(state, settings, "POST", `${path}/reschedule`, { appointmentAt: second.startAt });
  await assert.rejects(call(state, settings, "POST", `/api/test-drive-bookings/${booked.data.id}/decision`, { decision: "confirm", expectedRevision: 0 }), /has changed/);
  assert.equal(moved.data.status, "pending"); assert.equal(moved.data.calendarIcs, null);
  assert.equal((await call(state, settings, "POST", `${path}/cancel`, {})).data.status, "cancelled");
  assert.equal((await call(state, settings, "GET", `/api/enquiries/availability?date=${day}`)).data.slots[0].available, true);
  const another = await call(state, settings, "POST", "/api/enquiries", payload);
  const declined = await call(state, settings, "POST", `/api/test-drive-bookings/${another.data.id}/decision`, { decision: "decline", expectedRevision: 0 });
  assert.ok(declined.data.appointmentCancelledAt); assert.equal(declined.data.calendarIcs, null);
  await assert.rejects(call(state, settings, "POST", `/api/test-drive-bookings/${another.data.id}/decision`, { decision: "confirm", expectedRevision: 0 }), /has changed/);
});

test('staff phone-only enquiries and appointments preserve capacity and reject stale edits', async () => {
  const state: BookingPreviewState = { reservations: [] };
  const config = policy({ dailyCapacity: 1 });
  const settings = { ...previewSettings, testDriveBooking: config };
  let day = addDays(dateStringInTimezone(new Date()), 1);
  while (!getSlotsForDate(day, config).length) day = addDays(day, 1);
  const slots = (await call(state, settings, 'GET', `/api/enquiries/availability?date=${day}`)).data.slots;
  const payload = { vehicleId: previewStock.cars[0].id, type: 'general', customerName: 'Phone Caller', email: null, phone: '07700900123', preferredContact: 'phone', message: 'Called showroom', appointmentAt: null };
  const enquiry = await call(state, settings, 'POST', '/api/staff/enquiries', payload);
  assert.equal(enquiry.data.email, null); assert.equal(enquiry.data.source, 'phone'); assert.equal(enquiry.data.status, 'contacted');
  assert.equal((await call(state, settings, 'POST', '/api/enquiries', payload)).status, 201);
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', { ...payload, phone: '' }));
  const booked = await call(state, settings, 'POST', '/api/staff/enquiries', { ...payload, type: 'viewing', appointmentAt: slots[0].startAt });
  assert.equal(booked.data.appointmentStatus, 'confirmed');
  const path = `/api/staff/enquiries/${booked.data.id}/appointment`;
  assert.equal((await call(state, settings, 'GET', `/api/enquiries/availability?date=${day}`)).data.slots[1].available, false);
  assert.equal((await call(state, settings, 'GET', `/api/staff/enquiries/${booked.data.id}/availability?date=${day}`)).data.slots[1].available, true);
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', { ...payload, type: 'viewing', appointmentAt: slots[0].startAt }), /overlaps|capacity/);
  const moved = await call(state, settings, 'POST', path, { action: 'reschedule', appointmentAt: slots[1].startAt, expectedRevision: 0 });
  assert.equal(moved.data.appointmentAt, slots[1].startAt); assert.equal(moved.data.appointmentRevision, 1);
  await assert.rejects(call(state, settings, 'POST', path, { action: 'cancel', expectedRevision: 0 }), /changed/);
  const cancelled = await call(state, settings, 'POST', path, { action: 'cancel', expectedRevision: 1 });
  assert.ok(cancelled.data.appointmentCancelledAt); assert.equal(cancelled.data.appointmentRevision, 2);
  assert.equal((await call(state, settings, 'GET', `/api/enquiries/availability?date=${day}`)).data.slots[1].available, true);
});

test('staff exceptions require explicit overrides and remain visible; customer booking stays protected', async () => {
  const state: BookingPreviewState = { reservations: [] };
  const config = policy({ dailyCapacity: 2 });
  const settings = { ...previewSettings, testDriveBooking: config };
  let day = addDays(dateStringInTimezone(new Date()), 2);
  while (!getSlotsForDate(day, config).length) day = addDays(day, 1);
  const first = getSlotsForDate(day, config)[0].startAt.toISOString();
  const afterHours = new Date(first); afterHours.setUTCHours(21, 0, 0, 0);
  const payload = { vehicleId: previewStock.cars[0].id, type: 'viewing', customerName: 'Staff Test', email: null, phone: '07700900123', preferredContact: 'phone', message: 'Staff booking test', appointmentAt: first };
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', { ...payload, appointmentAt: afterHours.toISOString() }), /outside normal booking hours/);
  const outside = await call(state, settings, 'POST', '/api/staff/enquiries', { ...payload, appointmentAt: afterHours.toISOString(), allowOutsideHours: true });
  assert.equal(outside.data.appointmentOutsideHours, true);
  assert.equal(outside.data.appointmentDoubleBooked, false);
  const regular = await call(state, settings, 'POST', '/api/staff/enquiries', payload);
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', payload), /overlaps|capacity/);
  const doubled = await call(state, settings, 'POST', '/api/staff/enquiries', { ...payload, allowDoubleBooking: true });
  assert.equal(doubled.data.appointmentDoubleBooked, true);
  assert.equal(doubled.data.appointmentOverCapacity, true);
  await assert.rejects(call(state, settings, 'POST', '/api/enquiries', { ...payload, email: 'customer@example.test', allowDoubleBooking: true }), /no longer available|Invalid/);
  const moved = await call(state, settings, 'POST', `/api/staff/enquiries/${regular.data.id}/appointment`, { action: 'reschedule', appointmentAt: afterHours.toISOString(), expectedRevision: 0, allowOutsideHours: true, allowDoubleBooking: true });
  assert.equal(moved.data.appointmentOutsideHours, true);
  assert.equal(moved.data.appointmentDoubleBooked, true);
});

test('ad hoc phone enquiry persists vehicle details and follow-up lifecycle without booking or creating stock', async () => {
  const state: BookingPreviewState = { reservations: [] };
  const settings = { ...previewSettings, testDriveBooking: policy() };
  const followUpAt = new Date(Date.now() + 86400000).toISOString();
  const input = { vehicleId: null, type: 'general', customerName: 'Ad Hoc Caller', email: null, phone: '07700900123', preferredContact: 'phone', message: 'Wants to discuss a car not in stock.', appointmentAt: null, adHocVehicle: { title: '2018 Volkswagen Golf', registration: 'ab18 xyz', price: 9000 }, followUpAt, followUpNote: 'Call with service history details' };
  const stockCount = previewStock.cars.length;
  const result = await call(state, settings, 'POST', '/api/staff/enquiries', input);
  assert.equal(result.data.vehicleId, null); assert.equal(result.data.vehicleTitle, input.adHocVehicle.title); assert.equal(result.data.vehicleRegistration, 'AB18 XYZ'); assert.equal(result.data.vehiclePrice, 9000); assert.equal(result.data.source, 'phone_ad_hoc'); assert.equal(result.data.appointmentAt, null); assert.equal(result.data.followUpAt, followUpAt); assert.equal(previewStock.cars.length, stockCount);
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', { ...input, vehicleId: previewStock.cars[0].id }), /ad hoc/);
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', { ...input, type: 'viewing', appointmentAt: followUpAt }), /ad hoc/);
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', { ...input, adHocVehicle: { title: '  ' } }), /ad hoc/);
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', { ...input, followUpAt: '2020-01-01T09:00:00Z' }), /future/);
  const path = `/api/staff/enquiries/${result.data.id}/follow-up`;
  const completed = await call(state, settings, 'POST', path, { action: 'complete', expectedRevision: 0 });
  assert.ok(completed.data.followUpCompletedAt); assert.equal(completed.data.followUpRevision, 1);
  await assert.rejects(call(state, settings, 'POST', path, { action: 'schedule', expectedRevision: 0, followUpAt }), /changed/);
  const rescheduled = await call(state, settings, 'POST', path, { action: 'schedule', expectedRevision: 1, followUpAt, followUpNote: 'Call again' });
  assert.equal(rescheduled.data.followUpCompletedAt, null); assert.equal(rescheduled.data.followUpNote, 'Call again');
  const cancelled = await call(state, settings, 'POST', path, { action: 'cancel', expectedRevision: 2 });
  assert.equal(cancelled.data.followUpAt, null); assert.equal(cancelled.data.appointmentAt, null);
  assert.equal((await call(state, settings, 'GET', '/api/enquiries')).data[0].vehicleTitle, input.adHocVehicle.title);
});

test('workspace ownership, outcomes and attendance persist with revision and transition protection', async () => {
  const state: BookingPreviewState = { reservations: [] };
  const settings = { ...previewSettings, testDriveBooking: policy() };
  const input = { vehicleId: null, type: 'general', customerName: 'Workspace Test', preferredContact: 'phone', email: null, phone: '07700900123', message: 'Original call note', appointmentAt: null, assignedToId: 'preview-alex', callOutcome: 'information_given' };
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', { ...input, assignedToId: 'other-dealer-user' }), /staff member/);
  const created = (await call(state, settings, 'POST', '/api/staff/enquiries', input)).data;
  assert.equal(created.assignedToName, 'Alex');
  const path = `/api/staff/enquiries/${created.id}/workspace`;
  const edited = (await call(state, settings, 'PATCH', path, { expectedRevision: 0, assignedToId: 'preview-jamie', callOutcome: 'no_answer', staffNote: 'Try tomorrow' })).data;
  assert.equal(edited.workspaceRevision, 1); assert.equal(edited.message, 'Original call note'); assert.equal(edited.assignedToName, 'Jamie');
  await assert.rejects(call(state, settings, 'PATCH', path, { expectedRevision: 0, staffNote: 'Stale edit' }), /changed/);
  await assert.rejects(call(state, settings, 'PATCH', path, { expectedRevision: 1, callOutcome: 'test_drive_booked' }), /Book an appointment/);
  await assert.rejects(call(state, settings, 'PATCH', path, { expectedRevision: 1, callOutcome: 'callback_requested' }), /follow-up/);
  await assert.rejects(call(state, settings, 'PATCH', path, { expectedRevision: 1, expectedAppointmentRevision: 0, attendance: 'arrived' }), /active appointment/);
  // Isolated fixture models a customer whose appointment started five minutes ago.
  const entry = state.enquiries![0]; entry.type = 'viewing'; entry.appointmentAt = new Date(Date.now() - 300000).toISOString(); entry.appointmentStatus = 'confirmed';
  await assert.rejects(call(state, settings, 'PATCH', path, { expectedRevision: 1, expectedAppointmentRevision: 8, attendance: 'arrived' }), /appointment changed/);
  await assert.rejects(call(state, settings, 'PATCH', path, { expectedRevision: 1, expectedAppointmentRevision: 0, attendance: 'completed' }), /arrived/);
  const arrived = (await call(state, settings, 'PATCH', path, { expectedRevision: 1, expectedAppointmentRevision: 0, attendance: 'arrived' })).data;
  assert.equal(arrived.attendance, 'arrived');
  const complete = (await call(state, settings, 'PATCH', path, { expectedRevision: 2, expectedAppointmentRevision: 0, attendance: 'completed' })).data;
  assert.equal(complete.attendance, 'completed');
  entry.appointmentCancelledAt = new Date().toISOString();
  await assert.rejects(call(state, settings, 'PATCH', path, { expectedRevision: 3, expectedAppointmentRevision: 0, attendance: 'scheduled' }), /active appointment/);
});

test('customer phone enquiry needs no email but email replies and test drives still require it', async () => {
 const state: BookingPreviewState = { reservations: [] };
 const settings = { ...previewSettings, testDriveBooking: policy() };
 const payload = { vehicleId: previewStock.cars[0].id, type: 'general', customerName: 'Customer Test', email: null, phone: '07700900123', preferredContact: 'phone', message: 'Please call about the history', appointmentAt: null };
 const saved = await call(state, settings, 'POST', '/api/enquiries', payload);
 assert.equal(saved.status, 201); assert.equal(saved.data.email, null); assert.equal(saved.data.preferredContact, 'phone');
 await assert.rejects(call(state, settings, 'POST', '/api/enquiries', { ...payload, preferredContact: 'email' }), /email/);
 await assert.rejects(call(state, settings, 'POST', '/api/enquiries', { ...payload, phone: null }), /phone/);
 await assert.rejects(call(state, settings, 'POST', '/api/enquiries', { ...payload, type: 'viewing' }), /email/);
});
