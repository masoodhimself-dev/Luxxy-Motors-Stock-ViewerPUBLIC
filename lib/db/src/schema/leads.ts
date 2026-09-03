import {
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
 * The lead model: one row per person the dealership is talking to, whatever
 * channel they arrived through, and an append-only event log of what happened.
 *
 * Website enquiries mirror into leads automatically; walk-ins, calls and
 * marketplace messages are typed in by the dealer.
 */

/** Where the lead came from. */
export const leadSourceEnum = pgEnum("lead_source", [
  "website_form",
  "phone",
  "whatsapp",
  "walk_in",
  "marketplace",
  "social",
]);

/** How far along the sale the lead is. */
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

/** How a closed lead finished. Kept separate from stage so a won lead still
 * records the stage it reached. */
export const leadOutcomeEnum = pgEnum("lead_outcome", ["won", "lost"]);

/** How a pre-deal deposit was taken. */
export const leadDepositMethodEnum = pgEnum("lead_deposit_method", [
  "cash",
  "card_machine",
  "bank_transfer",
  "other",
]);

/** Who caused a lead event. */
export const leadActorTypeEnum = pgEnum("lead_actor_type", [
  "staff",
  "customer",
  "system",
]);

/** Everything that can appear on a lead's timeline. */
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
    /** Set when the lead mirrors a website enquiry. */
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
    source: leadSourceEnum("source").notNull().default("website_form"),
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
    /** Deposit taken before a deal record exists; drives the work-queue chase. */
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
    index("leads_dealer_created_idx").on(table.dealerId, table.createdAt),
    index("leads_dealer_stage_created_idx").on(
      table.dealerId,
      table.stage,
      table.createdAt,
    ),
    index("leads_dealer_next_action_idx").on(
      table.dealerId,
      table.nextActionDueAt,
    ),
    index("leads_dealer_owner_idx").on(table.dealerId, table.owner),
    index("leads_vehicle_idx").on(table.vehicleId),
  ],
);

export const leadEventsTable = pgTable(
  "lead_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leadsTable.id, { onDelete: "cascade" }),
    type: leadEventTypeEnum("type").notNull(),
    actorType: leadActorTypeEnum("actor_type").notNull().default("staff"),
    actor: text("actor"),
    body: text("body"),
    payload: jsonb("payload").notNull().default({}),
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
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;

export const insertLeadEventSchema = createInsertSchema(leadEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLeadEvent = z.infer<typeof insertLeadEventSchema>;
export type LeadEvent = typeof leadEventsTable.$inferSelect;
