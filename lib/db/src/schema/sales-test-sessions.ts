import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Server-owned synthetic sale sessions. No reference to a real sale or customer. */
export const salesTestSessionsTable = pgTable('sales_test_sessions', {
  id: uuid('id').primaryKey(),
  parentDealerId: text('parent_dealer_id').notNull(),
  staffUserId: text('staff_user_id').notNull(),
  sandboxDealerId: text('sandbox_dealer_id').notNull().unique(),
  vehicleId: uuid('vehicle_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  cleanedAt: timestamp('cleaned_at', { withTimezone: true }),
}, t => [index('sales_test_sessions_owner_idx').on(t.parentDealerId, t.staffUserId, t.createdAt.desc())]);
