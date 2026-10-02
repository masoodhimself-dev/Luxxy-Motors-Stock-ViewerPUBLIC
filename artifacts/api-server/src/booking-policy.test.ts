import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingDateIsInWindow, bookingPolicyError, defaultBookingPolicy, getSlotsForDate, localDateTimeToUtc, slotIsAvailable, validBookingDateTime, type BookingPolicy } from "./lib/booking-slots";
import { notificationVersion, viewingCalendarIcs } from "./lib/enquiry-links";
import { preserveTestDriveBooking } from "./lib/settings-content";

const policy = (overrides: Partial<BookingPolicy> = {}): BookingPolicy => ({ ...structuredClone(defaultBookingPolicy), ...overrides });
const now = new Date("2026-10-01T08:00:00Z");
const date = "2026-10-02";
const time = (hour: number, minute = 0) => localDateTimeToUtc(date, hour, minute);

test("booking hours generate full appointments with duration and preparation gaps", () => {
  const config = policy({ durationMinutes: 45, bufferMinutes: 15 });
  const slots = getSlotsForDate(date, config);
  assert.equal(slots.length, 8);
  assert.equal(slots[0].startAt.toISOString(), "2026-10-02T09:00:00.000Z");
  assert.equal(slots.at(-1)?.startAt.toISOString(), "2026-10-02T16:00:00.000Z");
  assert.equal(getSlotsForDate("2026-10-04", config).length, 0);
});

test("disabled bookings, closed days and blocked dates expose no times", () => {
  assert.deepEqual(getSlotsForDate(date, policy({ enabled: false })), []);
  assert.deepEqual(getSlotsForDate(date, policy({ blockedDates: [date] })), []);
  assert.deepEqual(getSlotsForDate("2026-02-30"), []);
});

test("notice and booking window are enforced with local dates", () => {
  assert.equal(validBookingDateTime(time(10), policy({ minimumNoticeHours: 26 }), now), false);
  assert.equal(validBookingDateTime(time(10), policy({ minimumNoticeHours: 24 }), now), true);
  assert.equal(bookingDateIsInWindow("2026-10-03", policy({ daysAhead: 1 }), now), false);
  assert.equal(validBookingDateTime(new Date(time(10).getTime() + 1), policy(), now), false);
});

test("London slot times follow daylight savings and skip non-existent times", () => {
  assert.equal(getSlotsForDate("2026-10-24")[0].startAt.toISOString(), "2026-10-24T09:00:00.000Z");
  assert.equal(getSlotsForDate("2026-10-26")[0].startAt.toISOString(), "2026-10-26T10:00:00.000Z");
  const config = policy(); config.weeklyHours[0] = { day: 0, enabled: true, open: "01:00", close: "03:00" };
  assert.equal(getSlotsForDate("2026-03-29", config).length, 2);
});

test("appointment duration cannot overrun closing across the spring clock change", () => {
  const config = policy({ durationMinutes: 120 });
  config.weeklyHours[0] = { day: 0, enabled: true, open: "00:30", close: "02:30" };
  assert.deepEqual(getSlotsForDate("2027-03-28", config), []);
});

test("existing snapshot duration and buffers prevent overlaps after policy changes", () => {
  const booked = [{ id: "first", appointmentAt: time(10), appointmentDurationMinutes: 45, appointmentBufferMinutes: 15 }];
  assert.equal(slotIsAvailable(time(10, 30), policy(), booked, now), false);
  assert.equal(slotIsAvailable(time(11), policy(), booked, now), true);
  assert.equal(slotIsAvailable(time(10), policy(), booked, now, "first"), true);
  assert.equal(slotIsAvailable(time(11), policy({ dailyCapacity: 1 }), booked, now), false);
  assert.equal(slotIsAvailable(time(11), policy({ dailyCapacity: 1 }), [], now), true);
});

test("a candidate's buffer also prevents running into a later appointment", () => {
  assert.equal(slotIsAvailable(time(10), policy({ durationMinutes: 30, bufferMinutes: 15 }), [{ appointmentAt: time(10, 30) }], now), false);
});

test("invalid policy days, hours and dates are rejected and older editors preserve policy", () => {
  const config = policy(); config.weeklyHours[0].day = 1;
  assert.match(bookingPolicyError(config)!, /once for each day/);
  const closed = policy(); closed.weeklyHours[1].close = "09:00";
  assert.match(bookingPolicyError(closed)!, /after opening/);
  assert.match(bookingPolicyError(policy({ blockedDates: ["2026-02-30"] }))!, /valid dates/);
  assert.deepEqual(preserveTestDriveBooking({}, { testDriveBooking: policy() }), { testDriveBooking: policy() });
  assert.equal(preserveTestDriveBooking({ testDriveBooking: { enabled: false } }, { testDriveBooking: policy() }).testDriveBooking.enabled, false);
});

test("pending requests have no calendar while confirmed invitations use snapshot duration", () => {
  const oldSecret = process.env.SESSION_SECRET; const oldOrigin = process.env.PUBLIC_SITE_URL;
  process.env.SESSION_SECRET = "synthetic-booking-test-secret"; process.env.PUBLIC_SITE_URL = "https://dealer.example";
  try {
    const enquiry = { id: "test", dealerId: "test-dealer", reference: "TEST", appointmentAt: time(10), appointmentCancelledAt: null, vehicleTitle: "Example car", appointmentStatus: "pending" as "pending" | "confirmed", appointmentDurationMinutes: 45, appointmentRevision: 3 };
    assert.equal(viewingCalendarIcs({ enquiry, dealerName: "Example" }), null);
    enquiry.appointmentStatus = "confirmed";
    const calendar = viewingCalendarIcs({ enquiry, dealerName: "Example" })!;
    assert.match(calendar, /DTEND:20261002T094500Z/);
    assert.match(calendar, /STATUS:CONFIRMED/);
    assert.match(calendar, /SEQUENCE:3/);
    assert.match(viewingCalendarIcs({ enquiry: { ...enquiry, appointmentCancelledAt: new Date() }, dealerName: "Example" })!, /METHOD:CANCEL/);
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret;
    if (oldOrigin === undefined) delete process.env.PUBLIC_SITE_URL; else process.env.PUBLIC_SITE_URL = oldOrigin;
  }
});


test("notification retries share a key but returning to the same appointment gets a new key", () => {
  const booked = { appointmentAt: time(10), appointmentStatus: "confirmed" as const, appointmentCancelledAt: null, appointmentRevision: 0 };
  assert.equal(notificationVersion(booked), notificationVersion({ ...booked }));
  assert.notEqual(notificationVersion(booked), notificationVersion({ ...booked, appointmentRevision: 2 }));
  assert.notEqual(notificationVersion({ ...booked, appointmentStatus: "pending" }), notificationVersion(booked));
});
