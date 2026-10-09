import { and as tenantAnd, eq as tenantEq } from "drizzle-orm";
import { currentDealerId } from "./tenant-context";
import { and, asc, desc, eq, notExists, sql } from "drizzle-orm";
import type { Logger } from "pino";
import {
  db,
  enquiriesTable,
  leadEventsTable,
  leadsTable,
  salesTable,
  type Enquiry,
  type Lead,
  type LeadActorType,
  type LeadDepositMethod,
  type LeadEvent,
  type LeadEventType,
  type LeadSource,
  type LeadStage,
} from "@workspace/db";
import { bookingTimezone } from "./enquiry-notifications";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type QueryDb = Tx | typeof db;

/**
 * Stages a lead can sit at while it is still live. `won` and `lost` are closed
 * stages and are only ever reached by recording an outcome with a reason.
 */
export const LEAD_OPEN_STAGES = [
  "new",
  "qualifying",
  "viewing_booked",
  "offer",
  "reserved",
  "sale_agreed",
  "collected",
] as const;

export type LeadOpenStage = (typeof LEAD_OPEN_STAGES)[number];

/** Touches a person can log against a lead, and the timeline entry each writes. */
export const LEAD_TOUCH_KINDS = {
  call: { type: "call_logged", contact: true },
  whatsapp: { type: "message_logged", contact: true },
  sms: { type: "message_logged", contact: true },
  email: { type: "email_logged", contact: true },
  visit: { type: "visit_logged", contact: true },
  note: { type: "note_added", contact: false },
} as const satisfies Record<string, { type: LeadEventType; contact: boolean }>;

export type LeadTouchKind = keyof typeof LEAD_TOUCH_KINDS;

export const CARRIED_ACROSS_OUTCOME_REASON =
  "Carried across from a closed website enquiry. The original outcome was not recorded before leads existed.";

export class LeadError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LeadError";
    this.status = status;
  }
}

export function leadDealerId(): string {
  return currentDealerId();
}

export function isClosedStage(stage: LeadStage): boolean {
  return stage === "won" || stage === "lost";
}

function formatAppointment(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: bookingTimezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

export type LeadEventInput = {
  leadId: string;
  type: LeadEventType;
  actorType: LeadActorType;
  actor?: string | null;
  body?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
};

/**
 * Appends to the lead timeline. Timeline rows are never updated or deleted:
 * every stage change, owner assignment and outcome writes a new entry so the
 * history of a lead stays whole.
 */
export async function appendLeadEvent(
  tx: Tx,
  event: LeadEventInput,
): Promise<LeadEvent> {
  const [created] = await tx
    .insert(leadEventsTable)
    .values({
      leadId: event.leadId,
      type: event.type,
      actorType: event.actorType,
      actor: event.actor ?? null,
      body: event.body ?? null,
      payload: event.payload ?? {},
      occurredAt: event.occurredAt ?? new Date(),
    })
    .returning();
  return created;
}

/** Maps the free-text source recorded on an enquiry onto a lead channel. */
export function leadSourceFromEnquiry(enquiry: Enquiry): LeadSource {
  switch (enquiry.source?.trim().toLowerCase()) {
    case "phone":
      return "phone";
    case "whatsapp":
      return "whatsapp";
    case "walk_in":
    case "walk-in":
      return "walk_in";
    case "marketplace":
    case "autotrader":
      return "marketplace";
    case "social":
    case "facebook":
    case "instagram":
      return "social";
    default:
      return "website_form";
  }
}

/**
 * The rule for turning an enquiry into a lead, used both when a website
 * enquiry arrives and when existing enquiries are carried across:
 *
 * - a booked viewing opens at `viewing_booked`
 * - an enquiry already marked contacted opens at `qualifying`
 * - a closed enquiry opens at `lost`, because it is no longer live; the reason
 *   says plainly that the original outcome was never recorded
 */
export function leadStageForEnquiry(enquiry: Enquiry): LeadStage {
  if (enquiry.status === "closed") return "lost";
  if (enquiry.type === "viewing" && enquiry.appointmentAt) return "viewing_booked";
  if (enquiry.status === "contacted") return "qualifying";
  return "new";
}

type LeadOpening = {
  values: typeof leadsTable.$inferInsert;
  events: Array<Omit<LeadEventInput, "leadId">>;
};

export function leadOpeningFromEnquiry(enquiry: Enquiry): LeadOpening {
  const stage = leadStageForEnquiry(enquiry);
  const closed = stage === "lost";
  const events: Array<Omit<LeadEventInput, "leadId">> = [
    {
      type: "enquiry_received",
      actorType: "customer",
      actor: enquiry.customerName,
      body: enquiry.message,
      payload: {
        enquiryId: enquiry.id,
        enquiryType: enquiry.type,
        enquirySource: enquiry.source,
        vehicleId: enquiry.vehicleId,
      },
      occurredAt: enquiry.createdAt,
    },
  ];

  if (enquiry.appointmentAt) {
    events.push({
      type: "viewing_booked",
      actorType: "customer",
      actor: enquiry.customerName,
      body: `Viewing booked for ${formatAppointment(enquiry.appointmentAt)}.`,
      payload: {
        enquiryId: enquiry.id,
        appointmentAt: enquiry.appointmentAt.toISOString(),
      },
      occurredAt: enquiry.createdAt,
    });
  }

  if (enquiry.status !== "new") {
    events.push({
      type: "stage_changed",
      actorType: "system",
      body: `Carried across from the enquiry inbox, where it was marked as ${enquiry.status}. The time of that contact was not recorded.`,
      payload: {
        carriedAcross: true,
        enquiryStatus: enquiry.status,
        toStage: stage,
      },
      occurredAt: enquiry.updatedAt,
    });
  }

  if (closed) {
    events.push({
      type: "outcome_recorded",
      actorType: "system",
      body: CARRIED_ACROSS_OUTCOME_REASON,
      payload: {
        carriedAcross: true,
        outcome: "lost",
        closedAtSource: "enquiry.updatedAt",
      },
      occurredAt: enquiry.updatedAt,
    });
  }

  return {
    values: {
      dealerId: enquiry.dealerId,
      enquiryId: enquiry.id,
      vehicleId: enquiry.vehicleId,
      vehicleTitle: enquiry.vehicleTitle,
      vehicleRegistration: enquiry.vehicleRegistration,
      vehiclePrice: enquiry.vehiclePrice,
      vehicleUrl: enquiry.vehicleUrl,
      stage,
      source: leadSourceFromEnquiry(enquiry),
      customerName: enquiry.customerName,
      email: enquiry.email,
      phone: enquiry.phone,
      preferredContact: enquiry.preferredContact,
      summary: enquiry.message,
      outcome: closed ? "lost" : null,
      outcomeReason: closed ? CARRIED_ACROSS_OUTCOME_REASON : null,
      closedAt: closed ? enquiry.updatedAt : null,
      createdAt: enquiry.createdAt,
      updatedAt: enquiry.updatedAt,
    },
    events,
  };
}

/**
 * Opens the lead an enquiry belongs to. Returns null when the enquiry already
 * has one, so this is safe to call again.
 */
export async function openLeadForEnquiry(
  tx: Tx,
  enquiry: Enquiry,
): Promise<Lead | null> {
  const opening = leadOpeningFromEnquiry(enquiry);
  const [lead] = await tx
    .insert(leadsTable)
    .values(opening.values)
    .onConflictDoNothing({ target: leadsTable.enquiryId })
    .returning();
  if (!lead) return null;
  for (const event of opening.events) {
    await appendLeadEvent(tx, { ...event, leadId: lead.id });
  }
  return lead;
}

/**
 * Carries every enquiry that predates leads across into one, preserving its
 * date, status and vehicle context. Idempotent, so it can run on every boot.
 */
export async function backfillLeadsFromEnquiries(
  log: Logger,
  batchSize = 200,
): Promise<number> {
  let carried = 0;
  for (let batch = 0; batch < 500; batch += 1) {
    const opened = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('leads:carry-across'))`,
      );
      const pending = await tx
        .select()
        .from(enquiriesTable)
        .where(
          and(eq(enquiriesTable.dealerId, currentDealerId()), notExists(
            tx
              .select({ present: sql`1` })
              .from(leadsTable)
              .where(tenantAnd(eq(leadsTable.enquiryId, enquiriesTable.id), tenantEq(leadsTable.dealerId, currentDealerId()))),
          )),
        )
        .orderBy(asc(enquiriesTable.createdAt))
        .limit(batchSize);
      let count = 0;
      for (const enquiry of pending) {
        if (await openLeadForEnquiry(tx, enquiry)) count += 1;
      }
      return count;
    });
    carried += opened;
    if (opened < batchSize) break;
  }
  if (carried > 0) {
    log.info({ carried }, "Carried existing enquiries across into leads");
  }
  return carried;
}

export type LeadSaleLink = {
  id: string;
  status: string;
  agreedPricePence: number;
  depositPence: number;
  balancePence: number;
  createdAt: Date;
  completedAt: Date | null;
};

export type LeadDetail = {
  lead: Lead;
  events: LeadEvent[];
  sales: LeadSaleLink[];
};

export async function loadLead(tx: QueryDb, leadId: string): Promise<Lead | null> {
  const [lead] = await tx
    .select()
    .from(leadsTable)
    .where(and(eq(leadsTable.id, leadId), eq(leadsTable.dealerId, leadDealerId())));
  return lead ?? null;
}

export async function loadLeadDetail(
  tx: QueryDb,
  leadId: string,
): Promise<LeadDetail | null> {
  const lead = await loadLead(tx, leadId);
  if (!lead) return null;
  const events = await tx
    .select()
    .from(leadEventsTable)
    .where(eq(leadEventsTable.leadId, lead.id))
    .orderBy(asc(leadEventsTable.occurredAt), asc(leadEventsTable.createdAt));
  const sales = await tx
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
    .where(tenantAnd(eq(salesTable.leadId, lead.id), tenantEq(salesTable.dealerId, currentDealerId())))
    .orderBy(desc(salesTable.createdAt));
  return { lead, events, sales };
}

/** Shapes a lead for the API. Dates are left as dates for the response schema. */
export function leadPayload(lead: Lead) {
  return {
    id: lead.id,
    dealerId: lead.dealerId,
    enquiryId: lead.enquiryId,
    vehicleId: lead.vehicleId,
    vehicleTitle: lead.vehicleTitle,
    vehicleRegistration: lead.vehicleRegistration,
    vehiclePrice: lead.vehiclePrice,
    vehicleUrl: lead.vehicleUrl,
    stage: lead.stage,
    source: lead.source,
    owner: lead.owner,
    customerName: lead.customerName,
    email: lead.email,
    phone: lead.phone,
    preferredContact: lead.preferredContact,
    summary: lead.summary,
    nextAction: lead.nextAction,
    nextActionDueAt: lead.nextActionDueAt,
    lastContactedAt: lead.lastContactedAt,
    outcome: lead.outcome,
    outcomeReason: lead.outcomeReason,
    closedAt: lead.closedAt,
    depositPence: lead.depositPence,
    depositMethod: lead.depositMethod,
    depositReference: lead.depositReference,
    depositTakenAt: lead.depositTakenAt,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

export function leadEventPayload(event: LeadEvent) {
  return {
    id: event.id,
    leadId: event.leadId,
    type: event.type,
    actorType: event.actorType,
    actor: event.actor,
    body: event.body,
    payload: event.payload,
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
  };
}

export function leadDetailPayload(detail: LeadDetail) {
  return {
    lead: leadPayload(detail.lead),
    events: detail.events.map(leadEventPayload),
    sales: detail.sales,
  };
}

export type LeadDepositInput = {
  amountPence: number;
  method: LeadDepositMethod;
  reference?: string | null;
  takenAt?: Date | null;
};

/**
 * Moves a lead to another open stage. Closing a lead is deliberately not
 * possible here: `won` and `lost` are only reached through `closeLead`, which
 * demands an outcome and a reason.
 */
export async function changeLeadStage(
  tx: Tx,
  lead: Lead,
  input: {
    stage: LeadOpenStage;
    note?: string | null;
    actor?: string | null;
    deposit?: LeadDepositInput | null;
  },
): Promise<void> {
  if (isClosedStage(lead.stage)) {
    throw new LeadError(
      `This lead was closed as ${lead.stage} and cannot be moved to another stage.`,
      409,
    );
  }
  if (lead.stage === input.stage) {
    throw new LeadError(`This lead is already at the ${input.stage} stage.`, 409);
  }
  if (input.deposit && input.stage !== "reserved") {
    throw new LeadError("A deposit can only be recorded when a lead is reserved.");
  }

  const deposit = input.deposit ?? null;
  const takenAt = deposit ? deposit.takenAt ?? new Date() : null;

  await tx
    .update(leadsTable)
    .set({
      stage: input.stage,
      ...(deposit
        ? {
            depositPence: deposit.amountPence,
            depositMethod: deposit.method,
            depositReference: deposit.reference ?? null,
            depositTakenAt: takenAt,
          }
        : {}),
    })
    .where(tenantAnd(eq(leadsTable.id, lead.id), tenantEq(leadsTable.dealerId, currentDealerId())));

  await appendLeadEvent(tx, {
    leadId: lead.id,
    type: "stage_changed",
    actorType: "staff",
    actor: input.actor ?? null,
    body: input.note ?? null,
    payload: { fromStage: lead.stage, toStage: input.stage },
  });

  if (deposit) {
    await appendLeadEvent(tx, {
      leadId: lead.id,
      type: "deposit_recorded",
      actorType: "staff",
      actor: input.actor ?? null,
      body: `Deposit of £${(deposit.amountPence / 100).toFixed(2)} taken by ${deposit.method.replace(/_/g, " ")}.`,
      payload: {
        amountPence: deposit.amountPence,
        method: deposit.method,
        reference: deposit.reference ?? null,
        takenOffline: true,
      },
      occurredAt: takenAt ?? undefined,
    });
  }
}

/** Closes a lead. An outcome and a reason are both required. */
export async function closeLead(
  tx: Tx,
  lead: Lead,
  input: { outcome: "won" | "lost"; reason: string; actor?: string | null },
): Promise<void> {
  if (isClosedStage(lead.stage)) {
    throw new LeadError(`This lead was already closed as ${lead.stage}.`, 409);
  }
  const reason = input.reason.trim();
  if (!reason) {
    throw new LeadError("Give a reason for closing this lead.");
  }
  const closedAt = new Date();
  await tx
    .update(leadsTable)
    .set({
      stage: input.outcome,
      outcome: input.outcome,
      outcomeReason: reason,
      closedAt,
    })
    .where(tenantAnd(eq(leadsTable.id, lead.id), tenantEq(leadsTable.dealerId, currentDealerId())));
  await appendLeadEvent(tx, {
    leadId: lead.id,
    type: "outcome_recorded",
    actorType: "staff",
    actor: input.actor ?? null,
    body: reason,
    payload: { outcome: input.outcome, fromStage: lead.stage },
    occurredAt: closedAt,
  });
  await appendLeadEvent(tx, {
    leadId: lead.id,
    type: "stage_changed",
    actorType: "staff",
    actor: input.actor ?? null,
    body: null,
    payload: { fromStage: lead.stage, toStage: input.outcome },
    occurredAt: closedAt,
  });
}

/**
 * Finds the lead a sale is being created from, either named directly or
 * inferred from the enquiry the sale quotes.
 *
 * A named lead is a claim about where the sale came from, so it is checked: it
 * must belong to this dealer, it must not be about a different vehicle, and if
 * the sale also quotes an enquiry it must be that lead's own enquiry. A lead
 * taken by hand with no vehicle on it stays eligible, because the conversation
 * was never tied to one car.
 *
 * An inferred lead is only a guess, so a lead about a different vehicle is left
 * alone rather than dragged into a sale it has nothing to do with. The sale
 * still records the enquiry it was given.
 */
export async function resolveLeadForSale(
  tx: Tx,
  input: { leadId?: string | null; enquiryId?: string | null; vehicleId: string },
  log?: Logger,
): Promise<Lead | null> {
  if (input.leadId) {
    const lead = await loadLead(tx, input.leadId);
    if (!lead) throw new LeadError("Lead not found", 404);
    if (lead.vehicleId && lead.vehicleId !== input.vehicleId) {
      throw new LeadError(
        "This lead is about a different vehicle, so the sale cannot be created from it.",
        409,
      );
    }
    if (input.enquiryId && lead.enquiryId !== input.enquiryId) {
      throw new LeadError(
        "This lead did not come from that enquiry, so the sale would record where it came from wrongly.",
        409,
      );
    }
    return lead;
  }
  if (input.enquiryId) {
    const [lead] = await tx
      .select()
      .from(leadsTable)
      .where(
        and(
          eq(leadsTable.enquiryId, input.enquiryId),
          eq(leadsTable.dealerId, leadDealerId()),
        ),
      );
    if (!lead) return null;
    if (lead.vehicleId && lead.vehicleId !== input.vehicleId) {
      log?.warn(
        { leadId: lead.id, enquiryId: input.enquiryId, vehicleId: input.vehicleId },
        "The enquiry quoted on this sale belongs to a lead about another vehicle, so the lead was left as it was",
      );
      return null;
    }
    return lead;
  }
  return null;
}

/**
 * Records the sale on its lead and moves the lead on to `sale_agreed`. The sale
 * itself keeps its own checklist, revisions and signing flow untouched.
 */
export async function advanceLeadForSale(
  tx: Tx,
  lead: Lead,
  sale: { id: string; vehicleId: string; agreedPricePence: number },
): Promise<void> {
  if (isClosedStage(lead.stage)) {
    throw new LeadError(
      `This lead was closed as ${lead.stage} and cannot be turned into a sale.`,
      409,
    );
  }
  await appendLeadEvent(tx, {
    leadId: lead.id,
    type: "sale_created",
    actorType: "staff",
    body: null,
    payload: {
      saleId: sale.id,
      vehicleId: sale.vehicleId,
      agreedPricePence: sale.agreedPricePence,
    },
  });
  if (lead.stage === "sale_agreed" || lead.stage === "collected") return;
  await tx
    .update(leadsTable)
    .set({ stage: "sale_agreed" })
    .where(tenantAnd(eq(leadsTable.id, lead.id), tenantEq(leadsTable.dealerId, currentDealerId())));
  await appendLeadEvent(tx, {
    leadId: lead.id,
    type: "stage_changed",
    actorType: "system",
    body: "A sale was created from this lead.",
    payload: { fromStage: lead.stage, toStage: "sale_agreed", saleId: sale.id },
  });
}
