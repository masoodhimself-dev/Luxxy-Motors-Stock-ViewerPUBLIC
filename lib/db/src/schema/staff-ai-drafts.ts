import {
  pgTable,
  text,
  uuid,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Reservations intentionally survive enquiry deletion, so deleting a case cannot reset its spend.
export const staffAiDraftGenerationsTable = pgTable(
  "staff_ai_draft_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    enquiryId: uuid("enquiry_id").notNull(),
    authUserId: text("auth_user_id").notNull(),
    requestId: uuid("request_id").notNull(),
    baseRevision: integer("base_revision").notNull(),
    baseDraftVersion: integer("base_draft_version").notNull(),
    factsHash: text("facts_hash").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull().default("reserved"),
    reservedMicroUsd: integer("reserved_micro_usd").notNull(),
    dayKey: text("day_key").notNull(),
    monthKey: text("month_key").notNull(),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    failureCode: text("failure_code"),
  },
  (t) => [
    uniqueIndex("staff_ai_draft_generations_dealer_id_request_id_key").on(
      t.dealerId,
      t.requestId,
    ),
    index("staff_ai_draft_generations_dealer_day_idx").on(t.dealerId, t.dayKey),
    index("staff_ai_draft_generations_month_idx").on(t.monthKey, t.dealerId),
    check(
      "staff_ai_draft_generations_base_revision_check",
      sql`${t.baseRevision}>=0`,
    ),
    check(
      "staff_ai_draft_generations_base_draft_version_check",
      sql`${t.baseDraftVersion}>=0`,
    ),
    check(
      "staff_ai_draft_generations_reserved_micro_usd_check",
      sql`${t.reservedMicroUsd}>0`,
    ),
    check(
      "staff_ai_draft_generations_status_check",
      sql`${t.status} IN ('reserved','succeeded','failed','unknown','stale')`,
    ),
  ],
);
