import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { vehiclesTable } from "./vehicles";
export const vehicleVideosTable = pgTable(
  "vehicle_videos",
  {
    id: uuid("id").primaryKey(),
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehiclesTable.id),
    sourceDigest: text("source_digest").notNull(),
    objectKey: text("object_key").notNull(),
    status: text("status").notNull(),
    published: boolean("published").notNull().default(false),
    revision: integer("revision").notNull().default(1),
    durationMs: integer("duration_ms"),
    byteSize: integer("byte_size"),
    width: integer("width"),
    height: integer("height"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("vehicle_videos_one_published")
      .on(t.dealerId, t.vehicleId)
      .where(sql`${t.published}`),
    index("vehicle_videos_dealer_car").on(t.dealerId, t.vehicleId, t.createdAt),
    check(
      "vehicle_videos_status_check",
      sql`${t.status} IN ('processing','ready','failed')`,
    ),
    check(
      "vehicle_videos_duration_check",
      sql`${t.durationMs} IS NULL OR ${t.durationMs} BETWEEN 1 AND 30000`,
    ),
    check(
      "vehicle_videos_size_check",
      sql`${t.byteSize} IS NULL OR ${t.byteSize} BETWEEN 1 AND 5242880`,
    ),
    check(
      "vehicle_videos_publish_check",
      sql`NOT ${t.published} OR ${t.status}='ready'`,
    ),
  ],
);
export const customerPhoneSharesTable = pgTable(
  "customer_phone_shares",
  {
    id: uuid("id").primaryKey(),
    dealerId: text("dealer_id").notNull(),
    requestId: uuid("request_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    fingerprint: text("fingerprint").notNull(),
    payload: jsonb("payload").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("customer_phone_shares_token_hash_key").on(t.tokenHash),
    uniqueIndex("customer_phone_shares_dealer_id_request_id_key").on(
      t.dealerId,
      t.requestId,
    ),
    index("customer_phone_shares_expiry").on(t.dealerId, t.expiresAt),
    check(
      "customer_phone_shares_expiry_check",
      sql`${t.expiresAt}>${t.createdAt}`,
    ),
  ],
);
