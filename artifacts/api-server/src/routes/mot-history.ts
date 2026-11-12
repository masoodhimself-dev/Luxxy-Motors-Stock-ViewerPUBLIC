import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, vehiclesTable } from "@workspace/db";
import { vehicleRegistration } from "@workspace/vehicle-meta";
import { currentDealerId } from "../lib/tenant-context";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { MotError, normaliseMotRegistration } from "../lib/mot-history";
import { DvlaVehicleCheckError, lookupDvlaVehicle } from "../lib/dvla-vehicle-check";
import { estimateMotMileage } from "../lib/mot-mileage-estimate";
import { motVehicleDetails } from "../lib/mot-vehicle-details";
import { motService, readCachedMot } from "../lib/mot-storage";
import { findPublicVehicle } from "./stock";
import { stockMotRepository } from "../lib/mot-stock-checks";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const partExchangeInput = z.object({
  registration: z.string().max(20),
  source: z.enum(["both", "dvla", "dvsa"]).default("both"),
}).strict();

function partExchangeLookupFailure(error: unknown) {
  const code = error instanceof MotError || error instanceof DvlaVehicleCheckError
    ? error.code
    : "unavailable";
  return { status: code === "invalid_registration" ? "unavailable" : code };
}

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
  stockChecks = stockMotRepository,
  dvlaLookup = lookupDvlaVehicle,
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
  // Durable stock work is staff-only and returns immediately. The server worker owns provider calls.
  router.get(
    "/staff/vehicles/mot-checks",
    requireStaff,
    requirePermission("sales.manage"),
    async (_req, res) => {
      res.set("Cache-Control", "no-store");
      try {
        res.json(await stockChecks.status(currentDealerId()));
      } catch (error) {
        fail(res, error);
      }
    },
  );
  router.post(
    "/staff/vehicles/mot-checks",
    requireStaff,
    requirePermission("sales.manage"),
    limit,
    async (_req, res) => {
      try {
        res.status(202).json(await stockChecks.start(currentDealerId()));
      } catch (error) {
        fail(res, error);
      }
    },
  );
  // Public vehicle facts and estimate share one cached lookup; no VIN/defects/customer data.
  router.get("/mot-mileage-estimate", limit, async (req, res) => {
    try {
      if (typeof req.query.registration !== "string")
        throw new MotError(
          "invalid_registration",
          "Enter a complete UK registration number.",
          400,
        );
      const registration = normaliseMotRegistration(req.query.registration);
      if (req.query.identity === "dvla") {
        const [dvla, dvsa] = await Promise.allSettled([
          dvlaLookup(registration),
          service.lookup(registration),
        ]);
        if (dvla.status === "rejected") {
          const error = dvla.reason;
          res.status(error instanceof DvlaVehicleCheckError ? error.status : 503)
            .json({ error: "We couldn’t find your vehicle through DVLA. Check the registration and try again." });
          return;
        }
        const details = dvsa.status === "fulfilled" ? motVehicleDetails(dvsa.value) : null;
        res.set("Cache-Control", "no-store");
        res.json({ status: "unavailable", registration, vehicle: {
          make: dvla.value.make ?? null,
          model: details?.vehicle.model ?? null,
          registrationDate: details?.vehicle.registrationDate ?? null,
          year: dvla.value.yearOfManufacture,
          colour: dvla.value.colour,
          fuel: dvla.value.fuelType,
        }, mot: details?.mot ?? null });
        return;
      }
      const history = await service.lookup(registration);
      const estimate = estimateMotMileage(history);
      const details = motVehicleDetails(history);
      res.json(
        estimate
          ? { status: "estimated", registration, ...details, estimate }
          : { status: "unavailable", registration, ...details },
      );
    } catch (error) {
      fail(res, error);
    }
  });
  router.get("/vehicles/:id/mot-history", limit, vehicleHandler(publicVehicle));
  router.post(
    "/staff/part-exchange/check",
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    requireStaff,
    requirePermission("sales.manage"),
    limit,
    async (req, res) => {
      const input = partExchangeInput.safeParse(req.body);
      if (!input.success) {
        res.status(400).json({
          code: "invalid_request",
          error: "Enter a complete UK registration and choose a valid check.",
        });
        return;
      }
      let registration: string;
      try {
        registration = normaliseMotRegistration(input.data.registration);
      } catch (error) {
        fail(res, error);
        return;
      }
      const { source } = input.data;
      const [dvla, dvsa] = await Promise.all([
        source === "dvsa" ? undefined : dvlaLookup(registration)
            .then((details) => ({ status: "available", details }))
            .catch(partExchangeLookupFailure),
        source === "dvla" ? undefined : service.lookup(registration)
            .then((history) => ({
              status: "available",
              history,
              estimate: estimateMotMileage(history),
            }))
            .catch(partExchangeLookupFailure),
      ]);
      res.json({ registration, dvla, dvsa });
    },
  );
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
