import { pgTable, text, timestamp, uniqueIndex, uuid, index } from 'drizzle-orm/pg-core';
import { vehiclesTable } from './vehicles';

/** Keep deleted-vehicle codes as tombstones so old links can never point at another car. */
export const vehiclePublicLinksTable = pgTable('vehicle_public_links', {
  code: text('code').primaryKey(),
  vehicleId: uuid('vehicle_id').references(() => vehiclesTable.id, { onDelete: 'set null' }),
  dealerId: text('dealer_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('vehicle_public_links_vehicle_uidx').on(table.vehicleId),
  index('vehicle_public_links_dealer_idx').on(table.dealerId),
]);
