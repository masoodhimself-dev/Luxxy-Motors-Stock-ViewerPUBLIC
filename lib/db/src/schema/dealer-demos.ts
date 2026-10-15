import { pgTable, text, jsonb, integer, timestamp } from 'drizzle-orm/pg-core';
import { dealershipsTable } from './tenants';
/** Demo identity is server-controlled, separate from editable website settings. */
export const dealerDemosTable = pgTable('dealer_demos', {
  dealerId: text('dealer_id').primaryKey().references(() => dealershipsTable.id),
  logoData: text('logo_data'),
  recipient: text('recipient').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  baseline: jsonb('baseline').$type<Record<string, unknown>>(),
  revision: integer('revision').notNull().default(0),
  lastResetAt: timestamp('last_reset_at', { withTimezone: true }),
  updatedBy: text('updated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
