import { Router } from "express";
import { z } from "zod/v4";
import { DvlaVehicleCheckError, invalidDvlaRegistration, lookupDvlaVehicle } from "../lib/dvla-vehicle-check";
import { stockTaxRepository } from "../lib/stock-tax-checks";
import { currentDealerId, currentTenant } from "../lib/tenant-context";
import { requirePermission, requireStaff } from "../middlewares/staff-auth";

const path = "/staff/dvla/vehicle-check";
const stockChecksPath = "/staff/vehicles/tax-checks";
const input = z.object({ registration: z.string().max(20), vehicleId: z.uuid().optional() }).strict();

export function dvlaVehicleCheckRouter(
  lookup = lookupDvlaVehicle,
  taxChecks: Pick<typeof stockTaxRepository, "configured" | "discover" | "status" | "recordVehicleResult"> = stockTaxRepository,
) {
  const router = Router();
  router.use([path, stockChecksPath], (_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
    next();
  }, requireStaff);

  router.get(stockChecksPath, async (req, res) => {
    try {
      res.json(await taxChecks.status(currentDealerId()));
    } catch (error) {
      req.log?.warn({ err: error }, "Stock tax status could not be loaded");
      res.status(503).json({ error: "Stock tax checks could not be loaded. Try again." });
    }
  });

  router.post(stockChecksPath, requirePermission("sales.manage"), async (req, res) => {
    try {
      const dealerId = currentDealerId();
      if (taxChecks.configured() && !currentTenant()?.demo) await taxChecks.discover(dealerId, true);
      res.status(202).json(await taxChecks.status(dealerId));
    } catch (error) {
      req.log?.warn({ err: error }, "Stock tax checks could not be queued");
      res.status(503).json({ error: "Stock tax checks could not be started. Try again." });
    }
  });

  router.post(path, requirePermission("sales.manage"), async (req, res) => {
    try {
      const parsed = input.safeParse(req.body);
      if (!parsed.success) throw invalidDvlaRegistration();
      const { registration, vehicleId } = parsed.data;
      const details = await lookup(registration);
      if (vehicleId) {
        try {
          await taxChecks.recordVehicleResult(currentDealerId(), vehicleId, details);
        } catch {
          req.log?.warn("DVLA vehicle tax result could not be saved to stock");
        }
      }
      res.json(details);
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
