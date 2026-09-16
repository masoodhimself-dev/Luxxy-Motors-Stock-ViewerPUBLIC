import { Router, type IRouter } from "express";
import { requireStaff } from "../middlewares/staff-auth";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  GetContactIntentsQueryParams,
  GetContactIntentsResponse,
  RecordContactIntentBody,
  RecordContactIntentResponse,
} from "@workspace/api-zod";
import {
  db,
  enquiriesTable,
  enquiryEventsTable,
  vehiclesTable,
  type EnquiryEvent,
} from "@workspace/db";

const router: IRouter = Router();
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const intentListLimit = 50;

const dealerId = () => process.env.STOCK_DEALER_ID ?? "luxxy-motors";
const errorResponse = (message: string) => ({ error: message });

function checkRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    if (rateLimits.size > 5000) {
      for (const [entryKey, entry] of rateLimits) {
        if (entry.resetAt <= now) rateLimits.delete(entryKey);
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  return {
    allowed: current.count <= max,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

function serializeIntent(
  event: EnquiryEvent,
  enquiry?: { reference: string; customerName: string },
) {
  return {
    id: event.id,
    channel: event.kind === "whatsapp_intent" ? ("whatsapp" as const) : ("call" as const),
    vehicleId: event.vehicleId,
    vehicleTitle: event.vehicleTitle,
    vehicleUrl: event.vehicleUrl,
    enquiryId: event.enquiryId,
    enquiryReference: enquiry?.reference ?? null,
    customerName: enquiry?.customerName ?? null,
    occurredAt: event.occurredAt,
  };
}

/**
 * Records that someone tapped Call or WhatsApp on a car. Phone traffic is how
 * most of this dealer's business happens, so the tap is logged against the car
 * and, once the same browser sends an enquiry, against that lead too.
 */
router.post("/contact-intents", async (req, res): Promise<void> => {
  const parsed = RecordContactIntentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse("Invalid contact intent."));
    return;
  }
  const input = parsed.data;
  if (input.vehicleId && !uuidPattern.test(input.vehicleId)) {
    res.status(400).json(errorResponse("Invalid vehicle."));
    return;
  }

  const limit = checkRateLimit(`contact-intent:${req.ip}`, 60, 60_000);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    res
      .status(429)
      .json(errorResponse("Too many requests. Please try again shortly."));
    return;
  }

  try {
    let vehicle: typeof vehiclesTable.$inferSelect | undefined;
    if (input.vehicleId) {
      [vehicle] = await db
        .select()
        .from(vehiclesTable)
        .where(
          and(
            eq(vehiclesTable.id, input.vehicleId),
            eq(vehiclesTable.dealerId, dealerId()),
          ),
        );
    }

    const visitorId = input.visitorId?.trim() || null;
    const channelLabel = input.channel === "whatsapp" ? "WhatsApp" : "Call";
    const vehicleTitle = vehicle
      ? vehicle.websiteTitleOverride ?? vehicle.title
      : null;

    // A tap from a browser that has already enquired belongs on that lead.
    let enquiry:
      | { id: string; reference: string; customerName: string }
      | undefined;
    if (visitorId) {
      [enquiry] = await db
        .select({
          id: enquiriesTable.id,
          reference: enquiriesTable.reference,
          customerName: enquiriesTable.customerName,
        })
        .from(enquiriesTable)
        .where(
          and(
            eq(enquiriesTable.dealerId, dealerId()),
            eq(enquiriesTable.visitorId, visitorId),
          ),
        )
        .orderBy(desc(enquiriesTable.createdAt))
        .limit(1);
    }

    const [created] = await db
      .insert(enquiryEventsTable)
      .values({
        dealerId: dealerId(),
        enquiryId: enquiry?.id ?? null,
        vehicleId: vehicle?.id ?? null,
        vehicleTitle,
        vehicleUrl: vehicle ? `/vehicle/${vehicle.id}` : null,
        kind: input.channel === "whatsapp" ? "whatsapp_intent" : "call_intent",
        actor: "customer",
        summary: vehicleTitle
          ? `${channelLabel} tapped on ${vehicleTitle}`
          : `${channelLabel} tapped on the showroom`,
        detail: { source: input.source?.trim() || null },
        visitorId,
      })
      .returning();

    res.status(201).json(RecordContactIntentResponse.parse(serializeIntent(created, enquiry)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to record contact intent");
    res.status(500).json(errorResponse("Unable to record contact intent."));
  }
});

router.get("/contact-intents", requireStaff, async (req, res): Promise<void> => {
  const parsedQuery = GetContactIntentsQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json(errorResponse("Invalid contact intent filter."));
    return;
  }

  try {
    const conditions = [
      eq(enquiryEventsTable.dealerId, dealerId()),
      or(
        eq(enquiryEventsTable.kind, "call_intent"),
        eq(enquiryEventsTable.kind, "whatsapp_intent"),
      ),
    ];
    if (parsedQuery.data.unattributed) {
      conditions.push(isNull(enquiryEventsTable.enquiryId));
    }
    const events = await db
      .select()
      .from(enquiryEventsTable)
      .where(and(...conditions))
      .orderBy(desc(enquiryEventsTable.occurredAt))
      .limit(intentListLimit);

    const enquiryIds = [
      ...new Set(
        events
          .map((event) => event.enquiryId)
          .filter((value): value is string => value != null),
      ),
    ];
    const enquiries = enquiryIds.length
      ? await db
          .select({
            id: enquiriesTable.id,
            reference: enquiriesTable.reference,
            customerName: enquiriesTable.customerName,
          })
          .from(enquiriesTable)
          .where(inArray(enquiriesTable.id, enquiryIds))
      : [];
    const byId = new Map(enquiries.map((entry) => [entry.id, entry]));

    res.json(
      GetContactIntentsResponse.parse(
        events.map((event) =>
          serializeIntent(
            event,
            event.enquiryId ? byId.get(event.enquiryId) : undefined,
          ),
        ),
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to list contact intents");
    res.status(500).json(errorResponse("Unable to load contact intents."));
  }
});

export default router;
