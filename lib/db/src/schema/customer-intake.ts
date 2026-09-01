import { createInsertSchema } from "drizzle-zod";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { customerTable } from "./sales";
import { vehiclesTable } from "./vehicles";

export const customerIntakeStatusEnum = pgEnum("customer_intake_status", [
  "pending",
  "completed",
  "expired",
]);

export const customerIntakeSessionsTable = pgTable(
  "customer_intake_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehiclesTable.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    status: customerIntakeStatusEnum("status").notNull().default("pending"),
    customerId: uuid("customer_id").references(() => customerTable.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_intake_token_hash_uidx").on(table.tokenHash),
    index("customer_intake_dealer_status_created_idx").on(
      table.dealerId,
      table.status,
      table.createdAt,
    ),
    index("customer_intake_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const insertCustomerIntakeSessionSchema = createInsertSchema(
  customerIntakeSessionsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertCustomerIntakeSession = z.infer<
  typeof insertCustomerIntakeSessionSchema
>;
export type CustomerIntakeSession =
  typeof customerIntakeSessionsTable.$inferSelect;