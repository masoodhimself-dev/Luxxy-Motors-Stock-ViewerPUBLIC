import { pgTable,text,jsonb,timestamp,doublePrecision,index,integer } from 'drizzle-orm/pg-core';
import { dealerSettingsTable } from './dealer-settings';
export const postcodeLookupCacheTable=pgTable('postcode_lookup_cache',{
 postcode:text('postcode').primaryKey(),data:jsonb('data').notNull(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
},table=>[index('postcode_lookup_cache_expiry').on(table.expiresAt)]);
export const dealerLocationsTable=pgTable('dealer_locations',{
 dealerId:text('dealer_id').primaryKey().references(()=>dealerSettingsTable.dealerId,{onDelete:'cascade'}),postcode:text('postcode').notNull(),latitude:doublePrecision('latitude').notNull(),longitude:doublePrecision('longitude').notNull(),region:text('region'),administrativeArea:text('administrative_area'),verifiedAt:timestamp('verified_at',{withTimezone:true}).notNull().defaultNow(),
},table=>[index('dealer_locations_coordinates').on(table.latitude,table.longitude)]);
export const roadDistanceCacheTable=pgTable('road_distance_cache',{
 routeKey:text('route_key').primaryKey(),metres:doublePrecision('metres').notNull(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
},table=>[index('road_distance_cache_expiry').on(table.expiresAt)]);

export const roadRoutingUsageTable=pgTable('road_routing_usage',{bucket:text('bucket').primaryKey(),count:integer('count').notNull().default(0)});
