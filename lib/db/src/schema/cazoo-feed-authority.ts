import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { dealershipsTable } from "./tenants";
export const cazooFeedAuthorityTable = pgTable(
  "cazoo_feed_authority",
  {
    dealerId: text("dealer_id")
      .primaryKey()
      .references(() => dealershipsTable.id),
    retailerId: text("retailer_id").notNull(),
    feedId: text("feed_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("cazoo_feed_authority_feed_check", sql`${t.feedId} ~ '^AETA[0-9]+$'`),
  ],
);
