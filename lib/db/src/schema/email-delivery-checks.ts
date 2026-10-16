import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { dealershipsTable } from "./tenants";
export const emailDeliveryChecksTable = pgTable(
  "email_delivery_checks",
  {
    dealerId: text("dealer_id")
      .notNull()
      .references(() => dealershipsTable.id, { onDelete: "cascade" }),
    messageKey: text("message_key").notNull(),
    providerId: text("provider_id").notNull(),
    lastEvent: text("last_event").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.dealerId, t.messageKey] })],
);
