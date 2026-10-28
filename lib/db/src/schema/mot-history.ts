import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  integer,
} from "drizzle-orm/pg-core";
export const motHistoryCacheTable = pgTable(
  "mot_history_cache",
  {
    registration: text("registration").primaryKey(),
    data: jsonb("data").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("mot_history_cache_expiry").on(table.expiresAt)],
);
export const motApiUsageTable = pgTable("mot_api_usage", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull().default(0),
});
