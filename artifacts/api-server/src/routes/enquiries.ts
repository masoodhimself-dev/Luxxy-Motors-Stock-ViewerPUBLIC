import { Router, type IRouter } from "express";
import { requireStaff } from "../middlewares/staff-auth";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  DecideTestDriveBookingBody,
  DecideTestDriveBookingResponse,
  GetTestDriveBookingsResponse,
  CreateEnquiryBody,
  CreateEnquiryResponse,
  GetEnquiryAvailabilityQueryParams,
  GetEnquiryAvailabilityResponse,
  GetEnquiriesQueryParams,
  GetEnquiriesResponse,
  UpdateEnquiryStatusBody,
  UpdateEnquiryStatusParams,
  UpdateEnquiryStatusResponse,
} from "@workspace/api-zod";
import {
  db,
  enquiriesTable,
  vehiclesTable,
  type Enquiry,
  type Vehicle,
} from "@workspace/db";
import {
  deliverEnquiryNotifications,
  dealerProfile,
} from "../lib/enquiry-notifications";
import {
  bookingDateIsInWindow,
  bookingTimezone,
  constraintName,
  formatAppointmentLabel,
  getSlotsForDate,
  isUniqueViolation,
  isValidDateString,
  validBookingDateTime,
  slotIsAvailable,
  type BookingPolicy,
} from "../lib/booking-slots";
import {
  attachVisitorEventsToEnquiry,
  eventsForEnquiries,
  eventsForEnquiry,
  recordEnquiryEvent,
  serializeEnquiryEvent,
} from "../lib/enquiry-events";
import {
  generateEnquiryReference,
  viewingCalendarIcs,
  viewingManagePath,
  viewingToken,
  viewingTokenHash,
} from "../lib/enquiry-links";
import { BookingConflict, bookingsForDate, ensureBookingAvailable, getBookingPolicy, lockBookingDays } from "../lib/booking-store";
import { openLeadForEnquiry } from "../lib/leads";

const router: IRouter = Router();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const settings = () => ({
  dealerId: process.env.STOCK_DEALER_ID ?? "luxxy-motors",
  missingHideThreshold: Number.isFinite(Number(process.env.STOCK_MISSING_HIDE_THRESHOLD))
    ? Number(process.env.STOCK_MISSING_HIDE_THRESHOLD)
    : 2,
});

const errorResponse = (message: string) => ({ error: message });

function visibleVehicle(vehicle: Vehicle) {
  return (
    vehicle.dealerId === settings().dealerId &&
    vehicle.source === "autotrader" &&
    ["available", "reserved"].includes(vehicle.inventoryStatus) &&
    vehicle.missingCount < settings().missingHideThreshold &&
    !(
      vehicle.priceReviewRequired &&
      vehicle.sourcePrice == null &&
      vehicle.websitePriceOverride == null
    )
  );
}

function validationMessage(error: { issues: Array<{ message: string }> }) {
  return error.issues[0]?.message ?? "Please check the submitted details.";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Returns the digits-only form of a usable phone number, or null. */
function normalisePhone(value: string) {
  const compact = value.trim().replace(/[\s().\-/]/g, "");
  if (!/^\+?\d{7,15}$/.test(compact)) return null;
  return compact;
}

function normaliseRegistration(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ").slice(0, 16);
}

const enquiryTypeLabels: Record<string, string> = {
  viewing: "Viewing",
  general: "General",
  delivery: "Delivery",
  warranty: "Warranty",
  part_exchange: "Part exchange",
};

function enquiryTypeLabel(type: string) {
  return enquiryTypeLabels[type] ?? "General";
}

/**
 * Inserts an enquiry with a unique customer-facing reference, retrying if the
 * generated reference happens to collide.
 */
async function insertEnquiryWithReference(
  values: Omit<typeof enquiriesTable.$inferInsert, "reference">,
  policy?: BookingPolicy,
): Promise<Enquiry> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = generateEnquiryReference();
    try {
      return await db.transaction(async (tx) => {
        if (values.appointmentAt && policy) {
          await lockBookingDays(tx, values.dealerId, [values.appointmentAt]);
          await ensureBookingAvailable(tx, values.dealerId, values.appointmentAt, policy);
        }
        const [created] = await tx
          .insert(enquiriesTable)
          .values({ ...values, reference })
          .returning();
        // The enquiry and its lead timeline must either both persist or roll back.
        await openLeadForEnquiry(tx, created);
        return created;
      });
    } catch (error) {
      if (!isReferenceConflict(error)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("Unable to allocate an enquiry reference");
}

function isReferenceConflict(error: unknown) {
  if (!isUniqueViolation(error)) return false;
  const constraint = constraintName(error);
  return constraint === "enquiries_dealer_reference_uidx";
}

type EnquiryEventView = ReturnType<typeof serializeEnquiryEvent>;

function toEnquiryResponse(
  enquiry: Enquiry,
  options: {
    events?: EnquiryEventView[];
    managePath?: string | null;
    calendarIcs?: string | null;
  } = {},
) {
  return {
    ...enquiry,
    events: options.events ?? [],
    managePath: options.managePath ?? null,
    calendarIcs: options.calendarIcs ?? null,
  };
}

router.get("/enquiries", requireStaff, async (req, res): Promise<void> => {
  const parsedQuery = GetEnquiriesQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json(errorResponse("Invalid enquiry status filter."));
    return;
  }

  try {
    const conditions = [eq(enquiriesTable.dealerId, settings().dealerId)];
    if (parsedQuery.data.status) {
      conditions.push(eq(enquiriesTable.status, parsedQuery.data.status));
    }
    const enquiries = await db
      .select()
      .from(enquiriesTable)
      .where(and(...conditions))
      .orderBy(desc(enquiriesTable.createdAt));
    const events = await eventsForEnquiries(enquiries.map((entry) => entry.id));
    res.json(
      GetEnquiriesResponse.parse(
        enquiries.map((enquiry) =>
          toEnquiryResponse(enquiry, { events: events.get(enquiry.id) ?? [] }),
        ),
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to list enquiries");
    res.status(500).json(errorResponse("Unable to load enquiries."));
  }
});

router.get("/enquiries/availability", async (req, res): Promise<void> => {
  const parsedQuery = GetEnquiryAvailabilityQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json(errorResponse("Choose a valid booking date."));
    return;
  }

  const { date } = parsedQuery.data;
  try {
    const policy = await getBookingPolicy(settings().dealerId);
    if (!isValidDateString(date) || !bookingDateIsInWindow(date, policy)) {
      res.status(400).json(errorResponse(`Choose a date within the next ${policy.daysAhead} days.`));
      return;
    }
    const allSlots = getSlotsForDate(date, policy);
    const booked = await bookingsForDate(settings().dealerId, date);
    res.json(
      GetEnquiryAvailabilityResponse.parse({
        date,
        timezone: bookingTimezone,
        slots: allSlots.map((slot) => ({
          startAt: slot.startAt.toISOString(),
          label: slot.label,
          available: slotIsAvailable(slot.startAt, policy, booked),
        })),
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to load enquiry availability");
    res.status(500).json(errorResponse("Unable to load viewing availability."));
  }
});

router.post("/enquiries", async (req, res): Promise<void> => {
  const parsed = CreateEnquiryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse(validationMessage(parsed.error)));
    return;
  }

  const input = parsed.data;
  if (!input.email) {
    res.status(400).json(errorResponse("Please provide an email address for confirmation."));
    return;
  }
  if (!validEmail(input.email)) {
    res.status(400).json(errorResponse("Please provide a valid email address."));
    return;
  }

  const preferredContact = input.preferredContact ?? "email";
  const phone = input.phone?.trim() ? normalisePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) {
    res.status(400).json(errorResponse("Please provide a valid phone number."));
    return;
  }
  if (!phone && (preferredContact === "phone" || preferredContact === "whatsapp")) {
    res
      .status(400)
      .json(errorResponse("Please provide a phone number we can reach you on."));
    return;
  }
  if (!phone && input.type === "viewing") {
    res
      .status(400)
      .json(errorResponse("Please provide a phone number for your viewing."));
    return;
  }

  const partExchange = input.partExchange ?? null;
  const partExchangeMileage = partExchange?.mileage ?? null;
  if (partExchangeMileage != null && !Number.isInteger(partExchangeMileage)) {
    res.status(400).json(errorResponse("Please provide the mileage in whole miles."));
    return;
  }

  if (input.type === "viewing" && !input.vehicleId) {
    res.status(400).json(errorResponse("Please select a vehicle before booking a viewing."));
    return;
  }
  if (input.type === "viewing" && !input.appointmentAt) {
    res.status(400).json(errorResponse("Please choose a viewing date and time."));
    return;
  }
  if (input.type !== "viewing" && input.appointmentAt) {
    res.status(400).json(errorResponse("Appointments are only available for viewing enquiries."));
    return;
  }
  if (input.vehicleId && !uuidPattern.test(input.vehicleId)) {
    res.status(400).json(errorResponse("The selected vehicle is invalid."));
    return;
  }

  try {
    const policy = await getBookingPolicy(settings().dealerId);
    if (input.appointmentAt && !validBookingDateTime(input.appointmentAt, policy)) {
      res.status(400).json(errorResponse("That test-drive time is no longer available. Please choose another."));
      return;
    }
    let vehicle: Vehicle | undefined;
    if (input.vehicleId) {
      vehicle = (
        await db
          .select()
          .from(vehiclesTable)
          .where(
            and(
              eq(vehiclesTable.id, input.vehicleId),
              eq(vehiclesTable.dealerId, settings().dealerId),
              eq(vehiclesTable.source, "autotrader"),
            ),
          )
      )[0];
      if (!vehicle || !visibleVehicle(vehicle)) {
        res.status(404).json(errorResponse("That vehicle is no longer available."));
        return;
      }
    }

    const vehicleTitle = vehicle
      ? vehicle.websiteTitleOverride ?? vehicle.title
      : null;
    const vehicleUrl = vehicle ? `/vehicle/${vehicle.id}` : null;
    const isViewing = input.type === "viewing";

    const created = await insertEnquiryWithReference({
      dealerId: settings().dealerId,
      vehicleId: vehicle?.id ?? null,
      vehicleTitle,
      vehicleRegistration: vehicle
        ? vehicle.registration ?? vehicle.plate ?? vehicle.vrm
        : null,
      vehiclePrice: vehicle
        ? vehicle.websitePriceOverride ?? vehicle.sourcePrice
        : null,
      vehicleUrl,
      type: input.type,
      customerName: input.customerName.trim(),
      email: input.email.trim().toLowerCase(),
      phone,
      preferredContact,
      message: input.message.trim(),
      partExchangeRegistration: partExchange?.registration?.trim()
        ? normaliseRegistration(partExchange.registration)
        : null,
      partExchangeMileage,
      partExchangeCondition: partExchange?.condition ?? null,
      appointmentAt: input.appointmentAt ?? null,
      appointmentStatus: isViewing ? (policy.confirmationMode === "approval" ? "pending" : "confirmed") : null,
      appointmentDurationMinutes: isViewing ? policy.durationMinutes : null,
      appointmentBufferMinutes: isViewing ? policy.bufferMinutes : null,
      visitorId: input.visitorId?.trim() || null,
      customerNotificationStatus: "pending",
      dealerNotificationStatus: "pending",
      reminderStatus: isViewing && policy.confirmationMode === "instant" ? "pending" : "not_scheduled",
      source: "website",
    }, policy);

    // A booked viewing gets a capability link so the customer can move or drop
    // it themselves; the token is derived from the id, so only its hash is kept.
    if (isViewing) {
      await db
        .update(enquiriesTable)
        .set({ manageTokenHash: viewingTokenHash(viewingToken(created.id)) })
        .where(eq(enquiriesTable.id, created.id));
    }

    await recordEnquiryEvent({
      dealerId: created.dealerId,
      enquiryId: created.id,
      vehicleId: created.vehicleId,
      vehicleTitle: created.vehicleTitle,
      vehicleUrl: created.vehicleUrl,
      kind: isViewing ? "viewing_booked" : "enquiry_received",
      actor: "customer",
      summary: isViewing
        ? `${created.appointmentStatus === "pending" ? "Test drive requested" : "Test drive booked"} for ${formatAppointmentLabel(created.appointmentAt)}`
        : `${enquiryTypeLabel(created.type)} enquiry received`,
      detail: { reference: created.reference, preferredContact },
      visitorId: created.visitorId,
    });

    if (created.visitorId) {
      await attachVisitorEventsToEnquiry({
        dealerId: created.dealerId,
        visitorId: created.visitorId,
        enquiryId: created.id,
      });
    }

    const managePath = isViewing
      ? viewingManagePath(viewingToken(created.id))
      : null;

    const respond = async (enquiry: Enquiry) => {
      const dealer = await dealerProfile();
      res.status(201).json(
        CreateEnquiryResponse.parse(
          toEnquiryResponse(enquiry, {
            events: await eventsForEnquiry(enquiry.id),
            managePath,
            calendarIcs: isViewing
              ? viewingCalendarIcs({
                  enquiry,
                  dealerName: dealer.identity.name,
                  location: dealer.contact.address,
                })
              : null,
          }),
        ),
      );
    };

    try {
      const updated = await deliverEnquiryNotifications(created, req.log);
      await respond(updated);
    } catch (error) {
      req.log.error(
        { err: error, enquiryId: created.id },
        "Notification processing failed after enquiry was saved",
      );
      await respond(created);
    }
  } catch (error) {
    if (error instanceof BookingConflict || isUniqueViolation(error)) {
      res.status(409).json(errorResponse("That viewing slot has just been booked. Please choose another."));
      return;
    }
    req.log.error({ err: error }, "Unable to create enquiry");
    res.status(500).json(errorResponse("Unable to save your enquiry. Please try again."));
  }
});

router.patch("/enquiries/:id/status", requireStaff, async (req, res): Promise<void> => {
  const parsedParams = UpdateEnquiryStatusParams.safeParse(req.params);
  if (!parsedParams.success || !uuidPattern.test(parsedParams.data.id)) {
    res.status(400).json(errorResponse("Invalid enquiry id."));
    return;
  }
  const parsedBody = UpdateEnquiryStatusBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json(errorResponse("Invalid enquiry status."));
    return;
  }

  try {
    const [updated] = await db
      .update(enquiriesTable)
      .set({ status: parsedBody.data.status })
      .where(
        and(
          eq(enquiriesTable.id, parsedParams.data.id),
          eq(enquiriesTable.dealerId, settings().dealerId),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json(errorResponse("Enquiry not found."));
      return;
    }
    res.json(
      UpdateEnquiryStatusResponse.parse(
        toEnquiryResponse(updated, { events: await eventsForEnquiry(updated.id) }),
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to update enquiry status");
    res.status(500).json(errorResponse("Unable to update enquiry status."));
  }
});


router.get("/test-drive-bookings", requireStaff, async (req, res): Promise<void> => {
  try {
    const appointments = await db.select().from(enquiriesTable).where(and(eq(enquiriesTable.dealerId, settings().dealerId), eq(enquiriesTable.type, "viewing"))).orderBy(desc(enquiriesTable.createdAt));
    res.json(GetTestDriveBookingsResponse.parse(appointments.map((entry) => toEnquiryResponse(entry))));
  } catch (error) {
    req.log.error({ err: error }, "Unable to list test-drive appointments");
    res.status(500).json(errorResponse("Unable to load test drives."));
  }
});

router.post("/test-drive-bookings/:id/decision", requireStaff, async (req, res): Promise<void> => {
  const parsed = DecideTestDriveBookingBody.safeParse(req.body);
  if (!parsed.success || !uuidPattern.test(String(req.params.id))) {
    res.status(400).json(errorResponse("Choose a valid booking decision."));
    return;
  }
  try {
    const outcome = await db.transaction(async (tx) => {
      const [booking] = await tx.select().from(enquiriesTable).where(and(eq(enquiriesTable.id, String(req.params.id)), eq(enquiriesTable.dealerId, settings().dealerId), eq(enquiriesTable.type, "viewing"))).for("update");
      if (!booking) return null;
      if (booking.appointmentRevision !== parsed.data.expectedRevision) throw new BookingConflict("This test drive has changed. Refresh the booking before deciding.");
      if (parsed.data.decision === "decline" && booking.appointmentCancelledAt) return { booking, changed: false };
      if (parsed.data.decision === "confirm" && booking.appointmentStatus === "confirmed" && !booking.appointmentCancelledAt) return { booking, changed: false };
      if (booking.appointmentCancelledAt || booking.appointmentStatus !== "pending" || !booking.appointmentAt || booking.appointmentAt.getTime() <= Date.now()) throw new BookingConflict("Only a future pending test drive can be confirmed or declined.");
      const confirm = parsed.data.decision === "confirm";
      const [updated] = await tx.update(enquiriesTable).set({
        appointmentRevision: sql`${enquiriesTable.appointmentRevision} + 1`,
        appointmentStatus: confirm ? "confirmed" : "pending",
        appointmentCancelledAt: confirm ? null : new Date(),
        reminderStatus: confirm ? "pending" : "not_scheduled",
        customerNotificationStatus: "pending", customerNotificationError: null, customerNotificationAttemptedAt: null, customerNotificationSentAt: null,
        dealerNotificationStatus: "pending", dealerNotificationError: null, dealerNotificationAttemptedAt: null, dealerNotificationSentAt: null,
      }).where(eq(enquiriesTable.id, booking.id)).returning();
      return { booking: updated, changed: true };
    });
    if (!outcome) { res.status(404).json(errorResponse("Test drive not found.")); return; }
    if (outcome.changed) {
      await recordEnquiryEvent({ dealerId: outcome.booking.dealerId, enquiryId: outcome.booking.id, vehicleId: outcome.booking.vehicleId, vehicleTitle: outcome.booking.vehicleTitle, vehicleUrl: outcome.booking.vehicleUrl, kind: parsed.data.decision === "confirm" ? "viewing_booked" : "viewing_cancelled", actor: "dealer", summary: parsed.data.decision === "confirm" ? "Staff confirmed the test drive" : "Staff declined the test-drive request", detail: { decision: parsed.data.decision }, visitorId: outcome.booking.visitorId });
      try { outcome.booking = await deliverEnquiryNotifications(outcome.booking, req.log); } catch (error) { req.log.error({ err: error }, "Unable to deliver booking decision notification"); }
    }
    res.json(DecideTestDriveBookingResponse.parse(toEnquiryResponse(outcome.booking)));
  } catch (error) {
    if (error instanceof BookingConflict) { res.status(409).json(errorResponse(error.message)); return; }
    req.log.error({ err: error }, "Unable to decide test-drive booking");
    res.status(500).json(errorResponse("Unable to update this test drive."));
  }
});

export default router;