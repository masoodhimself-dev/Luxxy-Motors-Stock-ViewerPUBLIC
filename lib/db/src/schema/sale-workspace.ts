import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Separate from the retired sales tables. State contains an append-only payment/document ledger. */
export const saleWorkspaceTable = pgTable('sale_workspace', {
  id: uuid('id').primaryKey(),
  dealerId: text('dealer_id').notNull(),
  reference: text('reference').notNull(),
  revision: integer('revision').notNull(),
  state: jsonb('state').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('sale_workspace_dealer_reference_uidx').on(table.dealerId, table.reference), index('sale_workspace_dealer_updated_idx').on(table.dealerId, table.updatedAt)]);

export const saleWorkspaceCountersTable = pgTable('sale_workspace_counters', {
  dealerId: text('dealer_id').primaryKey(),
  numbers: jsonb('numbers').$type<Record<string, number>>().notNull().default({}),
});
