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
  assert.equal((await call(state, settings, "GET", `/api/enquiries/availability?date=${day}`)).data.slots.some((slot: { available: boolean }) => slot.available), false);
  await assert.rejects(call(state, settings, "POST", "/api/enquiries", { ...payload, appointmentAt: second.startAt }), /no longer available/);
  const confirmed = await call(state, settings, "POST", `/api/test-drive-bookings/${booked.data.id}/decision`, { decision: "confirm", expectedRevision: 0 });
  assert.equal(confirmed.data.appointmentStatus, "confirmed"); assert.match(confirmed.data.calendarIcs, /STATUS:CONFIRMED/);
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
  await assert.rejects(call(state, settings, 'POST', '/api/enquiries', payload));
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
