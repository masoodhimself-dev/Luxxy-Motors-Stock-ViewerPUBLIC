/*
 * Portal regression coverage uses the staff automation token against a
 * synthetic dealer namespace. It exercises the same protected HTTP contracts
 * the portal uses without touching shared showroom stock or lead data.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";

process.env.SESSION_SECRET = "portal-integration-session-secret";
process.env.STOCK_DEALER_ID = `portal-test-${process.pid}-${Date.now()}`;
process.env.PORTAL_API_TOKEN = `portal-integration-token-${process.pid}`;

const {
  db,
  pool,
  enquiriesTable,
  leadEventsTable,
  leadsTable,
} = await import("@workspace/db");
const { default: app } = await import("./app");

const server: Server = createServer(app);
await new Promise<void>((resolve) =>
  server.listen(0, "127.0.0.1", resolve),
);
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Unable to start portal test listener");
}

const baseUrl = `http://127.0.0.1:${address.port}/api`;
const dealerId = process.env.STOCK_DEALER_ID!;
const portalToken = process.env.PORTAL_API_TOKEN!;
const testUuid = "00000000-0000-0000-0000-000000000060";

async function request(path: string, init: RequestInit = {}, authenticated = true) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (authenticated) headers.set("x-portal-token", portalToken);

  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function cleanupNamespace() {
  const leadIds = await db
    .select({ id: leadsTable.id })
    .from(leadsTable)
    .where(eq(leadsTable.dealerId, dealerId));

  for (const lead of leadIds) {
    await db
      .delete(leadEventsTable)
      .where(eq(leadEventsTable.leadId, lead.id));
  }
  await db.delete(leadsTable).where(eq(leadsTable.dealerId, dealerId));
  await db.delete(enquiriesTable).where(eq(enquiriesTable.dealerId, dealerId));
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

before(async () => {
  await cleanupNamespace();
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

test("keeps the staff work queue safe across lead changes", async () => {
  const protectedRoutes: Array<[string, string, string?]> = [
    ["GET", "/portal/session"],
    ["GET", "/portal/worklist"],
    ["GET", "/leads"],
    ["GET", "/leads/summary"],
    ["GET", `/leads/${testUuid}`],
    ["POST", "/leads", "{}"],
    ["PATCH", `/leads/${testUuid}`, "{}"],
    ["POST", `/leads/${testUuid}/activities`, "{}"],
    ["GET", "/enquiries"],
    ["PATCH", `/enquiries/${testUuid}/status`, "{}"],
    ["GET", "/sales"],
    ["POST", "/sales", "{}"],
    ["GET", `/sales/${testUuid}`],
    ["GET", `/sales/${testUuid}/checklist`],
    ["POST", `/sales/${testUuid}/checklist/customer_confirmed`, "{}"],
    ["GET", `/sales/${testUuid}/final-checks`],
    ["POST", `/sales/${testUuid}/prepare`, "{}"],
    ["POST", `/sales/${testUuid}/complete`, "{}"],
    ["POST", `/sales/${testUuid}/revoke-signing`, "{}"],
  ];

  for (const [method, path, body] of protectedRoutes) {
    const response = await request(
      path,
      { method, body },
      false,
    );
    assert.equal(
      response.status,
      401,
      `signed-out ${method} ${path} must be rejected`,
    );
  }

  const session = await request("/portal/session");
  assert.equal(session.status, 200);
  assert.deepEqual(await json(session), {
    state: "allowed",
    name: "Automation",
    email: null,
  });

  const now = Date.now();
  const futureDueAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  const overdueDueAt = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

  const walkInResponse = await request("/leads", {
    method: "POST",
    body: JSON.stringify({
      customerName: "Future Walk-in Buyer",
      email: "future-walk-in@example.test",
      phone: "07123456789",
      source: "walk_in",
      owner: "Automation",
      summary: "Interested in a future test drive.",
      nextAction: "Call back after the test drive",
      nextActionDueAt: futureDueAt,
    }),
  });
  assert.equal(walkInResponse.status, 201);
  const walkIn = await json<{
    id: string;
    source: string;
    stage: string;
    nextActionDueAt: string | null;
  }>(walkInResponse);
  assert.equal(walkIn.source, "walk_in");
  assert.equal(walkIn.stage, "new");
  assert.equal(new Date(walkIn.nextActionDueAt!).toISOString(), futureDueAt);

  const overdueResponse = await request("/leads", {
    method: "POST",
    body: JSON.stringify({
      customerName: "Overdue Phone Buyer",
      phone: "07987654321",
      source: "phone",
      owner: "Follow-up Desk",
      summary: "Needs a prompt follow-up.",
      nextAction: "Call today",
      nextActionDueAt: overdueDueAt,
    }),
  });
  assert.equal(overdueResponse.status, 201);
  const overdue = await json<{ id: string; source: string }>(overdueResponse);
  assert.equal(overdue.source, "phone");

  const activityResponse = await request(
    `/leads/${walkIn.id}/activities`,
    {
      method: "POST",
      body: JSON.stringify({
        kind: "call",
        body: "Spoke with the buyer and agreed a follow-up.",
        nextAction: "Confirm test-drive time",
        nextActionDueAt: futureDueAt,
      }),
    },
  );
  assert.equal(activityResponse.status, 201);
  const activity = await json<{
    lead: { stage: string; nextAction: string | null };
    activities: Array<{ kind: string; body: string }>;
  }>(activityResponse);
  assert.equal(activity.lead.stage, "qualifying");
  assert.equal(activity.lead.nextAction, "Confirm test-drive time");
  assert.ok(
    activity.activities.some(
      (entry) =>
        entry.kind === "call" &&
        entry.body === "Spoke with the buyer and agreed a follow-up.",
    ),
  );

  const worklistResponse = await request("/portal/worklist");
  assert.equal(worklistResponse.status, 200);
  const worklist = await json<{
    overdueFollowUps: Array<{ id: string }>;
    unansweredEnquiries: Array<{ id: string }>;
  }>(worklistResponse);
  assert.ok(
    worklist.overdueFollowUps.some((lead) => lead.id === overdue.id),
    "overdue next actions must appear in the work queue",
  );
  assert.ok(
    !worklist.overdueFollowUps.some((lead) => lead.id === walkIn.id),
    "future next actions must not appear as overdue",
  );
  assert.ok(
    worklist.unansweredEnquiries.some((lead) => lead.id === overdue.id),
    "untouched new leads must remain visible in unanswered enquiries",
  );
  assert.ok(
    !worklist.unansweredEnquiries.some((lead) => lead.id === walkIn.id),
    "a logged call must remove a lead from unanswered enquiries",
  );

  const searchResponse = await request(
    "/leads?search=Future%20Walk-in%20Buyer",
  );
  assert.equal(searchResponse.status, 200);
  const searched = await json<Array<{ id: string }>>(searchResponse);
  assert.deepEqual(searched.map((lead) => lead.id), [walkIn.id]);

  const sourceResponse = await request("/leads?source=walk_in");
  assert.equal(sourceResponse.status, 200);
  const bySource = await json<Array<{ id: string }>>(sourceResponse);
  assert.deepEqual(bySource.map((lead) => lead.id), [walkIn.id]);

  const ownerResponse = await request("/leads?stage=open&owner=Automation");
  assert.equal(ownerResponse.status, 200);
  const byOwner = await json<Array<{ id: string }>>(ownerResponse);
  assert.equal(byOwner.length, 1);
  assert.equal(byOwner[0]?.id, walkIn.id);

  const outcomeResponse = await request(`/leads/${overdue.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      stage: "lost",
      outcomeReason: "Buyer bought another car.",
    }),
  });
  assert.equal(outcomeResponse.status, 200);
  const outcome = await json<{
    lead: {
      stage: string;
      outcomeReason: string | null;
      closedAt: string | null;
    };
    activities: Array<{ kind: string; body: string }>;
  }>(outcomeResponse);
  assert.equal(outcome.lead.stage, "lost");
  assert.equal(outcome.lead.outcomeReason, "Buyer bought another car.");
  assert.ok(outcome.lead.closedAt);
  assert.ok(
    outcome.activities.some(
      (entry) =>
        entry.kind === "system" &&
        entry.body.includes("Closed as lost") &&
        entry.body.includes("Buyer bought another car."),
    ),
    "recording an outcome must append a timeline event",
  );

  const detailResponse = await request(`/leads/${walkIn.id}`);
  assert.equal(detailResponse.status, 200);
  const detail = await json<{
    lead: { id: string; customerName: string };
    activities: Array<{ kind: string }>;
  }>(detailResponse);
  assert.equal(detail.lead.id, walkIn.id);
  assert.equal(detail.lead.customerName, "Future Walk-in Buyer");
  assert.ok(detail.activities.length >= 2);

  const enquirySeed = await db
    .insert(enquiriesTable)
    .values({
      dealerId,
      type: "general",
      customerName: "Website Regression Buyer",
      email: "website-regression@example.test",
      phone: null,
      preferredContact: "email",
      message: "Please send more details.",
      source: "website",
    })
    .returning({ id: enquiriesTable.id });
  assert.ok(enquirySeed[0]?.id);

  const enquiriesResponse = await request("/enquiries");
  assert.equal(enquiriesResponse.status, 200);
  const enquiries = await json<Array<{ id: string }>>(enquiriesResponse);
  assert.ok(enquiries.some((enquiry) => enquiry.id === enquirySeed[0]!.id));

  const mirroredLeadsResponse = await request(
    "/leads?search=Website%20Regression%20Buyer",
  );
  assert.equal(mirroredLeadsResponse.status, 200);
  const mirroredLeads = await json<Array<{ enquiryId: string | null }>>(
    mirroredLeadsResponse,
  );
  assert.equal(mirroredLeads.length, 1);
  assert.equal(mirroredLeads[0]?.enquiryId, enquirySeed[0]!.id);

  const statusResponse = await request(
    `/enquiries/${enquirySeed[0]!.id}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "contacted" }),
    },
  );
  assert.equal(statusResponse.status, 200);
  const updatedEnquiry = await json<{ status: string }>(statusResponse);
  assert.equal(updatedEnquiry.status, "contacted");

  const summaryResponse = await request("/leads/summary");
  assert.equal(summaryResponse.status, 200);
  const summary = await json<
    Array<{ source: string; total: number; open: number; lost: number }>
  >(summaryResponse);
  assert.deepEqual(
    summary.find((entry) => entry.source === "walk_in"),
    { source: "walk_in", total: 1, open: 1, won: 0, lost: 0 },
  );
  assert.deepEqual(
    summary.find((entry) => entry.source === "phone"),
    { source: "phone", total: 1, open: 0, won: 0, lost: 1 },
  );
  assert.deepEqual(
    summary.find((entry) => entry.source === "website_form"),
    { source: "website_form", total: 1, open: 1, won: 0, lost: 0 },
  );
});