import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { enquiriesTable } from "./enquiries";
import { vehiclesTable } from "./vehicles";

export const saleStatusEnum = pgEnum("sale_status", [
  "draft",
  "ready",
  "signing",
  "signed",
  "completed",
  "cancelled",
]);

export const saleRevisionStatusEnum = pgEnum("sale_revision_status", [
  "draft",
  "active",
  "signed",
  "superseded",
]);

export const signingSessionStatusEnum = pgEnum("signing_session_status", [
  "pending",
  "signed",
  "revoked",
  "expired",
]);

export const saleActorTypeEnum = pgEnum("sale_actor_type", [
  "staff",
  "customer",
  "system",
  "provider",
]);

export const customerTable = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: jsonb("address").$type<Record<string, unknown>>(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("customers_dealer_created_idx").on(table.dealerId, table.createdAt),
    index("customers_dealer_email_idx").on(table.dealerId, table.email),
  ],
);

export const salesTable = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehiclesTable.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customerTable.id, { onDelete: "restrict" }),
    enquiryId: uuid("enquiry_id").references(() => enquiriesTable.id, {
      onDelete: "set null",
    }),
    status: saleStatusEnum("status").notNull().default("draft"),
    currency: text("currency").notNull().default("GBP"),
    agreedPricePence: integer("agreed_price_pence").notNull(),
    depositPence: integer("deposit_pence").notNull().default(0),
    balancePence: integer("balance_pence").notNull(),
    mileageAtSale: integer("mileage_at_sale"),
    disclosureNotes: text("disclosure_notes"),
    internalNotes: text("internal_notes"),
    customerSnapshot: jsonb("customer_snapshot").$type<Record<string, unknown>>(),
    vehicleSnapshot: jsonb("vehicle_snapshot").$type<Record<string, unknown>>(),
    signedRevisionId: uuid("signed_revision_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("sales_dealer_status_created_idx").on(
      table.dealerId,
      table.status,
      table.createdAt,
    ),
    index("sales_vehicle_idx").on(table.vehicleId),
    index("sales_customer_idx").on(table.customerId),
    check(
      "sales_nonnegative_money_check",
      sql`${table.agreedPricePence} >= 0 and ${table.depositPence} >= 0 and ${table.balancePence} >= 0`,
    ),
    check(
      "sales_balance_matches_check",
      sql`${table.balancePence} = ${table.agreedPricePence} - ${table.depositPence}`,
    ),
  ],
);

export const saleRevisionsTable = pgTable(
  "sale_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    status: saleRevisionStatusEnum("status").notNull().default("draft"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    manifest: jsonb("manifest").$type<unknown[]>().notNull().default([]),
    documentHashes: jsonb("document_hashes")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    packHash: text("pack_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    signedAt: timestamp("signed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sale_revisions_sale_number_uidx").on(
      table.saleId,
      table.revisionNumber,
    ),
    index("sale_revisions_sale_status_idx").on(table.saleId, table.status),
  ],
);

export const saleAdjustmentsTable = pgTable(
  "sale_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    amountPence: integer("amount_pence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sale_adjustments_sale_idx").on(table.saleId),
    check(
      "sale_adjustments_amount_check",
      sql`${table.amountPence} <> 0`,
    ),
  ],
);

export const salePaymentsTable = pgTable(
  "sale_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    amountPence: integer("amount_pence").notNull(),
    method: text("method"),
    reference: text("reference"),
    status: text("status").notNull().default("recorded"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sale_payments_sale_idx").on(table.saleId),
    check("sale_payments_amount_check", sql`${table.amountPence} > 0`),
  ],
);

export const salePartExchangesTable = pgTable(
  "sale_part_exchanges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    registration: text("registration"),
    agreedValuePence: integer("agreed_value_pence").notNull(),
    customerDeclaration: text("customer_declaration"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sale_part_exchanges_sale_idx").on(table.saleId),
    check(
      "sale_part_exchanges_value_check",
      sql`${table.agreedValuePence} >= 0`,
    ),
  ],
);

export const saleWarrantiesTable = pgTable(
  "sale_warranties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    durationMonths: integer("duration_months"),
    pricePence: integer("price_pence").notNull().default(0),
    terms: text("terms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sale_warranties_sale_idx").on(table.saleId),
    check(
      "sale_warranties_nonnegative_check",
      sql`${table.pricePence} >= 0 and (${table.durationMonths} is null or ${table.durationMonths} > 0)`,
    ),
  ],
);

export const saleFulfilmentsTable = pgTable(
  "sale_fulfilments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    targetDate: timestamp("target_date", { withTimezone: true }),
    address: jsonb("address").$type<Record<string, unknown>>(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sale_fulfilments_sale_idx").on(table.saleId)],
);

export const saleDocumentsTable = pgTable(
  "sale_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => saleRevisionsTable.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    title: text("title").notNull(),
    templateVersion: text("template_version").notNull(),
    sortOrder: integer("sort_order").notNull(),
    required: boolean("required").notNull().default(true),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    storageKey: text("storage_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sale_documents_revision_order_uidx").on(
      table.revisionId,
      table.sortOrder,
    ),
    index("sale_documents_revision_idx").on(table.revisionId),
  ],
);

export const signingSessionsTable = pgTable(
  "signing_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => saleRevisionsTable.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    intendedCustomerEmail: text("intended_customer_email"),
    providerKind: text("provider_kind").notNull().default("demo"),
    providerRequestId: text("provider_request_id"),
    status: signingSessionStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("signing_sessions_token_hash_uidx").on(table.tokenHash),
    index("signing_sessions_sale_status_idx").on(table.saleId, table.status),
    index("signing_sessions_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const acknowledgementsTable = pgTable(
  "acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signingSessionId: uuid("signing_session_id")
      .notNull()
      .references(() => signingSessionsTable.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => saleRevisionsTable.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    statement: text("statement").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("acknowledgements_session_code_uidx").on(
      table.signingSessionId,
      table.code,
    ),
    index("acknowledgements_revision_idx").on(table.revisionId),
  ],
);

export const signaturesTable = pgTable(
  "signatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signingSessionId: uuid("signing_session_id")
      .notNull()
      .references(() => signingSessionsTable.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => saleRevisionsTable.id, { onDelete: "restrict" }),
    signatureType: text("signature_type").notNull().default("demo"),
    signerName: text("signer_name").notNull(),
    signerEmail: text("signer_email"),
    signatureHash: text("signature_hash").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("signatures_session_uidx").on(table.signingSessionId),
    index("signatures_revision_idx").on(table.revisionId),
  ],
);

export const saleEventsTable = pgTable(
  "sale_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    actorType: saleActorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sale_events_sale_created_idx").on(table.saleId, table.createdAt),
    index("sale_events_type_created_idx").on(table.eventType, table.createdAt),
  ],
);

export const invoicesTable = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "restrict" }),
    invoiceNumber: text("invoice_number").notNull(),
    status: text("status").notNull().default("development"),
    currency: text("currency").notNull().default("GBP"),
    totalPence: integer("total_pence").notNull(),
    depositPence: integer("deposit_pence").notNull(),
    balancePence: integer("balance_pence").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("invoices_sale_uidx").on(table.saleId),
    uniqueIndex("invoices_number_uidx").on(table.invoiceNumber),
    check(
      "invoices_nonnegative_money_check",
      sql`${table.totalPence} >= 0 and ${table.depositPence} >= 0 and ${table.balancePence} >= 0`,
    ),
  ],
);

export const dealVaultArtifactsTable = pgTable(
  "deal_vault_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "restrict" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => saleRevisionsTable.id, { onDelete: "restrict" }),
    artifactType: text("artifact_type").notNull().default("document_pack"),
    storageStatus: text("storage_status").notNull().default("metadata_only"),
    packHash: text("pack_hash").notNull(),
    documentHashes: jsonb("document_hashes")
      .$type<Record<string, string>>()
      .notNull(),
    manifest: jsonb("manifest").$type<unknown[]>().notNull(),
    storageKey: text("storage_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("deal_vault_artifacts_sale_revision_uidx").on(
      table.saleId,
      table.revisionId,
    ),
    index("deal_vault_artifacts_sale_idx").on(table.saleId),
  ],
);

export const insertCustomerSchema = createInsertSchema(customerTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertSaleSchema = createInsertSchema(salesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Customer = typeof customerTable.$inferSelect;
export type Sale = typeof salesTable.$inferSelect;
export type SaleRevision = typeof saleRevisionsTable.$inferSelect;
export type SaleDocument = typeof saleDocumentsTable.$inferSelect;
export type SigningSession = typeof signingSessionsTable.$inferSelect;