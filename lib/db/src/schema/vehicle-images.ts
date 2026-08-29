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
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";
import { dealerIntegrationsTable, dealersTable } from "./tenants";

export const vehicleImageOriginEnum = pgEnum("vehicle_image_origin", [
  "source",
  "manual",
]);

export const vehicleImagesTable = pgTable(
  "vehicle_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehiclesTable.id, { onDelete: "cascade" }),
    tenantDealerId: uuid("tenant_dealer_id").references(() => dealersTable.id, { onDelete: "restrict" }),
    dealerIntegrationId: uuid("dealer_integration_id"),
    origin: vehicleImageOriginEnum("origin").notNull().default("source"),
    sourceUrl: text("source_url").notNull(),
    caption: text("caption"),
    sortOrder: integer("sort_order").notNull().default(0),
    isHero: boolean("is_hero").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    rawSourceData: jsonb("raw_source_data").$type<unknown>(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "vehicle_images_vehicle_dealer_fk",
      columns: [table.vehicleId, table.tenantDealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.tenantDealerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "vehicle_images_vehicle_integration_fk",
      columns: [table.vehicleId, table.tenantDealerId, table.dealerIntegrationId],
      foreignColumns: [
        vehiclesTable.id,
        vehiclesTable.tenantDealerId,
        vehiclesTable.dealerIntegrationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "vehicle_images_integration_dealer_fk",
      columns: [table.dealerIntegrationId, table.tenantDealerId],
      foreignColumns: [dealerIntegrationsTable.id, dealerIntegrationsTable.dealerId],
    }).onDelete("restrict"),
    uniqueIndex("vehicle_images_vehicle_url_uidx").on(
      table.vehicleId,
      table.sourceUrl,
    ),
    index("vehicle_images_vehicle_sort_order_idx").on(
      table.vehicleId,
      table.sortOrder,
    ),
    index("vehicle_images_tenant_dealer_id_idx").on(table.tenantDealerId),
    index("vehicle_images_dealer_integration_id_idx").on(table.dealerIntegrationId),
    index("vehicle_images_vehicle_active_idx").on(
      table.vehicleId,
      table.isActive,
    ),
  ],
);

export const insertVehicleImageSchema = createInsertSchema(
  vehicleImagesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVehicleImage = z.infer<typeof insertVehicleImageSchema>;
export type VehicleImage = typeof vehicleImagesTable.$inferSelect;
