import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import {
  db,
  enquiryEventsTable,
  type EnquiryEvent,
  type InsertEnquiryEvent,
} from "@workspace/db";

/** How far back an anonymous call/WhatsApp tap can be attached to a new lead. */
const visitorAttachWindowMs = 14 * 24 * 60 * 60 * 1000;

export type EnquiryEventKind = EnquiryEvent["kind"];

export async function recordEnquiryEvent(event: InsertEnquiryEvent) {
  const [created] = await db.insert(enquiryEventsTable).values(event).returning();
  return created;
}

/**
 * A call or WhatsApp tap happens before anyone identifies themselves. When the
 * same browser later sends an enquiry, its earlier taps become part of that
 * lead's timeline.
 */
export async function attachVisitorEventsToEnquiry({
  dealerId,
  visitorId,
  enquiryId,
}: {
  dealerId: string;
  visitorId: string;
  enquiryId: string;
}) {
  const since = new Date(Date.now() - visitorAttachWindowMs);
  return db
    .update(enquiryEventsTable)
    .set({ enquiryId })
    .where(
      and(
        eq(enquiryEventsTable.dealerId, dealerId),
        eq(enquiryEventsTable.visitorId, visitorId),
        isNull(enquiryEventsTable.enquiryId),
        gte(enquiryEventsTable.occurredAt, since),
      ),
    )
    .returning({ id: enquiryEventsTable.id });
}

export function serializeEnquiryEvent(event: EnquiryEvent) {
  const detail = event.kind === 'conversation_logged' || event.kind === 'records_merged' ? event.detail : null;
  return {
    id: event.id,
    kind: event.kind,
    actor: event.actor,
    summary: event.summary,
    vehicleId: event.vehicleId,
    vehicleTitle: event.vehicleTitle,
    vehicleUrl: event.vehicleUrl,
    occurredAt: event.occurredAt,
    ...(detail ? {
      ...(typeof detail.note === 'string' ? { note: detail.note } : {}),
      ...(typeof detail.staffId === 'string' ? { staffId: detail.staffId } : {}),
      ...(typeof detail.staffName === 'string' ? { staffName: detail.staffName } : {}),
      ...(typeof detail.callOutcome === 'string' ? { callOutcome: detail.callOutcome } : {}),
      ...(typeof detail.followUpAt === 'string' || detail.followUpAt === null ? { followUpAt: detail.followUpAt } : {}),
    } : {}),
  };
}

/** Timeline entries for a set of enquiries, oldest first within each enquiry. */
export async function eventsForEnquiries(enquiryIds: string[]) {
  const grouped = new Map<string, ReturnType<typeof serializeEnquiryEvent>[]>();
  if (enquiryIds.length === 0) return grouped;

  const events = await db
    .select()
    .from(enquiryEventsTable)
    .where(inArray(enquiryEventsTable.enquiryId, enquiryIds))
    .orderBy(desc(enquiryEventsTable.occurredAt));

  for (const event of events) {
    if (!event.enquiryId) continue;
    const bucket = grouped.get(event.enquiryId);
    if (bucket) {
      bucket.unshift(serializeEnquiryEvent(event));
    } else {
      grouped.set(event.enquiryId, [serializeEnquiryEvent(event)]);
    }
  }
  return grouped;
}

export async function eventsForEnquiry(enquiryId: string) {
  return (await eventsForEnquiries([enquiryId])).get(enquiryId) ?? [];
}
