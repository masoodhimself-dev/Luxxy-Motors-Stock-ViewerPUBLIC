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
  await assert.rejects(call(state, settings, 'POST', '/api/staff/enquiries', { ...payload, type: 'viewing', appointmentAt: slots[0].startAt }), /no longer available/);
  const moved = await call(state, settings, 'POST', path, { action: 'reschedule', appointmentAt: slots[1].startAt, expectedRevision: 0 });
  assert.equal(moved.data.appointmentAt, slots[1].startAt); assert.equal(moved.data.appointmentRevision, 1);
  await assert.rejects(call(state, settings, 'POST', path, { action: 'cancel', expectedRevision: 0 }), /changed/);
  const cancelled = await call(state, settings, 'POST', path, { action: 'cancel', expectedRevision: 1 });
  assert.ok(cancelled.data.appointmentCancelledAt); assert.equal(cancelled.data.appointmentRevision, 2);
  assert.equal((await call(state, settings, 'GET', `/api/enquiries/availability?date=${day}`)).data.slots[1].available, true);
});
