import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Server-owned synthetic sale sessions. No reference to a real sale or customer. */
export const salesTestSessionsTable = pgTable('sales_test_sessions', {
  id: uuid('id').primaryKey(),
  parentDealerId: text('parent_dealer_id').notNull(),
  staffUserId: text('staff_user_id').notNull(),
  sandboxDealerId: text('sandbox_dealer_id').notNull().unique(),
  vehicleId: uuid('vehicle_id').notNull(),
  sourceVehicleId: uuid('source_vehicle_id'),
  customerName: text('customer_name').notNull().default('[TEST] Example Buyer'),
  customerPhone: text('customer_phone').notNull().default('07700900123'),
  customerEmail: text('customer_email').notNull().default(''),
  customerAddress: text('customer_address').notNull().default(''),
  vehicleTitle: text('vehicle_title').notNull().default('[TEST] Example Car'),
  vehicleRegistration: text('vehicle_registration').notNull().default('TEST 01'),
  vehiclePrice: integer('vehicle_price').notNull().default(1000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  cleanedAt: timestamp('cleaned_at', { withTimezone: true }),
}, t => [index('sales_test_sessions_owner_idx').on(t.parentDealerId, t.staffUserId, t.createdAt.desc())]);
