import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  integer,
  jsonb,
  timestamp,
  foreignKey,
  check,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { enquiriesTable } from "./enquiries";

export const enquiryEmailDraftsTable = pgTable(
  "enquiry_email_drafts",
  {
    dealerId: text("dealer_id").notNull(),
    enquiryId: uuid("enquiry_id").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    source: text("source").notNull().default("manual"),
    content: jsonb("content").notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sendRequestId: uuid("send_request_id"),
  },
  (t) => [
    primaryKey({ columns: [t.dealerId, t.enquiryId] }),
    foreignKey({
      columns: [t.enquiryId, t.dealerId],
      foreignColumns: [enquiriesTable.id, enquiriesTable.dealerId],
    }).onDelete("cascade"),
    check("enquiry_email_drafts_version_check", sql`${t.version} > 0`),
    check(
      "enquiry_email_drafts_status_check",
      sql`${t.status} IN ('draft','sending','sent','unknown','discarded')`,
    ),
    check(
      "enquiry_email_drafts_source_check",
      sql`${t.source} IN ('manual','template','ai')`,
    ),
    index("enquiry_email_drafts_queue_idx").on(
      t.dealerId,
      t.status,
      t.updatedAt.desc(),
    ),
  ],
);
