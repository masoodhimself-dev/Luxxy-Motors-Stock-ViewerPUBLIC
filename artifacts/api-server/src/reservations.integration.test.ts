import "./test/setup";
/**
 * The mandatory setup rejects production/non-loopback databases and blocks
 * external requests. Every fixture and deletion below belongs to this suite's
 * unique dealer namespace. No migrations, schema changes or truncation run.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import test, { after, beforeEach } from "node:test";
import { eq, inArray } from "drizzle-orm";
import type { OnlineReservationInput } from "./lib/online-reservations";

process.env.SESSION_SECRET = "reservation-integration-session-secret";
process.env.STOCK_DEALER_ID = `reservations-test-${process.pid}-${randomUUID()}`;
process.env.PORTAL_API_TOKEN = `reservations-integration-token-${randomUUID()}`;
process.env.RESERVATION_PAYMENT_MODE = "simulated";
process.env.STOCK_MISSING_HIDE_THRESHOLD = "2";

const {
  db, pool, dealerSettingsTable, leadEventsTable, leadsTable,
  salePaymentsTable, salesTable, vehiclesTable,
} = await import("@workspace/db");
const { default: app } = await import("./app");
const dealerId = process.env.STOCK_DEALER_ID!;
const portalToken = process.env.PORTAL_API_TOKEN!;
const terms = "Synthetic test terms: the car is held until dealership staff release the reservation.";
const server: Server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to start reservation test listener");
const baseUrl = `http://127.0.0.1:${address.port}/api`;
let vehicleId = "";

async function request(path: string, init: RequestInit = {}, staff = false) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (staff) headers.set("x-portal-token", portalToken);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function json<T>(response: Response): Promise<T> { return await response.json() as T; }

function payload(overrides: Partial<OnlineReservationInput> = {}): OnlineReservationInput {
  return {
    vehicleId, idempotencyKey: randomUUID(), customerName: "Synthetic Reservation Customer",
    email: "reservation@example.test", phone: "07700900123",
    expectedPricePence: 1850000, expectedDepositPence: 10000,
    termsAccepted: true, terms,
    ...overrides,
  };
}

function reserve(input = payload()) {
  return request("/reservations", { method: "POST", body: JSON.stringify(input) });
}

function cancel(id: string, staff = true) {
  return request(`/reservations/${id}/cancel`, { method: "POST" }, staff);
}

async function savedVehicle() {
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  assert.ok(vehicle);
  return vehicle;
}

async function savedLeads() {
  return db.select().from(leadsTable).where(eq(leadsTable.dealerId, dealerId));
}

async function savedEvents() {
  return db.select({ event: leadEventsTable }).from(leadEventsTable)
    .innerJoin(leadsTable, eq(leadEventsTable.leadId, leadsTable.id))
    .where(eq(leadsTable.dealerId, dealerId));
}

async function cleanupNamespace() {
  const leads = await savedLeads();
  if (leads.length) {
    await db.delete(leadEventsTable).where(inArray(leadEventsTable.leadId, leads.map((lead) => lead.id)));
  }
  await db.delete(leadsTable).where(eq(leadsTable.dealerId, dealerId));
  await db.delete(vehiclesTable).where(eq(vehiclesTable.dealerId, dealerId));
  await db.delete(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, dealerId));
}

beforeEach(async () => {
  process.env.STOCK_DEALER_ID = dealerId;
  await cleanupNamespace();
  await db.insert(dealerSettingsTable).values({ dealerId, config: {
    onlineReservation: { enabled: true, depositPence: 10000, terms },
  } });
  const [vehicle] = await db.insert(vehiclesTable).values({
    dealerId, source: "autotrader", advertId: `reservation-${randomUUID()}`,
    title: "Synthetic Reservation Vehicle", make: "Testmaker", model: "Reserve", year: 2021,
    sourcePrice: 18500, currency: "GBP", mileage: 31000, registration: "TEST 21",
    inventoryStatus: "available", sourceStatus: "live", missingCount: 0,
  }).returning({ id: vehiclesTable.id });
  vehicleId = vehicle!.id;
});

after(async () => {
  try { await cleanupNamespace(); }
  finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
});

// Public card reservations are release-disabled. The supported reservation
// business rules are exercised by test:reservations (18 isolated policy tests).
test('release-disabled public reservations cannot create holds, leads, payments or change stock', async () => {
  const before = await savedVehicle(), leads = await savedLeads(), events = await savedEvents();
  const payments = await db.select().from(salePaymentsTable);
  for (const path of ['/reservations', '/reservations/checkout']) {
    for (const body of [payload(), payload({ expectedPricePence: 1 }), {}, { vehicleId: randomUUID() }]) {
      const response = await request(path, { method: 'POST', body: JSON.stringify(body) });
      assert.equal(response.status, 410); assert.match((await json<{ error: string }>(response)).error, /unavailable/);
    }
  }
  assert.deepEqual(await savedVehicle(), before); assert.deepEqual(await savedLeads(), leads); assert.deepEqual(await savedEvents(), events);
  assert.deepEqual(await db.select().from(salePaymentsTable), payments);
  assert.equal((await db.select().from(salesTable).where(eq(salesTable.dealerId, dealerId))).length, 0);
});

test('public readiness and showroom settings stay disabled even when an old saved switch is enabled', async () => {
  const readiness = await request('/reservations/payment-readiness'); assert.equal(readiness.status, 200);
  assert.deepEqual(await readiness.json(), { enabled: false, mode: null, prepared: true });
  const response = await request('/dealer-settings'); assert.equal(response.status, 200);
  assert.equal((await json<{ onlineReservation: { enabled: boolean } }>(response)).onlineReservation.enabled, false);
  const [saved] = await db.select().from(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, dealerId));
  assert.equal((saved!.config.onlineReservation as { enabled: boolean }).enabled, true, 'the release guard does not overwrite saved preferences');
});

test('staff reservation history and cancellation routes retain authorization while public creation is disabled', async () => {
  assert.equal((await request('/reservations')).status, 401);
  const listed = await request('/reservations', {}, true); assert.equal(listed.status, 200);
  assert.ok(Array.isArray((await json<{ reservations: unknown[] }>(listed)).reservations));
  const before = await savedVehicle();
  assert.equal((await cancel(randomUUID(), false)).status, 401);
  const cancelled = await cancel(randomUUID()); assert.equal(cancelled.status, 404);
  assert.deepEqual(await savedVehicle(), before); assert.equal((await savedLeads()).length, 0);
});

test('publishing reservation settings uses the version header and cannot bypass the release guard', async () => {
  const loaded = await request('/dealer-settings'); const config = await json<Record<string, any>>(loaded);
  const updated = await request('/dealer-settings', { method: 'PATCH', headers: { 'If-Match': loaded.headers.get('x-settings-revision')! }, body: JSON.stringify({ ...config, onlineReservation: { ...config.onlineReservation, enabled: false } }) }, true);
  assert.equal(updated.status, 200, await updated.clone().text());
  assert.equal(Number(updated.headers.get('x-settings-revision')), Number(loaded.headers.get('x-settings-revision')) + 1);
  const before = await savedVehicle(); const blocked = await reserve(); assert.equal(blocked.status, 410);
  assert.deepEqual(await savedVehicle(), before); assert.equal((await savedLeads()).length, 0);
});
