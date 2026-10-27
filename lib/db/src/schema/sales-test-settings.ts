import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, uuid } from 'drizzle-orm/pg-core';
import { salesTestSessionsTable } from './sales-test-sessions';

/** Mutable practice copies, removed with the owning test session. */
export const salesTestSettingsTable=pgTable('sales_test_settings',{
  sessionId:uuid('session_id').primaryKey().references(()=>salesTestSessionsTable.id,{onDelete:'cascade'}),
  config:jsonb('config').notNull(),
  revision:integer('revision').notNull().default(1),
  templates:jsonb('templates'),
  templatesRevision:integer('templates_revision').notNull().default(1),
  paperwork:jsonb('paperwork'),
  paperworkRevision:integer('paperwork_revision').notNull().default(1),
  team:jsonb('team'),
  teamRevision:integer('team_revision').notNull().default(1),
},table=>[
  check('sales_test_settings_revision_check',sql`${table.revision} > 0`),
  check('sales_test_settings_templates_revision_check',sql`${table.templatesRevision} > 0`),
  check('sales_test_settings_paperwork_revision_check',sql`${table.paperworkRevision} > 0`),
  check('sales_test_settings_team_revision_check',sql`${table.teamRevision} > 0`),
]);
