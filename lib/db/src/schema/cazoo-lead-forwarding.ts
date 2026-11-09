import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { dealershipsTable } from "./tenants";

export const cazooLeadForwardingSettingsTable = pgTable("cazoo_lead_forwarding_settings", {
  dealerId: text("dealer_id").primaryKey().references(() => dealershipsTable.id, { onDelete: "cascade" }),
  recipient: text("recipient"),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").notNull(),
}, (t) => [
  check("cazoo_forwarding_recipient_check", sql`(${t.recipient} is null or length(${t.recipient}) between 3 and 254) and (not ${t.enabled} or ${t.recipient} is not null)`),
]);

export const cazooLeadForwardsTable = pgTable("cazoo_lead_forwards", {
  receiptId: uuid("receipt_id").primaryKey(),
  dealerId: text("dealer_id").notNull().references(() => dealershipsTable.id, { onDelete: "cascade" }),
  dedupeKey: text("dedupe_key").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject"),
  body: text("body"),
  payload: text("payload"),
  payloadHash: text("payload_hash"),
  accountHash: text("account_hash"),
  status: text("status").$type<"pending" | "sending" | "sent" | "failed" | "unknown" | "cancelled">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  retryDeadline: timestamp("retry_deadline", { withTimezone: true }).notNull(),
  leaseToken: uuid("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  providerId: text("provider_id"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("cazoo_lead_forwards_dedupe").on(t.dealerId, t.dedupeKey),
  index("cazoo_lead_forwards_due").on(t.nextAttemptAt, t.receiptId).where(sql`${t.status}='pending'`),
  index("cazoo_lead_forwards_expired_lease").on(t.leaseUntil).where(sql`${t.status}='sending'`),
  check("cazoo_lead_forwards_status_check", sql`${t.status} in ('pending','sending','sent','failed','unknown','cancelled')`),
  check("cazoo_lead_forwards_attempts_check", sql`${t.attempts} between 0 and 3`),
  check("cazoo_lead_forwards_payload_check", sql`(${t.payload} is null and ${t.payloadHash} is null and ${t.accountHash} is null) or (${t.payload} is not null and ${t.payloadHash} is not null and ${t.accountHash} is not null)`),
]);
