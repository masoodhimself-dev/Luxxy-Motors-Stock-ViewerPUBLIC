import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { enquiriesTable } from "./enquiries";
import { vehiclesTable } from "./vehicles";
import { saleWorkspaceTable } from "./sale-workspace";

/** Contact work created atomically with a confirmed sale; never a mail queue. */
export const soldVehicleFollowUpsTable = pgTable(
  "sold_vehicle_follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealerId: text("dealer_id").notNull(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => saleWorkspaceTable.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").notNull(),
    enquiryId: uuid("enquiry_id").notNull(),
    relatedEnquiryIds: jsonb("related_enquiry_ids").$type<string[]>().notNull(),
    kind: text("kind").$type<"appointment" | "interest">().notNull(),
    status: text("status")
      .$type<"pending" | "contacted" | "not_needed">()
      .notNull()
      .default("pending"),
    revision: integer("revision").notNull().default(0),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    outcome: text("outcome").$type<"phone" | "email" | "not_needed">(),
    emailId: uuid("email_id"),
    note: text("note"),
    updatedBy: text("updated_by").notNull(),
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
    foreignKey({
      columns: [t.enquiryId, t.dealerId],
      foreignColumns: [enquiriesTable.id, enquiriesTable.dealerId],
    }).onDelete("cascade"),
    uniqueIndex("sold_vehicle_follow_ups_sale_customer_uidx").on(
      t.dealerId,
      t.saleId,
      t.enquiryId,
    ),
    index("sold_vehicle_follow_ups_home_idx").on(
      t.dealerId,
      t.status,
      t.createdAt,
    ),
    check(
      "sold_vehicle_follow_ups_kind_check",
      sql`${t.kind} in ('appointment','interest')`,
    ),
    check(
      "sold_vehicle_follow_ups_status_check",
      sql`${t.status} in ('pending','contacted','not_needed')`,
    ),
    check(
      "sold_vehicle_follow_ups_outcome_check",
      sql`${t.outcome} is null or ${t.outcome} in ('phone','email','not_needed')`,
    ),
    check("sold_vehicle_follow_ups_revision_check", sql`${t.revision} >= 0`),
  ],
);
