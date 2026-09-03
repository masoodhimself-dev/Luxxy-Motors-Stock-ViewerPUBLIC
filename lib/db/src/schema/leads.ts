import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { enquiriesTable } from "./enquiries";
import { vehiclesTable } from "./vehicles";

/**
 * A lead is the dealer-facing record of a buyer conversation, whatever channel
 * it arrived on. A website enquiry stays exactly as it is and becomes the
 * opening event of its lead; phone calls, WhatsApp messages, walk-ins,
 * marketplace and social leads are created directly.
 */
export const leadStageEnum = pgEnum("lead_stage", [
  "new",
  "qualifying",
  "viewing_booked",
  "offer",
  "reserved",
  "sale_agreed",
  "collected",
  "won",
  "lost",
]);

export const leadSourceEnum = pgEnum("lead_source", [
  "website_form",
  "phone",
  "whatsapp",
  "walk_in",
  "marketplace",
  "social",
]);

export const leadOutcomeEnum = pgEnum("lead_outcome", ["won", "lost"]);

/**
 * Offline deposit methods only. Online card payments are deliberately not
 * modelled yet; a future provider would add its own value here.
 */
export const leadDepositMethodEnum = pgEnum("lead_deposit_method", [
  "cash",
  "card_machine",
  "bank_transfer",
  "other",
]);

export const leadActorTypeEnum = pgEnum("lead_actor_type", [
  "staff",
  "customer",
  "system",
]);

export const leadEventTypeEnum = pgEnum("lead_event_type", [
  "lead_created",
  "enquiry_received",
  "call_logged",
  "message_logged",
  "email_logged",
  "visit_logged",
  "note_added",
  "viewing_booked",
  "stage_changed",
  "owner_assigned",
  "next_action_set",
  "deposit_recorded",
  "outcome_recorded",
  "sale_created",
]);

export const leadsTable = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    // The website enquiry that opened this lead, when there is one. At most one
    // lead per enquiry; the enquiry row itself is never rewritten.
    enquiryId: uuid("enquiry_id").references(() => enquiriesTable.id, {
      onDelete: "set null",
    }),
    vehicleId: uuid("vehicle_id").references(() => vehiclesTable.id, {
      onDelete: "set null",
    }),
    vehicleTitle: text("vehicle_title"),
    vehicleRegistration: text("vehicle_registration"),
    vehiclePrice: integer("vehicle_price"),
    vehicleUrl: text("vehicle_url"),
    stage: leadStageEnum("stage").notNull().default("new"),
    source: leadSourceEnum("source").notNull(),
    owner: text("owner"),
    customerName: text("customer_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    preferredContact: text("preferred_contact"),
    summary: text("summary"),
    nextAction: text("next_action"),
    nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    outcome: leadOutcomeEnum("outcome"),
    outcomeReason: text("outcome_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // A deposit taken in person or over the phone while the lead is reserved.
    depositPence: integer("deposit_pence").notNull().default(0),
    depositMethod: leadDepositMethodEnum("deposit_method"),
    depositReference: text("deposit_reference"),
    depositTakenAt: timestamp("deposit_taken_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("leads_enquiry_uidx").on(table.enquiryId),
    index("leads_dealer_stage_created_idx").on(
      table.dealerId,
      table.stage,
      table.createdAt,
    ),
    index("leads_dealer_created_idx").on(table.dealerId, table.createdAt),
    index("leads_dealer_next_action_idx").on(
      table.dealerId,
      table.nextActionDueAt,
    ),
    index("leads_dealer_owner_idx").on(table.dealerId, table.owner),
    index("leads_vehicle_idx").on(table.vehicleId),
    // A lead is only closed with an outcome and a reason, and an open lead
    // never carries one. The stage and the outcome must agree.
    check(
      "leads_closure_check",
      sql`(
        ${table.stage} in ('won', 'lost')
        and ${table.outcome} is not null
        and ${table.outcome}::text = ${table.stage}::text
        and ${table.outcomeReason} is not null
        and length(btrim(${table.outcomeReason})) > 0
        and ${table.closedAt} is not null
      ) or (
        ${table.stage} not in ('won', 'lost')
        and ${table.outcome} is null
        and ${table.outcomeReason} is null
        and ${table.closedAt} is null
      )`,
    ),
    // A recorded deposit always says how much, how it was taken and when.
    check(
      "leads_deposit_check",
      sql`(
        ${table.depositPence} = 0
        and ${table.depositMethod} is null
        and ${table.depositTakenAt} is null
      ) or (
        ${table.depositPence} > 0
        and ${table.depositMethod} is not null
        and ${table.depositTakenAt} is not null
      )`,
    ),
  ],
);

/**
 * The lead timeline. Rows are only ever appended: a stage change, an outcome or
 * an owner assignment writes a new event rather than overwriting the previous
 * one, so the history of a lead stays intact.
 *
 * `occurredAt` is when the touch happened in the real world and `createdAt` is
 * when it was recorded, so a call logged after the fact keeps its real time.
 */
export const leadEventsTable = pgTable(
  "lead_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leadsTable.id, { onDelete: "cascade" }),
    type: leadEventTypeEnum("type").notNull(),
    actorType: leadActorTypeEnum("actor_type").notNull(),
    actor: text("actor"),
    body: text("body"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("lead_events_lead_occurred_idx").on(table.leadId, table.occurredAt),
    index("lead_events_lead_created_idx").on(table.leadId, table.createdAt),
    index("lead_events_type_occurred_idx").on(table.type, table.occurredAt),
  ],
);

export const insertLeadSchema = createInsertSchema(leadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertLeadEventSchema = createInsertSchema(leadEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type InsertLeadEvent = z.infer<typeof insertLeadEventSchema>;
export type Lead = typeof leadsTable.$inferSelect;
export type LeadEvent = typeof leadEventsTable.$inferSelect;
export type LeadStage = (typeof leadStageEnum.enumValues)[number];
export type LeadSource = (typeof leadSourceEnum.enumValues)[number];
export type LeadEventType = (typeof leadEventTypeEnum.enumValues)[number];
export type LeadActorType = (typeof leadActorTypeEnum.enumValues)[number];
export type LeadDepositMethod = (typeof leadDepositMethodEnum.enumValues)[number];
