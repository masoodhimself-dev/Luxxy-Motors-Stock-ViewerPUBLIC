import { check, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const dealerSettingsVersionsTable = pgTable('dealer_settings_versions', {
  dealerId: text('dealer_id').notNull(),
  revision: integer('revision').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  publishedBy: text('published_by').notNull(),
  action: text('action').$type<'initial' | 'publish' | 'restore'>().notNull(),
  restoredFrom: integer('restored_from'),
}, table => [primaryKey({ columns: [table.dealerId, table.revision] }), check('dealer_settings_versions_action_check',sql`${table.action} in ('initial','publish','restore')`)]);
