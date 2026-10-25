import "./test/setup";
/*
 * Sales integration coverage is scoped to a synthetic dealer namespace and
 * deletes only its own rows. It never truncates or rewrites shared showroom stock.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test, { after, beforeEach } from "node:test";
import { eq } from "drizzle-orm";

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

// The former signing/checklist workflow is deliberately retired. Current sale
// arithmetic, payments and invoice issuance are covered by test:sale-workspace.
test("retired sales endpoints preserve existing customers, invoices, payments and stock", async () => {
  const [customer] = await db.insert(customerTable).values({ dealerId, name: 'Fictional protected buyer', email: 'protected@example.test' }).returning();
  const [sale] = await db.insert(salesTable).values({ dealerId, vehicleId, customerId: customer!.id, status: 'completed', agreedPricePence: 1250000, depositPence: 250000, balancePence: 1000000 }).returning();
  await db.insert(salePaymentsTable).values({ saleId: sale!.id, kind: 'deposit', amountPence: 250000, method: 'bank_transfer', reference: 'FICTIONAL-ONLY' });
  await db.insert(invoicesTable).values({ saleId: sale!.id, invoiceNumber: `FICTIONAL-RETIRED-${process.pid}`, totalPence: 1250000, depositPence: 250000, balancePence: 1000000, snapshot: { fictional: true, keep: 'unchanged' } });
  const snapshot = async () => ({
    customer: await db.select().from(customerTable).where(eq(customerTable.dealerId, dealerId)),
    sales: await db.select().from(salesTable).where(eq(salesTable.dealerId, dealerId)),
    payments: await db.select().from(salePaymentsTable).where(eq(salePaymentsTable.saleId, sale!.id)),
    invoices: await db.select().from(invoicesTable).where(eq(invoicesTable.saleId, sale!.id)),
    stock: await db.select().from(vehiclesTable).where(eq(vehiclesTable.dealerId, dealerId)),
  });
  const before = await snapshot();
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    for (const path of ['/sales', `/sales/${sale!.id}`, `/sales/${sale!.id}/prepare`, `/sales/${sale!.id}/complete`, `/sales/${sale!.id}/revoke-signing`]) {
      const response = await request(path, { method, ...(method === 'GET' ? {} : { body: JSON.stringify({ vehicleId, agreedPricePence: 1, depositPence: 1 }) }) });
      assert.equal(response.status, 410); assert.deepEqual(await response.json(), { error: 'The previous sales process has been removed.' });
    }
  }
  assert.deepEqual(await snapshot(), before);
});

test("retired public signing and intake links cannot write or disclose saved sales", async () => {
  const before = await db.select().from(salesTable).where(eq(salesTable.dealerId, dealerId));
  for (const path of ['/signing/fictional/complete', '/customer-intake-sessions/fictional/complete', '/sales/00000000-0000-4000-8000-000000000001/checklist']) {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(baseUrl + path, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
      const protectedWrite = method === 'POST' && path.startsWith('/customer-intake-sessions/');
      assert.equal(response.status, protectedWrite ? 401 : 410, `${method} ${path}`);
      if (protectedWrite) {
        assert.match((await response.json() as { error: string }).error, /Sign in/);
        assert.equal((await request(path, { method, body: '{}' })).status, 410);
      } else assert.deepEqual(await response.json(), { error: 'The previous sales process has been removed.' });
    }
  }
  assert.deepEqual(await db.select().from(salesTable).where(eq(salesTable.dealerId, dealerId)), before);
});

test("the current sale workspace keeps staff authorization and remains available", async () => {
  assert.equal((await fetch(baseUrl + '/sale-workspace')).status, 401);
  const response = await request('/sale-workspace'); assert.equal(response.status, 200);
  const result = await response.json() as { sales: unknown[]; preview: boolean };
  assert.ok(Array.isArray(result.sales)); assert.equal(result.preview, false);
});
