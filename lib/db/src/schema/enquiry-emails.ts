import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { enquiriesTable } from "./enquiries";

/** Delivery journal: email retries must never silently send a second message. */
export const enquiryEmailsTable = pgTable(
  "enquiry_emails",
  {
    id: uuid("id").primaryKey(),
    dealerId: text("dealer_id").notNull(),
    enquiryId: uuid("enquiry_id").notNull(),
    requestId: uuid("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status")
      .$type<"sending" | "sent" | "failed" | "unknown">()
      .notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    photoIds: jsonb("photo_ids").$type<string[]>().notNull().default([]),
    providerId: text("provider_id"),
    error: text("error"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("enquiry_emails_request_unique").on(
      t.dealerId,
      t.enquiryId,
      t.requestId,
    ),
    index("enquiry_emails_history_idx").on(
      t.dealerId,
      t.enquiryId,
      t.createdAt,
    ),
    foreignKey({
      columns: [t.enquiryId, t.dealerId],
      foreignColumns: [enquiriesTable.id, enquiriesTable.dealerId],
    }).onDelete("cascade"),
    check(
      "enquiry_emails_status_check",
      sql`${t.status} in ('sending','sent','failed','unknown')`,
    ),
  ],
);
