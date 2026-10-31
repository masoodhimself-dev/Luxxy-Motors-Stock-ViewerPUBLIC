import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  uuid,
  index,
  unique,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
export const aiBrowserSessionsTable = pgTable(
  "ai_browser_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    dealerId: text("dealer_id").notNull(),
    usedCount: integer("used_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now()+interval '24 hours'`),
  },
  (t) => [
    index("ai_browser_session_expiry").on(t.expiresAt),
    check(
      "ai_browser_sessions_used_count_check",
      sql`${t.usedCount}>=0 AND ${t.usedCount}<=10`,
    ),
  ],
);
export const aiAssistanceRequestsTable = pgTable(
  "ai_assistance_requests",
  {
    id: uuid("id").primaryKey(),
    dealerId: text("dealer_id").notNull(),
    sessionHash: text("session_hash").notNull(),
    ipHash: text("ip_hash").notNull(),
    requestId: uuid("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    cacheKey: text("cache_key"),
    monthKey: text("month_key").notNull(),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    status: text("status").notNull(),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("ai_assistance_requests_dealer_id_session_hash_request_id_key").on(
      t.dealerId,
      t.sessionHash,
      t.requestId,
    ),
    index("ai_assistance_month").on(t.monthKey),
    index("ai_assistance_ip_day").on(t.ipHash, t.createdAt),
    check(
      "ai_assistance_requests_cost_micro_usd_check",
      sql`${t.costMicroUsd}>=0`,
    ),
    check(
      "ai_assistance_requests_status_check",
      sql`${t.status} IN ('reserved','succeeded','failed')`,
    ),
  ],
);
export const aiAssistanceCacheTable = pgTable(
  "ai_assistance_cache",
  {
    dealerId: text("dealer_id").notNull(),
    cacheKey: text("cache_key").notNull(),
    result: jsonb("result").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.dealerId, t.cacheKey] })],
);
