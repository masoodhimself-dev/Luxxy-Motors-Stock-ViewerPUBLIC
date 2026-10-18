import { pgTable, text, timestamp, integer, jsonb, uuid, primaryKey, index } from 'drizzle-orm/pg-core';
import { dealershipsTable } from './tenants';
const ruleColumns = () => ({
  mode: text('mode').$type<'inherit' | 'enabled' | 'disabled'>().notNull(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  revision: integer('revision').notNull().default(0),
  reason: text('reason').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by').notNull(),
});
export const platformFeatureDefaultsTable = pgTable('platform_feature_defaults', {
  featureKey: text('feature_key').primaryKey(), ...ruleColumns(),
});
export const dealerFeatureOverridesTable = pgTable('dealer_feature_overrides', {
  dealerId: text('dealer_id').notNull().references(() => dealershipsTable.id),
  featureKey: text('feature_key').notNull(), ...ruleColumns(),
}, table => [primaryKey({ columns: [table.dealerId, table.featureKey] })]);
export const featurePolicyAuditTable = pgTable('feature_policy_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  dealerId: text('dealer_id').references(() => dealershipsTable.id),
  featureKey: text('feature_key').notNull(),
  before: jsonb('before_rule').notNull(), after: jsonb('after_rule').notNull(),
  reason: text('reason').notNull(), actor: text('actor').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('feature_policy_audit_scope_created_idx').on(table.dealerId, table.createdAt)]);
