import {
  boolean,
  check,
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
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { stockImportRunsTable } from "./stock-import-runs";

export const inventoryStatusEnum = pgEnum("inventory_status", [
  "available",
  "reserved",
  "sold",
  "hidden",
  "archived",
]);

export const sourceStatusEnum = pgEnum("source_status", ["live", "missing"]);

export const vehiclesTable = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importRunId: uuid("import_run_id").references(
      () => stockImportRunsTable.id,
      { onDelete: "set null" },
    ),
    dealerId: text("dealer_id").notNull(),
    source: text("source").notNull(),
    advertId: text("advert_id").notNull(),
    inventoryStatus: inventoryStatusEnum("inventory_status")
      .notNull()
      .default("available"),
    sourceStatus: sourceStatusEnum("source_status").notNull().default("live"),

    title: text("title"),
    variant: text("variant"),
    make: text("make"),
    model: text("model"),
    trim: text("trim"),
    year: integer("year"),
    sourcePrice: integer("source_price"),
    pendingSourcePrice: integer("pending_source_price"),
    priceReviewRequired: boolean("price_review_required")
      .notNull()
      .default(false),
    websitePriceOverride: integer("website_price_override"),
    priceType: text("price_type"),
    currency: text("currency").notNull().default("GBP"),
    mileage: integer("mileage"),
    mileageText: text("mileage_text"),

    registrationBand: text("registration_band"),
    registration: text("registration"),
    plate: text("plate"),
    vrm: text("vrm"),
    vrmVerified: boolean("vrm_verified").notNull().default(false),

    fuel: text("fuel"),
    transmission: text("transmission"),
    bodyType: text("body_type"),
    engineSize: text("engine_size"),
    engineCC: integer("engine_cc"),
    doors: integer("doors"),
    seats: integer("seats"),
    colour: text("colour"),
    emissionClass: text("emission_class"),
    drivetrain: text("drivetrain"),
    owners: integer("owners"),
    writeOffCategory: text("write_off_category"),
    advertUrl: text("advert_url"),
    dealerName: text("dealer_name"),
    dealerLocation: text("dealer_location"),
    imageCount: integer("image_count"),
    sourceHeroImage: text("source_hero_image"),

    websiteTitleOverride: text("website_title_override"),
    websiteDescription: text("website_description"),
    websiteHeroImageOverride: text("website_hero_image_override"),
    websiteFeatured: boolean("website_featured").notNull().default(false),

    rawSourceData: jsonb("raw_source_data").$type<unknown>(),
    auditMetadata: jsonb("audit_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    uniqueIndex("vehicles_dealer_source_advert_uidx").on(
      table.dealerId,
      table.source,
      table.advertId,
    ),
    index("vehicles_import_run_id_idx").on(table.importRunId),
    index("vehicles_dealer_inventory_status_idx").on(
      table.dealerId,
      table.inventoryStatus,
    ),
    index("vehicles_dealer_source_status_idx").on(
      table.dealerId,
      table.sourceStatus,
    ),
    index("vehicles_vrm_idx").on(table.vrm),
    index("vehicles_price_review_required_idx").on(table.priceReviewRequired),
    check(
      "vehicles_nonnegative_values_check",
      sql`(${table.sourcePrice} is null or ${table.sourcePrice} >= 0)
         and (${table.pendingSourcePrice} is null or ${table.pendingSourcePrice} >= 0)
        and (${table.websitePriceOverride} is null or ${table.websitePriceOverride} >= 0)
        and (${table.mileage} is null or ${table.mileage} >= 0)
        and (${table.imageCount} is null or ${table.imageCount} >= 0)
        and ${table.missingCount} >= 0`,
    ),
  ],
);

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
