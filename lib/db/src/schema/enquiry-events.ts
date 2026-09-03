import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { enquiriesTable } from "./enquiries";
import { vehiclesTable } from "./vehicles";

export const enquiryEventKindEnum = pgEnum("enquiry_event_kind", [
  "enquiry_received",
  "viewing_booked",
  "viewing_rescheduled",
  "viewing_cancelled",
  "call_intent",
  "whatsapp_intent",
]);

export const enquiryEventActorEnum = pgEnum("enquiry_event_actor", [
  "customer",
  "dealer",
  "system",
]);

/**
 * Timeline of everything that happened around a lead: the enquiry itself, the
 * customer rescheduling or cancelling their own viewing, and call/WhatsApp taps.
 *
 * A tap happens before anyone identifies themselves, so `enquiryId` is nullable.
 * Those rows are attached to the enquiry later using `visitorId`.
 */
export const enquiryEventsTable = pgTable(
  "enquiry_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    enquiryId: uuid("enquiry_id").references(() => enquiriesTable.id, {
      onDelete: "cascade",
    }),
    vehicleId: uuid("vehicle_id").references(() => vehiclesTable.id, {
      onDelete: "set null",
    }),
    vehicleTitle: text("vehicle_title"),
    vehicleUrl: text("vehicle_url"),
    kind: enquiryEventKindEnum("kind").notNull(),
    actor: enquiryEventActorEnum("actor").notNull().default("customer"),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    visitorId: text("visitor_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("enquiry_events_dealer_occurred_idx").on(
      table.dealerId,
      table.occurredAt,
    ),
    index("enquiry_events_enquiry_occurred_idx").on(
      table.enquiryId,
      table.occurredAt,
    ),
    index("enquiry_events_dealer_visitor_idx").on(
      table.dealerId,
      table.visitorId,
      table.occurredAt,
    ),
    index("enquiry_events_vehicle_idx").on(table.vehicleId),
  ],
);

export const insertEnquiryEventSchema = createInsertSchema(
  enquiryEventsTable,
).omit({
  id: true,
  occurredAt: true,
});
export type InsertEnquiryEvent = z.infer<typeof insertEnquiryEventSchema>;
export type EnquiryEvent = typeof enquiryEventsTable.$inferSelect;
