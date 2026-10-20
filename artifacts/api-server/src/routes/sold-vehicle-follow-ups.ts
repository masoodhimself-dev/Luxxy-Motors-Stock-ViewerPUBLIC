import { Router } from "express";
import { z } from "zod/v4";
import {
  requirePermission,
  requireStaff,
  staffLabel,
} from "../middlewares/staff-auth";
import { currentDealerId } from "../lib/tenant-context";
import {
  actOnSoldVehicleCustomer,
  readSoldVehicleFollowUp,
  readSoldVehicleFollowUps,
  SoldVehicleFollowUpError,
} from "../lib/sold-vehicle-follow-ups";
const router = Router(),
  uuid = z.uuid();
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("cancel_appointment"),
      expectedRevision: z.number().int().nonnegative(),
      expectedAppointmentRevision: z.number().int().nonnegative().optional(),
      expectedAppointments: z
        .array(
          z
            .object({
              enquiryId: z.uuid(),
              expectedRevision: z.number().int().nonnegative(),
            })
            .strict(),
        )
        .min(1)
        .max(100)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete"),
      expectedRevision: z.number().int().nonnegative(),
      outcome: z.enum(["phone", "email", "not_needed"]),
      note: z.string().trim().max(2000).optional(),
      emailId: z.uuid().optional(),
    })
    .strict(),
]);
function failed(
  req: import("express").Request,
  res: import("express").Response,
  error: unknown,
) {
  if (error instanceof SoldVehicleFollowUpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  req.log.error({ err: error }, "Sold vehicle customer review failed");
  res
    .status(503)
    .json({
      error:
        "Customer follow-ups could not be loaded or saved. Try again shortly.",
    });
}
router.get("/staff/sold-vehicle-follow-ups", requireStaff, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await readSoldVehicleFollowUps(currentDealerId()));
  } catch (error) {
    failed(req, res, error);
  }
});
router.get(
  "/staff/sold-vehicle-follow-ups/:saleId",
  requireStaff,
  async (req, res) => {
    if (!uuid.safeParse(req.params.saleId).success) {
      res.status(404).json({ error: "Sale not found." });
      return;
    }
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await readSoldVehicleFollowUp(
          currentDealerId(),
          String(req.params.saleId),
        ),
      );
    } catch (error) {
      failed(req, res, error);
    }
  },
);
router.post(
  "/staff/sold-vehicle-follow-ups/:saleId/customers/:enquiryId",
  requireStaff,
  requirePermission("sales.manage"),
  async (req, res) => {
    const parsed = input.safeParse(req.body);
    if (
      !uuid.safeParse(req.params.saleId).success ||
      !uuid.safeParse(req.params.enquiryId).success
    ) {
      res.status(404).json({ error: "Customer follow-up not found." });
      return;
    }
    if (!parsed.success) {
      res
        .status(400)
        .json({
          error: "Refresh the customer review and check the selected action.",
          details: parsed.error.issues,
        });
      return;
    }
    try {
      res.json(
        await actOnSoldVehicleCustomer(
          currentDealerId(),
          String(req.params.saleId),
          String(req.params.enquiryId),
          parsed.data,
          staffLabel(req),
        ),
      );
    } catch (error) {
      failed(req, res, error);
    }
  },
);
export default router;
