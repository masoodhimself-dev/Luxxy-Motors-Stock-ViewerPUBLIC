import { pgTable, text, timestamp, uuid, integer, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import { dealerDemosTable } from './dealer-demos';
export const demoOnboardingKeysTable=pgTable('demo_onboarding_keys',{
 id:uuid('id').primaryKey().defaultRandom(),secretHash:text('secret_hash').notNull().unique(),label:text('label').notNull(),ownerAuthUserId:text('owner_auth_user_id').notNull(),maxDemos:integer('max_demos').notNull(),maxPerDay:integer('max_per_day').notNull(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),revokedAt:timestamp('revoked_at',{withTimezone:true}),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const demoOnboardingRequestsTable=pgTable('demo_onboarding_requests',{
 keyId:uuid('key_id').notNull().references(()=>demoOnboardingKeysTable.id),requestId:uuid('request_id').notNull(),dealerId:text('dealer_id').notNull().unique().references(()=>dealerDemosTable.dealerId),payloadHash:text('payload_hash').notNull(),sealedResponse:jsonb('sealed_response').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.keyId,t.requestId]})]);
/** A fixed test email and initial baseline only; never grants reset or general mail access. */
export const demoOnboardingCompletionTable=pgTable('demo_onboarding_completion',{
 dealerId:text('dealer_id').primaryKey().references(()=>dealerDemosTable.dealerId),keyId:uuid('key_id').notNull().references(()=>demoOnboardingKeysTable.id),recipient:text('recipient').notNull(),providerId:text('provider_id'),emailStatus:text('email_status').notNull().default('pending'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),checkedAt:timestamp('checked_at',{withTimezone:true}),baselineRunId:text('baseline_run_id'),completedAt:timestamp('completed_at',{withTimezone:true}),
});
