import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import {
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
  type Vehicle,
} from "@workspace/db";

const router: IRouter = Router();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bookingTimezone = "Europe/London";
const bookingStartHour = 10;
const bookingEndHour = 18;
const slotMinutes = 30;
const bookingWindowDays = 30;

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

function datePartsInTimezone(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: bookingTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function dateStringInTimezone(value: Date) {
  const parts = datePartsInTimezone(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function bookingDateIsInWindow(dateValue: string) {
  const today = dateStringInTimezone(new Date());
  return dateValue >= today && dateValue <= addDays(today, bookingWindowDays);
}

function localDateTimeToUtc(dateValue: string, hour: number, minute: number) {
  const rough = new Date(
    `${dateValue}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  );
  const parts = datePartsInTimezone(rough);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMinutes = (localAsUtc - rough.getTime()) / 60000;
  return new Date(rough.getTime() - offsetMinutes * 60000);
}

function formatSlotLabel(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: bookingTimezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

function getSlotsForDate(dateValue: string) {
  const weekday = new Date(`${dateValue}T00:00:00.000Z`).getUTCDay();
  if (weekday === 0) return [];
  const slots: Array<{ startAt: Date; label: string }> = [];
  for (let minutes = bookingStartHour * 60; minutes < bookingEndHour * 60; minutes += slotMinutes) {
    const startAt = localDateTimeToUtc(dateValue, Math.floor(minutes / 60), minutes % 60);
    slots.push({ startAt, label: formatSlotLabel(startAt) });
  }
  return slots;
}

function validBookingDateTime(value: string) {
  const appointmentAt = new Date(value);
  if (Number.isNaN(appointmentAt.getTime()) || appointmentAt.getTime() <= Date.now()) {
    return false;
  }
  const parts = datePartsInTimezone(appointmentAt);
  const dateValue = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  if (!bookingDateIsInWindow(dateValue) || parts.second !== 0) return false;
  return getSlotsForDate(dateValue).some(
    (slot) => slot.startAt.getTime() === appointmentAt.getTime(),
  );
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505",
  );
}

router.get("/enquiries", async (req, res): Promise<void> => {
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
    res.json(GetEnquiriesResponse.parse(enquiries));
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
  if (!isValidDateString(date) || !bookingDateIsInWindow(date)) {
    res.status(400).json(errorResponse("Choose a date within the next 30 days."));
    return;
  }

  try {
    const allSlots = getSlotsForDate(date);
    const dayStart = localDateTimeToUtc(date, 0, 0);
    const nextDay = addDays(date, 1);
    const dayEnd = localDateTimeToUtc(nextDay, 0, 0);
    const booked = await db
      .select({ appointmentAt: enquiriesTable.appointmentAt })
      .from(enquiriesTable)
      .where(
        and(
          eq(enquiriesTable.dealerId, settings().dealerId),
          eq(enquiriesTable.type, "viewing"),
          gte(enquiriesTable.appointmentAt, dayStart),
          lt(enquiriesTable.appointmentAt, dayEnd),
        ),
      );
    const bookedTimes = new Set(
      booked
        .map((entry) => entry.appointmentAt?.getTime())
        .filter((value): value is number => value != null),
    );
    const now = Date.now();
    res.json(
      GetEnquiryAvailabilityResponse.parse({
        date,
        timezone: bookingTimezone,
        slots: allSlots.map((slot) => ({
          startAt: slot.startAt.toISOString(),
          label: slot.label,
          available: slot.startAt.getTime() > now && !bookedTimes.has(slot.startAt.getTime()),
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
  if (!input.email && !input.phone) {
    res.status(400).json(errorResponse("Please provide an email address or phone number."));
    return;
  }
  if (input.email && !validEmail(input.email)) {
    res.status(400).json(errorResponse("Please provide a valid email address."));
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
  if (input.appointmentAt && !validBookingDateTime(input.appointmentAt)) {
    res.status(400).json(errorResponse("That viewing slot is no longer available."));
    return;
  }
  if (input.vehicleId && !uuidPattern.test(input.vehicleId)) {
    res.status(400).json(errorResponse("The selected vehicle is invalid."));
    return;
  }

  try {
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

    const [created] = await db
      .insert(enquiriesTable)
      .values({
        dealerId: settings().dealerId,
        vehicleId: vehicle?.id ?? null,
        vehicleTitle: vehicle
          ? vehicle.websiteTitleOverride ?? vehicle.title
          : null,
        vehicleRegistration: vehicle
          ? vehicle.registration ?? vehicle.plate ?? vehicle.vrm
          : null,
        vehiclePrice: vehicle
          ? vehicle.websitePriceOverride ?? vehicle.sourcePrice
          : null,
        vehicleUrl: vehicle ? `/vehicle/${vehicle.id}` : null,
        type: input.type,
        customerName: input.customerName.trim(),
        email: input.email?.trim().toLowerCase() ?? null,
        phone: input.phone?.trim() ?? null,
        preferredContact: input.preferredContact ?? null,
        message: input.message.trim(),
         appointmentAt: input.appointmentAt ? new Date(input.appointmentAt) : null,
        source: "website",
      })
      .returning();

    res.status(201).json(CreateEnquiryResponse.parse(created));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json(errorResponse("That viewing slot has just been booked. Please choose another."));
      return;
    }
    req.log.error({ err: error }, "Unable to create enquiry");
    res.status(500).json(errorResponse("Unable to save your enquiry. Please try again."));
  }
});

router.patch("/enquiries/:id/status", async (req, res): Promise<void> => {
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
    res.json(UpdateEnquiryStatusResponse.parse(updated));
  } catch (error) {
    req.log.error({ err: error }, "Unable to update enquiry status");
    res.status(500).json(errorResponse("Unable to update enquiry status."));
  }
});

export default router;