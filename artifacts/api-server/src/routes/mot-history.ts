import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, vehiclesTable } from "@workspace/db";
import { vehicleRegistration } from "@workspace/vehicle-meta";
import { currentDealerId } from "../lib/tenant-context";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { MotError, normaliseMotRegistration } from "../lib/mot-history";
import { estimateMotMileage } from "../lib/mot-mileage-estimate";
import { motService, readCachedMot } from "../lib/mot-storage";
import { findPublicVehicle } from "./stock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function findStaffMotVehicle(id: string) {
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.id, id),
        eq(vehiclesTable.dealerId, currentDealerId()),
      ),
    );
  return vehicle ?? null;
}
export function motRouter(
  service = motService,
  publicVehicle = findPublicVehicle,
  staffVehicle = findStaffMotVehicle,
  cachedHistory = readCachedMot,
) {
  const router = Router(),
    limits = new Map<string, { until: number; count: number }>();
  const limit: import("express").RequestHandler = (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const key = `${currentDealerId()}:${req.ip}`,
      now = Date.now();
    let entry = limits.get(key);
    if (!entry || entry.until <= now) {
      if (limits.size >= 5000) limits.delete(limits.keys().next().value!);
      entry = { until: now + 60000, count: 0 };
      limits.set(key, entry);
    }
    if (++entry.count > 20) {
      res.set("Retry-After", "60");
      res.status(429).json({
        code: "busy",
        error: "Too many MOT checks. Please try again shortly.",
      });
      return;
    }
    next();
  };
  const fail = (res: import("express").Response, error: unknown) => {
    if (error instanceof MotError)
      res.status(error.status).json({ code: error.code, error: error.message });
    else
      res.status(503).json({
        code: "unavailable",
        error:
          "MOT history is temporarily unavailable. Please try again later.",
      });
  };
  const vehicleHandler =
    (
      find: typeof publicVehicle | typeof staffVehicle,
    ): import("express").RequestHandler =>
    async (req, res) => {
      try {
        const id = String(req.params.id);
        if (!UUID.test(id)) {
          res
            .status(400)
            .json({ code: "invalid_vehicle", error: "Invalid vehicle." });
          return;
        }
        const car = await find(id);
        if (!car) {
          res
            .status(404)
            .json({ code: "vehicle_not_found", error: "Vehicle not found." });
          return;
        }
        const registration = vehicleRegistration(car);
        if (!registration) {
          res.json({
            status: "registration_missing",
            message:
              "Ask the dealership for the registration to check MOT history.",
          });
          return;
        }
        if (req.query.cacheOnly === "true") {
          const history = await cachedHistory(
            normaliseMotRegistration(registration),
          );
          res.json(
            history ? { status: "available", history } : { status: "uncached" },
          );
          return;
        }
        res.json({
          status: "available",
          history: await service.lookup(registration),
        });
      } catch (error) {
        fail(res, error);
      }
    };
  // Public part-exchange forms receive an estimate only, never staff/customer data.
  router.get("/mot-mileage-estimate", limit, async (req, res) => {
    try {
      if (typeof req.query.registration !== "string")
        throw new MotError(
          "invalid_registration",
          "Enter a complete UK registration number.",
          400,
        );
      const registration = normaliseMotRegistration(req.query.registration);
      const history = await service.lookup(registration);
      const estimate = estimateMotMileage(history);
      const vehicle = { make: history.make, model: history.model };
      res.json(
        estimate
          ? { status: "estimated", registration, vehicle, estimate }
          : { status: "unavailable", registration, vehicle },
      );
    } catch (error) {
      fail(res, error);
    }
  });
  router.get("/vehicles/:id/mot-history", limit, vehicleHandler(publicVehicle));
  router.get(
    "/staff/vehicles/:id/mot-history",
    requireStaff,
    requirePermission("sales.manage"),
    limit,
    vehicleHandler(staffVehicle),
  );
  router.get(
    "/staff/mot-history",
    requireStaff,
    requirePermission("sales.manage"),
    limit,
    async (req, res) => {
      try {
        if (typeof req.query.registration !== "string")
          throw new MotError(
            "invalid_registration",
            "Enter a complete UK registration number.",
            400,
          );
        res.json({
          status: "available",
          history: await service.lookup(req.query.registration),
        });
      } catch (error) {
        fail(res, error);
      }
    },
  );
  return router;
}
export default motRouter();
