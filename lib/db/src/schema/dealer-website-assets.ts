import { sql } from 'drizzle-orm';
import { check, customType, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const assetBytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
/** Deliberately separate from private customer/service-book photographs. */
export const dealerWebsiteAssetsTable = pgTable('dealer_website_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  dealerId: text('dealer_id').notNull(),
  requestId: uuid('request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  bytes: assetBytes('bytes').notNull(),
  mimeType: text('mime_type').$type<'image/png' | 'image/jpeg' | 'image/webp'>().notNull(),
  byteSize: integer('byte_size').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  digest: text('digest').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('dealer_website_assets_request_uidx').on(table.dealerId, table.requestId),
  index('dealer_website_assets_quota_idx').on(table.dealerId, table.createdAt),
  check('dealer_website_assets_mime_check', sql`${table.mimeType} IN ('image/png','image/jpeg','image/webp')`),
  check('dealer_website_assets_size_check', sql`${table.byteSize}>0 AND ${table.byteSize}<=2097152 AND octet_length(${table.bytes})=${table.byteSize}`),
  check('dealer_website_assets_dimensions_check', sql`${table.width}>0 AND ${table.width}<=4096 AND ${table.height}>0 AND ${table.height}<=4096 AND ${table.width}::bigint*${table.height}<=12000000`),
  check('dealer_website_assets_hash_check', sql`${table.digest} ~ '^[0-9a-f]{64}$' AND ${table.requestHash} ~ '^[0-9a-f]{64}$'`),
]);
