import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { salesTable, saleRevisionsTable } from "./sales";

export const saleChecklistCodeEnum = pgEnum("sale_checklist_code", [
  "customer_confirmed",
  "vehicle_confirmed",
  "price_confirmed",
  "disclosure_confirmed",
  "mileage_confirmed",
  "warranty_confirmed",
  "fulfilment_confirmed",
  "part_exchange_confirmed",
  "deposit_confirmed",
  "documents_generated",
]);

export const saleChecklistStatusEnum = pgEnum("sale_checklist_status", [
  "pending",
  "complete",
  "not_applicable",
  "invalidated",
]);

export const saleChecklistItemsTable = pgTable(
  "sale_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id").references(() => saleRevisionsTable.id, {
      onDelete: "set null",
    }),
    code: saleChecklistCodeEnum("code").notNull(),
    status: saleChecklistStatusEnum("status").notNull().default("pending"),
    completedBy: text("completed_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    evidenceHash: text("evidence_hash"),
    notes: text("notes"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sale_checklist_sale_code_uidx").on(table.saleId, table.code),
    index("sale_checklist_sale_status_idx").on(table.saleId, table.status),
  ],
);

export type SaleChecklistItem = typeof saleChecklistItemsTable.$inferSelect;