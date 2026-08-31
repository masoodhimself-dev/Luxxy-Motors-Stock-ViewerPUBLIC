import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dealerIntegrationsTable, dealersTable } from "./tenants";
import { includeCompositeTenantForeignKeys } from "./publish-mode";

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
    tenantDealerId: uuid("tenant_dealer_id").references(() => dealersTable.id, { onDelete: "restrict" }),
    dealerIntegrationId: uuid("dealer_integration_id"),
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
    unique("stock_import_runs_id_tenant_dealer_unique").on(table.id, table.tenantDealerId),
    unique("stock_import_runs_id_tenant_dealer_integration_unique").on(
      table.id,
      table.tenantDealerId,
      table.dealerIntegrationId,
    ),
    ...(includeCompositeTenantForeignKeys
      ? [
          foreignKey({
            name: "stock_import_runs_integration_dealer_fk",
            columns: [table.dealerIntegrationId, table.tenantDealerId],
            foreignColumns: [dealerIntegrationsTable.id, dealerIntegrationsTable.dealerId],
          }).onDelete("restrict"),
        ]
      : []),
    uniqueIndex("stock_import_runs_run_id_uidx").on(table.runId),
    index("stock_import_runs_tenant_dealer_id_idx").on(table.tenantDealerId),
    index("stock_import_runs_dealer_integration_id_idx").on(table.dealerIntegrationId),
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
