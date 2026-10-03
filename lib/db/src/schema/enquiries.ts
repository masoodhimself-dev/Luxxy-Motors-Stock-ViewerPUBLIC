import { sql } from "drizzle-orm";
import {
  check,
  boolean,
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
    // Customer-facing reference quoted on the phone. Written by the API on every
    // new enquiry; the database default only exists to fill rows created before
    // references were introduced.
    reference: text("reference")
      .notNull()
      .default(
        sql`upper(substr(md5(random()::text), 1, 4) || '-' || substr(md5(random()::text), 1, 4))`,
      ),
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
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    followUpNote: text("follow_up_note"),
    followUpCompletedAt: timestamp("follow_up_completed_at", { withTimezone: true }),
    followUpRevision: integer("follow_up_revision").notNull().default(0),
    // Part exchange details are stored as real fields so they can be searched
    // and carried into a deal, instead of being sentences inside the message.
    partExchangeRegistration: text("part_exchange_registration"),
    partExchangeMileage: integer("part_exchange_mileage"),
    partExchangeCondition: text("part_exchange_condition"),
    appointmentRevision: integer("appointment_revision").notNull().default(0),
    appointmentStatus: text("appointment_status").$type<"pending" | "confirmed">(),
    appointmentDurationMinutes: integer("appointment_duration_minutes"),
    appointmentBufferMinutes: integer("appointment_buffer_minutes"),
    appointmentAt: timestamp("appointment_at", { withTimezone: true }),
    appointmentOutsideHours: boolean("appointment_outside_hours").notNull().default(false),
    appointmentDoubleBooked: boolean("appointment_double_booked").notNull().default(false),
    appointmentOverCapacity: boolean("appointment_over_capacity").notNull().default(false),
    appointmentCancelledAt: timestamp("appointment_cancelled_at", {
      withTimezone: true,
    }),
    // Lookup hash for the customer's self-service reschedule/cancel link.
    manageTokenHash: text("manage_token_hash"),
    // Anonymous browser identifier, used to attach earlier call/WhatsApp taps
    // to the lead they turned into.
    visitorId: text("visitor_id"),
    customerNotificationStatus: text("customer_notification_status")
      .notNull()
      .default("not_sent"),
    customerNotificationError: text("customer_notification_error"),
    customerNotificationAttemptedAt: timestamp(
      "customer_notification_attempted_at",
      { withTimezone: true },
    ),
    customerNotificationSentAt: timestamp("customer_notification_sent_at", {
      withTimezone: true,
    }),
    customerNotificationProviderId: text("customer_notification_provider_id"),
    dealerNotificationStatus: text("dealer_notification_status")
      .notNull()
      .default("not_sent"),
    dealerNotificationError: text("dealer_notification_error"),
    dealerNotificationAttemptedAt: timestamp(
      "dealer_notification_attempted_at",
      { withTimezone: true },
    ),
    dealerNotificationSentAt: timestamp("dealer_notification_sent_at", {
      withTimezone: true,
    }),
    dealerNotificationProviderId: text("dealer_notification_provider_id"),
    reminderStatus: text("reminder_status").notNull().default("not_scheduled"),
    reminderError: text("reminder_error"),
    reminderAttemptedAt: timestamp("reminder_attempted_at", {
      withTimezone: true,
    }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    reminderProviderId: text("reminder_provider_id"),
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
    check("enquiries_appointment_status_check", sql`${table.appointmentStatus} is null or ${table.appointmentStatus} in ('pending', 'confirmed')`),
    check("enquiries_appointment_duration_check", sql`${table.appointmentDurationMinutes} is null or ${table.appointmentDurationMinutes} between 15 and 180`),
    check("enquiries_appointment_buffer_check", sql`${table.appointmentBufferMinutes} is null or ${table.appointmentBufferMinutes} between 0 and 120`),
    index("enquiries_dealer_status_created_idx").on(
      table.dealerId,
      table.status,
      table.createdAt,
    ),
    index("enquiries_dealer_created_idx").on(table.dealerId, table.createdAt),
    index("enquiries_vehicle_id_idx").on(table.vehicleId),
    // Day advisory locks and booking checks protect ordinary bookings; staff may override.
    index("enquiries_dealer_appointment_idx")
      .on(table.dealerId, table.appointmentAt)
      .where(sql`appointment_cancelled_at is null`),
    uniqueIndex("enquiries_dealer_reference_uidx").on(
      table.dealerId,
      table.reference,
    ),
    uniqueIndex("enquiries_manage_token_hash_uidx").on(table.manageTokenHash),
    index("enquiries_dealer_visitor_idx").on(table.dealerId, table.visitorId),
  ],
);

export const insertEnquirySchema = createInsertSchema(enquiriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEnquiry = z.infer<typeof insertEnquirySchema>;
export type Enquiry = typeof enquiriesTable.$inferSelect;
