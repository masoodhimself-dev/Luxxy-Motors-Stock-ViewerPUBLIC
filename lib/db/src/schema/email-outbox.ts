import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { enquiriesTable } from "./enquiries";

/** Short-lived immutable provider payload; credentials are never persisted here. */
export const emailOutboxTable = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    enquiryId: uuid("enquiry_id").notNull(),
    deliveryId: uuid("delivery_id"),
    kind: text("kind")
      .$type<"staff" | "customer" | "dealer" | "reminder">()
      .notNull(),
    sendKey: text("send_key").notNull(),
    payload: text("payload"),
    payloadHash: text("payload_hash").notNull(),
    validationHash: text("validation_hash").notNull(),
    validation: jsonb("validation").$type<Record<string, unknown>>().notNull(),
    accountHash: text("account_hash").notNull(),
    status: text("status")
      .$type<
        "queued" | "sending" | "sent" | "failed" | "unknown" | "cancelled"
      >()
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    retryDeadline: timestamp("retry_deadline", {
      withTimezone: true,
    }).notNull(),
    providerId: text("provider_id"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("email_outbox_send_key_unique").on(t.dealerId, t.sendKey),
    index("email_outbox_due_idx")
      .on(t.dealerId, t.nextAttemptAt, t.id)
      .where(sql`${t.status} IN ('queued','sending')`),
    index("email_outbox_delivery_idx")
      .on(t.dealerId, t.deliveryId)
      .where(sql`${t.deliveryId} IS NOT NULL`),
    index("email_outbox_global_queued_idx")
      .on(t.nextAttemptAt, t.dealerId)
      .where(sql`${t.status}='queued'`),
    index("email_outbox_global_lease_idx")
      .on(t.leaseUntil, t.dealerId)
      .where(sql`${t.status}='sending'`),
    index("email_outbox_global_deadline_idx")
      .on(t.retryDeadline, t.dealerId)
      .where(sql`${t.status}='queued'`),
    index("email_outbox_payload_retention_idx")
      .on(t.createdAt, t.dealerId)
      .where(
        sql`${t.payload} IS NOT NULL AND ${t.status} IN ('sent','failed','unknown','cancelled')`,
      ),
    foreignKey({
      name: "email_outbox_enquiry_fk",
      columns: [t.enquiryId, t.dealerId],
      foreignColumns: [enquiriesTable.id, enquiriesTable.dealerId],
    }).onDelete("cascade"),
    check("email_outbox_attempts_check", sql`${t.attempts} BETWEEN 0 AND 3`),
    check(
      "email_outbox_kind_check",
      sql`${t.kind} IN ('staff','customer','dealer','reminder')`,
    ),
    check(
      "email_outbox_status_check",
      sql`${t.status} IN ('queued','sending','sent','failed','unknown','cancelled')`,
    ),
  ],
);
export const emailAccountThrottleTable = pgTable("email_account_throttle", {
  accountHash: text("account_hash").primaryKey(),
  nextAllowedAt: timestamp("next_allowed_at", { withTimezone: true }).notNull(),
});
