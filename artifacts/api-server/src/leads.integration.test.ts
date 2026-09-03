/*
 * Lead integration coverage is scoped to a synthetic dealer namespace and
 * deletes only its own rows. It never truncates or rewrites shared showroom
 * stock. The carry-across is deliberately dealer-wide, exactly as it runs at
 * boot, so it may also open leads for enquiries that already exist here; that
 * only ever adds a lead, it never alters an enquiry.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test, { after, beforeEach } from "node:test";
import { eq, inArray } from "drizzle-orm";

process.env.SESSION_SECRET = "leads-integration-session-secret";
process.env.STOCK_DEALER_ID = `leads-test-${process.pid}`;
process.env.PORTAL_API_TOKEN = "leads-integration-portal-token";

const {
  db,
  pool,
  customerTable,
  enquiriesTable,
  leadEventsTable,
  leadsTable,
  saleChecklistItemsTable,
  saleEventsTable,
  salesTable,
  vehiclesTable,
} = await import("@workspace/db");
const { default: app } = await import("./app");
const { backfillLeadsFromEnquiries } = await import("./lib/leads");
const { logger } = await import("./lib/logger");

const server: Server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Unable to start leads test listener");
}
const baseUrl = `http://127.0.0.1:${address.port}/api`;
const dealerId = process.env.STOCK_DEALER_ID!;
let vehicleId = "";

type LeadRecord = {
  id: string;
  stage: string;
  source: string;
  owner: string | null;
  enquiryId: string | null;
  vehicleId: string | null;
  vehicleTitle: string | null;
  vehiclePrice: number | null;
  outcome: string | null;
  outcomeReason: string | null;
  closedAt: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  lastContactedAt: string | null;
  depositPence: number;
  depositMethod: string | null;
  createdAt: string;
};

type LeadDetailBody = {
  lead: LeadRecord;
  events: Array<{ id: string; type: string; body: string | null; actorType: string; occurredAt: string }>;
  sales: Array<{ id: string; status: string }>;
};

async function request(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-portal-token": process.env.PORTAL_API_TOKEN!,
      ...init.headers,
    },
  });
}

async function post(path: string, body: unknown) {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

async function createManualLead(overrides: Record<string, unknown> = {}) {
  const response = await post("/leads", {
    source: "phone",
    customerName: "Phone Lead Customer",
    phone: "07700 900123",
    summary: "Called about the estate on the forecourt.",
    ...overrides,
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()) as LeadDetailBody;
}

async function cleanupNamespace() {
  const leads = await db
    .select({ id: leadsTable.id })
    .from(leadsTable)
    .where(eq(leadsTable.dealerId, dealerId));
  if (leads.length) {
    await db.delete(leadEventsTable).where(
      inArray(leadEventsTable.leadId, leads.map((lead) => lead.id)),
    );
  }
  const sales = await db
    .select({ id: salesTable.id })
    .from(salesTable)
    .where(eq(salesTable.dealerId, dealerId));
  for (const sale of sales) {
    await db.delete(saleEventsTable).where(eq(saleEventsTable.saleId, sale.id));
    await db
      .delete(saleChecklistItemsTable)
      .where(eq(saleChecklistItemsTable.saleId, sale.id));
  }
  await db.delete(salesTable).where(eq(salesTable.dealerId, dealerId));
  await db.delete(leadsTable).where(eq(leadsTable.dealerId, dealerId));
  await db.delete(enquiriesTable).where(eq(enquiriesTable.dealerId, dealerId));
  await db.delete(customerTable).where(eq(customerTable.dealerId, dealerId));
  await db.delete(vehiclesTable).where(eq(vehiclesTable.dealerId, dealerId));
}

beforeEach(async () => {
  await cleanupNamespace();
  const [vehicle] = await db
    .insert(vehiclesTable)
    .values({
      dealerId,
      // The enquiry route only accepts vehicles that are live on the website,
      // which means stock that came from the feed.
      source: "autotrader",
      advertId: `leads-${process.pid}`,
      title: "Synthetic Lead Test Vehicle",
      make: "Testmaker",
      model: "Pipeline",
      year: 2021,
      sourcePrice: 18500,
      currency: "GBP",
      mileage: 31000,
      registration: "TEST 21",
      inventoryStatus: "available",
      sourceStatus: "live",
    })
    .returning({ id: vehiclesTable.id });
  vehicleId = vehicle!.id;
});

after(async () => {
  try {
    await cleanupNamespace();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await pool.end();
  }
});

test("carries existing enquiries across without losing or altering any of them", async () => {
  const olderCreatedAt = new Date("2026-04-02T09:15:00.000Z");
  const closedUpdatedAt = new Date("2026-05-06T16:30:00.000Z");
  const appointmentAt = new Date("2026-06-11T10:00:00.000Z");

  const inserted = await db
    .insert(enquiriesTable)
    .values([
      {
        dealerId,
        vehicleId,
        vehicleTitle: "Synthetic Lead Test Vehicle",
        vehiclePrice: 18500,
        vehicleUrl: `/vehicle/${vehicleId}`,
        type: "general",
        customerName: "Untouched New Enquiry",
        email: "new@example.test",
        message: "Is this still available?",
        status: "new",
        source: "website",
        createdAt: olderCreatedAt,
        updatedAt: olderCreatedAt,
      },
      {
        dealerId,
        vehicleId,
        vehicleTitle: "Synthetic Lead Test Vehicle",
        vehiclePrice: 18500,
        vehicleUrl: `/vehicle/${vehicleId}`,
        type: "viewing",
        customerName: "Booked Viewing Enquiry",
        email: "viewing@example.test",
        message: "Booked in to see it.",
        status: "contacted",
        appointmentAt,
        source: "website",
        createdAt: olderCreatedAt,
        updatedAt: olderCreatedAt,
      },
      {
        dealerId,
        type: "general",
        customerName: "Closed Enquiry",
        email: "closed@example.test",
        message: "Went elsewhere.",
        status: "closed",
        source: "website",
        createdAt: olderCreatedAt,
        updatedAt: closedUpdatedAt,
      },
    ])
    .returning();
  assert.equal(inserted.length, 3);

  await backfillLeadsFromEnquiries(logger);

  const leads = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.dealerId, dealerId));
  assert.equal(leads.length, 3, "every existing enquiry opens exactly one lead");

  const byName = new Map(leads.map((lead) => [lead.customerName, lead]));
  const fresh = byName.get("Untouched New Enquiry")!;
  assert.equal(fresh.stage, "new");
  assert.equal(fresh.source, "website_form");
  assert.equal(fresh.vehicleId, vehicleId, "vehicle context is preserved");
  assert.equal(fresh.vehicleTitle, "Synthetic Lead Test Vehicle");
  assert.equal(fresh.vehiclePrice, 18500);
  assert.equal(
    fresh.createdAt.toISOString(),
    olderCreatedAt.toISOString(),
    "the original enquiry date is preserved",
  );

  const booked = byName.get("Booked Viewing Enquiry")!;
  assert.equal(booked.stage, "viewing_booked");

  const closed = await post(`/leads/${lead.id}/outcome`, {
    outcome: "lost",
    reason: "Bought the same car cheaper from a main dealer.",
    actor: "Dealer",
  });
  assert.equal(closed.stage, "lost");
  assert.equal(closed.outcome, "lost");
  assert.ok(closed.outcomeReason, "a carried-across closure states its reason");
  assert.equal(closed.closedAt?.toISOString(), closedUpdatedAt.toISOString());

  // The enquiries themselves are left exactly as they were.
  const enquiriesAfter = await db
    .select()
    .from(enquiriesTable)
    .where(eq(enquiriesTable.dealerId, dealerId));
  assert.equal(enquiriesAfter.length, 3);
  for (const enquiry of enquiriesAfter) {
    const before = inserted.find((row) => row.id === enquiry.id)!;
    assert.equal(enquiry.status, before.status);
    assert.equal(enquiry.createdAt.toISOString(), before.createdAt.toISOString());
    assert.equal(enquiry.vehicleId, before.vehicleId);
  }

  // Running it again is safe: no duplicate leads, no extra timeline entries.
  const eventsBefore = await db
    .select()
    .from(leadEventsTable)
    .where(inArray(leadEventsTable.leadId, leads.map((lead) => lead.id)));
  await backfillLeadsFromEnquiries(logger);
  const leadsAfter = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.dealerId, dealerId));
  assert.equal(leadsAfter.length, 3, "the carry-across is idempotent");
  const eventsAfter = await db
    .select()
    .from(leadEventsTable)
    .where(inArray(leadEventsTable.leadId, leads.map((lead) => lead.id)));
  assert.equal(eventsAfter.length, eventsBefore.length);
});

test("a website enquiry opens a lead on the website form channel", async () => {
  const response = await post("/enquiries", {
    vehicleId,
    type: "general",
    customerName: "Website Form Buyer",
    email: "website@example.test",
    phone: null,
    preferredContact: "email",
    message: "Please can you send me more photos of this one?",
    appointmentAt: null,
  });
  assert.equal(response.status, 201, await response.clone().text());
  const enquiry = (await response.json()) as { id: string };

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.enquiryId, enquiry.id));
  assert.ok(lead, "the enquiry opens a lead");
  assert.equal(lead.source, "website_form");
  assert.equal(lead.stage, "new");
  assert.equal(lead.vehicleId, vehicleId);

  const detailResponse = await request(`/leads/${lead.id}`);
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()) as LeadDetailBody;
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0]!.type, "enquiry_received");
  assert.equal(detail.events[0]!.actorType, "customer");
});

test("a lead can be taken by hand for a phone call or a walk-in", async () => {
  const detail = (await detailResponse.json()) as LeadDetailBody;

  assert.equal(detail.lead.source, "walk_in");
  assert.equal(detail.lead.enquiryId, null);
  assert.equal(detail.lead.owner, "Sam on the forecourt");
  assert.equal(detail.lead.vehicleTitle, "Synthetic Lead Test Vehicle");
  assert.deepEqual(
    detail.events.map((event) => event.type),
    ["lead_created", "owner_assigned", "next_action_set"],
  );

  const listResponse = await request("/leads?source=walk_in");
  assert.equal(listResponse.status, 200);
  const listed = (await listResponse.json()) as LeadRecord[];
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.id, detail.lead.id);

  // A lead needs some way of reaching the person.
  const contactless = await post("/leads", {
    source: "phone",
    customerName: "No Way To Reach Them",
  });
  assert.equal(contactless.status, 400);
});

test("every touch is appended to the timeline and never overwrites an earlier one", async () => {
  const { lead } = await createManualLead({ vehicleId, customerName: "Wrong Vehicle Lead" });

  const wrongVehicle = await post("/sales", {
    vehicleId: otherVehicle!.id,
    leadId: lead.id,
    customer: { name: "Wrong Vehicle Lead", email: "wrong-vehicle@example.test" },
    agreedPricePence: 725000,
    depositPence: 0,
  });

  const callResponse = await post(`/leads/${lead.id}/touches`, {
    type: "call",
    body: "Spoke about finance options.",
    actor: "Dealer",
  });
  assert.equal(callResponse.status, 201);
  const afterCall = (await callResponse.json()) as LeadDetailBody;
  assert.ok(afterCall.lead.lastContactedAt, "a call moves the last contacted time on");

  const noteResponse = await post(`/leads/${lead.id}/touches`, {
    type: "note",
    body: "Wants to part-exchange a hatchback.",
  });
  assert.equal(noteResponse.status, 201);
  const afterNote = (await noteResponse.json()) as LeadDetailBody;

  assert.deepEqual(
    afterNote.events.map((event) => event.type),
    ["lead_created", "call_logged", "note_added"],
  );
  const firstEventId = afterCall.events[0]!.id;
  assert.equal(afterNote.events[0]!.id, firstEventId, "earlier entries are untouched");
  assert.equal(
    afterNote.lead.lastContactedAt,
    afterCall.lead.lastContactedAt,
    "a note is not a contact",
  );

  // Stage changes append to the timeline rather than only flipping a column.
  const stageResponse = await post(`/leads/${lead.id}/stage`, {
    stage: "qualifying",
    note: "Budget confirmed.",
  });
  assert.equal(stageResponse.status, 200);
  const staged = (await stageResponse.json()) as LeadDetailBody;
  assert.equal(staged.lead.stage, "qualifying");
  assert.equal(staged.events.length, 4);
  assert.equal(staged.events.at(-1)!.type, "stage_changed");
});

test("stage transitions are checked, and reserving can hold an offline deposit", async () => {
  const { lead } = await createManualLead({ vehicleId, customerName: "Wrong Vehicle Lead" });

  const wrongVehicle = await post("/sales", {
    vehicleId: otherVehicle!.id,
    leadId: lead.id,
    customer: { name: "Wrong Vehicle Lead", email: "wrong-vehicle@example.test" },
    agreedPricePence: 725000,
    depositPence: 0,
  });

  const sameStage = await post(`/leads/${lead.id}/stage`, { stage: "new" });
  assert.equal(sameStage.status, 409, "a lead cannot move to the stage it is already at");

  const depositOnWrongStage = await post(`/leads/${lead.id}/stage`, {
    stage: "qualifying",
    deposit: { amountPence: 50000, method: "cash" },
  });
  assert.equal(depositOnWrongStage.status, 400, "a deposit belongs to the reserved stage");

  const reserved = await post(`/leads/${lead.id}/stage`, {
    stage: "reserved",
    actor: "Dealer",
    deposit: {
      amountPence: 50000,
      method: "card_machine",
      reference: "Taken on the machine in the showroom",
    },
  });
  assert.equal(reserved.status, 200, await reserved.clone().text());
  const held = (await reserved.json()) as LeadDetailBody;
  assert.equal(held.lead.stage, "reserved");
  assert.equal(held.lead.depositPence, 50000);
  assert.equal(held.lead.depositMethod, "card_machine");
  assert.ok(held.events.some((event) => event.type === "deposit_recorded"));

  const unknownStage = await post(`/leads/${lead.id}/stage`, { stage: "won" });
  assert.equal(unknownStage.status, 400, "closing is not a plain stage change");
});

test("a lead cannot be closed without both an outcome and a reason", async () => {
  const { lead } = await createManualLead({ vehicleId, customerName: "Wrong Vehicle Lead" });

  const wrongVehicle = await post("/sales", {
    vehicleId: otherVehicle!.id,
    leadId: lead.id,
    customer: { name: "Wrong Vehicle Lead", email: "wrong-vehicle@example.test" },
    agreedPricePence: 725000,
    depositPence: 0,
  });

  const noBody = await post(`/leads/${lead.id}/outcome`, {});
  assert.equal(noBody.status, 400);

  const outcomeOnly = await post(`/leads/${lead.id}/outcome`, { outcome: "lost" });
  assert.equal(outcomeOnly.status, 400, "an outcome alone is not enough");

  const reasonOnly = await post(`/leads/${lead.id}/outcome`, {
    reason: "Bought elsewhere",
  });
  assert.equal(reasonOnly.status, 400, "a reason alone is not enough");

  const blankReason = await post(`/leads/${lead.id}/outcome`, {
    outcome: "lost",
    reason: "   ",
  });
  assert.equal(blankReason.status, 400, "a blank reason is not a reason");

  const unknownOutcome = await post(`/leads/${lead.id}/outcome`, {
    outcome: "maybe",
    reason: "Undecided",
  });
  assert.equal(unknownOutcome.status, 400);

  const closed = await post(`/leads/${lead.id}/outcome`, {
    outcome: "lost",
    reason: "Bought the same car cheaper from a main dealer.",
    actor: "Dealer",
  });
  assert.equal(closed.status, 200, await closed.clone().text());
  const closedDetail = (await closed.json()) as LeadDetailBody;
  assert.equal(closedDetail.lead.stage, "lost");
  assert.equal(closedDetail.lead.outcome, "lost");
  assert.equal(
    closedDetail.lead.outcomeReason,
    "Bought the same car cheaper from a main dealer.",
  );
  assert.ok(closedDetail.lead.closedAt);
  assert.ok(closedDetail.events.some((event) => event.type === "outcome_recorded"));

  const closeAgain = await post(`/leads/${lead.id}/outcome`, {
    outcome: "won",
    reason: "Changed my mind about the outcome.",
  });
  assert.equal(closeAgain.status, 409, "a closed lead stays closed");

  const moveClosed = await post(`/leads/${lead.id}/stage`, { stage: "qualifying" });
  assert.equal(moveClosed.status, 409, "a closed lead cannot be moved back to a live stage");

  const chaseClosed = await post(`/leads/${lead.id}/next-action`, {
    nextAction: "Chase again",
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.equal(chaseClosed.status, 409, "a closed lead has nothing left to chase");
});

test("a next action always carries a due date, and an owner can be assigned", async () => {
  const { lead } = await createManualLead({ vehicleId, customerName: "Wrong Vehicle Lead" });

  const wrongVehicle = await post("/sales", {
    vehicleId: otherVehicle!.id,
    leadId: lead.id,
    customer: { name: "Wrong Vehicle Lead", email: "wrong-vehicle@example.test" },
    agreedPricePence: 725000,
    depositPence: 0,
  });

  const undated = await post(`/leads/${lead.id}/next-action`, {
    nextAction: "Ring them back",
    dueAt: null,
  });
  assert.equal(undated.status, 400);

  const dueAt = new Date(Date.now() + 172_800_000);
  const set = await post(`/leads/${lead.id}/next-action`, {
    nextAction: "Ring them back with a delivery date",
    dueAt: dueAt.toISOString(),
  });
  assert.equal(set.status, 200, await set.clone().text());
  const withAction = (await set.json()) as LeadDetailBody;
  assert.equal(withAction.lead.nextAction, "Ring them back with a delivery date");
  assert.equal(
    new Date(withAction.lead.nextActionDueAt!).toISOString(),
    dueAt.toISOString(),
  );

  const owned = await post(`/leads/${lead.id}/owner`, { owner: "Alex" });
  assert.equal(owned.status, 200);
  const withOwner = (await owned.json()) as LeadDetailBody;
  assert.equal(withOwner.lead.owner, "Alex");
  assert.ok(withOwner.events.some((event) => event.type === "owner_assigned"));

  const cleared = await post(`/leads/${lead.id}/next-action`, {
    nextAction: null,
    dueAt: null,
  });
  assert.equal(cleared.status, 200);
  const withoutAction = (await cleared.json()) as LeadDetailBody;
  assert.equal(withoutAction.lead.nextAction, null);
  assert.equal(withoutAction.lead.nextActionDueAt, null);
});

test("creating a sale from a lead advances the lead and links the sale back", async () => {
  const { lead } = await createManualLead({ vehicleId, customerName: "Wrong Vehicle Lead" });

  const wrongVehicle = await post("/sales", {
    vehicleId: otherVehicle!.id,
    leadId: lead.id,
    customer: { name: "Wrong Vehicle Lead", email: "wrong-vehicle@example.test" },
    agreedPricePence: 725000,
    depositPence: 0,
  });

  const saleResponse = await post("/sales", {
    vehicleId,
    leadId: lead.id,
    customer: { name: "Phone Lead Customer", email: "phone-lead@example.test" },
    agreedPricePence: 1850000,
    depositPence: 50000,
  });
  assert.equal(saleResponse.status, 201, await saleResponse.clone().text());
  const sale = (await saleResponse.json()) as {
    id: string;
    leadId: string | null;
    balancePence: number;
  };
  assert.equal(sale.leadId, lead.id, "the sale links back to the lead it came from");
  assert.equal(sale.balancePence, 1800000, "existing sale arithmetic is untouched");

  const detailResponse = await request(`/leads/${lead.id}`);
  const detail = (await detailResponse.json()) as LeadDetailBody;
  assert.equal(detail.lead.stage, "sale_agreed", "the lead moves on when a sale is agreed");
  assert.equal(detail.sales.length, 1);
  assert.equal(detail.sales[0]!.id, sale.id);
  assert.ok(detail.events.some((event) => event.type === "sale_created"));

  // The sale keeps its own machinery: the checklist is still built for it.
  const checklist = await db
    .select()
    .from(saleChecklistItemsTable)
    .where(eq(saleChecklistItemsTable.saleId, sale.id));
  assert.ok(checklist.length > 0, "sale checklist initialisation still runs");

  // A closed lead cannot quietly become a sale.
  const other = await createManualLead({ customerName: "Closed Before Sale" });
  await post(`/leads/${other.lead.id}/outcome`, {
    outcome: "lost",
    reason: "Bought a van instead.",
  });
  const [secondVehicle] = await db
    .insert(vehiclesTable)
    .values({
      dealerId,
      source: "autotrader",
      advertId: `leads-second-${process.pid}`,
      title: "Second Synthetic Lead Vehicle",
      make: "Testmaker",
      model: "Pipeline",
      year: 2020,
      sourcePrice: 9500,
      currency: "GBP",
      inventoryStatus: "available",
      sourceStatus: "live",
    })
    .returning({ id: vehiclesTable.id });
  const blocked = await post("/sales", {
    vehicleId: secondVehicle!.id,
    leadId: other.lead.id,
    customer: { name: "Closed Before Sale", email: "closed-lead@example.test" },
    agreedPricePence: 950000,
    depositPence: 0,
  });

  const [otherVehicle] = await db
    .insert(vehiclesTable)
    .values({
      dealerId,
      source: "autotrader",
      advertId: `leads-mismatch-${process.pid}`,
      title: "Mismatched Synthetic Lead Vehicle",
      make: "Testmaker",
      model: "Crossline",
      year: 2019,
      sourcePrice: 7250,
      currency: "GBP",
      inventoryStatus: "available",
      sourceStatus: "live",
    })
    .returning({ id: vehiclesTable.id });
  assert.equal(accepted.status, 201, await accepted.clone().text());
});

  const stillOpen = (await (await request(`/leads/${lead.id}`)).json()) as LeadDetailBody;

  const enquiryResponse = await post("/enquiries", {
    vehicleId,
    type: "general",
    customerName: "Separate Enquiry",
    email: "separate-enquiry@example.test",
    phone: null,
    preferredContact: "email",
    message: "Is this still available?",
    appointmentAt: null,
  });

  const accepted = await post("/sales", {
    vehicleId,
    leadId: lead.id,
    customer: { name: "Wrong Vehicle Lead", email: "wrong-vehicle@example.test" },
    agreedPricePence: 1250000,
    depositPence: 0,
  });

  const contradictory = await post("/sales", {
    vehicleId,
    leadId: lead.id,
    enquiryId: separateEnquiry.id,
    customer: { name: "Wrong Vehicle Lead", email: "wrong-vehicle@example.test" },
    agreedPricePence: 1250000,
    depositPence: 0,
  });

  const untouched = (await (await request(`/leads/${lead.id}`)).json()) as LeadDetailBody;

  const separateEnquiry = (await enquiryResponse.json()) as { id: string };

  const strandedSales = await db
    .select({ id: salesTable.id })
    .from(salesTable)
    .where(eq(salesTable.vehicleId, otherVehicle!.id));
