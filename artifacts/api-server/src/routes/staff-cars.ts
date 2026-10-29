import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, pool, vehiclesTable } from "@workspace/db";
import { requireStaff } from "../middlewares/staff-auth";
import { currentDealerId } from "../lib/tenant-context";
import { roleHasPermission } from "../lib/staff-permissions";
import { readStaffCars } from "../lib/staff-cars";
import { projectVehicles } from "./stock";
export function staffCarsRouter(read = readStaffCars) {
  const router = Router();
  router.use(
    "/staff/cars",
    (_req, res, next) => {
      res.set({
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      });
      next();
    },
    requireStaff,
  );
  router.get("/staff/cars", async (req, res) => {
    try {
      const dealerId = currentDealerId();
      const vehicles = await db
        .select()
        .from(vehiclesTable)
        .where(eq(vehiclesTable.dealerId, dealerId))
        .orderBy(desc(vehiclesTable.firstSeenAt));
      res.json(
        await read({
          dealerId,
          canManage: roleHasPermission(req.staff?.role, "sales.manage"),
          vehicles,
          project: projectVehicles,
          database: pool,
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Staff Cars read failed");
      res
        .status(503)
        .json({ error: "Cars could not be loaded. Please try again." });
    }
  });
  router.all("/staff/cars", (_req, res) => {
    res
      .set("Allow", "GET")
      .status(405)
      .json({
        error:
          "Cars are read-only here. Use the existing sale process to change availability.",
      });
  });
  return router;
}
export default staffCarsRouter();
