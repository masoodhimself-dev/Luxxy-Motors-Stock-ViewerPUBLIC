import { pgTable, text, timestamp, boolean, jsonb, uuid, integer, uniqueIndex } from 'drizzle-orm/pg-core';
export const dealershipsTable = pgTable('dealerships', {
  id: text('id').primaryKey(), name: text('name').notNull(), status: text('status').$type<'draft' | 'active' | 'suspended'>().notNull().default('draft'), canonicalOrigin: text('canonical_origin').notNull(), stockPlatform: text('stock_platform').$type<'autotrader' | 'cazoo'>().notNull(), retailerId: text('retailer_id').notNull(), sourceUrl: text('source_url').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const dealerDomainsTable = pgTable('dealer_domains', {
  hostname: text('hostname').primaryKey(), dealerId: text('dealer_id').notNull().references(() => dealershipsTable.id), verified: boolean('verified').notNull().default(false), verificationToken: text('verification_token').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const dealerImportKeysTable = pgTable('dealer_import_keys', {
  id: uuid('id').primaryKey().defaultRandom(), dealerId: text('dealer_id').notNull().references(() => dealershipsTable.id), secretHash: text('secret_hash').notNull(), disabledAt: timestamp('disabled_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('dealer_import_keys_hash_uidx').on(table.secretHash)]);
export const dealerPrivateSettingsTable = pgTable('dealer_private_settings', {
  dealerId: text('dealer_id').primaryKey().references(() => dealershipsTable.id), revision: integer('revision').notNull().default(0), encryptedPayload: jsonb('encrypted_payload').$type<Record<string, unknown>>().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
