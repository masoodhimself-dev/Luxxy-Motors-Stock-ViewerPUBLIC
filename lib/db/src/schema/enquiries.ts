import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";

export const enquiryTypeEnum = pgEnum("enquiry_type", [
  "viewing",
  "general",
  "delivery",
  "warranty",
  "part_exchange",
]);

export const enquiryStatusEnum = pgEnum("enquiry_status", [
  "new",
  "contacted",
  "closed",
]);

export const enquiriesTable = pgTable(
  "enquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id").references(() => vehiclesTable.id, {
      onDelete: "set null",
    }),
    vehicleTitle: text("vehicle_title"),
    vehicleRegistration: text("vehicle_registration"),
    vehiclePrice: integer("vehicle_price"),
    vehicleUrl: text("vehicle_url"),
    type: enquiryTypeEnum("type").notNull(),
    status: enquiryStatusEnum("status").notNull().default("new"),
    customerName: text("customer_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    preferredContact: text("preferred_contact"),
    message: text("message").notNull(),
    appointmentAt: timestamp("appointment_at", { withTimezone: true }),
    source: text("source").notNull().default("website"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("enquiries_dealer_status_created_idx").on(
      table.dealerId,
      table.status,
      table.createdAt,
    ),
    index("enquiries_dealer_created_idx").on(table.dealerId, table.createdAt),
    index("enquiries_vehicle_id_idx").on(table.vehicleId),
    uniqueIndex("enquiries_dealer_appointment_uidx").on(
      table.dealerId,
      table.appointmentAt,
    ),
  ],
);

export const insertEnquirySchema = createInsertSchema(enquiriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEnquiry = z.infer<typeof insertEnquirySchema>;
export type Enquiry = typeof enquiriesTable.$inferSelect;