import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
/** Chat state is committed with enquiry updates under this dealer's row lock. */
export const dealerChatTable = pgTable(
  "dealer_chat",
  {
    dealerId: text("dealer_id").primaryKey(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "dealer_chat_schema_check",
      sql`${table.state}->>'schemaVersion' = '1'`,
    ),
  ],
);
