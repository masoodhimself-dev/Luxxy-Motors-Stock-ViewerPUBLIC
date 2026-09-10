/*
 * Sales integration coverage is scoped to a synthetic dealer namespace and
 * deletes only its own rows. It never truncates or rewrites shared showroom stock.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test, { after, beforeEach } from "node:test";
import { and, eq } from "drizzle-orm";

process.env.SESSION_SECRET = "sales-integration-session-secret";
process.env.STOCK_DEALER_ID = `sales-test-${process.pid}`;

const {
  db,
  pool,
  customerTable,
  dealerSettingsTable,
  dealVaultArtifactsTable,
  invoicesTable,
  saleAdjustmentsTable,
  saleDocumentsTable,
  saleEventsTable,
  saleFulfilmentsTable,
  salePartExchangesTable,
  salePaymentsTable,
  saleRevisionsTable,
  saleWarrantiesTable,
  salesTable,
  signaturesTable,
  signingSessionsTable,
  vehiclesTable,
} = await import("@workspace/db");
const { default: app } = await import("./app");

const server: Server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to start sales test listener");
const baseUrl = `http://127.0.0.1:${address.port}/api`;
const dealerId = process.env.STOCK_DEALER_ID!;
let vehicleId = "";

async function request(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

async function cleanupNamespace() {
  const sales = await db.select({ id: salesTable.id }).from(salesTable).where(eq(salesTable.dealerId, dealerId));
  for (const sale of sales) {
    await db.delete(dealVaultArtifactsTable).where(eq(dealVaultArtifactsTable.saleId, sale.id));
    await db.delete(invoicesTable).where(eq(invoicesTable.saleId, sale.id));
    await db.delete(saleEventsTable).where(eq(saleEventsTable.saleId, sale.id));
    await db.delete(signaturesTable).where(eq(signaturesTable.signingSessionId, sale.id));
    await db.delete(signingSessionsTable).where(eq(signingSessionsTable.saleId, sale.id));
    await db.delete(saleDocumentsTable).where(eq(saleDocumentsTable.revisionId, sale.id));
    await db.delete(saleAdjustmentsTable).where(eq(saleAdjustmentsTable.saleId, sale.id));
    await db.delete(salePaymentsTable).where(eq(salePaymentsTable.saleId, sale.id));
    await db.delete(salePartExchangesTable).where(eq(salePartExchangesTable.saleId, sale.id));
    await db.delete(saleWarrantiesTable).where(eq(saleWarrantiesTable.saleId, sale.id));
    await db.delete(saleFulfilmentsTable).where(eq(saleFulfilmentsTable.saleId, sale.id));
    await db.delete(saleRevisionsTable).where(eq(saleRevisionsTable.saleId, sale.id));
  }
  await db.delete(salesTable).where(eq(salesTable.dealerId, dealerId));
  await db.delete(customerTable).where(eq(customerTable.dealerId, dealerId));
  await db.delete(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, dealerId));
  await db.delete(vehiclesTable).where(eq(vehiclesTable.dealerId, dealerId));
}

beforeEach(async () => {
  await cleanupNamespace();
  const [vehicle] = await db.insert(vehiclesTable).values({
    dealerId,
    source: "sales-integration-test",
    advertId: `sales-${process.pid}`,
    title: "Synthetic Sale Test Vehicle",
    make: "Testmaker",
    model: "Workflow",
    year: 2022,
    sourcePrice: 12500,
    currency: "GBP",
    mileage: 24000,
    registration: "TEST 22",
    inventoryStatus: "available",
    sourceStatus: "live",
  }).returning({ id: vehiclesTable.id });
  vehicleId = vehicle!.id;
});

after(async () => {
  try {
    await cleanupNamespace();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
});

test("stores only a token hash and binds the signing session to its revision", async () => {
  const createdResponse = await request("/sales", {
    method: "POST",
    body: JSON.stringify({
      vehicleId,
      customer: { name: "Sale Test Customer", email: "sale@example.test" },
      agreedPricePence: 1250000,
      depositPence: 250000,
      disclosureNotes: "Synthetic integration disclosure",
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { id: string; balancePence: number };
  assert.equal(created.balancePence, 1000000);

  const preparedResponse = await request(`/sales/${created.id}/prepare`, { method: "POST" });
  assert.equal(preparedResponse.status, 201);
  const prepared = await preparedResponse.json() as { signingUrl: string; revision: { id: string } };
  const token = new URL(prepared.signingUrl).pathname.split("/").pop()!;
  assert.ok(token.length >= 32);

  const [session] = await db.select().from(signingSessionsTable).where(eq(signingSessionsTable.saleId, created.id));
  assert.ok(session);
  assert.notEqual(session.tokenHash, token);
  assert.equal(session.revisionId, prepared.revision.id);

  const signingResponse = await request(`/signing/${token}`);
  assert.equal(signingResponse.status, 200);
  const signing = await signingResponse.json() as { revision: { id: string } };
  assert.equal(signing.revision.id, prepared.revision.id);
});

test("rejects incomplete or duplicate signing and completes a signed sale once", async () => {
  const createdResponse = await request("/sales", {
    method: "POST",
    body: JSON.stringify({
      vehicleId,
      customer: { name: "Duplicate Test Customer", email: "duplicate@example.test" },
      agreedPricePence: 900000,
      depositPence: 0,
    }),
  });
  const created = await createdResponse.json() as { id: string };
  const prepared = await (await request(`/sales/${created.id}/prepare`, { method: "POST" })).json() as { signingUrl: string };
  const token = new URL(prepared.signingUrl).pathname.split("/").pop()!;
  const incomplete = await request(`/signing/${token}/complete`, {
    method: "POST",
    body: JSON.stringify({ signerName: "Duplicate Test Customer", acceptedCodes: [] }),
  });
  assert.equal(incomplete.status, 409);

  const signed = await request(`/signing/${token}/complete`, {
    method: "POST",
    body: JSON.stringify({
      signerName: "Duplicate Test Customer",
      signerEmail: "duplicate@example.test",
      acceptedCodes: ["sale_terms", "vehicle_disclosures", "document_review"],
    }),
  });
  assert.equal(signed.status, 200);

  const duplicate = await request(`/signing/${token}/complete`, {
    method: "POST",
    body: JSON.stringify({
      signerName: "Duplicate Test Customer",
      signerEmail: "duplicate@example.test",
      acceptedCodes: ["sale_terms", "vehicle_disclosures", "document_review"],
    }),
  });
  assert.equal(duplicate.status, 409);

  const completed = await request(`/sales/${created.id}/complete`, { method: "POST" });
  assert.equal(completed.status, 200);
  const finalChecksResponse = await request(`/sales/${created.id}/final-checks`);
  assert.equal(finalChecksResponse.status, 200);
  const finalChecks = await finalChecksResponse.json() as {
    canComplete: boolean;
    checks: Array<{ code: string; passed: boolean }>;
  };
  assert.equal(finalChecks.canComplete, true);
  assert.equal(finalChecks.checks.find((check) => check.code === "vehicle")?.passed, true);
  assert.equal(finalChecks.checks.find((check) => check.code === "vehicle_lock")?.passed, true);
  const completedAgain = await request(`/sales/${created.id}/complete`, { method: "POST" });
  assert.equal(completedAgain.status, 200);
  const completedAgainBody = await completedAgain.json() as { idempotent: boolean };
  assert.equal(completedAgainBody.idempotent, true);
  const [vehicle] = await db.select({ inventoryStatus: vehiclesTable.inventoryStatus }).from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  assert.equal(vehicle?.inventoryStatus, "sold");
});

test("prevents two active sales from claiming one vehicle", async () => {
  const first = await request("/sales", {
    method: "POST",
    body: JSON.stringify({ vehicleId, customer: { name: "First Buyer" }, agreedPricePence: 100000 }),
  });
  assert.equal(first.status, 201);
  const second = await request("/sales", {
    method: "POST",
    body: JSON.stringify({ vehicleId, customer: { name: "Second Buyer" }, agreedPricePence: 100000 }),
  });
  assert.equal(second.status, 409);
});

test("publishes only anonymised completed handovers in newest-first order", async () => {
  const [settings] = await db
    .select()
    .from(dealerSettingsTable)
    .where(eq(dealerSettingsTable.dealerId, dealerId));
  const settingsResponse = settings
    ? settings.config
    : await (await request("/dealer-settings")).json();
  await db
    .insert(dealerSettingsTable)
    .values({
      dealerId,
      config: {
        ...(settingsResponse as Record<string, unknown>),
        recentHandovers: { enabled: true, count: 2 },
      },
    })
    .onConflictDoUpdate({
      target: dealerSettingsTable.dealerId,
      set: { config: { ...(settingsResponse as Record<string, unknown>), recentHandovers: { enabled: true, count: 2 } } },
    });

  const [olderVehicle, newestVehicle] = await db
    .insert(vehiclesTable)
    .values([
      {
        dealerId,
        source: "sales-integration-test",
        advertId: `sales-older-${process.pid}`,
        title: "Older Handover Vehicle",
        make: "Older",
        model: "Handover",
        trim: "Touring",
        year: 2021,
        bodyType: "Estate",
        fuel: "Diesel",
        transmission: "Manual",
        inventoryStatus: "sold",
        sourceStatus: "live",
      },
      {
        dealerId,
        source: "sales-integration-test",
        advertId: `sales-newest-${process.pid}`,
        title: "Newest Handover Vehicle",
        make: "Newest",
        model: "Handover",
        trim: "Premium",
        year: 2023,
        bodyType: "SUV",
        fuel: "Petrol",
        transmission: "Automatic",
        inventoryStatus: "sold",
        sourceStatus: "live",
      },
    ])
    .returning({ id: vehiclesTable.id });
  const [olderCustomer, newestCustomer, incompleteCustomer] = await db
    .insert(customerTable)
    .values([
      { dealerId, name: "Private Older Buyer", email: "older@example.test", phone: "000" },
      { dealerId, name: "Private Newest Buyer", email: "newest@example.test", phone: "111" },
      { dealerId, name: "Private Incomplete Buyer", email: "incomplete@example.test", phone: "222" },
    ])
    .returning({ id: customerTable.id });
  await db.insert(salesTable).values([
    {
      dealerId,
      vehicleId: olderVehicle!.id,
      customerId: olderCustomer!.id,
      status: "completed",
      agreedPricePence: 1200000,
      depositPence: 100000,
      balancePence: 1100000,
      completedAt: new Date("2026-07-10T12:00:00.000Z"),
      internalNotes: "Never publish this",
    },
    {
      dealerId,
      vehicleId: newestVehicle!.id,
      customerId: newestCustomer!.id,
      status: "completed",
      agreedPricePence: 2300000,
      depositPence: 200000,
      balancePence: 2100000,
      completedAt: new Date("2026-08-20T12:00:00.000Z"),
      disclosureNotes: "Never publish this either",
    },
    {
      dealerId,
      vehicleId,
      customerId: incompleteCustomer!.id,
      status: "signed",
      agreedPricePence: 900000,
      depositPence: 0,
      balancePence: 900000,
      completedAt: null,
    },
  ]);

  const response = await request("/recent-handovers");
  assert.equal(response.status, 200);
  const body = await response.json() as { schemaVersion: number; handovers: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(body), ["schemaVersion", "handovers"]);
  assert.equal(body.handovers.length, 2);
  assert.deepEqual(body.handovers.map((handover) => handover.handoverMonth), ["August 2026", "July 2026"]);
  assert.deepEqual(Object.keys(body.handovers[0]!), ["vehicle", "handoverMonth"]);
  assert.deepEqual(Object.keys(body.handovers[0]!.vehicle as object), ["make", "model", "trim", "year", "bodyType", "fuel", "transmission"]);
  assert.equal(JSON.stringify(body).includes("Private"), false);
  assert.equal(JSON.stringify(body).includes("Never publish"), false);

  await db
    .update(dealerSettingsTable)
    .set({ config: { ...(settingsResponse as Record<string, unknown>), recentHandovers: { enabled: false, count: 2 } } })
    .where(eq(dealerSettingsTable.dealerId, dealerId));
  const disabled = await request("/recent-handovers");
  assert.deepEqual(await disabled.json(), { schemaVersion: 1, handovers: [] });
});

test("revokes the old signing session when a new revision is prepared", async () => {
  const created = await (await request("/sales", {
    method: "POST",
    body: JSON.stringify({ vehicleId, customer: { name: "Revision Test Customer" }, agreedPricePence: 100000 }),
  })).json() as { id: string };
  const first = await (await request(`/sales/${created.id}/prepare`, { method: "POST" })).json() as { signingUrl: string; revision: { id: string } };
  const oldToken = new URL(first.signingUrl).pathname.split("/").pop()!;
  const second = await (await request(`/sales/${created.id}/prepare`, { method: "POST" })).json() as { revision: { id: string } };
  assert.notEqual(second.revision.id, first.revision.id);
  assert.equal((await request(`/signing/${oldToken}`)).status, 410);
  const sessions = await db.select().from(signingSessionsTable).where(eq(signingSessionsTable.saleId, created.id));
  assert.equal(sessions.filter((session) => session.revisionId === first.revision.id)[0]?.status, "revoked");
});