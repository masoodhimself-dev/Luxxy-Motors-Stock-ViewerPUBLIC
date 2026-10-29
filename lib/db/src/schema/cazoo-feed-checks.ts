import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { dealershipsTable } from './tenants';

/** Private collection candidates only. These rows never publish or import stock. */
export const cazooFeedChecksTable = pgTable('cazoo_feed_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  dealerId: text('dealer_id').notNull().references(() => dealershipsTable.id),
  slotKey: text('slot_key').notNull(),
  status: text('status').$type<'processing' | 'ready' | 'blocked' | 'unchanged' | 'failed'>().notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  fileHash: text('file_hash'),
  fileBytes: integer('file_bytes'),
  remoteModifiedAt: timestamp('remote_modified_at', { withTimezone: true }),
  vehicleCount: integer('vehicle_count'),
  basedOnCheckId: uuid('based_on_check_id'),
  warnings: jsonb('warnings').$type<unknown[]>().notNull().default([]),
  candidate: jsonb('candidate').$type<unknown>(),
  reconciliation: jsonb('reconciliation').$type<unknown>(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
}, table => [
  uniqueIndex('cazoo_feed_checks_dealer_slot_uidx').on(table.dealerId, table.slotKey),
  index('cazoo_feed_checks_dealer_received_idx').on(table.dealerId, table.receivedAt.desc()),
  check('cazoo_feed_checks_status_check', sql`${table.status} in ('processing','ready','blocked','unchanged','failed')`),
  check('cazoo_feed_checks_attempts_check', sql`${table.attempts} between 0 and 3`),
  check('cazoo_feed_checks_hash_check', sql`${table.fileHash} is null or ${table.fileHash} ~ '^[a-f0-9]{64}$'`),
  check('cazoo_feed_checks_count_check', sql`(${table.vehicleCount} is null or ${table.vehicleCount} >= 0) and (${table.fileBytes} is null or ${table.fileBytes} >= 0)`),
]);

export type CazooFeedCheckRow = typeof cazooFeedChecksTable.$inferSelect;
