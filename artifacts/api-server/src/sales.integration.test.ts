import "./test/setup";
/*
 * Sales integration coverage is scoped to a synthetic dealer namespace and
 * deletes only its own rows. It never truncates or rewrites shared showroom stock.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test, { after, beforeEach } from "node:test";
import { and, eq } from "drizzle-orm";

process.env.PORTAL_API_TOKEN = "sales-integration-portal-token";
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
    headers: { "content-type": "application/json", "x-portal-token": process.env.PORTAL_API_TOKEN!, ...init.headers },
  });
}

type Checklist = {
  readyForPreparation: boolean;
  readyForCompletion: boolean;
  items: Array<{ code: string; status: string; eligible: boolean; canMarkNotApplicable: boolean }>;
};

async function confirmChecklist(id: string) {
  const response = await request(`/sales/${id}/checklist`);
  assert.equal(response.status, 200, await response.clone().text());
  const checklist = await response.json() as Checklist;
  for (const item of checklist.items) {
    if (item.code === "documents_generated") continue;
    const confirmed = await request(`/sales/${id}/checklist/${item.code}`, {
      method: "POST",
      body: JSON.stringify({ status: item.canMarkNotApplicable ? "not_applicable" : "complete", method: "bank_transfer" }),
    });
    assert.equal(confirmed.status, 200, `${item.code}: ${await confirmed.clone().text()}`);
  }
}

async function prepareSale(id: string) {
  await confirmChecklist(id);
  const response = await request(`/sales/${id}/prepare`, { method: "POST" });
  assert.equal(response.status, 201, await response.clone().text());
  return response;
}

async function cleanupNamespace() {
  const sales = await db.select({ id: salesTable.id }).from(salesTable).where(eq(salesTable.dealerId, dealerId));
  for (const sale of sales) {
    await db.delete(dealVaultArtifactsTable).where(eq(dealVaultArtifactsTable.saleId, sale.id));
    await db.delete(invoicesTable).where(eq(invoicesTable.saleId, sale.id));
    await db.delete(saleEventsTable).where(eq(saleEventsTable.saleId, sale.id));
    await db.delete(signingSessionsTable).where(eq(signingSessionsTable.saleId, sale.id));
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
      fulfilment: { method: "collection" },
      customer: { name: "Sale Test Customer", email: "sale@example.test" },
      agreedPricePence: 1250000,
      depositPence: 250000,
      disclosureNotes: "Synthetic integration disclosure",
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { id: string; balancePence: number };
  assert.equal(created.balancePence, 1000000);

  const preparedResponse = await prepareSale(created.id);
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
      fulfilment: { method: "collection" },
      customer: { name: "Duplicate Test Customer", email: "duplicate@example.test" },
      agreedPricePence: 900000,
      depositPence: 0,
    }),
  });
  const created = await createdResponse.json() as { id: string };
  const prepared = await (await prepareSale(created.id)).json() as { signingUrl: string };
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
    body: JSON.stringify({ vehicleId, fulfilment: { method: "collection" }, customer: { name: "Revision Test Customer", email: "revision@example.test" }, agreedPricePence: 100000 }),
  })).json() as { id: string };
  const first = await (await prepareSale(created.id)).json() as { signingUrl: string; revision: { id: string } };
  const oldToken = new URL(first.signingUrl).pathname.split("/").pop()!;
  const second = await (await prepareSale(created.id)).json() as { revision: { id: string } };
  assert.notEqual(second.revision.id, first.revision.id);
  assert.equal((await request(`/signing/${oldToken}`)).status, 410);
  const sessions = await db.select().from(signingSessionsTable).where(eq(signingSessionsTable.saleId, created.id));
  assert.equal(sessions.filter((session) => session.revisionId === first.revision.id)[0]?.status, "revoked");
});
async function createReadyFixture() {
  const response = await request("/sales", {
    method: "POST",
    body: JSON.stringify({
      vehicleId, customer: { name: "Workflow Buyer", email: "workflow@example.test" },
      agreedPricePence: 1000000, depositPence: 100000,
      fulfilment: { method: "collection" }, disclosureNotes: "Reviewed vehicle condition.",
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return await response.json() as { id: string; customer: { id: string } };
}

const signature = {
  signerName: "Workflow Buyer", signerEmail: "workflow@example.test",
  acceptedCodes: ["sale_terms", "vehicle_disclosures", "document_review"],
};

test("validates sale inputs and returns missing sales consistently", async () => {
  assert.equal((await request("/sales", { method: "POST", body: JSON.stringify(signature) })).status, 400);
  assert.equal((await request("/sales/not-a-uuid")).status, 400);
  const missing = "11111111-1111-4111-8111-111111111111";
  for (const [suffix, method, body] of [
    ["", "GET", undefined], ["/final-checks", "GET", undefined], ["/checklist", "GET", undefined],
    ["/prepare", "POST", undefined], ["/complete", "POST", undefined], ["/revoke-signing", "POST", undefined],
    ["/checklist/customer_confirmed", "POST", '{"status":"complete"}'],
  ] as const) {
    const response = await request(`/sales/${missing}${suffix}`, { method, body });
    assert.equal(response.status, 404, `${method} ${suffix}: ${await response.clone().text()}`);
  }
});

test("requires current checklist evidence and records an offline deposit once", async () => {
  const sale = await createReadyFixture();
  assert.equal((await request(`/sales/${sale.id}/prepare`, { method: "POST" })).status, 400);
  const notApplicable = await request(`/sales/${sale.id}/checklist/deposit_confirmed`, {
    method: "POST", body: JSON.stringify({ status: "not_applicable" }),
  });
  assert.equal(notApplicable.status, 422, "a nonzero deposit cannot be skipped");
  await confirmChecklist(sale.id);
  await confirmChecklist(sale.id);
  const payments = await db.select().from(salePaymentsTable).where(eq(salePaymentsTable.saleId, sale.id));
  assert.equal(payments.length, 1);
  assert.equal(payments[0]!.amountPence, 100000);
  assert.equal(payments[0]!.method, "bank_transfer");
  await db.update(customerTable).set({ phone: "07700900111" }).where(eq(customerTable.id, sale.customer.id));
  const checklist = await (await request(`/sales/${sale.id}/checklist`)).json() as Checklist;
  assert.equal(checklist.items.find(item => item.code === "customer_confirmed")?.status, "invalidated");
  assert.equal(checklist.readyForPreparation, false);
  assert.equal((await request(`/sales/${sale.id}/prepare`, { method: "POST" })).status, 400);
  await prepareSale(sale.id);
  const detail = await request(`/sales/${sale.id}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json() as { status: string }).status, "signing");
});

test("revoking a link prevents signing and preserves the sale until a new preparation", async () => {
  const sale = await createReadyFixture();
  const prepared = await (await prepareSale(sale.id)).json() as { signingUrl: string };
  const token = new URL(prepared.signingUrl).pathname.split("/").pop()!;
  assert.equal((await request(`/sales/${sale.id}/revoke-signing`, { method: "POST" })).status, 200);
  assert.equal((await request(`/signing/${token}`)).status, 410);
  assert.equal((await request(`/signing/${token}/complete`, { method: "POST", body: JSON.stringify(signature) })).status, 409);
  assert.equal((await request(`/sales/${sale.id}/complete`, { method: "POST" })).status, 422);
  assert.equal((await request(`/sales/${sale.id}/revoke-signing`, { method: "POST" })).status, 409);
  const fresh = await prepareSale(sale.id);
  assert.equal(fresh.status, 201);
});

test("rejects missing or wrong signer email and expired tokens", async () => {
  const sale = await createReadyFixture();
  const prepared = await (await prepareSale(sale.id)).json() as { signingUrl: string };
  const token = new URL(prepared.signingUrl).pathname.split("/").pop()!;
  for (const signerEmail of [undefined, "someone-else@example.test"]) {
    const response = await request(`/signing/${token}/complete`, { method: "POST", body: JSON.stringify({ ...signature, signerEmail }) });
    assert.equal(response.status, 409);
  }
  await db.update(signingSessionsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(signingSessionsTable.saleId, sale.id));
  assert.equal((await request(`/signing/${token}`)).status, 410);
  assert.equal((await request(`/signing/${token}`)).status, 410);
  assert.equal((await request(`/signing/${token}/complete`, { method: "POST", body: JSON.stringify(signature) })).status, 409);
});

test("concurrent completion creates one invoice, vault record and completion event", async () => {
  const sale = await createReadyFixture();
  const prepared = await (await prepareSale(sale.id)).json() as { signingUrl: string };
  const token = new URL(prepared.signingUrl).pathname.split("/").pop()!;
  const signing = await Promise.all([1, 2].map(() => request(`/signing/${token}/complete`, { method: "POST", body: JSON.stringify(signature) })));
  assert.deepEqual(signing.map(response => response.status).sort(), [200, 409]);
  const completion = await Promise.all([1, 2].map(() => request(`/sales/${sale.id}/complete`, { method: "POST" })));
  for (const response of completion) assert.equal(response.status, 200, await response.clone().text());
  const bodies = await Promise.all(completion.map(response => response.json() as Promise<{ idempotent: boolean }>));
  assert.equal(bodies.filter(body => body.idempotent).length, 1);
  assert.equal((await db.select().from(invoicesTable).where(eq(invoicesTable.saleId, sale.id))).length, 1);
  assert.equal((await db.select().from(dealVaultArtifactsTable).where(eq(dealVaultArtifactsTable.saleId, sale.id))).length, 1);
  const events = await db.select().from(saleEventsTable).where(eq(saleEventsTable.saleId, sale.id));
  assert.equal(events.filter(event => event.eventType === "sale.completed").length, 1);
  // Once completed, a retry must not recreate side effects or fail because later
  // stock/customer changes would prevent a NEW completion.
  await db.update(customerTable).set({ phone: "07700900222" }).where(eq(customerTable.id, sale.customer.id));
  const retry = await request(`/sales/${sale.id}/complete`, { method: "POST" });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { idempotent: boolean }).idempotent, true);
  assert.equal((await request(`/sales/${sale.id}/checklist/price_confirmed`, { method: "POST", body: '{"status":"pending"}' })).status, 422);
});
