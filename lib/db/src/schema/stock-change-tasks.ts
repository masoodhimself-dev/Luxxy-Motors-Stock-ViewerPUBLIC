import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";

/** Staff work only. Stock imports never mutate customer commitments or send emails. */
export const stockChangeTasksTable = pgTable(
  "stock_change_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    kind: text("kind").$type<"price_drop" | "missing_stock">().notNull(),
    status: text("status")
      .$type<"open" | "reviewed" | "resolved">()
      .notNull()
      .default("open"),
    changeKey: text("change_key").notNull(),
    revision: integer("revision").notNull().default(0),
    previousPrice: integer("previous_price"),
    currentPrice: integer("current_price"),
    missingCount: integer("missing_count").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    note: text("note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
    uniqueIndex("stock_change_tasks_dealer_change_uidx").on(
      t.dealerId,
      t.changeKey,
    ),
    uniqueIndex("stock_change_tasks_current_kind_uidx")
      .on(t.dealerId, t.vehicleId, t.kind)
      .where(sql`${t.resolvedAt} is null`),
    index("stock_change_tasks_home_idx").on(
      t.dealerId,
      t.status,
      t.createdAt.desc(),
    ),
    check(
      "stock_change_tasks_kind_check",
      sql`${t.kind} in ('price_drop','missing_stock')`,
    ),
    check(
      "stock_change_tasks_status_check",
      sql`${t.status} in ('open','reviewed','resolved')`,
    ),
    check(
      "stock_change_tasks_revision_check",
      sql`${t.revision} >= 0 and ${t.missingCount} >= 0`,
    ),
  ],
);
export type StockChangeTaskRecord = typeof stockChangeTasksTable.$inferSelect;
