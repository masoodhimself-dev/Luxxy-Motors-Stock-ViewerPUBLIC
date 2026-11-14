import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { vehiclesTable } from './vehicles';

export const stockTaxChecksTable = pgTable('stock_tax_checks', {
  dealerId: text('dealer_id').notNull(),
  vehicleId: uuid('vehicle_id').notNull(),
  registration: text('registration').notNull(),
  taxStatus: text('tax_status'),
  dueDate: text('due_date'),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  leaseToken: uuid('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  errorCode: text('error_code'),
}, t => [
  primaryKey({ columns: [t.dealerId, t.vehicleId] }),
  foreignKey({ columns: [t.vehicleId, t.dealerId], foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId] }).onDelete('cascade'),
  index('stock_tax_checks_due_idx').on(t.nextAttemptAt, t.dealerId, t.vehicleId),
  check('stock_tax_checks_status_check', sql`${t.taxStatus} IN ('Taxed','Untaxed','SORN','Not Taxed for on Road Use')`),
]);
