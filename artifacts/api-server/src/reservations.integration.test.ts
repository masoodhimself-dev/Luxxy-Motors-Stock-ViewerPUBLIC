import "./test/setup";
/**
 * The mandatory setup rejects production/non-loopback databases and blocks
 * external requests. Every fixture and deletion below belongs to this suite's
 * unique dealer namespace. No migrations, schema changes or truncation run.
 */
import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { createServer, type Server } from "node:http";
import test, { after, beforeEach, mock } from "node:test";
import { eq, inArray } from "drizzle-orm";
import type { OnlineReservationInput, reservationView } from "./lib/online-reservations";

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

type Reservation = ReturnType<typeof reservationView>;
type StaffReservation = Reservation & { customerName: string; email: string; phone: string; leadId: string };

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

test("persists an online hold and customer lead without recording received money; staff access is required", async () => {
  const response = await reserve(payload({ partExchange: { registration: "AB12 CDE", mileage: 45000 } }));
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  const created = await json<Reservation>(response);
  assert.equal(created.status, "reserved");
  assert.equal(created.paymentStatus, "simulated");
  assert.equal(created.amountReceivedPence, 0);
  assert.equal(created.depositPence, 10000);
  for (const privateKey of ["customerName", "email", "phone", "idempotencyKey", "requestFingerprint", "terms"]) {
    assert.equal(privateKey in created, false, `${privateKey} must not leak into the public response`);
  }
  assert.equal((await savedVehicle()).inventoryStatus, "reserved");
  const leads = await savedLeads();
  assert.equal(leads.length, 1);
  assert.equal(leads[0]!.id, created.id);
  assert.equal(leads[0]!.stage, "reserved");
  assert.equal(leads[0]!.depositPence, 0);
  assert.equal(leads[0]!.depositMethod, null);
  assert.equal(leads[0]!.depositTakenAt, null);
  const events = await savedEvents();
  assert.equal(events.length, 2);
  assert.equal(events.some(({ event }) => event.type === "deposit_recorded"), false);
  const snapshot = events.find(({ event }) => event.payload.kind === "online_reservation")!.event.payload.reservation as Record<string, unknown>;
  assert.deepEqual(snapshot.partExchange, { registration: "AB12 CDE", mileage: 45000 });
  assert.equal(snapshot.terms, terms);
  assert.equal(snapshot.termsAccepted, true);
  const payments = await db.select({ id: salePaymentsTable.id }).from(salePaymentsTable)
    .innerJoin(salesTable, eq(salePaymentsTable.saleId, salesTable.id)).where(eq(salesTable.dealerId, dealerId));
  assert.equal(payments.length, 0);
  assert.equal((await request("/reservations")).status, 401);
  assert.equal((await request("/reservations", { headers: { "x-portal-token": "wrong-token" } })).status, 401);
  assert.equal((await cancel(created.id, false)).status, 401);
  const staffResponse = await request("/reservations", {}, true);
  assert.equal(staffResponse.status, 200);
  assert.equal(staffResponse.headers.get("cache-control"), "no-store");
  const listed = await json<{ reservations: StaffReservation[] }>(staffResponse);
  assert.equal(listed.reservations.length, 1);
  assert.equal(listed.reservations[0]!.leadId, created.id);
  assert.equal(listed.reservations[0]!.email, "reservation@example.test");
  const stock = await json<{ cars: Array<{ id: string; inventoryStatus: string }> }>(await request("/stock"));
  assert.equal(stock.cars.find((car) => car.id === vehicleId)?.inventoryStatus, "reserved");

  // The same authenticated machine must not read or cancel another deployment's records.
  process.env.STOCK_DEALER_ID = `${dealerId}-empty-deployment`;
  try {
    assert.deepEqual(await json(await request("/reservations", {}, true)), { reservations: [] });
    assert.equal((await cancel(created.id)).status, 404);
  } finally { process.env.STOCK_DEALER_ID = dealerId; }
  assert.equal((await savedVehicle()).inventoryStatus, "reserved");
});

test("concurrent retries return one reservation and reject a reused key with changed details", async () => {
  const input = payload();
  const responses = await Promise.all([reserve(input), reserve(input)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const records = await Promise.all(responses.map((response) => json<Reservation>(response)));
  assert.deepEqual(records[0], records[1]);
  assert.equal((await savedLeads()).length, 1);
  assert.equal((await savedEvents()).length, 2);
  const changed = await reserve({ ...input, email: "another@example.test" });
  assert.equal(changed.status, 409, await changed.clone().text());
  assert.equal((await savedLeads())[0]!.email, input.email);
});

test("two buyers racing for one vehicle create exactly one hold and lead", async () => {
  const responses = await Promise.all([
    reserve(payload({ email: "first@example.test" })),
    reserve(payload({ email: "second@example.test" })),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal((await savedLeads()).length, 1);
  assert.equal((await savedEvents()).length, 2);
  assert.equal((await savedVehicle()).inventoryStatus, "reserved");
});

test("turning reservations off in staff settings rejects a stale customer's request without writes", async () => {
  const settings = await json<Record<string, unknown>>(await request("/dealer-settings"));
  const updated = await request("/dealer-settings", { method: "PATCH", body: JSON.stringify({
    ...settings, onlineReservation: { enabled: false, depositPence: 10000, terms },
  }) }, true);
  assert.equal(updated.status, 200, await updated.clone().text());
  const response = await reserve();
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await savedVehicle()).inventoryStatus, "available");
  assert.equal((await savedLeads()).length, 0);
  assert.equal((await savedEvents()).length, 0);
});

test("a stale vehicle price is rejected before a hold or lead is created", async () => {
  const response = await reserve(payload({ expectedPricePence: 1849900 }));
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await savedVehicle()).inventoryStatus, "available");
  assert.equal((await savedLeads()).length, 0);
});

test("staff cancellation releases the hold once and preserves its audit history on retries", async () => {
  const input = payload();
  const response = await reserve(input);
  assert.equal(response.status, 201, await response.clone().text());
  const created = await json<Reservation>(response);
  const cancelled = await cancel(created.id);
  assert.equal(cancelled.status, 200, await cancelled.clone().text());
  assert.equal((await json<Reservation>(cancelled)).status, "cancelled");
  assert.equal((await savedVehicle()).inventoryStatus, "available");
  assert.equal((await savedLeads())[0]!.stage, "qualifying");
  assert.equal((await savedLeads())[0]!.depositPence, 0);
  assert.equal((await savedEvents()).length, 4);
  assert.equal((await cancel(created.id)).status, 200);
  assert.equal((await savedEvents()).length, 4, "repeat cancellation must not append duplicate events");
  const replay = await reserve(input);
  assert.equal(replay.status, 200);
  assert.equal((await json<Reservation>(replay)).status, "cancelled");
  assert.equal((await savedVehicle()).inventoryStatus, "available", "a retry must not recreate the released hold");
  const listed = await json<{ reservations: StaffReservation[] }>(await request("/reservations", {}, true));
  assert.equal(listed.reservations[0]!.status, "cancelled");
});

test("cancellation cannot release a reservation after a real offline deposit was recorded", async () => {
  const response = await reserve();
  assert.equal(response.status, 201, await response.clone().text());
  const created = await json<Reservation>(response);
  await db.update(leadsTable).set({ depositPence: 5000, depositMethod: "bank_transfer", depositTakenAt: new Date() })
    .where(eq(leadsTable.id, created.id));
  const cancelled = await cancel(created.id);
  assert.equal(cancelled.status, 409, await cancelled.clone().text());
  assert.equal((await savedVehicle()).inventoryStatus, "reserved");
  assert.equal((await savedLeads())[0]!.depositPence, 5000);
  assert.equal((await savedEvents()).length, 2);
});

test("a database failure after the vehicle update rolls the whole reservation back", async () => {
  const duplicateLeadId = randomUUID();
  const input = payload();
  await db.insert(leadsTable).values({ id: duplicateLeadId, dealerId, source: "phone", customerName: "Existing synthetic lead", stage: "qualifying" });
  // Force the generated reservation UUID to collide with this suite's own lead.
  // The resulting primary-key failure occurs after the stock update, exercising
  // the actual PostgreSQL transaction rollback without changing the schema.
  const random = mock.method(crypto, "randomUUID", () => duplicateLeadId);
  syncBuiltinESMExports();
  let response: Response;
  try { response = await reserve(input); }
  finally { random.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(response.status, 500, await response.clone().text());
  assert.equal((await savedVehicle()).inventoryStatus, "available");
  const leads = await savedLeads();
  assert.equal(leads.length, 1);
  assert.equal(leads[0]!.id, duplicateLeadId);
  assert.equal(leads[0]!.customerName, "Existing synthetic lead");
  assert.equal((await savedEvents()).length, 0);
});
