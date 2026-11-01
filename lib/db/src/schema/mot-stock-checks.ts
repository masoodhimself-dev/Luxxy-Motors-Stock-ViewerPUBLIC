import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";

// Queue metadata only. Public DVSA facts remain in the existing shared MOT cache.
export const motStockCheckRunsTable = pgTable(
  "mot_stock_check_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    status: text("status").notNull().default("queued"),
    total: integer("total").notNull().default(0),
    checked: integer("checked").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("mot_stock_runs_id_dealer_uidx").on(t.id, t.dealerId),
    uniqueIndex("mot_stock_runs_active_dealer_uidx")
      .on(t.dealerId)
      .where(sql`${t.status} IN ('queued','running')`),
    index("mot_stock_runs_dealer_started_idx").on(
      t.dealerId,
      t.startedAt.desc(),
    ),
    check(
      "mot_stock_runs_status_check",
      sql`${t.status} IN ('queued','running','completed','completed_with_errors')`,
    ),
  ],
);
export const motStockChecksTable = pgTable(
  "mot_stock_checks",
  {
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    registration: text("registration").notNull(),
    runId: uuid("run_id"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.dealerId, t.vehicleId] }),
    foreignKey({
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.runId, t.dealerId],
      foreignColumns: [
        motStockCheckRunsTable.id,
        motStockCheckRunsTable.dealerId,
      ],
    }),
    index("mot_stock_checks_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} IN ('queued','running')`),
    index("mot_stock_checks_run_idx").on(t.dealerId, t.runId),
    check(
      "mot_stock_checks_status_check",
      sql`${t.status} IN ('queued','running','completed','failed','skipped')`,
    ),
  ],
);
