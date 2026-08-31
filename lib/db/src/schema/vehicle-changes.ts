import {
  index,
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
    index("vehicle_changes_vehicle_changed_at_idx").on(
      table.vehicleId,
      table.changedAt,
    ),
    index("vehicle_changes_import_run_id_idx").on(table.importRunId),
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
