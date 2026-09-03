import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Staff who may use the dealer portal.
 *
 * Identity comes from Clerk; this table is the authorization list that decides
 * whether a signed-in Clerk account is allowed anywhere near the portal. It is
 * deliberately small: this project is one dealership, so the expected content
 * is a single row.
 */
export const portalUsersTable = pgTable(
  "portal_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    authUserId: text("auth_user_id").notNull(),
    email: text("email"),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("portal_users_auth_user_uidx").on(table.authUserId),
    index("portal_users_dealer_idx").on(table.dealerId),
  ],
);

export const insertPortalUserSchema = createInsertSchema(portalUsersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPortalUser = z.infer<typeof insertPortalUserSchema>;
export type PortalUser = typeof portalUsersTable.$inferSelect;
