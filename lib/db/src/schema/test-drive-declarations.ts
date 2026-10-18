import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { enquiriesTable } from './enquiries';
import { vehiclesTable } from './vehicles';

export const testDriveDeclarationsTable = pgTable('test_drive_declarations', {
  id: uuid('id').primaryKey().defaultRandom(), dealerId: text('dealer_id').notNull(),
  enquiryId: uuid('enquiry_id').notNull(), vehicleId: uuid('vehicle_id').notNull(),
  requestId: uuid('request_id').notNull(), tokenHash: text('token_hash').notNull(), createHash: text('create_hash').notNull(),
  appointmentRevision: integer('appointment_revision').notNull(), snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(), contextHash: text('context_hash').notNull(),
  statementVersion: text('statement_version').notNull(), statement: text('statement').notNull(), statementHash: text('statement_hash').notNull(),
  revision: integer('revision').notNull().default(0), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), createdBy: text('created_by').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }), revokedBy: text('revoked_by'),
  signedAt: timestamp('signed_at', { withTimezone: true }), signerName: text('signer_name'), acceptanceRequestId: uuid('acceptance_request_id'), acceptanceHash: text('acceptance_hash'),
  licenceChecked: boolean('licence_checked').notNull().default(false), insuranceChecked: boolean('insurance_checked').notNull().default(false),
  checksUpdatedAt: timestamp('checks_updated_at', { withTimezone: true }), checksUpdatedBy: text('checks_updated_by'),
}, t => [
  uniqueIndex('test_drive_declarations_token_hash_key').on(t.tokenHash),
  uniqueIndex('test_drive_declarations_dealer_id_request_id_key').on(t.dealerId, t.requestId),
  index('test_drive_declarations_enquiry_idx').on(t.dealerId, t.enquiryId, t.createdAt.desc()),
  foreignKey({ name: 'test_drive_declarations_enquiry_id_dealer_id_fkey', columns: [t.enquiryId, t.dealerId], foreignColumns: [enquiriesTable.id, enquiriesTable.dealerId] }).onDelete('cascade'),
  foreignKey({ name: 'test_drive_declarations_vehicle_id_dealer_id_fkey', columns: [t.vehicleId, t.dealerId], foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId] }).onDelete('cascade'),
  check('test_drive_declarations_expiry_check', sql`${t.expiresAt}>${t.createdAt}`),
  check('test_drive_declarations_token_hash_check', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
]);
