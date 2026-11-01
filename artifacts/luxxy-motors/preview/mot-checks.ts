import type { IncomingMessage, ServerResponse } from "node:http";
import { isUKNumberPlate, vehicleRegistration, type VehicleRegistrationSource, type MotHistory, type StaffMotCheckStatus } from "@workspace/vehicle-meta";
import { previewStock } from "./stock";

type PreviewCar = VehicleRegistrationSource & { id: string; make?: string | null; model?: string | null; mileage?: number | null; inventoryStatus?: string | null; sourceStatus?: string | null };

/** Development-only demonstration. No DVSA request, database, stock import or customer write. */
export function createPreviewMotChecks(cars: readonly PreviewCar[], now = Date.now) {
  let started: number | null = null;
  const histories = new Map<string, MotHistory>();
  const current = () => cars.filter(car => !["sold", "hidden", "archived"].includes(car.inventoryStatus ?? "available") && car.sourceStatus !== "missing");
  const registration = (car: PreviewCar) => {
    const value = vehicleRegistration(car).replace(/[\s-]/g, "").toUpperCase();
    return isUKNumberPlate(value) ? value : null;
  };
  function advance() {
    if (started === null) return;
    const eligible = current().filter(car => registration(car));
    const processed = Math.min(eligible.length, Math.floor((now() - started) / 700));
    for (let i = 0; i < processed; i++) {
      const car = eligible[i]!;
      if (histories.has(car.id)) continue;
      const completed = new Date(now() - 180 * 86400000).toISOString();
      const expiry = new Date(now() + (i === 0 ? -10 : i === 1 ? 45 : 300) * 86400000).toISOString().slice(0, 10);
      histories.set(car.id, {
        registration: registration(car)!, make: car.make ?? null, model: car.model ?? null,
        checkedAt: new Date(now()).toISOString(), recall: "Unknown",
        tests: [{ completedDate: completed, result: "PASSED", expiryDate: expiry,
          mileage: String(car.mileage ?? 50000), mileageUnit: "MI", defects: [] }],
      });
    }
  }
  function status(start = false): StaffMotCheckStatus & { preview: true } {
    advance();
    const stock = current(), missing = stock.filter(car => !registration(car)).length;
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

export const previewMotChecks = createPreviewMotChecks(previewStock.cars);
export async function motChecksPreview(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname !== "/api/staff/vehicles/mot-checks") return false;
  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    res.end(JSON.stringify({ error: "Use Check all MOTs to run the local preview." }));
    return true;
  }
  res.statusCode = req.method === "POST" ? 202 : 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(previewMotChecks.status(req.method === "POST")));
  return true;
}
