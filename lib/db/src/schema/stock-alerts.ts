import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const stockAlertSettingsTable = pgTable('stock_alert_settings', {
  dealerId: text('dealer_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
});

export const stockAlertsTable = pgTable('stock_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  dealerId: text('dealer_id').notNull(),
  email: text('email').notNull(),
  criteria: jsonb('criteria').$type<Record<string, unknown>>().notNull().default({}),
  pendingCriteria: jsonb('pending_criteria').$type<Record<string, unknown>>(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
}, table => [
  uniqueIndex('stock_alerts_dealer_email_uidx').on(table.dealerId, table.email),
  uniqueIndex('stock_alerts_id_dealer_uidx').on(table.id, table.dealerId),
  index('stock_alerts_due_idx').on(table.dealerId, table.nextCheckAt).where(sql`${table.unsubscribedAt} is null and ${table.confirmedAt} is not null`),
  check('stock_alerts_normalised_email_check', sql`${table.email} = lower(${table.email})`),
]);

export const stockAlertDeliveriesTable = pgTable('stock_alert_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  dealerId: text('dealer_id').notNull(),
  alertId: uuid('alert_id').notNull(),
  digestDate: text('digest_date').notNull(),
  vehicleIds: jsonb('vehicle_ids').$type<string[]>().notNull(),
  status: text('status').$type<'queued' | 'sending' | 'sent' | 'failed'>().notNull().default('queued'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  claimToken: uuid('claim_token'),
  attempts: integer('attempts').notNull().default(0),
  retryAt: timestamp('retry_at', { withTimezone: true }),
  providerId: text('provider_id'),
  payload: text('payload'),
  accountHash: text('account_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({ columns: [table.alertId, table.dealerId], foreignColumns: [stockAlertsTable.id, stockAlertsTable.dealerId] }).onDelete('cascade'),
  uniqueIndex('stock_alert_deliveries_day_uidx').on(table.dealerId, table.alertId, table.digestDate),
  index('stock_alert_deliveries_due_idx').on(table.dealerId, table.retryAt, table.leaseUntil).where(sql`${table.status} in ('queued', 'sending')`),
  check('stock_alert_deliveries_status_check', sql`${table.status} in ('queued', 'sending', 'sent', 'failed')`),
]);

export const stockAlertRateLimitsTable = pgTable('stock_alert_rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(1),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => [
  index('stock_alert_rate_limits_expiry_idx').on(table.expiresAt),
]);
