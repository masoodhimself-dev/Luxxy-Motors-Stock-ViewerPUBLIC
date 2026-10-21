import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  foreignKey,
  customType,
} from "drizzle-orm/pg-core";
import { enquiriesTable } from "./enquiries";
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const enquiryPhotosTable = pgTable(
  "enquiry_photos",
  {
    id: uuid("id").primaryKey(),
    dealerId: text("dealer_id").notNull(),
    enquiryId: uuid("enquiry_id").notNull(),
    jpeg: bytea("jpeg").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.enquiryId, t.dealerId],
      foreignColumns: [enquiriesTable.id, enquiriesTable.dealerId],
    }).onDelete("cascade"),
    index("enquiry_photos_case").on(t.dealerId, t.enquiryId, t.createdAt, t.id),
  ],
);
export const enquiryPhotoUploadSessionsTable = pgTable(
  "enquiry_photo_upload_sessions",
  {
    id: uuid("id").primaryKey(),
    dealerId: text("dealer_id").notNull(),
    enquiryId: uuid("enquiry_id").notNull(),
    tokenHash: text("token_hash").unique(),
    createdBy: text("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    requestId: uuid("request_id"),
    requestHash: text("request_hash"),
    resultIds: jsonb("result_ids").$type<string[]>().notNull().default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.enquiryId, t.dealerId],
      foreignColumns: [enquiriesTable.id, enquiriesTable.dealerId],
    }).onDelete("cascade"),
    index("enquiry_photo_upload_case").on(t.dealerId, t.enquiryId, t.expiresAt),
  ],
);
export const customerEmailPreparationsTable = pgTable(
  "customer_email_preparations",
  {
    id: uuid("id").primaryKey(),
    dealerId: text("dealer_id").notNull(),
    enquiryId: uuid("enquiry_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.enquiryId, t.dealerId],
      foreignColumns: [enquiriesTable.id, enquiriesTable.dealerId],
    }).onDelete("cascade"),
  ],
);
