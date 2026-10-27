import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { db, engine, dealershipsTable, enquiriesTable, saleWorkspaceTable, dealerChatTable } from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import { PostgresSaleWorkspaceStore } from "./lib/sale-workspace-store";
import { publicSaleWorkspace } from "@workspace/vehicle-meta";
import { readDealerChatRecords } from "./lib/historical-chat-history";
import enquiriesRouter from "./routes/enquiries";

process.env.MULTI_TENANT_ENABLED = "true";
const dealer = "history-a", other = "history-b";
const tenant = { dealerId: dealer, canonicalOrigin: "https://history.example.test", platform: "autotrader" as const, retailerId: "fictional", sourceUrl: "https://www.autotrader.co.uk/example" };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
before(async () => {
  for (const file of (await readdir("../../lib/db/drizzle")).filter(file => /^\d.*\.sql$/.test(file)).sort()) await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, "utf8"));
  for (const id of [dealer, other]) await db.insert(dealershipsTable).values({ id, name: "Fictional history dealership", status: "active", canonicalOrigin: `https://${id}.example.test`, stockPlatform: "autotrader", retailerId: id, sourceUrl: tenant.sourceUrl });
});
after(() => engine.close());

function enquiryGet(path: string, omit = false, staff = true) {
  return runWithTenant(tenant, () => new Promise<{ status: number; data: any }>((resolve, reject) => {
    let status = 200;
    const url = new URL(path, "https://history.example.test");
    const req = { method: "GET", url: url.pathname + url.search, query: Object.fromEntries(url.searchParams), headers: {}, get: (key: string) => key === "x-enquiry-timeline" && omit ? "omit" : undefined, log: { error() {}, warn() {} }, ...(staff ? { staff: { authUserId: "fictional-staff", role: "owner" } } : {}) } as unknown as Request;
    const res = { status(value: number) { status = value; return this; }, json(data: unknown) { resolve({ status, data }); return this; } } as unknown as Response;
    enquiriesRouter(req, res, error => error ? reject(error) : reject(new Error("History route did not respond")));
  }));
}

test("large sales and relationship chat reads exclude archive/retry/token bulk inside PostgreSQL while keeping public history", async t => {
  const sales = Array.from({ length: 100 }, (_, number) => {
    const id = randomUUID();
    return { id, dealerId: dealer, reference: `FICTIONAL-${number}`, revision: 0, createdAt: "2026-10-17T10:00:00.000Z", updatedAt: "2026-10-17T10:00:00.000Z", draft: { customer: `Fictional buyer ${number}`, price:"12000",sourceEnquiryId:randomUUID(),sourceReservationId:randomUUID() }, payments: [{ amountPence: 10000 }], documents: [{ id: `doc-${number}`, title: "Fictional invoice" }], events: [], documentArchives: { document: { content: "ARCHIVED-PDF".repeat(2000), sha256: "fictional" } }, requests: { private: { fingerprint: "PRIVATE-RETRY".repeat(100) } }, providerPayments: { private: "PRIVATE-PROVIDER" }, customerAccess: { tokenHash: "PRIVATE-ACCESS", expiresAt: "2027-01-01T00:00:00Z" } };
  });
  await db.insert(saleWorkspaceTable).values(sales.map(state => ({ id: state.id, dealerId: dealer, reference: state.reference, revision: 0, state })));
  const oldRows = (await engine.query("SELECT state FROM sale_workspace WHERE dealer_id=$1 ORDER BY updated_at DESC", [dealer])).rows;
  let transferred = 0;
  const database = { async query(query: string, parameters: unknown[]) { const result = await engine.query(query, parameters); transferred += bytes(result.rows); return result; } };
  const store = new PostgresSaleWorkspaceStore(dealer, async () => { throw new Error("Listing must not load photos or providers"); }, database as never);
  const page=await store.list(),next=await store.list({offset:50});
  const listed=[...page.sales,...next.sales];
  assert.equal(page.sales.length,50);assert.equal(page.hasMore,true);assert.equal(next.sales.length,50);assert.equal(next.hasMore,false);
  assert.equal(listed.length,100);assert.deepEqual(listed.map(record=>record.id).sort(),sales.map(record=>record.id).sort());
  for(const record of listed){assert.equal(record.listSummary,true);assert.equal(record.listTotalDue,1200000);assert.deepEqual(record.documents,[]);assert.deepEqual(record.payments,[]);assert.deepEqual(record.events,[]);assert.equal(record.emptyDraftDeletable,false);assert.ok(!JSON.stringify(record).includes('PRIVATE-'));assert.ok(!JSON.stringify(record).includes('ARCHIVED-PDF'));}
  const old=sales[99];
  assert.equal((await store.list({q:'Fictional buyer 99'})).sales[0].id,old.id);
  assert.equal((await store.list({enquiryId:old.draft.sourceEnquiryId})).sales[0].id,old.id);
  assert.equal((await store.list({reservationId:old.draft.sourceReservationId})).sales[0].id,old.id);
  assert.equal((await store.list({q:old.draft.sourceEnquiryId})).sales[0].id,old.id);
  assert.equal((await store.get(old.id)).documents.length,1);
  await assert.rejects(()=>store.list({offset:-1}),/sales search/);await assert.rejects(()=>store.list({offset:10001}),/sales search/);
  assert.ok(transferred < bytes(oldRows) / 10);
  const chatRecords = Array.from({ length: 100 }, (_, number) => ({ conversation: { id: `chat-${number}`, reference: `CHAT-${number}`, enquiryId: null, status: "with_staff" }, messages: [{ id: `message-${number}`, body: "Fictional customer history", createdAt: "2026-10-17T10:00:00Z" }], tokenHash: "PRIVATE-CHAT-HASH".repeat(200), tokenExpiresAt: "2027-01-01T00:00:00Z", requestId: `private-request-${number}` }));
  const state = { schemaVersion: 1, settings: { private: "PRIVATE-SETTING".repeat(1000) }, records: chatRecords, presence: {} };
  await db.insert(dealerChatTable).values({ dealerId: dealer, state });
  let chatBytes = 0;
  const chats = await readDealerChatRecords(dealer, { async query(query, parameters) { const result = await engine.query(query, parameters); chatBytes += bytes(result.rows); return result; } });
  assert.deepEqual(chats, chatRecords.map(({ conversation, messages }) => ({ conversation, messages })));
  assert.ok(!JSON.stringify(chats).includes("PRIVATE-")); assert.ok(chatBytes < bytes(state) / 5);
  t.diagnostic(JSON.stringify({ sales: { records: 100, beforeDatabaseBytes: bytes(oldRows), afterDatabaseBytes: transferred }, chat: { records: 100, beforeDatabaseBytes: bytes(state), afterDatabaseBytes: chatBytes } }));
});

test("enquiry summaries keep merged originals, matching fields and appointments; every conversation remains reachable in bounded authenticated pages", async t => {
  const main = randomUUID(), original = randomUUID(), foreign = randomUUID();
  await db.insert(enquiriesTable).values([
    { id: main, dealerId: dealer, customerName: "Fictional main customer", message: "Main enquiry", type: "general" },
    { id: original, dealerId: dealer, customerName: "Fictional original customer", message: "Original car and contact details", phone: "07700900123", vehicleTitle: "Original vehicle", type: "viewing", mergedIntoId: main, appointmentAt: new Date("2027-01-01T10:00:00Z") },
    { id: foreign, dealerId: other, customerName: "Other dealer", message: "Must stay private", type: "general" },
  ]);
  await engine.query(`INSERT INTO enquiry_events(dealer_id,enquiry_id,kind,actor,summary,detail,occurred_at)
    SELECT $1,$2::uuid,'conversation_logged','dealer','Fictional conversation '||n,jsonb_build_object('note',repeat('Fictional note. ',100),'staffName','Fictional staff'), '2026-10-17 10:00:00Z'::timestamptz + n*interval '1 microsecond' FROM generate_series(1,1000) n`, [dealer, original]);
  const full = await enquiryGet("/enquiries"), summary = await enquiryGet("/enquiries", true);
  assert.equal(full.status, 200); assert.equal(summary.status, 200);
  assert.equal(full.data.length, 2); assert.equal(summary.data.length, 2);
  assert.deepEqual(summary.data, full.data.map((record: any) => ({ ...record, events: [] })));
  assert.ok(bytes(summary.data) < bytes(full.data) / 100);
  let cursor: string | null = null, pages = 0, largestPage = 0;
  const seen = new Set<string>();
  do {
    const response = await enquiryGet(`/staff/enquiries/${original}/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(response.status, 200); assert.equal(response.data.total, 1000); assert.ok(response.data.events.length <= 25);
    for (const event of response.data.events) { assert.ok(!seen.has(event.id)); seen.add(event.id); }
    pages++; largestPage = Math.max(largestPage, bytes(response.data)); cursor = response.data.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 1000); assert.equal(pages, 40);
  assert.equal((await enquiryGet(`/staff/enquiries/${foreign}/conversations`)).status, 404);
  assert.equal((await enquiryGet(`/staff/enquiries/${original}/conversations`, false, false)).status, 401);
  assert.equal((await enquiryGet(`/staff/enquiries/${original}/conversations?cursor=invalid`)).status, 400);
  t.diagnostic(JSON.stringify({ enquiries: { records: 2, events: 1000, fullPollBytes: bytes(full.data), summaryPollBytes: bytes(summary.data), maximumConversationPageBytes: largestPage, pages } }));
});
