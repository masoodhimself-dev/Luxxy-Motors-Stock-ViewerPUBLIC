import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  primaryKey,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";
export const priceUpdateRecipientClaimsTable = pgTable(
  "price_update_recipient_claims",
  {
    dealerId: text("dealer_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    changeKey: text("change_key").notNull(),
    email: text("email").notNull(),
    sourceKey: text("source_key").notNull(),
    status: text("status")
      .$type<"processing" | "sent" | "uncertain">()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.dealerId, t.vehicleId, t.changeKey, t.email] }),
    foreignKey({
      columns: [t.vehicleId, t.dealerId],
      foreignColumns: [vehiclesTable.id, vehiclesTable.dealerId],
    }).onDelete("cascade"),
    check(
      "price_update_recipient_claims_status_check",
      sql`${t.status} in ('processing','sent','uncertain')`,
    ),
    check(
      "price_update_recipient_claims_email_check",
      sql`${t.email}=lower(trim(${t.email}))`,
    ),
  ],
);
