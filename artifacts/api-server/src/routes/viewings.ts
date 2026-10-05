import { Router, type IRouter, type Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  CancelViewingBody,
  CancelViewingParams,
  CancelViewingResponse,
  GetViewingBookingParams,
  GetViewingBookingResponse,
  RescheduleViewingBody,
  RescheduleViewingParams,
  RescheduleViewingResponse,
} from "@workspace/api-zod";
import { db, enquiriesTable, vehiclesTable, type Enquiry } from "@workspace/db";
import {
  bookingTimezone,
  formatAppointmentLabel,
  isUniqueViolation,
  validBookingDateTime,
} from "../lib/booking-slots";
import { recordEnquiryEvent } from "../lib/enquiry-events";
import {
  viewingCalendarIcs,
  viewingTokenHash,
  viewingTokenMatches,
} from "../lib/enquiry-links";
import { BookingConflict, ensureBookingAvailable, getBookingPolicy, lockBookingDays } from "../lib/booking-store";
import { deliverEnquiryNotifications, dealerProfile } from "../lib/enquiry-notifications";

const router: IRouter = Router();
const rateLimits = new Map<string, { count: number; resetAt: number }>();

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

async function findViewing(token: string) {
  if (!token || token.length > 200) return undefined;
  const [enquiry] = await db
    .select()
    .from(enquiriesTable)
    .where(
      and(
        eq(enquiriesTable.dealerId, dealerId()),
        eq(enquiriesTable.manageTokenHash, viewingTokenHash(token)),
      ),
    );
  if (!enquiry?.manageTokenHash) return undefined;
  return viewingTokenMatches(enquiry.manageTokenHash, token) ? enquiry : undefined;
}

function canChange(enquiry: Enquiry) {
  return (
    enquiry.appointmentCancelledAt == null &&
    enquiry.appointmentAt != null &&
    enquiry.appointmentAt.getTime() > Date.now()
  );
}

async function viewingBooking(enquiry: Enquiry) {
  const dealer = await dealerProfile();
  return {
    reference: enquiry.reference,
    status: enquiry.appointmentCancelledAt ? ("cancelled" as const) : enquiry.appointmentStatus === "pending" ? ("pending" as const) : ("booked" as const),
    durationMinutes: enquiry.appointmentDurationMinutes ?? 30,
    customerName: enquiry.customerName,
    appointmentAt: enquiry.appointmentAt,
    cancelledAt: enquiry.appointmentCancelledAt,
    timezone: bookingTimezone,
    vehicleTitle: enquiry.vehicleTitle,
    vehicleUrl: enquiry.vehicleUrl,
    calendarIcs: viewingCalendarIcs({
      enquiry,
      dealerName: dealer.identity.name,
      location: dealer.contact.address,
    }),
    canChange: canChange(enquiry),
  };
}

function notFound(res: Response) {
  res
    .status(404)
    .json(
      errorResponse(
        "This link is no longer valid. Please contact the showroom to change your viewing.",
      ),
    );
}

router.get("/viewings/:token", async (req, res): Promise<void> => {
  const parsedParams = GetViewingBookingParams.safeParse(req.params);
  if (!parsedParams.success) {
    notFound(res);
    return;
  }
  const limit = checkRateLimit(`viewing-get:${req.ip}`, 60, 60_000);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    res.status(429).json(errorResponse("Too many requests. Please try again shortly."));
    return;
  }

  try {
    const enquiry = await findViewing(parsedParams.data.token);
    if (!enquiry) {
      notFound(res);
      return;
    }
    res.json(
      GetViewingBookingResponse.parse(
        await viewingBooking(enquiry),
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to load viewing from manage link");
    res.status(500).json(errorResponse("Unable to load your viewing."));
  }
});

router.post("/viewings/:token/reschedule", async (req, res): Promise<void> => {
  const parsedParams = RescheduleViewingParams.safeParse(req.params);
  const parsedBody = RescheduleViewingBody.safeParse(req.body);
  if (!parsedParams.success) {
    notFound(res);
    return;
  }
  if (!parsedBody.success) {
    res.status(400).json(errorResponse("Please choose a new viewing time."));
    return;
  }
  const limit = checkRateLimit(`viewing-change:${req.ip}`, 20, 60_000);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    res.status(429).json(errorResponse("Too many requests. Please try again shortly."));
    return;
  }

  const { token } = parsedParams.data;
  const appointmentAt = parsedBody.data.appointmentAt;

  try {
    const enquiry = await findViewing(token);
    if (!enquiry) {
      notFound(res);
      return;
    }
    if (enquiry.appointmentCancelledAt) {
      res
        .status(400)
        .json(errorResponse("This viewing was cancelled. Please book a new one."));
      return;
    }
    if (!canChange(enquiry)) {
      res
        .status(400)
        .json(
          errorResponse(
            "This viewing has already started. Please call the showroom to rearrange.",
          ),
        );
      return;
    }
    const policy = await getBookingPolicy(dealerId());
    if (!validBookingDateTime(appointmentAt, policy)) {
      res.status(400).json(errorResponse("That viewing slot is not available."));
      return;
    }
    if (appointmentAt.getTime() === enquiry.appointmentAt?.getTime()) {
      res.json(GetViewingBookingResponse.parse(await viewingBooking(enquiry)));
      return;
    }

    const previous = enquiry.appointmentAt;
    const updated = await db.transaction(async (tx) => {
      await lockBookingDays(tx, dealerId(), [appointmentAt, ...(previous ? [previous] : [])]);
      const [current] = await tx.select().from(enquiriesTable).where(eq(enquiriesTable.id, enquiry.id)).for("update");
      if (!current || !canChange(current)) throw new BookingConflict("This booking has changed. Reload it before choosing another time.");
      if (current.vehicleId) {
        const [vehicle] = await tx.select().from(vehiclesTable).where(and(eq(vehiclesTable.id, current.vehicleId), eq(vehiclesTable.dealerId, dealerId()))).for("update");
        if (!vehicle || vehicle.inventoryStatus !== "available") throw new BookingConflict("This car is no longer available for online test-drive changes. Please contact the showroom.");
      }
      await ensureBookingAvailable(tx, dealerId(), appointmentAt, policy, enquiry.id);
      const [changed] = await tx.update(enquiriesTable).set({
        appointmentAt,
        attendance: "scheduled",
        appointmentOutsideHours: false,
        appointmentDoubleBooked: false,
        appointmentOverCapacity: false,
        appointmentRevision: sql`${enquiriesTable.appointmentRevision} + 1`,
        appointmentStatus: policy.confirmationMode === "approval" ? "pending" : "confirmed",
        appointmentDurationMinutes: policy.durationMinutes,
        appointmentBufferMinutes: policy.bufferMinutes,
        reminderStatus: policy.confirmationMode === "approval" ? "not_scheduled" : "pending",
        reminderError: null, reminderSentAt: null, reminderAttemptedAt: null, reminderProviderId: null,
        customerNotificationStatus: "pending", customerNotificationError: null, customerNotificationAttemptedAt: null, customerNotificationSentAt: null,
        dealerNotificationStatus: "pending", dealerNotificationError: null, dealerNotificationAttemptedAt: null, dealerNotificationSentAt: null,
      }).where(and(eq(enquiriesTable.id, enquiry.id), isNull(enquiriesTable.appointmentCancelledAt))).returning();
      return changed;
    });
    if (!updated) {
      notFound(res);
      return;
    }

    await recordEnquiryEvent({
      dealerId: updated.dealerId,
      enquiryId: updated.id,
      vehicleId: updated.vehicleId,
      vehicleTitle: updated.vehicleTitle,
      vehicleUrl: updated.vehicleUrl,
      kind: "viewing_rescheduled",
      actor: "customer",
      summary: `Customer moved their viewing from ${formatAppointmentLabel(previous)} to ${formatAppointmentLabel(updated.appointmentAt)}`,
      detail: {
        from: previous?.toISOString() ?? null,
        to: updated.appointmentAt?.toISOString() ?? null,
      },
      visitorId: updated.visitorId,
    });

    try { await deliverEnquiryNotifications(updated, req.log); } catch (error) { req.log.error({ err: error }, "Reschedule notification failed"); }
    res.json(
      RescheduleViewingResponse.parse(await viewingBooking(updated)),
    );
  } catch (error) {
    if (error instanceof BookingConflict || isUniqueViolation(error)) {
      res
        .status(409)
        .json(errorResponse("That slot has just been taken. Please choose another."));
      return;
    }
    req.log.error({ err: error }, "Unable to reschedule viewing");
    res.status(500).json(errorResponse("Unable to move your viewing. Please try again."));
  }
});

router.post("/viewings/:token/cancel", async (req, res): Promise<void> => {
  const parsedParams = CancelViewingParams.safeParse(req.params);
  const parsedBody = CancelViewingBody.safeParse(req.body ?? {});
  if (!parsedParams.success) {
    notFound(res);
    return;
  }
  if (!parsedBody.success) {
    res.status(400).json(errorResponse("Please shorten your reason for cancelling."));
    return;
  }
  const limit = checkRateLimit(`viewing-change:${req.ip}`, 20, 60_000);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    res.status(429).json(errorResponse("Too many requests. Please try again shortly."));
    return;
  }

  const { token } = parsedParams.data;
  const reason = parsedBody.data.reason?.trim() || null;

  try {
    const enquiry = await findViewing(token);
    if (!enquiry) {
      notFound(res);
      return;
    }
    if (enquiry.appointmentCancelledAt) {
      res.json(CancelViewingResponse.parse(await viewingBooking(enquiry)));
      return;
    }

    const [updated] = await db
      .update(enquiriesTable)
      .set({
        appointmentCancelledAt: new Date(),
        appointmentRevision: sql`${enquiriesTable.appointmentRevision} + 1`,
        customerNotificationStatus: "pending", customerNotificationError: null, customerNotificationAttemptedAt: null, customerNotificationSentAt: null,
        dealerNotificationStatus: "pending", dealerNotificationError: null, dealerNotificationAttemptedAt: null, dealerNotificationSentAt: null,
        // No reminder should go out for a viewing that is no longer happening.
        reminderStatus: "not_scheduled",
        reminderError: null,
        reminderAttemptedAt: null,
      })
      .where(
        and(
          eq(enquiriesTable.id, enquiry.id),
          isNull(enquiriesTable.appointmentCancelledAt),
        ),
      )
      .returning();
    if (!updated) {
      notFound(res);
      return;
    }

    await recordEnquiryEvent({
      dealerId: updated.dealerId,
      enquiryId: updated.id,
      vehicleId: updated.vehicleId,
      vehicleTitle: updated.vehicleTitle,
      vehicleUrl: updated.vehicleUrl,
      kind: "viewing_cancelled",
      actor: "customer",
      summary: reason
        ? `Customer cancelled their ${formatAppointmentLabel(updated.appointmentAt)} viewing: ${reason}`
        : `Customer cancelled their ${formatAppointmentLabel(updated.appointmentAt)} viewing`,
      detail: {
        appointmentAt: updated.appointmentAt?.toISOString() ?? null,
        reason,
      },
      visitorId: updated.visitorId,
    });

    try { await deliverEnquiryNotifications(updated, req.log); } catch (error) { req.log.error({ err: error }, "Cancellation notification failed"); }
    res.json(CancelViewingResponse.parse(await viewingBooking(updated)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to cancel viewing");
    res
      .status(500)
      .json(errorResponse("Unable to cancel your viewing. Please try again."));
  }
});

export default router;
