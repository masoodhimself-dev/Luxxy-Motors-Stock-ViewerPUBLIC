import type { IncomingMessage, ServerResponse } from "node:http";
import { isUKNumberPlate, vehicleRegistration, type VehicleRegistrationSource, type MotHistory, type StaffMotCheckStatus } from "@workspace/vehicle-meta";
import { previewStock } from "./stock";

type PreviewCar = VehicleRegistrationSource & { id: string; make?: string | null; model?: string | null; mileage?: number | null; inventoryStatus?: string | null; sourceStatus?: string | null };

function isCurrentPreviewCar(car: PreviewCar) {
  return car.sourceStatus !== "missing" && ["available", "reserved"].includes(car.inventoryStatus ?? "available");
}

function previewRegistration(car: PreviewCar) {
  const value = vehicleRegistration(car).replace(/[\s-]/g, "").toUpperCase();
  return isUKNumberPlate(value) ? value : null;
}

/** Development-only demonstration. No DVSA request, database, stock import or customer write. */
export function createPreviewMotChecks(cars: readonly PreviewCar[], now = Date.now) {
  let started: number | null = null;
  const histories = new Map<string, MotHistory>();
  const current = () => cars.filter(isCurrentPreviewCar);
  function advance() {
    if (started === null) return;
    const eligible = current().filter(car => previewRegistration(car));
    const processed = Math.min(eligible.length, Math.floor((now() - started) / 700));
    for (let i = 0; i < processed; i++) {
      const car = eligible[i]!;
      if (histories.has(car.id)) continue;
      const completed = new Date(now() - 180 * 86400000).toISOString();
      const expiry = new Date(now() + (i === 0 ? -10 : i === 1 ? 45 : 300) * 86400000).toISOString().slice(0, 10);
      histories.set(car.id, {
        registration: previewRegistration(car)!, make: car.make ?? null, model: car.model ?? null,
        checkedAt: new Date(now()).toISOString(), recall: "Unknown",
        tests: [{ completedDate: completed, result: "PASSED", expiryDate: expiry,
          mileage: String(car.mileage ?? 50000), mileageUnit: "MI", defects: [] }],
      });
    }
  }
  function status(start = false): StaffMotCheckStatus & { preview: true } {
    advance();
    const stock = current(), missing = stock.filter(car => !previewRegistration(car)).length;
    const checked = stock.filter(car => histories.has(car.id)).length;
    if (start && started === null) started = now();
    const pending = started === null ? 0 : stock.length - missing - checked;
    return {
      configured: true, automatic: true, preview: true,
      current: { total: stock.length, checked, needsCheck: stock.length - missing - checked, pending, failed: 0, missingRegistration: missing },
      run: started === null ? null : {
        id: "local-preview-mot-run", status: pending ? "running" : "completed",
        total: stock.length, checked, failed: 0, skipped: missing, pending,
        startedAt: new Date(started).toISOString(), finishedAt: pending ? null : new Date(started + (stock.length - missing) * 700).toISOString(),
      },
    };
  }
  return { status, history(id: string) { advance(); return histories.get(id) ?? null; } };
}

function sendPreviewMot(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
  return true;
}

export function createMotChecksPreview(cars: readonly PreviewCar[], checks = createPreviewMotChecks(cars)) {
  return (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const vehicle = /^\/api\/vehicles\/([^/]+)\/mot-history$/.exec(url.pathname);
    if (req.method === "GET" && vehicle) {
      const car = cars.find(car => car.id === vehicle[1] && isCurrentPreviewCar(car));
      if (!car) return false;
      if (!previewRegistration(car)) {
        return sendPreviewMot(res, 200, { status: "registration_missing", message: "Ask the dealership for the registration to check MOT history." });
      }
      const history = checks.history(car.id);
      if (history) return sendPreviewMot(res, 200, { status: "available", history });
      if (url.searchParams.get("cacheOnly") === "true") return sendPreviewMot(res, 200, { status: "uncached" });
      return sendPreviewMot(res, 503, { code: "unavailable", error: "No sample MOT history is available. Run Check all MOTs in the local portal first." });
    }
    if (url.pathname !== "/api/staff/vehicles/mot-checks") return false;
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return sendPreviewMot(res, 405, { error: "Use Check all MOTs to run the local preview." });
    }
    const start = req.method === "POST";
    return sendPreviewMot(res, start ? 202 : 200, checks.status(start));
  };
}

export const previewMotChecks = createPreviewMotChecks(previewStock.cars);
export const motChecksPreview = createMotChecksPreview(previewStock.cars, previewMotChecks);
