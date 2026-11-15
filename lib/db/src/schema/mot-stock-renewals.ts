import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";

export const motStockRenewalObservationsTable = pgTable(
  "mot_stock_renewal_observations",
  {
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    registration: text("registration").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    testDate: date("test_date"),
    expiryDate: date("expiry_date"),
  },
  (t) => [
    primaryKey({ columns: [t.dealerId, t.vehicleId] }),
    foreignKey({
      name: "mot_stock_renewal_observations_vehicle_fk",
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
  ],
);

export const motStockRenewalNoticesTable = pgTable(
  "mot_stock_renewal_notices",
  {
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    registration: text("registration").notNull(),
    expiryDate: date("expiry_date").notNull(),
    status: text("status")
      .$type<"queued" | "sending" | "sent" | "failed" | "skipped" | "unknown">()
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimToken: uuid("claim_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    payload: text("payload"),
    accountHash: text("account_hash"),
    providerId: text("provider_id"),
  },
  (t) => [
    primaryKey({
      name: "mot_stock_renewal_notices_pk",
      columns: [t.dealerId, t.vehicleId, t.registration, t.expiryDate],
    }),
    foreignKey({
      name: "mot_stock_renewal_notices_vehicle_fk",
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
    index("mot_stock_renewal_notices_due_idx")
      .on(t.dealerId, t.nextAttemptAt)
      .where(sql`${t.status} IN ('queued','sending')`),
    check(
      "mot_stock_renewal_notices_status_check",
      sql`${t.status} IN ('queued','sending','sent','failed','skipped','unknown')`,
    ),
    check("mot_stock_renewal_notices_attempts_check", sql`${t.attempts} >= 0`),
  ],
);
