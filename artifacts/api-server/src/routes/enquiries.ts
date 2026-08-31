import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateEnquiryBody,
  CreateEnquiryResponse,
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
        source: "website",
      })
      .returning();

    res.status(201).json(CreateEnquiryResponse.parse(created));
  } catch (error) {
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