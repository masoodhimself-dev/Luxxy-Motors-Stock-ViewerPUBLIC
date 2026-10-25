import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";
export const vehicleWatchSettingsTable = pgTable("vehicle_watch_settings", {
  dealerId: text("dealer_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  revision: integer("revision").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const vehicleWatchesTable = pgTable(
  "vehicle_watches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    email: text("email").notNull(),
    status: text("status")
      .$type<"pending" | "active" | "stopped">()
      .notNull()
      .default("pending"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
    uniqueIndex("vehicle_watches_dealer_vehicle_email_uidx").on(
      t.dealerId,
      t.vehicleId,
      t.email,
    ),
    uniqueIndex("vehicle_watches_id_dealer_uidx").on(t.id, t.dealerId),
    index("vehicle_watches_active_idx").on(t.dealerId, t.vehicleId, t.status),
    check(
      "vehicle_watches_status_check",
      sql`${t.status} in ('pending','active','stopped') and ${t.email}=lower(${t.email})`,
    ),
  ],
);
export const vehicleWatchTokensTable = pgTable(
  "vehicle_watch_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    email: text("email").notNull(),
    watchId: uuid("watch_id"),
    purpose: text("purpose").$type<"verify" | "manage">().notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("vehicle_watch_tokens_hash_uidx").on(t.tokenHash),
    index("vehicle_watch_tokens_lookup_idx").on(t.dealerId, t.email, t.purpose),
    foreignKey({
      columns: [t.watchId, t.dealerId],
      foreignColumns: [vehicleWatchesTable.id, vehicleWatchesTable.dealerId],
    }).onDelete("cascade"),
  ],
);
export const vehicleWatchEventsTable = pgTable(
  "vehicle_watch_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    kind: text("kind")
      .$type<"price_drop" | "reserved" | "available_again" | "sold">()
      .notNull(),
    changeKey: text("change_key").notNull(),
    status: text("status")
      .$type<"open" | "dismissed" | "superseded">()
      .notNull()
      .default("open"),
    previousPrice: integer("previous_price"),
    currentPrice: integer("current_price"),
    previousStatus: text("previous_status"),
    currentStatus: text("current_status"),
    revision: integer("revision").notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
    uniqueIndex("vehicle_watch_events_key_uidx").on(t.dealerId, t.changeKey),
    uniqueIndex("vehicle_watch_events_id_dealer_uidx").on(t.id, t.dealerId),
    index("vehicle_watch_events_vehicle_idx").on(
      t.dealerId,
      t.vehicleId,
      t.status,
    ),
    index("vehicle_watch_events_home_idx").on(
      t.dealerId,
      t.status,
      t.createdAt.desc(),
    ),
    check(
      "vehicle_watch_events_kind_check",
      sql`${t.kind} in ('price_drop','reserved','available_again','sold')`,
    ),
  ],
);
export const vehicleWatchDeliveriesTable = pgTable(
  "vehicle_watch_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    eventId: uuid("event_id").notNull(),
    watchId: uuid("watch_id").notNull(),
    requestId: uuid("request_id").notNull(),
    status: text("status")
      .$type<"processing" | "sent" | "failed" | "uncertain" | "skipped">()
      .notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    providerId: text("provider_id"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.eventId, t.dealerId],
      foreignColumns: [
        vehicleWatchEventsTable.id,
        vehicleWatchEventsTable.dealerId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.watchId, t.dealerId],
      foreignColumns: [vehicleWatchesTable.id, vehicleWatchesTable.dealerId],
    }).onDelete("cascade"),
    uniqueIndex("vehicle_watch_deliveries_event_watch_uidx").on(
      t.dealerId,
      t.eventId,
      t.watchId,
    ),
  ],
);
export const vehicleWatchRateLimitsTable = pgTable(
  "vehicle_watch_rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
);
export const vehicleWatchReplyRoutesTable = pgTable(
  "vehicle_watch_reply_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    watchId: uuid("watch_id").notNull(),
    deliveryId: uuid("delivery_id").notNull(),
    replyAddress: text("reply_address").notNull(),
    recipient: text("recipient").notNull(),
    enquiryId: uuid("enquiry_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("vehicle_watch_reply_routes_address_uidx").on(t.replyAddress),
    uniqueIndex("vehicle_watch_reply_routes_delivery_uidx").on(
      t.dealerId,
      t.deliveryId,
    ),
    foreignKey({
      columns: [t.watchId, t.dealerId],
      foreignColumns: [vehicleWatchesTable.id, vehicleWatchesTable.dealerId],
    }).onDelete("cascade"),
  ],
);
export const vehicleWatchReplyReceiptsTable = pgTable(
  "vehicle_watch_reply_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id").notNull(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => vehicleWatchReplyRoutesTable.id, {
        onDelete: "cascade",
      }),
    dealerId: text("dealer_id").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("vehicle_watch_reply_receipts_provider_uidx").on(t.providerId),
    index("vehicle_watch_reply_receipts_due_idx").on(t.status, t.nextAttemptAt),
  ],
);
