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
import { enquiriesTable } from "./enquiries";

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
    uniqueIndex("stock_change_tasks_id_dealer_uidx").on(t.id, t.dealerId),
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

/** Private staff preferences. They never alter stock prices or public labels. */
export const stockChangeSettingsTable = pgTable(
  "stock_change_settings",
  {
    dealerId: text("dealer_id").primaryKey(),
    minimumReduction: integer("minimum_reduction").notNull().default(100),
    contactIntervalDays: integer("contact_interval_days").notNull().default(7),
    revision: integer("revision").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "stock_change_settings_values_check",
      sql`${t.minimumReduction} between 0 and 1000000 and ${t.contactIntervalDays} between 0 and 365 and ${t.revision} >= 0`,
    ),
  ],
);

export const stockChangeCustomerOutcomesTable = pgTable(
  "stock_change_customer_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    taskId: uuid("task_id").notNull(),
    enquiryId: uuid("enquiry_id").notNull(),
    status: text("status")
      .$type<"pending" | "contacted" | "not_needed" | "follow_up">()
      .notNull()
      .default("pending"),
    revision: integer("revision").notNull().default(0),
    channel: text("channel").$type<"call" | "email" | "whatsapp">(),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    note: text("note"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.taskId, t.dealerId],
      foreignColumns: [
        stockChangeTasksTable.id,
        stockChangeTasksTable.dealerId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.enquiryId, t.dealerId],
      foreignColumns: [enquiriesTable.id, enquiriesTable.dealerId],
    }).onDelete("cascade"),
    uniqueIndex("stock_change_customer_outcomes_customer_uidx").on(
      t.dealerId,
      t.taskId,
      t.enquiryId,
    ),
    index("stock_change_customer_outcomes_follow_up_idx").on(
      t.dealerId,
      t.status,
      t.followUpAt,
    ),
    check(
      "stock_change_customer_outcomes_values_check",
      sql`${t.status} in ('pending','contacted','not_needed','follow_up') and ${t.revision}>=0 and (${t.channel} is null or ${t.channel} in ('call','email','whatsapp')) and ((${t.status}='follow_up' and ${t.followUpAt} is not null) or (${t.status}<>'follow_up' and ${t.followUpAt} is null))`,
    ),
  ],
);

/** Confirmed contact only; retries cannot restart the contact interval. */
export const stockChangeContactEventsTable = pgTable(
  "stock_change_contact_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    taskId: uuid("task_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    enquiryId: uuid("enquiry_id").notNull(),
    eventKey: text("event_key").notNull(),
    channel: text("channel").$type<"call" | "email" | "whatsapp">().notNull(),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    contactedAt: timestamp("contacted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.taskId, t.dealerId],
      foreignColumns: [
        stockChangeTasksTable.id,
        stockChangeTasksTable.dealerId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.enquiryId, t.dealerId],
      foreignColumns: [enquiriesTable.id, enquiriesTable.dealerId],
    }).onDelete("cascade"),
    uniqueIndex("stock_change_contact_events_key_uidx").on(
      t.dealerId,
      t.eventKey,
    ),
    index("stock_change_contact_events_customer_idx").on(
      t.dealerId,
      t.vehicleId,
      t.contactedAt.desc(),
    ),
    check(
      "stock_change_contact_events_channel_check",
      sql`${t.channel} in ('call','email','whatsapp')`,
    ),
  ],
);
