import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db, enquiriesTable, enquiryEventsTable } from "@workspace/db";
import { serializeEnquiryEvent } from "./enquiry-events";
import { historyCursor, type HistoryCursor } from "./history-cursor";

export async function enquiryConversationPage(dealerId: string, enquiryId: string, cursor: HistoryCursor | null, connection: typeof db = db) {
  const [owned] = await connection.select({ id: enquiriesTable.id }).from(enquiriesTable).where(and(eq(enquiriesTable.dealerId, dealerId), eq(enquiriesTable.id, enquiryId))).limit(1);
  if (!owned) return null;
  const scope = and(eq(enquiryEventsTable.dealerId, dealerId), eq(enquiryEventsTable.enquiryId, enquiryId), eq(enquiryEventsTable.kind, "conversation_logged"));
  const [rows, [count]] = await Promise.all([
    connection.select({ event: enquiryEventsTable, cursorAt: sql<string>`to_char(${enquiryEventsTable.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` }).from(enquiryEventsTable)
      .where(and(scope, cursor ? or(sql`${enquiryEventsTable.occurredAt} < ${cursor.at}::timestamptz`, and(sql`${enquiryEventsTable.occurredAt} = ${cursor.at}::timestamptz`, lt(enquiryEventsTable.id, cursor.id))) : undefined))
      .orderBy(desc(enquiryEventsTable.occurredAt), desc(enquiryEventsTable.id)).limit(26),
    connection.select({ count: sql<number>`count(*)::int` }).from(enquiryEventsTable).where(scope),
  ]);
  const page = rows.slice(0, 25);
  const last = page.at(-1);
  return { events: page.map(({ event }) => serializeEnquiryEvent(event)), total: Number(count?.count ?? 0), nextCursor: rows.length > 25 && last ? historyCursor({ at: last.cursorAt, id: last.event.id }) : null };
}
