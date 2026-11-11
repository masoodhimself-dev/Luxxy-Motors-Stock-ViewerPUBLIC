import { Router } from "express";
import { z } from "zod/v4";
import { DvlaVehicleCheckError, invalidDvlaRegistration, lookupDvlaVehicle } from "../lib/dvla-vehicle-check";
import { requirePermission, requireStaff } from "../middlewares/staff-auth";

const path = "/staff/dvla/vehicle-check";
const input = z.object({ registration: z.string().max(20) }).strict();

export function dvlaVehicleCheckRouter(lookup = lookupDvlaVehicle) {
  const router = Router();
  router.post(path, (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  }, requireStaff, requirePermission("sales.manage"), async (req, res) => {
    try {
      const parsed = input.safeParse(req.body);
      if (!parsed.success) throw invalidDvlaRegistration();
      res.json(await lookup(parsed.data.registration));
    } catch (error) {
      if (error instanceof DvlaVehicleCheckError) {
        if (error.retryAfter) res.set("Retry-After", String(error.retryAfter));
        res.status(error.status).json({ code: error.code, error: error.message });
        return;
      }
      res.status(503).json({ code: "unavailable", error: "DVLA vehicle checks are temporarily unavailable. Try again later." });
    }
  });
  return router;
}

export default dvlaVehicleCheckRouter();
