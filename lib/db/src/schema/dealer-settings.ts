import {
  jsonb,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dealerSettingsTable = pgTable("dealer_settings", {
  dealerId: text("dealer_id").primaryKey(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertDealerSettingsSchema = createInsertSchema(dealerSettingsTable);
export type InsertDealerSettings = z.infer<typeof insertDealerSettingsSchema>;
export type DealerSettings = typeof dealerSettingsTable.$inferSelect;
