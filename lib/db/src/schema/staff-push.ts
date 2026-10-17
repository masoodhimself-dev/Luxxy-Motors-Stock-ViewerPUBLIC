import { pgTable, text, uuid, boolean, timestamp, integer, primaryKey, uniqueIndex, index, foreignKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { portalUsersTable } from './portal-users';
export const staffPushPreferencesTable = pgTable('staff_push_preferences', {
  dealerId: text('dealer_id').notNull(), authUserId: text('auth_user_id').notNull(),
  enquiries: boolean('enquiries').notNull().default(true), bookings: boolean('bookings').notNull().default(true),
  reminders: boolean('reminders').notNull().default(true), followups: boolean('followups').notNull().default(true),
  emailFailures: boolean('email_failures').notNull().default(true), reminderMinutes: integer('reminder_minutes').notNull().default(30),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({columns:[t.dealerId,t.authUserId]}),
  foreignKey({name:'staff_push_preferences_dealer_id_auth_user_id_fkey',columns:[t.dealerId,t.authUserId],foreignColumns:[portalUsersTable.dealerId,portalUsersTable.authUserId]}).onDelete('cascade'),
  check('staff_push_preferences_reminder_minutes_check',sql`${t.reminderMinutes} IN (10,15,30,60)`),
]);
export const staffPushSubscriptionsTable = pgTable('staff_push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(), dealerId: text('dealer_id').notNull(), authUserId: text('auth_user_id').notNull(),
  origin: text('origin').notNull(), endpoint: text('endpoint').notNull(), endpointHash: text('endpoint_hash').notNull(),
  p256dh: text('p256dh').notNull(), auth: text('auth').notNull(), deviceLabel: text('device_label').notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(), lastSuccessAt: timestamp('last_success_at',{withTimezone:true}), lastTestAt: timestamp('last_test_at',{withTimezone:true}),
},t=>[
  uniqueIndex('staff_push_subscriptions_endpoint_hash_key').on(t.endpointHash),
  index('staff_push_subscriptions_actor_idx').on(t.dealerId,t.authUserId),
  foreignKey({name:'staff_push_subscriptions_dealer_id_auth_user_id_fkey',columns:[t.dealerId,t.authUserId],foreignColumns:[portalUsersTable.dealerId,portalUsersTable.authUserId]}).onDelete('cascade'),
]);
export const staffPushDeliveriesTable = pgTable('staff_push_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(), subscriptionId: uuid('subscription_id').notNull().references(()=>staffPushSubscriptionsTable.id,{onDelete:'cascade'}),
  dealerId: text('dealer_id').notNull(), eventKey: text('event_key').notNull(), category: text('category').notNull(), enquiryId: uuid('enquiry_id'), revision: integer('revision'), dueAt: timestamp('due_at',{withTimezone:true}),
  status:text('status').notNull().default('pending'), attempts:integer('attempts').notNull().default(0),
  nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(), retryAfter:timestamp('retry_after',{withTimezone:true}), leaseUntil:timestamp('lease_until',{withTimezone:true}),
  expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(), createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(), finishedAt:timestamp('finished_at',{withTimezone:true}),errorCode:text('error_code'),
},t=>[
  uniqueIndex('staff_push_deliveries_subscription_id_event_key_key').on(t.subscriptionId,t.eventKey),
  index('staff_push_deliveries_due_idx').on(t.dealerId,t.status,t.nextAttemptAt),
  check('staff_push_deliveries_category_check',sql`${t.category} IN ('enquiries','bookings','reminders','followups','emailFailures','test')`),
  check('staff_push_deliveries_status_check',sql`${t.status} IN ('pending','sending','sent','cancelled','failed')`),
  check('staff_push_deliveries_attempts_check',sql`${t.attempts} BETWEEN 0 AND 3`),
]);
