import {
  pgTable,
  text,
  uuid,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { enquiriesTable } from "./enquiries";
export const staffReplyPresenceTable = pgTable(
  "staff_reply_presence",
  {
    dealerId: text("dealer_id").notNull(),
    enquiryId: uuid("enquiry_id")
      .notNull()
      .references(() => enquiriesTable.id, { onDelete: "cascade" }),
    staffId: text("staff_id").notNull(),
    staffName: text("staff_name").notNull(),
    sessionId: uuid("session_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dealerId, t.enquiryId] }),
    index("staff_reply_presence_expiry_idx").on(t.expiresAt),
  ],
);
