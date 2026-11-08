import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dealershipsTable } from './tenants';

export const demoStockCollectionJobsTable = pgTable('demo_stock_collection_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestedBy: text('requested_by').notNull(),
  sourceUrl: text('source_url').notNull(),
  retailerId: text('retailer_id').notNull(),
  status: text('status').notNull().default('collecting'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  claimToken: uuid('claim_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  payloadHash: text('payload_hash'),
  dealerId: text('dealer_id').references(() => dealershipsTable.id, { onDelete: 'set null' }),
  dealerName: text('dealer_name'),
  received: integer('received'),
  error: text('error'),
}, table => [
  check('demo_stock_collection_jobs_status_check', sql`${table.status} in ('collecting', 'ready', 'failed')`),
  index('demo_stock_collection_jobs_active_idx').on(table.retailerId, table.expiresAt)
    .where(sql`${table.status} = 'collecting'`),
]);
