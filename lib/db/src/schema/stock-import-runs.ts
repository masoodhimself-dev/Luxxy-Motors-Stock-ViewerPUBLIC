import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stockImportStatusEnum = pgEnum("stock_import_status", [
  "pending",
  "processing",
  "completed",
  "quarantined",
  "failed",
]);

export const stockImportRunsTable = pgTable(
  "stock_import_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: text("run_id").notNull(),
    dealerId: text("dealer_id").notNull(),
    source: text("source").notNull(),
    retailerId: text("retailer_id").notNull(),
    schemaVersion: text("schema_version").notNull(),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expectedCount: integer("expected_count").notNull(),
    receivedCount: integer("received_count").notNull(),
    complete: boolean("complete").notNull().default(false),
    status: stockImportStatusEnum("status").notNull().default("pending"),
    failedAdvertIds: jsonb("failed_advert_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    errors: jsonb("errors").$type<unknown[]>().notNull().default([]),
    rawSnapshot: jsonb("raw_snapshot").$type<unknown>().notNull(),
    addedCount: integer("added_count").notNull().default(0),
    changedCount: integer("changed_count").notNull().default(0),
    missingCount: integer("missing_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("stock_import_runs_run_id_uidx").on(table.runId),
    index("stock_import_runs_dealer_source_idx").on(
      table.dealerId,
      table.source,
    ),
    index("stock_import_runs_status_received_at_idx").on(
      table.status,
      table.receivedAt,
    ),
  ],
);

export const insertStockImportRunSchema = createInsertSchema(
  stockImportRunsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStockImportRun = z.infer<typeof insertStockImportRunSchema>;
export type StockImportRun = typeof stockImportRunsTable.$inferSelect;
