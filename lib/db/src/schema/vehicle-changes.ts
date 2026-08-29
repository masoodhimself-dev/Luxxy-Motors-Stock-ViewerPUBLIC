import {
  index,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { stockImportRunsTable } from "./stock-import-runs";
import { vehiclesTable } from "./vehicles";
import { dealerIntegrationsTable, dealersTable } from "./tenants";

export const vehicleChangesTable = pgTable(
  "vehicle_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehiclesTable.id, { onDelete: "cascade" }),
    importRunId: uuid("import_run_id").references(
      () => stockImportRunsTable.id,
      { onDelete: "set null" },
    ),
    tenantDealerId: uuid("tenant_dealer_id").references(() => dealersTable.id, { onDelete: "restrict" }),
    dealerIntegrationId: uuid("dealer_integration_id"),
    fieldName: text("field_name").notNull(),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditMetadata: jsonb("audit_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    foreignKey({
      name: "vehicle_changes_vehicle_dealer_fk",
      columns: [table.vehicleId, table.tenantDealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.tenantDealerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "vehicle_changes_run_dealer_fk",
      columns: [table.importRunId, table.tenantDealerId],
      foreignColumns: [stockImportRunsTable.id, stockImportRunsTable.tenantDealerId],
    }).onDelete("restrict"),
    foreignKey({
      name: "vehicle_changes_vehicle_integration_fk",
      columns: [table.vehicleId, table.tenantDealerId, table.dealerIntegrationId],
      foreignColumns: [
        vehiclesTable.id,
        vehiclesTable.tenantDealerId,
        vehiclesTable.dealerIntegrationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "vehicle_changes_run_integration_fk",
      columns: [table.importRunId, table.tenantDealerId, table.dealerIntegrationId],
      foreignColumns: [
        stockImportRunsTable.id,
        stockImportRunsTable.tenantDealerId,
        stockImportRunsTable.dealerIntegrationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "vehicle_changes_integration_dealer_fk",
      columns: [table.dealerIntegrationId, table.tenantDealerId],
      foreignColumns: [dealerIntegrationsTable.id, dealerIntegrationsTable.dealerId],
    }).onDelete("restrict"),
    index("vehicle_changes_vehicle_changed_at_idx").on(
      table.vehicleId,
      table.changedAt,
    ),
    index("vehicle_changes_import_run_id_idx").on(table.importRunId),
    index("vehicle_changes_tenant_dealer_id_idx").on(table.tenantDealerId),
    index("vehicle_changes_dealer_integration_id_idx").on(table.dealerIntegrationId),
    index("vehicle_changes_field_changed_at_idx").on(
      table.fieldName,
      table.changedAt,
    ),
  ],
);

export const insertVehicleChangeSchema = createInsertSchema(
  vehicleChangesTable,
).omit({ id: true });
export type InsertVehicleChange = z.infer<typeof insertVehicleChangeSchema>;
export type VehicleChange = typeof vehicleChangesTable.$inferSelect;
