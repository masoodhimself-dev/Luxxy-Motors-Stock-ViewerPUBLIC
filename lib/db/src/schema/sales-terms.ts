import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
export const dealerSalesTermsTable = pgTable('dealer_sales_terms', {
  dealerId: text('dealer_id').primaryKey(), revision: integer('revision').notNull().default(1), draft: jsonb('draft').$type<Record<string, unknown>>().notNull(),
  publishedVersionId: uuid('published_version_id'), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), updatedBy: text('updated_by').notNull(),
});
export const dealerSalesTermsVersionsTable = pgTable('dealer_sales_terms_versions', {
  id: uuid('id').primaryKey(), dealerId: text('dealer_id').notNull(), version: integer('version').notNull(), content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), createdBy: text('created_by').notNull(),
}, t => [uniqueIndex('dealer_sales_terms_versions_number_uidx').on(t.dealerId, t.version)]);
export const saleTermsDocumentsTable = pgTable('sale_terms_documents', {
  id: uuid('id').primaryKey(), dealerId: text('dealer_id').notNull(), saleId: uuid('sale_id').notNull(), requestId: uuid('request_id').notNull(), requestHash: text('request_hash').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(), dealerPdf: text('dealer_pdf').notNull(), bothPdf: text('both_pdf').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), createdBy: text('created_by').notNull(),
}, t => [uniqueIndex('sale_terms_documents_request_uidx').on(t.dealerId, t.requestId), index('sale_terms_documents_sale_idx').on(t.dealerId, t.saleId, t.createdAt.desc())]);
