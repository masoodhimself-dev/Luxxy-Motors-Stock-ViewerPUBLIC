import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  customType,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { vehiclesTable } from "./vehicles";
const jpeg = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
export const vehiclePreparationTable = pgTable(
  "vehicle_preparation",
  {
    vehicleId: uuid("vehicle_id").primaryKey(),
    dealerId: text("dealer_id").notNull(),
    revision: integer("revision").notNull().default(0),
    tasks: jsonb("tasks")
      .notNull()
      .default({
        cleaning: "pending",
        inspection: "pending",
        mot: "pending",
        servicing: "pending",
      }),
    assignedToId: uuid("assigned_to_id"),
    dueDate: text("due_date"),
    notes: text("notes").notNull().default(""),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
  ],
);
export const vehicleServiceUploadSessionsTable = pgTable(
  "vehicle_service_upload_sessions",
  {
    id: uuid("id").primaryKey(),
    vehicleId: uuid("vehicle_id").notNull(),
    dealerId: text("dealer_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    requestId: uuid("request_id"),
    requestHash: text("request_hash"),
    resultIds: jsonb("result_ids"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("service_upload_sessions_token_hash_unique").on(t.tokenHash),
    index("service_upload_sessions_vehicle_idx").on(t.dealerId, t.vehicleId),
    foreignKey({
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
  ],
);
export const vehicleServicePhotosTable = pgTable(
  "vehicle_service_photos",
  {
    id: uuid("id").primaryKey(),
    vehicleId: uuid("vehicle_id").notNull(),
    dealerId: text("dealer_id").notNull(),
    jpeg: jpeg("jpeg").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("service_photos_vehicle_idx").on(t.dealerId, t.vehicleId),
    check(
      "service_photos_size_check",
      sql`${t.byteSize}>0 AND ${t.byteSize}<=512000`,
    ),
    check(
      "service_photos_dimensions_check",
      sql`${t.width}>0 AND ${t.width}<=2000 AND ${t.height}>0 AND ${t.height}<=2000`,
    ),
    foreignKey({
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
  ],
);
