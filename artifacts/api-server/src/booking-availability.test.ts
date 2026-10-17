import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { getTableColumns } from 'drizzle-orm';
import { defaultBookingPolicy, getSlotsForDate, addDays, dateStringInTimezone } from './lib/booking-slots';

// The real production routers run through a synthetic driver; no listener or database can be contacted.
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.MULTI_TENANT_ENABLED = 'true';
const { pool, db, enquiriesTable, vehiclesTable } = await import('@workspace/db');
const { default: enquiriesRouter } = await import('./routes/enquiries');
const { default: viewingsRouter } = await import('./routes/viewings');
const { ensureBookingVehicleAvailable, BookingConflict } = await import('./lib/booking-store');
const { runWithTenant } = await import('./lib/tenant-context');
const { viewingTokenHash } = await import('./lib/enquiry-links');
const dealerId = 'fictional-booking-dealer';
const bookingId = '00000000-0000-4000-8000-000000000001';
const vehicleId = '00000000-0000-4000-8000-000000000002';
const token = 'fictional-booking-manage-token';
const tenant = { dealerId, canonicalOrigin: 'https://booking.example.test', platform: 'autotrader' as const, retailerId: 'fictional', sourceUrl: 'https://www.autotrader.co.uk/example' };
let day = addDays(dateStringInTimezone(new Date()), 2);
while (!getSlotsForDate(day).length) day = addDays(day, 1);
const slots = getSlotsForDate(day);
const originalAppointment = slots[0].startAt.toISOString(), nextAppointment = slots[1].startAt.toISOString();
const booking: Record<string, unknown> = { id: bookingId, dealerId, type: 'viewing', appointmentAt: originalAppointment, appointmentRevision: 0, appointmentStatus: 'pending', vehicleId, manageTokenHash: viewingTokenHash(token) };
const availableVehicle = { id: vehicleId, dealerId, source: 'autotrader', inventoryStatus: 'available', missingCount: 0, sourcePrice: 9000, priceReviewRequired: false };
let vehicle: Record<string, unknown> | null = { ...availableVehicle };
const queries: string[] = [];
function rowsFor(table: typeof enquiriesTable | typeof vehiclesTable, record: Record<string, unknown> | null) {
  return record ? [Object.keys(getTableColumns(table)).map(key => record[key] ?? null)] : [];
}
async function query(config: string | { text: string }, params: unknown[] = []) {
  const text = typeof config === 'string' ? config : config.text;
  queries.push(text);
  if (/^(begin|commit|rollback)/i.test(text) || /pg_advisory_xact_lock/.test(text)) return { rows: [] };
  if (/from "dealer_settings"/.test(text)) return { rows: [[{ testDriveBooking: defaultBookingPolicy }]] };
  if (/from "dealer_private_settings"/.test(text)) return { rows: [] };
  if (/from "enquiries"/.test(text)) {
    assert.ok(params.includes(dealerId), 'booking read is scoped to this dealer');
    return { rows: rowsFor(enquiriesTable, booking) };
  }
  if (/from "vehicles"/.test(text)) {
    assert.ok(params.includes(dealerId), 'stock read is scoped to this dealer');
    assert.ok(params.includes(vehicleId));
    assert.match(text, /for update/i, 'availability is rechecked under a row lock');
    return { rows: rowsFor(vehiclesTable, vehicle) };
  }
  throw new Error(`Unexpected query in isolated booking test: ${text}`);
}
async function request(router: typeof enquiriesRouter, path: string, body: unknown) {
  return runWithTenant(tenant, () => new Promise<{ status: number; data: any }>((resolve, reject) => {
    let status = 200;
    const req = { method: 'POST', url: path, headers: {}, body, ip: 'fictional', get: () => undefined, log: { error() {}, warn() {} }, staff: { authUserId: 'fictional-staff', name: 'Fictional Staff', role: 'owner' } } as unknown as Request;
    const res = { status(value: number) { status = value; return this; }, json(data: unknown) { resolve({ status, data }); return this; } } as unknown as Response;
    router(req, res, error => error ? reject(error) : reject(new Error('Booking route did not respond')));
  }));
}

test('production booking changes recheck current dealer stock and give an accurate unavailable-car error', async t => {
  const originalConnect = pool.connect, originalQuery = pool.query;
  (pool as any).query = query;
  (pool as any).connect = async () => ({ query, release() {} });
  try {
    for (const inventoryStatus of ['reserved', 'sold', 'hidden', 'archived']) {
      await t.test(`${inventoryStatus} cars cannot be confirmed or rescheduled by staff or customers`, async () => {
        vehicle = { ...availableVehicle, inventoryStatus };
        const original = structuredClone(booking);
        for (const [router, path, input] of [
          [enquiriesRouter, `/test-drive-bookings/${bookingId}/decision`, { decision: 'confirm', expectedRevision: 0 }],
          [enquiriesRouter, `/staff/enquiries/${bookingId}/appointment`, { action: 'reschedule', appointmentAt: nextAppointment, expectedRevision: 0 }],
          [viewingsRouter, `/viewings/${token}/reschedule`, { appointmentAt: nextAppointment }],
        ] as const) {
          const response = await request(router, path, input);
          assert.equal(response.status, 409, path);
          assert.match(response.data.error, /car is no longer available.*contact the showroom/i);
          assert.doesNotMatch(response.data.error, /slot has just been taken/i);
        }
        assert.deepEqual(booking, original, 'rejection leaves appointment and revision untouched');
      });
    }
    await t.test('the shared guard rejects missing, unpublished and wrong-source cars', async () => {
      for (const stock of [null, { ...availableVehicle, archivedAt: new Date().toISOString() }, { ...availableVehicle, missingCount: 2 }, { ...availableVehicle, source: 'cazoo' }, { ...availableVehicle, sourcePrice: null, priceReviewRequired: true }]) {
        vehicle = stock;
        await assert.rejects(runWithTenant(tenant, () => db.transaction(tx => ensureBookingVehicleAvailable(tx, dealerId, vehicleId))), BookingConflict);
      }
      vehicle = { ...availableVehicle };
      await runWithTenant(tenant, () => db.transaction(tx => ensureBookingVehicleAvailable(tx, dealerId, vehicleId)));
      await assert.rejects(runWithTenant(tenant, () => db.transaction(tx => ensureBookingVehicleAvailable(tx, dealerId, null))), BookingConflict);
    });
    await t.test('stale staff changes are rejected before examining the car', async () => {
      queries.length = 0;
      const response = await request(enquiriesRouter, `/staff/enquiries/${bookingId}/appointment`, { action: 'reschedule', appointmentAt: nextAppointment, expectedRevision: 99 });
      assert.equal(response.status, 409);
      assert.match(response.data.error, /changed/i);
      assert.ok(!queries.some(text => /from "vehicles"/.test(text)));
    });
  } finally { pool.connect = originalConnect; pool.query = originalQuery; await pool.end(); }
});
