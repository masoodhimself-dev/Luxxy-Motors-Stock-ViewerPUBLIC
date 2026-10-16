import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { dealershipsTable, dealerDomainsTable } from './tenants';

export const domainSetupJobsTable = pgTable('domain_setup_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  dealerId: text('dealer_id').notNull().references(() => dealershipsTable.id),
  hostname: text('hostname').notNull().unique().references(() => dealerDomainsTable.hostname),
  hostnames: jsonb('hostnames').$type<string[]>().notNull().default([]),
  renderServiceId: text('render_service_id').notNull(),
  renderTarget: text('render_target').notNull(),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
  status: text('status').notNull().default('queued'),
  stage: text('stage').notNull().default('preflight'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  history: jsonb('history').notNull().default([]),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull().default(sql`now() + interval '30 minutes'`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('domain_setup_jobs_due_idx').on(table.nextAttemptAt).where(sql`${table.status} IN ('queued','running','waiting')`)]);
