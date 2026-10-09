import { dealerIntegrationsStore } from "../lib/dealer-integrations-store";
import { Router, type IRouter, type Request, type Response } from "express";
import { showroomAvailability, vehicleRegistrationLabel } from "@workspace/vehicle-meta";
import { requirePermission, requireStaff, staffLabel } from "../middlewares/staff-auth";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  DecideTestDriveBookingBody,
  DecideTestDriveBookingResponse,
  GetTestDriveBookingsResponse,
  CreateEnquiryBody,
  CreateStaffEnquiryBody,
  ChangeStaffAppointmentBody,
  ChangeStaffFollowUpBody,
  CreateEnquiryResponse,
  GetEnquiryAvailabilityQueryParams,
  GetEnquiryAvailabilityResponse,
  GetEnquiriesQueryParams,
  GetEnquiriesResponse,
  UpdateEnquiryStatusBody,
  UpdateEnquiryStatusParams,
  UpdateEnquiryStatusResponse,
  UpdateEnquiryWorkspaceBody,
  LogEnquiryConversationBody,
} from "@workspace/api-zod";
import {
  db,
  enquiriesTable,
  enquiryEventsTable,
  dealerSettingsTable,
  vehiclesTable,
  portalUsersTable,
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
  validStaffAppointmentDateTime,
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
import { BookingConflict, bookingsForDate, checkStaffAppointment, ensureBookingAvailable, getBookingPolicy, lockBookingDays } from "../lib/booking-store";
import { openLeadForEnquiry } from "../lib/leads";
import { attendanceError, outcomeError } from "../lib/enquiry-workspace";
import { conversationChange, ConversationError } from "../lib/enquiry-conversations";

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

async function assignedStaff(id: string | null | undefined, req: Request) {
  if (!id) return { assignedToId: null, assignedToName: null };
  if (id === req.staff?.authUserId) return { assignedToId: id, assignedToName: req.staff.name || req.staff.email || "Staff member" };
  const [member] = await db.select().from(portalUsersTable).where(and(eq(portalUsersTable.dealerId, settings().dealerId), eq(portalUsersTable.authUserId, id), isNull(portalUsersTable.disabledAt)));
  if (!member) throw new BookingConflict("Choose a staff member from this dealership.");
  return { assignedToId: id, assignedToName: member.name || member.email || "Staff member" };
}

router.get("/staff/directory", requireStaff, async (req, res) => {
  try {
    const rows = await db.select().from(portalUsersTable).where(and(eq(portalUsersTable.dealerId, settings().dealerId), isNull(portalUsersTable.disabledAt)));
    const members = rows.map(row => ({ id: row.authUserId, name: row.name || row.email || "Staff member" }));
    if (req.staff && !members.some(member => member.id === req.staff!.authUserId)) members.push({ id: req.staff.authUserId, name: req.staff.name || req.staff.email || "Staff member" });
    res.json({ currentUserId: req.staff!.authUserId, members });
  } catch (error) { req.log.error({ err: error }, "Unable to list staff"); res.status(500).json(errorResponse("Unable to load staff members.")); }
});

router.patch("/staff/enquiries/:id/workspace", requireStaff, async (req, res) => {
  const parsed = UpdateEnquiryWorkspaceBody.safeParse(req.body);
  if (!parsed.success || !uuidPattern.test(String(req.params.id))) { res.status(400).json(errorResponse("Check the enquiry update.")); return; }
  const input = parsed.data;
  try {
    const assignment = input.assignedToId !== undefined ? await assignedStaff(input.assignedToId, req) : {};
    const updated = await db.transaction(async tx => {
      const [entry] = await tx.select().from(enquiriesTable).where(and(eq(enquiriesTable.id, String(req.params.id)), eq(enquiriesTable.dealerId, settings().dealerId))).for("update");
      if (!entry) return null;
      if (entry.workspaceRevision !== input.expectedRevision) throw new BookingConflict("This enquiry changed. Refresh and review it before saving.");
      if (input.attendance) {
        if (input.expectedAppointmentRevision !== entry.appointmentRevision) throw new BookingConflict("The appointment changed. Refresh before recording attendance.");
        const error = attendanceError(entry, input.attendance);
        if (error) throw new BookingConflict(error);
      }
      const error = outcomeError(entry, input.callOutcome);
      if (error) throw new BookingConflict(error);
      const [row] = await tx.update(enquiriesTable).set({ ...assignment,
        ...(input.callOutcome !== undefined ? { callOutcome: input.callOutcome } : {}),
        ...(input.staffNote !== undefined ? { staffNote: input.staffNote?.trim() || null } : {}),
        ...(input.attendance ? { attendance: input.attendance } : {}),
        workspaceRevision: entry.workspaceRevision + 1, updatedAt: new Date(),
      }).where(eq(enquiriesTable.id, entry.id)).returning();
      return row;
    });
    if (!updated) { res.status(404).json(errorResponse("Enquiry not found.")); return; }
    res.json(toEnquiryResponse(updated, { events: await eventsForEnquiry(updated.id) }));
  } catch (error) {
    if (error instanceof BookingConflict) { res.status(409).json(errorResponse(error.message)); return; }
    req.log.error({ err: error }, "Unable to update enquiry workspace"); res.status(500).json(errorResponse("Unable to save the enquiry update."));
  }
});

router.post("/staff/enquiries/:id/conversations", requireStaff, requirePermission('sales.manage'), async (req, res) => {
  const parsed = LogEnquiryConversationBody.safeParse(req.body);
  const id = String(req.params.id);
  if (!parsed.success || !uuidPattern.test(id)) { res.status(400).json(errorResponse("Check the conversation details.")); return; }
  try {
    const updated = await db.transaction(async tx => {
      const [entry] = await tx.select().from(enquiriesTable).where(and(eq(enquiriesTable.id, id), eq(enquiriesTable.dealerId, settings().dealerId))).for("update");
      if (!entry) return null;
      const change = conversationChange(entry, parsed.data, { id: req.staff!.authUserId, name: staffLabel(req) });
      const [row] = await tx.update(enquiriesTable).set(change.update).where(and(eq(enquiriesTable.id, id), eq(enquiriesTable.dealerId, settings().dealerId))).returning();
      await tx.insert(enquiryEventsTable).values({ dealerId: entry.dealerId, enquiryId: id, vehicleId: entry.vehicleId, vehicleTitle: entry.vehicleTitle, vehicleUrl: entry.vehicleUrl, kind: 'conversation_logged', actor: 'dealer', summary: change.summary, detail: change.detail, occurredAt: change.occurredAt });
      return row;
    });
    if (!updated) { res.status(404).json(errorResponse("Enquiry not found.")); return; }
    res.json(toEnquiryResponse(updated, { events: await eventsForEnquiry(updated.id) }));
  } catch (error) {
    if (error instanceof ConversationError) { res.status(error.status).json(errorResponse(error.message)); return; }
    req.log.error({ err: error }, "Unable to log conversation"); res.status(500).json(errorResponse("Unable to save the conversation."));
  }
});

async function visibleVehicle(vehicle: Vehicle) {
  return (
    vehicle.dealerId === settings().dealerId &&
    vehicle.source === (await dealerIntegrationsStore.readStockConnection()).connection.platform &&
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
  staffOptions?: { allowOutsideHours?: boolean; allowDoubleBooking?: boolean },
): Promise<Enquiry> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = generateEnquiryReference();
    try {
      return await db.transaction(async (tx) => {
        let exception = { appointmentOutsideHours: false, appointmentDoubleBooked: false, appointmentOverCapacity: false };
        if (values.appointmentAt && policy) {
          await lockBookingDays(tx, values.dealerId, [values.appointmentAt]);
          if (staffOptions) exception = await checkStaffAppointment(tx, values.dealerId, values.appointmentAt, policy, staffOptions);
          else await ensureBookingAvailable(tx, values.dealerId, values.appointmentAt, policy);
          if (values.vehicleId) {
            const [vehicle] = await tx.select().from(vehiclesTable).where(and(eq(vehiclesTable.id, values.vehicleId), eq(vehiclesTable.dealerId, values.dealerId))).for("update");
            if (!vehicle || !(await visibleVehicle(vehicle)) || vehicle.inventoryStatus !== "available") throw new BookingConflict("This car is no longer available for a test drive.");
          }
        }
        const [created] = await tx
          .insert(enquiriesTable)
          .values({ ...values, ...exception, reference })
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

export function toEnquiryResponse(
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

async function enquiryAvailability(req: Request, res: Response, staff = false): Promise<void> {
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
    const excludeId = staff ? String(req.params.id) : undefined;
    if (excludeId) {
      if (!uuidPattern.test(excludeId)) { res.status(400).json(errorResponse("Invalid appointment.")); return; }
      const [booking] = await db.select({ id: enquiriesTable.id }).from(enquiriesTable).where(and(eq(enquiriesTable.id, excludeId), eq(enquiriesTable.dealerId, settings().dealerId), eq(enquiriesTable.type, "viewing")));
      if (!booking) { res.status(404).json(errorResponse("Appointment not found.")); return; }
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
          available: slotIsAvailable(slot.startAt, policy, booked, new Date(), excludeId),
        })),
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to load enquiry availability");
    res.status(500).json(errorResponse("Unable to load viewing availability."));
  }
}
router.get("/enquiries/availability", (req, res) => enquiryAvailability(req, res));
router.get("/staff/enquiries/:id/availability", requireStaff, (req, res) => enquiryAvailability(req, res, true));

async function createEnquiry(req: Request, res: Response, staff = false): Promise<void> {
  if (staff && req.body && Object.prototype.hasOwnProperty.call(req.body, 'requestCallback')) {
    res.status(400).json(errorResponse("Website callback requests must use the public enquiry form.")); return;
  }
  const parsed = (staff ? CreateStaffEnquiryBody : CreateEnquiryBody).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorResponse(validationMessage(parsed.error)));
    return;
  }

  const input = parsed.data as ReturnType<typeof CreateStaffEnquiryBody.parse>;
  const requestCallback = !staff && "requestCallback" in input && input.requestCallback === true;
  if (!staff && "requestCallback" in input && input.type !== "general") { res.status(400).json(errorResponse("Callback requests are only available for general enquiries.")); return; }
  if (requestCallback && input.appointmentAt) { res.status(400).json(errorResponse("Callback requests cannot include an appointment.")); return; }
  const adHoc = staff && "adHocVehicle" in input ? input.adHocVehicle : null;
  let followUpAt = staff && "followUpAt" in input ? input.followUpAt : null;
  let followUpNote = staff && "followUpNote" in input ? input.followUpNote : null;
  const staffOptions = staff ? { allowOutsideHours: "allowOutsideHours" in input ? input.allowOutsideHours : false, allowDoubleBooking: "allowDoubleBooking" in input ? input.allowDoubleBooking : false } : undefined;
  if (staffOptions && input.type !== "viewing" && (staffOptions.allowOutsideHours || staffOptions.allowDoubleBooking)) { res.status(400).json(errorResponse("Appointment exceptions apply only to a test drive.")); return; }
  if (followUpAt && followUpAt.getTime() <= Date.now()) { res.status(400).json(errorResponse("Choose a future follow-up time.")); return; }

  if (adHoc && (input.vehicleId || input.type === "viewing" || adHoc.title.trim().length < 2)) {
    res.status(400).json(errorResponse("Use an ad hoc car for an enquiry only, or choose a stock car for a test drive.")); return;
  }
  if (input.customerName.trim().length < 2) { res.status(400).json(errorResponse("Please provide the customer’s name.")); return; }
  if (!staff && !requestCallback && !input.email && (input.type === "viewing" || !input.preferredContact || input.preferredContact === "email")) {
    res.status(400).json(errorResponse("Please provide an email address for confirmation."));
    return;
  }
  if (input.email && !validEmail(input.email)) {
    res.status(400).json(errorResponse("Please provide a valid email address."));
    return;
  }

  const preferredContact = staff || requestCallback ? "phone" : input.preferredContact ?? "email";
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
    if (requestCallback) {
      const [dealerSettings] = await db.select({ config: dealerSettingsTable.config }).from(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, settings().dealerId));
      const config = dealerSettings?.config as { hours?: Array<{ days: string; times: string }> } | undefined;
      followUpAt = showroomAvailability(config?.hours).callbackAt;
      followUpNote = 'Website callback requested';
    }
    if (input.appointmentAt && !(staff ? validStaffAppointmentDateTime(input.appointmentAt) : validBookingDateTime(input.appointmentAt, policy))) {
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
              eq(vehiclesTable.source, (await dealerIntegrationsStore.readStockConnection()).connection.platform),
            ),
          )
      )[0];
      if (!vehicle || !(await visibleVehicle(vehicle))) {
        res.status(404).json(errorResponse("That vehicle is no longer available."));
        return;
      }
    }

    const vehicleTitle = vehicle
      ? vehicle.websiteTitleOverride ?? vehicle.title
      : adHoc?.title.trim() ?? null;
    const vehicleUrl = vehicle ? `/vehicle/${vehicle.id}` : null;
    const isViewing = input.type === "viewing";
    const owner = staff ? await assignedStaff("assignedToId" in input ? input.assignedToId : null, req) : requestCallback ? { assignedToId: null, assignedToName: null } : {};
    const callOutcome = staff ? ("callOutcome" in input ? input.callOutcome : undefined) ?? (isViewing ? "test_drive_booked" : "information_given") : requestCallback ? "callback_requested" : null;
    const outcomeProblem = requestCallback ? null : outcomeError({ appointmentAt: input.appointmentAt, followUpAt }, callOutcome);
    if (outcomeProblem) { res.status(400).json(errorResponse(outcomeProblem)); return; }

    const created = await insertEnquiryWithReference({
      ...owner,
      callOutcome,
      dealerId: settings().dealerId,
      vehicleId: vehicle?.id ?? null,
      vehicleTitle,
      vehicleRegistration: vehicle
        ? vehicleRegistrationLabel(vehicle)
        : adHoc?.registration?.trim() ? normaliseRegistration(adHoc.registration) : null,
      vehiclePrice: vehicle
        ? vehicle.websitePriceOverride ?? vehicle.sourcePrice
        : adHoc?.price ?? null,
      vehicleUrl,
      type: input.type,
      customerName: input.customerName.trim(),
      email: input.email?.trim().toLowerCase() || null,
      phone,
      preferredContact,
      message: input.message.trim(),
      followUpAt: followUpAt ?? null,
      followUpNote: followUpAt ? followUpNote?.trim() || null : null,
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
      customerNotificationStatus: input.email ? "pending" : "not_sent",
      dealerNotificationStatus: "pending",
      reminderStatus: Boolean(input.email) && isViewing && policy.confirmationMode === "instant" ? "pending" : "not_scheduled",
      source: staff ? adHoc ? "phone_ad_hoc" : "phone" : requestCallback ? "website_callback" : "website",
      status: staff ? "contacted" : "new",
    }, policy, staffOptions);

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
      actor: staff ? "dealer" : "customer",
      summary: isViewing
        ? `${created.appointmentStatus === "pending" ? "Test drive requested" : "Test drive booked"} for ${formatAppointmentLabel(created.appointmentAt)}`
        : requestCallback ? "Website callback requested" : `${enquiryTypeLabel(created.type)} enquiry received`,
      detail: { reference: created.reference, preferredContact, appointmentOutsideHours: created.appointmentOutsideHours, appointmentDoubleBooked: created.appointmentDoubleBooked, appointmentOverCapacity: created.appointmentOverCapacity },
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
      res.status(409).json(errorResponse(staff && error instanceof BookingConflict ? error.message : "That viewing slot has just been booked. Please choose another."));
      return;
    }
    req.log.error({ err: error }, "Unable to create enquiry");
    res.status(500).json(errorResponse("Unable to save your enquiry. Please try again."));
  }
 }
router.post("/enquiries", (req, res) => createEnquiry(req, res));
router.post("/staff/enquiries", requireStaff, (req, res) => createEnquiry(req, res, true));

router.post("/staff/enquiries/:id/follow-up", requireStaff, async (req, res): Promise<void> => {
  const parsed = ChangeStaffFollowUpBody.safeParse(req.body);
  const id = String(req.params.id);
  if (!uuidPattern.test(id) || !parsed.success) { res.status(400).json(errorResponse("Check the follow-up details.")); return; }
  const input = parsed.data;
  if (input.action === "schedule" && (!input.followUpAt || input.followUpAt.getTime() <= Date.now())) { res.status(400).json(errorResponse("Choose a future follow-up time.")); return; }
  try {
    const updated = await db.transaction(async tx => {
      const [entry] = await tx.select().from(enquiriesTable).where(and(eq(enquiriesTable.id, id), eq(enquiriesTable.dealerId, settings().dealerId))).for("update");
      if (!entry) return null;
      if (entry.followUpRevision !== input.expectedRevision) throw new BookingConflict("This follow-up changed. Refresh before editing it.");
      if (input.action !== "schedule" && (!entry.followUpAt || entry.followUpCompletedAt)) throw new BookingConflict("There is no outstanding follow-up to update.");
      const [changed] = await tx.update(enquiriesTable).set({
        followUpAt: input.action === "schedule" ? input.followUpAt! : input.action === "cancel" ? null : entry.followUpAt,
        followUpNote: input.action === "schedule" ? input.followUpNote?.trim() || null : entry.followUpNote,
        followUpCompletedAt: input.action === "complete" ? new Date() : null,
        followUpRevision: entry.followUpRevision + 1, updatedAt: new Date(),
      }).where(eq(enquiriesTable.id, id)).returning();
      return changed;
    });
    if (!updated) { res.status(404).json(errorResponse("Enquiry not found.")); return; }
    res.json(toEnquiryResponse(updated, { events: await eventsForEnquiry(updated.id) }));
  } catch (error) {
    if (error instanceof BookingConflict) { res.status(409).json(errorResponse(error.message)); return; }
    req.log.error({ err: error }, "Unable to save follow-up"); res.status(500).json(errorResponse("Unable to save follow-up."));
  }
});

router.post("/staff/enquiries/:id/appointment", requireStaff, async (req, res): Promise<void> => {
  const parsed = ChangeStaffAppointmentBody.safeParse(req.body);
  const id = String(req.params.id);
  if (!uuidPattern.test(id) || !parsed.success) {
    res.status(400).json(errorResponse("Check the appointment details.")); return;
  }
  const input = parsed.data;
  try {
    const policy = await getBookingPolicy(settings().dealerId);
    if (input.action === "reschedule" && (!input.appointmentAt || !validStaffAppointmentDateTime(input.appointmentAt))) {
      res.status(400).json(errorResponse("Choose an available appointment time.")); return;
    }
    const updated = await db.transaction(async tx => {
      // Day locks precede row locks, matching customer booking operations.
      const [before] = await tx.select().from(enquiriesTable).where(and(eq(enquiriesTable.id, id), eq(enquiriesTable.dealerId, settings().dealerId)));
      if (!before?.appointmentAt || before.type !== "viewing") return null;
      await lockBookingDays(tx, settings().dealerId, [before.appointmentAt, ...(input.appointmentAt ? [input.appointmentAt] : [])]);
      const [current] = await tx.select().from(enquiriesTable).where(eq(enquiriesTable.id, id)).for("update");
      if (!current || current.appointmentRevision !== input.expectedRevision || current.appointmentCancelledAt || !current.appointmentAt || current.appointmentAt.getTime() <= Date.now()) throw new BookingConflict("This appointment changed. Refresh and try again.");
      const exception = input.action === "reschedule" ? await checkStaffAppointment(tx, settings().dealerId, input.appointmentAt!, policy, input, id) : null;
      const cancelled = input.action === "cancel";
      const [changed] = await tx.update(enquiriesTable).set({
        appointmentAt: cancelled ? current.appointmentAt : input.appointmentAt!,
        attendance: cancelled ? current.attendance : "scheduled",
        appointmentOutsideHours: cancelled ? current.appointmentOutsideHours : exception!.appointmentOutsideHours,
        appointmentDoubleBooked: cancelled ? current.appointmentDoubleBooked : exception!.appointmentDoubleBooked,
        appointmentOverCapacity: cancelled ? current.appointmentOverCapacity : exception!.appointmentOverCapacity,
        appointmentCancelledAt: cancelled ? new Date() : null,
        appointmentRevision: current.appointmentRevision + 1,
        appointmentStatus: cancelled ? current.appointmentStatus : policy.confirmationMode === "approval" ? "pending" : "confirmed",
        appointmentDurationMinutes: cancelled ? current.appointmentDurationMinutes : policy.durationMinutes,
        appointmentBufferMinutes: cancelled ? current.appointmentBufferMinutes : policy.bufferMinutes,
        customerNotificationStatus: current.email ? "pending" : "not_sent", customerNotificationError: null, customerNotificationSentAt: null, customerNotificationAttemptedAt: null,
        dealerNotificationStatus: "pending", dealerNotificationError: null, dealerNotificationSentAt: null, dealerNotificationAttemptedAt: null,
        reminderStatus: !cancelled && current.email && policy.confirmationMode === "instant" ? "pending" : "not_scheduled",
        reminderError: null, reminderSentAt: null, reminderAttemptedAt: null, reminderProviderId: null,
        updatedAt: new Date(),
      }).where(eq(enquiriesTable.id, id)).returning();
      return changed;
    });
    if (!updated) { res.status(404).json(errorResponse("Appointment not found.")); return; }
    await recordEnquiryEvent({ dealerId: updated.dealerId, enquiryId: id, vehicleId: updated.vehicleId, vehicleTitle: updated.vehicleTitle, vehicleUrl: updated.vehicleUrl, kind: input.action === "cancel" ? "viewing_cancelled" : "viewing_rescheduled", actor: "dealer", summary: input.action === "cancel" ? "Staff cancelled the appointment" : `Staff moved the appointment to ${formatAppointmentLabel(updated.appointmentAt)}`, detail: { expectedRevision: input.expectedRevision, appointmentOutsideHours: updated.appointmentOutsideHours, appointmentDoubleBooked: updated.appointmentDoubleBooked, appointmentOverCapacity: updated.appointmentOverCapacity }, visitorId: null });
    let notified = updated;
    try { notified = await deliverEnquiryNotifications(updated, req.log); } catch (error) { req.log.error({ err: error }, "Staff appointment notification failed"); }
    res.json(toEnquiryResponse(notified, { events: await eventsForEnquiry(notified.id) }));
  } catch (error) {
    if (error instanceof BookingConflict || isUniqueViolation(error)) { res.status(409).json(errorResponse("The appointment or availability changed. Refresh before trying again.")); return; }
    req.log.error({ err: error }, "Unable to update staff appointment");
    res.status(500).json(errorResponse("Unable to update this appointment."));
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
      .set({ status: parsedBody.data.status, workspaceRevision: sql`${enquiriesTable.workspaceRevision} + 1` })
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
    const events = await eventsForEnquiries(appointments.map(entry => entry.id));
    res.json(GetTestDriveBookingsResponse.parse(appointments.map((entry) => toEnquiryResponse(entry, { events: events.get(entry.id) ?? [] }))));
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
        reminderStatus: confirm && booking.email ? "pending" : "not_scheduled",
        customerNotificationStatus: booking.email ? "pending" : "not_sent", customerNotificationError: null, customerNotificationAttemptedAt: null, customerNotificationSentAt: null,
        dealerNotificationStatus: "pending", dealerNotificationError: null, dealerNotificationAttemptedAt: null, dealerNotificationSentAt: null,
      }).where(eq(enquiriesTable.id, booking.id)).returning();
      return { booking: updated, changed: true };
    });
    if (!outcome) { res.status(404).json(errorResponse("Test drive not found.")); return; }
    if (outcome.changed) {
      await recordEnquiryEvent({ dealerId: outcome.booking.dealerId, enquiryId: outcome.booking.id, vehicleId: outcome.booking.vehicleId, vehicleTitle: outcome.booking.vehicleTitle, vehicleUrl: outcome.booking.vehicleUrl, kind: parsed.data.decision === "confirm" ? "viewing_booked" : "viewing_cancelled", actor: "dealer", summary: parsed.data.decision === "confirm" ? "Staff confirmed the test drive" : "Staff declined the test-drive request", detail: { decision: parsed.data.decision }, visitorId: outcome.booking.visitorId });
      try { outcome.booking = await deliverEnquiryNotifications(outcome.booking, req.log); } catch (error) { req.log.error({ err: error }, "Unable to deliver booking decision notification"); }
    }
    res.json(DecideTestDriveBookingResponse.parse(toEnquiryResponse(outcome.booking, { events: await eventsForEnquiry(outcome.booking.id) })));
  } catch (error) {
    if (error instanceof BookingConflict) { res.status(409).json(errorResponse(error.message)); return; }
    req.log.error({ err: error }, "Unable to decide test-drive booking");
    res.status(500).json(errorResponse("Unable to update this test drive."));
  }
});

export default router;
