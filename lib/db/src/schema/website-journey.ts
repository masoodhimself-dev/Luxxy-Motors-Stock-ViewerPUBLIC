import { bigint, date, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/** Aggregate event counts only: no visitor, device, URL or customer records. */
export const websiteJourneyDailyTable = pgTable('website_journey_daily', {
  dealerId: text('dealer_id').notNull(),
  day: date('day').notNull(),
  stage: text('stage').$type<'search' | 'vehicle' | 'enquiry' | 'appointment_request'>().notNull(),
  eventCount: bigint('event_count', { mode: 'number' }).notNull().default(0),
}, table => [primaryKey({ columns: [table.dealerId, table.day, table.stage] })]);
