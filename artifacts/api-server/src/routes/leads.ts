import { and as tenantAnd, eq as tenantEq } from "drizzle-orm";
import { currentDealerId } from "../lib/tenant-context";
import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  enquiriesTable,
  leadEventsTable,
  leadsTable,
  salesTable,
  vehiclesTable,
} from "@workspace/db";
import {
  AssignLeadOwnerBody,
  AssignLeadOwnerParams,
  AssignLeadOwnerResponse,
  CloseLeadBody,
  CloseLeadParams,
  CloseLeadResponse,
  CreateLeadActivityBody,
  CreateLeadBody,
  GetLeadChannelSummaryResponse,
  GetLeadParams,
  GetLeadsResponse,
  GetLeadResponse,
  LogLeadTouchBody,
  LogLeadTouchParams,
  LogLeadTouchResponse,
  GetPortalSessionResponse,
  GetPortalWorklistResponse,
  SetLeadNextActionBody,
  SetLeadNextActionParams,
  SetLeadNextActionResponse,
  UpdateLeadStageBody,
  UpdateLeadStageParams,
  UpdateLeadStageResponse,
  UpdateLeadBody,
} from "@workspace/api-zod";
import { portalAccess, requireStaff, staffLabel } from "../middlewares/staff-auth";
import {
  appendLeadEvent,
  changeLeadStage,
  closeLead,
  isClosedStage,
  LEAD_TOUCH_KINDS,
  LeadError,
  leadDealerId,
  loadLead as loadCoreLead,
  type QueryDb,
} from "../lib/leads";

const router: IRouter = Router();
const dealerId = () => currentDealerId();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Stage ordering used when the work queue has to break a tie: a lead that is
 * further along the sale outranks one nobody has touched.
 */
const STAGE_RANK: Record<string, number> = {
  sale_agreed: 0,
  reserved: 1,
  offer: 2,
  viewing_booked: 3,
  qualifying: 4,
  new: 5,
  collected: 6,
  won: 7,
  lost: 8,
};

/** Anything the dealer could still act on. */
const openStageFilter = () => sql`${leadsTable.stage} not in ('won','lost')`;

/**
 * The lead table deliberately stores no appointment column: a viewing either
 * belongs to the website enquiry that booked it, or to the `viewing_booked`
 * event the dealer logged by hand. This resolves both to one instant.
 */
// Keep correlated outer columns qualified: Drizzle strips direct column
// qualification from single-table SELECT expressions, which would otherwise
// bind "id" to the inner sales/event row instead of the lead.
const outerLeadId = sql`${leadsTable.id}`;
const outerEnquiryId = sql`${leadsTable.enquiryId}`;
const appointmentAtSql = sql<Date | null>`coalesce(
  (select e.appointment_at from enquiries e
    where e.id = ${outerEnquiryId} and e.appointment_cancelled_at is null),
  (select (ev.payload->>'appointmentAt')::timestamptz from lead_events ev
    where ev.lead_id = ${outerLeadId} and ev.type = 'viewing_booked'
    order by ev.occurred_at desc, ev.created_at desc limit 1)
)`;

/**
 * Deals predate leads and are keyed to the enquiry, so the association is
 * resolved on read rather than duplicated onto the lead.
 */
const saleIdSql = sql<string | null>`(
  select s.id from sales s
   where s.lead_id = ${outerLeadId}
      or (s.lead_id is null and s.enquiry_id = ${outerEnquiryId})
   order by s.created_at asc limit 1
)`;

const firstContactedAtSql = sql<Date | null>`(
  select min(ev.occurred_at) from lead_events ev
   where ev.lead_id = ${outerLeadId}
     and ev.type in ('call_logged','message_logged','email_logged','visit_logged')
)`;

const lastActivityAtSql = sql<Date>`greatest(${leadsTable.updatedAt}, ${leadsTable.createdAt})`;

/**
 * The shape the portal reads. Derived columns are computed in SQL so the work
 * queue can filter and order on them.
 */
const leadSelect = {
  id: leadsTable.id,
  dealerId: leadsTable.dealerId,
  customerName: leadsTable.customerName,
  email: leadsTable.email,
  phone: leadsTable.phone,
  preferredContact: leadsTable.preferredContact,
  source: leadsTable.source,
  stage: leadsTable.stage,
  vehicleId: leadsTable.vehicleId,
  vehicleTitle: leadsTable.vehicleTitle,
  vehicleRegistration: leadsTable.vehicleRegistration,
  vehiclePrice: leadsTable.vehiclePrice,
  vehicleUrl: leadsTable.vehicleUrl,
  owner: leadsTable.owner,
  summary: leadsTable.summary,
  nextAction: leadsTable.nextAction,
  nextActionDueAt: leadsTable.nextActionDueAt,
  depositPence: leadsTable.depositPence,
  depositMethod: leadsTable.depositMethod,
  depositReference: leadsTable.depositReference,
  depositTakenAt: leadsTable.depositTakenAt,
  lastContactedAt: leadsTable.lastContactedAt,
  outcome: leadsTable.outcome,
  outcomeReason: leadsTable.outcomeReason,
  closedAt: leadsTable.closedAt,
  enquiryId: leadsTable.enquiryId,
  createdAt: leadsTable.createdAt,
  updatedAt: leadsTable.updatedAt,
  appointmentAt: appointmentAtSql,
  saleId: saleIdSql,
  firstContactedAt: firstContactedAtSql,
  lastActivityAt: lastActivityAtSql,
} as const;

type LeadView = {
  [K in keyof typeof leadSelect]: (typeof leadSelect)[K] extends { _: { data: infer T } }
    ? T
    : never;
};

/**
 * The timeline stores precise event types; the portal talks in the plainer
 * vocabulary a salesperson uses. Translating here keeps the stored history
 * specific without making the UI decode it.
 */
const KIND_TO_EVENT = {
  call: "call_logged",
  whatsapp: "message_logged",
  email: "email_logged",
  visit: "visit_logged",
  note: "note_added",
} as const;
type ActivityKind = keyof typeof KIND_TO_EVENT;

function eventToKind(
  type: string,
  payload: unknown,
): "call" | "whatsapp" | "email" | "note" | "visit" | "stage_change" | "system" {
  switch (type) {
    case "call_logged":
      return "call";
    case "message_logged": {
      const channel =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).channel
          : null;
      return channel === "whatsapp" ? "whatsapp" : "note";
    }
    case "email_logged":
      return "email";
    case "visit_logged":
      return "visit";
    case "note_added":
      return "note";
    case "stage_changed":
      return "stage_change";
    default:
      return "system";
  }
}

const CONTACT_EVENTS = new Set([
  "call_logged",
  "message_logged",
  "email_logged",
  "visit_logged",
]);

/** Human wording for the automatic timeline entries. */
const SYSTEM_EVENT_BODY: Record<string, string> = {
  lead_created: "Lead created.",
  enquiry_received: "Enquiry received from the website.",
  viewing_booked: "Viewing booked.",
  owner_assigned: "Owner assigned.",
  next_action_set: "Next action set.",
  deposit_recorded: "Deposit recorded.",
  outcome_recorded: "Outcome recorded.",
  sale_created: "Deal started.",
};

function serialiseEvent(row: {
  id: string;
  type: string;
  body: string | null;
  actor: string | null;
  payload: unknown;
  occurredAt: Date;
}) {
  return {
    id: row.id,
    kind: eventToKind(row.type, row.payload),
    body: row.body ?? SYSTEM_EVENT_BODY[row.type] ?? row.type.replace(/_/g, " "),
    actor: row.actor,
    occurredAt: row.occurredAt,
  };
}

/**
 * Website enquiries are the dealership's busiest channel and they arrive on a
 * public route that must keep working without a login. Rather than writing to
 * two tables at submit time, the portal reflects enquiries into leads whenever
 * it reads. The unique index on enquiry_id makes this idempotent.
 */
async function mirrorEnquiries(): Promise<void> {
  const id = dealerId();
  const unmirrored = await db
    .select({
      id: enquiriesTable.id,
      customerName: enquiriesTable.customerName,
      email: enquiriesTable.email,
      phone: enquiriesTable.phone,
      preferredContact: enquiriesTable.preferredContact,
      message: enquiriesTable.message,
      status: enquiriesTable.status,
      vehicleId: enquiriesTable.vehicleId,
      vehicleTitle: enquiriesTable.vehicleTitle,
      vehicleRegistration: enquiriesTable.vehicleRegistration,
      vehiclePrice: enquiriesTable.vehiclePrice,
      vehicleUrl: enquiriesTable.vehicleUrl,
      appointmentAt: enquiriesTable.appointmentAt,
      createdAt: enquiriesTable.createdAt,
    })
    .from(enquiriesTable)
    .leftJoin(leadsTable, eq(leadsTable.enquiryId, enquiriesTable.id))
    .where(and(eq(enquiriesTable.dealerId, id), isNull(leadsTable.id)))
    .limit(200);

  if (!unmirrored.length) return;

  const created = await db
    .insert(leadsTable)
    .values(
      unmirrored.map((enquiry) => ({
        dealerId: id,
        enquiryId: enquiry.id,
        customerName: enquiry.customerName,
        email: enquiry.email,
        phone: enquiry.phone,
        preferredContact: enquiry.preferredContact,
        source: "website_form" as const,
        stage:
          enquiry.status === "closed"
            ? ("lost" as const)
            : enquiry.status === "contacted"
              ? ("qualifying" as const)
              : enquiry.appointmentAt
                ? ("viewing_booked" as const)
                : ("new" as const),
        vehicleId: enquiry.vehicleId,
        vehicleTitle: enquiry.vehicleTitle,
        vehicleRegistration: enquiry.vehicleRegistration,
        vehiclePrice: enquiry.vehiclePrice,
        vehicleUrl: enquiry.vehicleUrl,
        summary: enquiry.message,
        outcome: enquiry.status === "closed" ? ("lost" as const) : null,
        closedAt: enquiry.status === "closed" ? enquiry.createdAt : null,
        lastContactedAt: enquiry.status === "new" ? null : enquiry.createdAt,
        createdAt: enquiry.createdAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: leadsTable.id, enquiryId: leadsTable.enquiryId });

  if (!created.length) return;
  const byEnquiry = new Map(unmirrored.map((row) => [row.id, row]));
  await db.insert(leadEventsTable).values(
    created.flatMap((lead) => {
      const enquiry = lead.enquiryId ? byEnquiry.get(lead.enquiryId) : null;
      if (!enquiry) return [];
      const events: Array<typeof leadEventsTable.$inferInsert> = [
        {
          leadId: lead.id,
          type: "enquiry_received" as const,
          actorType: "customer" as const,
          actor: enquiry.customerName,
          body: enquiry.message,
          occurredAt: enquiry.createdAt,
        },
      ];
      if (enquiry.appointmentAt) {
        events.push({
          leadId: lead.id,
          type: "viewing_booked" as const,
          actorType: "customer" as const,
          actor: enquiry.customerName,
          body: "Viewing booked from the website.",
          occurredAt: enquiry.createdAt,
        });
      }
      return events;
    }),
  );
}

async function loadLead(id: string, query: QueryDb = db): Promise<LeadView | null> {
  const [row] = await query
    .select(leadSelect)
    .from(leadsTable)
    .where(and(eq(leadsTable.id, id), eq(leadsTable.dealerId, dealerId())));
  return (row as LeadView | undefined) ?? null;
}

async function leadDetail(row: LeadView, query: QueryDb = db) {
  const events = await query
    .select()
    .from(leadEventsTable)
    .where(eq(leadEventsTable.leadId, row.id))
    .orderBy(desc(leadEventsTable.occurredAt), desc(leadEventsTable.createdAt));

  let deal = null;
  if (row.saleId) {
    const [sale] = await query
      .select({
        id: salesTable.id,
        status: salesTable.status,
        agreedPricePence: salesTable.agreedPricePence,
        depositPence: salesTable.depositPence,
        balancePence: salesTable.balancePence,
        createdAt: salesTable.createdAt,
        completedAt: salesTable.completedAt,
      })
      .from(salesTable)
      .where(tenantAnd(eq(salesTable.id, row.saleId), tenantEq(salesTable.dealerId, currentDealerId())));
    deal = sale ?? null;
  }

  let enquiryMessage: string | null = null;
  if (row.enquiryId) {
    const [enquiry] = await query
      .select({ message: enquiriesTable.message })
      .from(enquiriesTable)
      .where(tenantAnd(eq(enquiriesTable.id, row.enquiryId), tenantEq(enquiriesTable.dealerId, currentDealerId())));
    enquiryMessage = enquiry?.message ?? null;
  }

  return {
    lead: row,
    activities: events.map(serialiseEvent),
    deal,
    enquiryMessage,
    events: [...events].reverse(),
    sales: deal ? [deal] : [],
  };
}

/** Start of today in the dealership's timezone, expressed as an instant. */
function dayBounds(): { start: Date; end: Date } {
  const timeZone = process.env.DEALER_TIMEZONE ?? "Europe/London";
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const isoDay = `${lookup("year")}-${lookup("month")}-${lookup("day")}`;

  // Resolve the timezone offset for that local midnight by comparing the same
  // instant rendered in UTC and in the dealership timezone.
  const naiveMidnight = new Date(`${isoDay}T00:00:00Z`);
  const offsetMs =
    naiveMidnight.getTime() -
    new Date(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
        .format(naiveMidnight)
        .replace(
          /(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})/,
          "$3-$1-$2T$4:$5:$6Z",
        ),
    ).getTime();

  const start = new Date(naiveMidnight.getTime() + offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

router.get("/portal/session", async (req, res): Promise<void> => {
  const access = await portalAccess(req);
  if (access.state === "signed_out") {
    res.status(401).json({ error: "Sign in to use the dealer portal." });
    return;
  }
  res.json(
    GetPortalSessionResponse.parse({
      state: access.state === "allowed" ? "allowed" : "forbidden",
      name: access.identity.name ?? null,
      email: access.identity.email ?? null,
    }),
  );
});

router.get("/portal/worklist", requireStaff, async (_req, res): Promise<void> => {
  await mirrorEnquiries();
  const id = dealerId();
  const now = new Date();
  const { start, end } = dayBounds();

  const [viewingsToday, overdueFollowUps, unansweredEnquiries, depositsWithoutDeal] =
    await Promise.all([
      db
        .select(leadSelect)
        .from(leadsTable)
        .where(
          and(
            eq(leadsTable.dealerId, id),
            openStageFilter(),
            gte(appointmentAtSql, start),
            lt(appointmentAtSql, end),
          ),
        )
        .orderBy(asc(appointmentAtSql)),
      db
        .select(leadSelect)
        .from(leadsTable)
        .where(
          and(
            eq(leadsTable.dealerId, id),
            openStageFilter(),
            isNotNull(leadsTable.nextActionDueAt),
            lt(leadsTable.nextActionDueAt, now),
          ),
        )
        .orderBy(asc(leadsTable.nextActionDueAt)),
      db
        .select(leadSelect)
        .from(leadsTable)
        .where(
          and(
            eq(leadsTable.dealerId, id),
            eq(leadsTable.stage, "new"),
            isNull(leadsTable.lastContactedAt),
          ),
        )
        .orderBy(asc(leadsTable.createdAt)),
      db
        .select(leadSelect)
        .from(leadsTable)
        .where(
          and(
            eq(leadsTable.dealerId, id),
            openStageFilter(),
            gt(leadsTable.depositPence, 0),
            isNull(saleIdSql),
          ),
        )
        .orderBy(asc(leadsTable.depositTakenAt)),
    ]);

  res.json(
    GetPortalWorklistResponse.parse({
      generatedAt: now,
      viewingsToday,
      overdueFollowUps,
      unansweredEnquiries,
      depositsWithoutDeal,
    }),
  );
});

router.get("/leads", requireStaff, async (req, res): Promise<void> => {
  await mirrorEnquiries();
  const id = dealerId();
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const stage = typeof req.query.stage === "string" ? req.query.stage : "all";
  const source = typeof req.query.source === "string" ? req.query.source : "all";
  const owner = typeof req.query.owner === "string" ? req.query.owner.trim() : "";

  const filters = [eq(leadsTable.dealerId, id)];

  if (stage === "open") {
    filters.push(openStageFilter());
  } else if (stage !== "all" && stage) {
    filters.push(sql`${leadsTable.stage}::text = ${stage}`);
  }
  if (source !== "all" && source) {
    filters.push(sql`${leadsTable.source}::text = ${source}`);
  }
  if (owner) {
    filters.push(eq(leadsTable.owner, owner));
  }
  if (search) {
    const term = `%${search.replace(/[%_]/g, (match) => `\\${match}`)}%`;
    const condition = or(
      sql`${leadsTable.customerName} ilike ${term}`,
      sql`replace(coalesce(${leadsTable.phone}, ''), ' ', '') ilike ${term.replace(/\s/g, "")}`,
      sql`coalesce(${leadsTable.email}, '') ilike ${term}`,
      sql`coalesce(${leadsTable.vehicleTitle}, '') ilike ${term}`,
      sql`replace(coalesce(${leadsTable.vehicleRegistration}, ''), ' ', '') ilike ${term.replace(/\s/g, "")}`,
    );
    if (condition) filters.push(condition);
  }

  const rows = (await db
    .select(leadSelect)
    .from(leadsTable)
    .where(and(...filters))
    .limit(300)) as LeadView[];

  // Urgency beats recency: overdue work first, then today's diary, then the
  // rest of the open pipeline, with closed leads at the bottom.
  const now = Date.now();
  const urgency = (row: LeadView) => {
    if (row.stage === "won" || row.stage === "lost") return 4;
    if (row.nextActionDueAt && new Date(row.nextActionDueAt).getTime() < now) return 0;
    if (row.appointmentAt && new Date(row.appointmentAt).getTime() >= now) return 1;
    if (!row.firstContactedAt) return 2;
    return 3;
  };
  rows.sort((a, b) => {
    const byUrgency = urgency(a) - urgency(b);
    if (byUrgency !== 0) return byUrgency;
    const byStage = (STAGE_RANK[a.stage] ?? 9) - (STAGE_RANK[b.stage] ?? 9);
    if (byStage !== 0) return byStage;
    return (
      new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );
  });

  res.json(GetLeadsResponse.parse(rows));
});

router.get("/leads/summary", requireStaff, async (_req, res): Promise<void> => {
  await mirrorEnquiries();
  const rows = await db
    .select({
      source: leadsTable.source,
      stage: leadsTable.stage,
      count: sql<number>`count(*)::int`,
    })
    .from(leadsTable)
    .where(eq(leadsTable.dealerId, dealerId()))
    .groupBy(leadsTable.source, leadsTable.stage);

  const summary = new Map<
    string,
    { source: string; total: number; open: number; won: number; lost: number }
  >();
  for (const row of rows) {
    const entry = summary.get(row.source) ?? {
      source: row.source,
      total: 0,
      open: 0,
      won: 0,
      lost: 0,
    };
    entry.total += row.count;
    if (row.stage === "won") entry.won += row.count;
    else if (row.stage === "lost") entry.lost += row.count;
    else entry.open += row.count;
    summary.set(row.source, entry);
  }

  const ordered = [...summary.values()].sort((a, b) => b.total - a.total);
  res.json(GetLeadChannelSummaryResponse.parse(ordered));
});

router.get("/leads/:id", requireStaff, async (req, res): Promise<void> => {
  const row = await loadLead(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json(GetLeadResponse.parse(await leadDetail(row)));
});

/** Copies the vehicle snapshot onto the lead when one is selected. */
async function vehicleSnapshot(vehicleId: string | null | undefined) {
  if (!vehicleId)
    return {
      vehicleId: null,
      vehicleTitle: null,
      vehicleRegistration: null,
      vehiclePrice: null,
    };
  const [vehicle] = await db
    .select({
      id: vehiclesTable.id,
      title: vehiclesTable.title,
      registration: vehiclesTable.registration,
      pricePence: sql<number | null>`coalesce(${vehiclesTable.websitePriceOverride}, ${vehiclesTable.sourcePrice})`,
    })
    .from(vehiclesTable)
    .where(tenantAnd(eq(vehiclesTable.id, vehicleId), tenantEq(vehiclesTable.dealerId, currentDealerId())));
  if (!vehicle) return null;
  return {
    vehicleId: vehicle.id,
    vehicleTitle: vehicle.title,
    vehicleRegistration: vehicle.registration,
    vehiclePrice: vehicle.pricePence,
  };
}

router.post("/leads", requireStaff, async (req: Request, res): Promise<void> => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (!data.email?.trim() && !data.phone?.trim()) {
    res.status(400).json({ error: "Provide an email address or phone number for the lead." });
    return;
  }

  let snapshot: {
    vehicleId: string | null;
    vehicleTitle: string | null;
    vehicleRegistration: string | null;
    vehiclePrice: number | null;
  } | null = {
    vehicleId: null,
    vehicleTitle: data.vehicleTitle ?? null,
    vehicleRegistration: null,
    vehiclePrice: null,
  };
  if (data.vehicleId) {
    snapshot = await vehicleSnapshot(data.vehicleId);
    if (!snapshot) {
      res.status(400).json({ error: "Selected vehicle was not found" });
      return;
    }
  }

  const now = new Date();
  const stage = data.stage ?? (data.appointmentAt ? "viewing_booked" : "new");
  const deposit = data.depositPence ?? 0;
  const actor = staffLabel(req);

  const [created] = await db
    .insert(leadsTable)
    .values({
      dealerId: dealerId(),
      customerName: data.customerName,
      email: data.email ?? null,
      phone: data.phone ?? null,
      source: data.source,
      stage,
      ...snapshot,
      owner: data.owner ?? actor,
      summary: data.summary ?? null,
      nextAction: data.nextAction ?? null,
      nextActionDueAt: data.nextActionDueAt ?? null,
      depositPence: deposit,
      depositMethod: deposit > 0 ? "other" : null,
      depositTakenAt: deposit > 0 ? now : null,
      // A lead the dealer typed in has by definition already been spoken to,
      // unless they explicitly logged it as untouched.
      lastContactedAt: stage === "new" ? null : now,
      outcome: null,
      closedAt: null,
    })
    .returning({ id: leadsTable.id });

  const events: Array<typeof leadEventsTable.$inferInsert> = [
    {
      leadId: created.id,
      type: "lead_created",
      actorType: "staff",
      actor,
      body: `Lead captured manually (${data.source.replace(/_/g, " ")}).`,
      occurredAt: now,
    },
  ];
  if (data.appointmentAt) {
    events.push({
      leadId: created.id,
      type: "viewing_booked",
      actorType: "staff",
      actor,
      body: "Viewing booked.",
      payload: { appointmentAt: new Date(data.appointmentAt).toISOString() },
      occurredAt: now,
    });
  }
  if (deposit > 0) {
    events.push({
      leadId: created.id,
      type: "deposit_recorded",
      actorType: "staff",
      actor,
      body: `Deposit of £${(deposit / 100).toFixed(2)} taken.`,
      occurredAt: now,
    });
  }
  await db.insert(leadEventsTable).values(events);

  const row = await loadLead(created.id);
  if (!row) {
    res.status(500).json({ error: "Unable to load the newly created lead." });
    return;
  }
  res.status(201).json(GetLeadResponse.parse(await leadDetail(row)));
});

router.patch("/leads/:id", requireStaff, async (req, res): Promise<void> => {
  const existing = await loadLead(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const parsed = UpdateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const now = new Date();
  const actor = data.actor?.trim() || staffLabel(req);

  const patch: Record<string, unknown> = { updatedAt: now };
  if (data.customerName !== undefined) patch.customerName = data.customerName;
  if (data.email !== undefined) patch.email = data.email;
  if (data.phone !== undefined) patch.phone = data.phone;
  if (data.source !== undefined) patch.source = data.source;
  if (data.owner !== undefined) patch.owner = data.owner;
  if (data.summary !== undefined) patch.summary = data.summary;
  if (data.nextAction !== undefined) patch.nextAction = data.nextAction;
  if (data.nextActionDueAt !== undefined) patch.nextActionDueAt = data.nextActionDueAt;
  if (data.outcomeReason !== undefined) patch.outcomeReason = data.outcomeReason;
  if (data.depositPence !== undefined && data.depositPence !== null) {
    patch.depositPence = data.depositPence;
    patch.depositTakenAt =
      data.depositPence > 0 ? (existing.depositTakenAt ?? now) : null;
  }
  if (data.vehicleId !== undefined) {
    const snapshot = await vehicleSnapshot(data.vehicleId);
    if (data.vehicleId && !snapshot) {
      res.status(400).json({ error: "Selected vehicle was not found" });
      return;
    }
    Object.assign(patch, snapshot);
  } else if (data.vehicleTitle !== undefined) {
    patch.vehicleTitle = data.vehicleTitle;
  }

  const stageChanged = data.stage !== undefined && data.stage !== existing.stage;
  if (stageChanged && data.stage) {
    patch.stage = data.stage;
    const closing = data.stage === "won" || data.stage === "lost";
    patch.outcome = closing ? data.stage : null;
    patch.closedAt = closing ? now : null;
    if (data.stage !== "new" && !existing.lastContactedAt) {
      patch.lastContactedAt = now;
    }
    if (closing) {
      // Nothing left to chase once the lead is closed.
      patch.nextAction = data.nextAction ?? null;
      patch.nextActionDueAt = data.nextActionDueAt ?? null;
    }
  }

  await db.update(leadsTable).set(patch).where(tenantAnd(eq(leadsTable.id, existing.id), tenantEq(leadsTable.dealerId, currentDealerId())));

  const events: Array<typeof leadEventsTable.$inferInsert> = [];
  if (data.appointmentAt !== undefined && data.appointmentAt) {
    events.push({
      leadId: existing.id,
      type: "viewing_booked",
      actorType: "staff",
      actor,
      body: "Viewing rebooked.",
      payload: { appointmentAt: new Date(data.appointmentAt).toISOString() },
      occurredAt: now,
    });
  }
  if (stageChanged && data.stage) {
    const closing = data.stage === "won" || data.stage === "lost";
    const reason = data.outcomeReason ?? existing.outcomeReason;
    const suffix = closing && reason ? ` — ${reason}` : "";
    events.push({
      leadId: existing.id,
      type: closing ? "outcome_recorded" : "stage_changed",
      actorType: "staff",
      actor,
      body: closing
        ? `Closed as ${data.stage}${suffix}.`
        : `Stage moved from ${existing.stage} to ${data.stage}.`,
      payload: { from: existing.stage, to: data.stage },
      occurredAt: now,
    });
  }
  if (events.length) await db.insert(leadEventsTable).values(events);

  const updated = await loadLead(existing.id);
  res.json(GetLeadResponse.parse(await leadDetail(updated!)));
});

router.post(
  "/leads/:id/activities",
  requireStaff,
  async (req, res): Promise<void> => {
    const existing = await loadLead(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    const parsed = CreateLeadActivityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const data = parsed.data;
    const occurredAt = data.occurredAt ?? new Date();
    const now = new Date();
    const actor = staffLabel(req);
    const kind = data.kind as ActivityKind;
    const type = KIND_TO_EVENT[kind] ?? "note_added";

    const events: Array<typeof leadEventsTable.$inferInsert> = [
      {
        leadId: existing.id,
        type,
        actorType: "staff",
        actor,
        body: data.body,
        payload: kind === "whatsapp" ? { channel: "whatsapp" } : {},
        occurredAt,
      },
    ];

    // Logging contact and deciding what happens next is one interaction, so the
    // activity write also moves the lead on.
    const madeContact = CONTACT_EVENTS.has(type);
    const patch: Record<string, unknown> = { updatedAt: now };
    if (madeContact) {
      patch.lastContactedAt = occurredAt;
      if (existing.stage === "new" && data.stage === undefined) {
        patch.stage = "qualifying";
      }
    }
    if (data.nextAction !== undefined) patch.nextAction = data.nextAction;
    if (data.nextActionDueAt !== undefined) patch.nextActionDueAt = data.nextActionDueAt;

    if (data.stage !== undefined && data.stage !== existing.stage) {
      const closing = data.stage === "won" || data.stage === "lost";
      patch.stage = data.stage;
      patch.outcome = closing ? data.stage : null;
      patch.closedAt = closing ? now : null;
      if (data.stage !== "new" && !existing.lastContactedAt) {
        patch.lastContactedAt = occurredAt;
      }
      events.push({
        leadId: existing.id,
        type: closing ? "outcome_recorded" : "stage_changed",
        actorType: "staff",
        actor,
        body: closing
          ? `Closed as ${data.stage}.`
          : `Stage moved from ${existing.stage} to ${data.stage}.`,
        payload: { from: existing.stage, to: data.stage },
        occurredAt: now,
      });
    }

    await db.insert(leadEventsTable).values(events);
    await db.update(leadsTable).set(patch).where(tenantAnd(eq(leadsTable.id, existing.id), tenantEq(leadsTable.dealerId, currentDealerId())));

    const updated = await loadLead(existing.id);
    res.status(201).json(GetLeadResponse.parse(await leadDetail(updated!)));
  },
);

/**
 * The original lead API exposes explicit operations for the append-only
 * timeline and the individual pipeline fields. Keep these alongside the
 * portal's broader PATCH/activity endpoints so existing API clients continue
 * to have a small, predictable surface.
 */
router.post("/leads/:id/touches", requireStaff, async (req, res): Promise<void> => {
  const params = LogLeadTouchParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data.id)) {
    res.status(400).json({ error: "Invalid lead id." });
    return;
  }
  const parsed = LogLeadTouchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const occurredAt = input.occurredAt ?? new Date();
  if (occurredAt.getTime() > Date.now() + 60_000) {
    res.status(400).json({ error: "A touch cannot be logged in the future." });
    return;
  }
  try {
    const detail = await db.transaction(async (tx) => {
      const lead = await loadCoreLead(tx, params.data.id);
      if (!lead) return null;
      const kind = LEAD_TOUCH_KINDS[input.type];
      await appendLeadEvent(tx, {
        leadId: lead.id,
        type: kind.type,
        actorType: "staff",
        actor: input.actor?.trim() || staffLabel(req),
        body: input.body.trim(),
        payload: { channel: input.type },
        occurredAt,
      });
      if (kind.contact && (!lead.lastContactedAt || lead.lastContactedAt < occurredAt)) {
        await tx.update(leadsTable).set({ lastContactedAt: occurredAt }).where(tenantAnd(eq(leadsTable.id, lead.id), tenantEq(leadsTable.dealerId, currentDealerId())));
      }
      const row = await loadLead(lead.id, tx);
      return row ? leadDetail(row, tx) : null;
    });
    if (!detail) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }
    res.status(201).json(LogLeadTouchResponse.parse(detail));
  } catch (error) {
    if (error instanceof LeadError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Unable to log lead touch");
    res.status(500).json({ error: "Unable to log that touch." });
  }
});

router.post("/leads/:id/stage", requireStaff, async (req, res): Promise<void> => {
  const params = UpdateLeadStageParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data.id)) {
    res.status(400).json({ error: "Invalid lead id." });
    return;
  }
  const parsed = UpdateLeadStageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const detail = await db.transaction(async (tx) => {
      const lead = await loadCoreLead(tx, params.data.id);
      if (!lead) return null;
      await changeLeadStage(tx, lead, {
        stage: parsed.data.stage,
        note: parsed.data.note?.trim() || null,
        actor: parsed.data.actor?.trim() || staffLabel(req),
        deposit: parsed.data.deposit ?? null,
      });
      const row = await loadLead(lead.id, tx);
      return row ? leadDetail(row, tx) : null;
    });
    if (!detail) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }
    res.json(UpdateLeadStageResponse.parse(detail));
  } catch (error) {
    if (error instanceof LeadError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Unable to change lead stage");
    res.status(500).json({ error: "Unable to change the lead stage." });
  }
});

router.post("/leads/:id/owner", requireStaff, async (req, res): Promise<void> => {
  const params = AssignLeadOwnerParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data.id)) {
    res.status(400).json({ error: "Invalid lead id." });
    return;
  }
  const parsed = AssignLeadOwnerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const detail = await db.transaction(async (tx) => {
      const lead = await loadCoreLead(tx, params.data.id);
      if (!lead) return null;
      const owner = parsed.data.owner?.trim() || null;
      await tx.update(leadsTable).set({ owner }).where(tenantAnd(eq(leadsTable.id, lead.id), tenantEq(leadsTable.dealerId, currentDealerId())));
      await appendLeadEvent(tx, {
        leadId: lead.id,
        type: "owner_assigned",
        actorType: "staff",
        actor: parsed.data.actor?.trim() || staffLabel(req),
        body: owner ? `Owner assigned to ${owner}.` : "Owner cleared.",
        payload: { owner },
      });
      const row = await loadLead(lead.id, tx);
      return row ? leadDetail(row, tx) : null;
    });
    if (!detail) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }
    res.json(AssignLeadOwnerResponse.parse(detail));
  } catch (error) {
    req.log.error({ err: error }, "Unable to assign lead owner");
    res.status(500).json({ error: "Unable to assign the owner." });
  }
});

router.post("/leads/:id/next-action", requireStaff, async (req, res): Promise<void> => {
  const params = SetLeadNextActionParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data.id)) {
    res.status(400).json({ error: "Invalid lead id." });
    return;
  }
  const parsed = SetLeadNextActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const nextAction = parsed.data.nextAction?.trim() || null;
  const dueAt = parsed.data.dueAt ?? null;
  if (nextAction && !dueAt) {
    res.status(400).json({ error: "Give the next action a due date." });
    return;
  }
  if (!nextAction && dueAt) {
    res.status(400).json({ error: "Say what the next action is." });
    return;
  }
  try {
    const detail = await db.transaction(async (tx) => {
      const lead = await loadCoreLead(tx, params.data.id);
      if (!lead) return null;
      if (isClosedStage(lead.stage)) {
        throw new LeadError(`This lead was closed as ${lead.stage}; there is nothing left to chase.`, 409);
      }
      await tx.update(leadsTable).set({ nextAction, nextActionDueAt: dueAt }).where(tenantAnd(eq(leadsTable.id, lead.id), tenantEq(leadsTable.dealerId, currentDealerId())));
      await appendLeadEvent(tx, {
        leadId: lead.id,
        type: "next_action_set",
        actorType: "staff",
        actor: parsed.data.actor?.trim() || staffLabel(req),
        body: nextAction ?? "Next action cleared.",
        payload: { nextAction, dueAt: dueAt?.toISOString() ?? null },
      });
      const row = await loadLead(lead.id, tx);
      return row ? leadDetail(row, tx) : null;
    });
    if (!detail) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }
    res.json(SetLeadNextActionResponse.parse(detail));
  } catch (error) {
    if (error instanceof LeadError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Unable to set lead next action");
    res.status(500).json({ error: "Unable to set the next action." });
  }
});

router.post("/leads/:id/outcome", requireStaff, async (req, res): Promise<void> => {
  const params = CloseLeadParams.safeParse(req.params);
  if (!params.success || !uuidPattern.test(params.data.id)) {
    res.status(400).json({ error: "Invalid lead id." });
    return;
  }
  const parsed = CloseLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Closing a lead needs an outcome of won or lost and a reason." });
    return;
  }
  try {
    const detail = await db.transaction(async (tx) => {
      const lead = await loadCoreLead(tx, params.data.id);
      if (!lead) return null;
      await closeLead(tx, lead, {
        outcome: parsed.data.outcome,
        reason: parsed.data.reason,
        actor: parsed.data.actor?.trim() || staffLabel(req),
      });
      const row = await loadLead(lead.id, tx);
      return row ? leadDetail(row, tx) : null;
    });
    if (!detail) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }
    res.json(CloseLeadResponse.parse(detail));
  } catch (error) {
    if (error instanceof LeadError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Unable to close lead");
    res.status(500).json({ error: "Unable to close the lead." });
  }
});

export default router;
