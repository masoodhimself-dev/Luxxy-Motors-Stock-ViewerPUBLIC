import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, notInArray, sql } from "drizzle-orm";
import {
  GetStockResponse,
  GetVehicleParams,
  GetVehicleResponse,
  ImportAutotraderStockBody,
  ImportAutotraderStockResponse,
} from "@workspace/api-zod";
import {
  db,
  LUXXY_AUTOTRADER_CONTEXT,
  stockImportRunsTable,
  vehicleChangesTable,
  vehicleImagesTable,
  vehiclesTable,
  type Vehicle,
} from "@workspace/db";
import { tenantStockRepository } from "../lib/tenant-stock-repository";

const router: IRouter = Router();
type Issue = { code: string; message: string; path: string | null; advertId: string | null };
type Import = typeof ImportAutotraderStockBody._output;

const envNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const config = () => ({
  dealerId: process.env.STOCK_DEALER_ID ?? "luxxy-motors",
  retailerId: process.env.STOCK_RETAILER_ID,
  maxAgeHours: envNumber("STOCK_MAX_AGE_HOURS", 24),
  maxDrop: envNumber("STOCK_MAX_DROP_PERCENT", 30),
  minPrice: envNumber("STOCK_MIN_PRICE", 500),
  maxPriceChange: envNumber("STOCK_MAX_PRICE_CHANGE_PERCENT", 50),
  missingHideThreshold: envNumber("STOCK_MISSING_HIDE_THRESHOLD", 2),
});
const compatibilityContext = (): typeof LUXXY_AUTOTRADER_CONTEXT => ({
  ...LUXXY_AUTOTRADER_CONTEXT,
  legacyDealerId: config().dealerId,
});
const issue = (code: string, message: string, path: string | null = null, advertId: string | null = null): Issue => ({ code, message, path, advertId });
/** Stable JSON for idempotency: JSONB does not preserve object insertion order. */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  if (typeof value === "undefined") return "null";
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const safeUrl = (value: string | null): value is string => {
  if (!value) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};
const validSecret = (provided: string | undefined): boolean => {
  const expected = process.env.STOCK_IMPORT_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
};

function semanticIssues(data: Import, settings: ReturnType<typeof config>): Issue[] {
  const problems: Issue[] = [];
  if (data.retailerId !== settings.retailerId) problems.push(issue("retailer_not_allowed", "Retailer is not allowed", "retailerId"));
  if (Date.now() - data.scrapedAt.getTime() > settings.maxAgeHours * 3_600_000 || data.scrapedAt.getTime() > Date.now() + 300_000)
    problems.push(issue("stale_snapshot", "Snapshot is outside the allowed freshness window", "scrapedAt"));
  if (data.count !== data.cars.length || data.expectedAdvertCount !== data.cars.length)
    problems.push(issue("count_mismatch", "count and expectedAdvertCount must equal cars.length"));
  const ids = new Set<string>();
  data.cars.forEach((car, index) => {
    if (!car.advertId.trim() || ids.has(car.advertId)) problems.push(issue("duplicate_advert_id", "advertId must be unique and nonempty", `cars.${index}.advertId`, car.advertId));
    ids.add(car.advertId);
    if (car.price != null && (car.price < 0 || car.price > 10_000_000)) problems.push(issue("price_out_of_range", "Price is out of range", `cars.${index}.price`, car.advertId));
    if (car.mileage != null && (car.mileage < 0 || car.mileage > 2_000_000)) problems.push(issue("mileage_out_of_range", "Mileage is out of range", `cars.${index}.mileage`, car.advertId));
    if (car.year != null && (car.year < 1900 || car.year > new Date().getFullYear() + 1)) problems.push(issue("year_out_of_range", "Year is out of range", `cars.${index}.year`, car.advertId));
    if (car.owners != null && !Number.isInteger(car.owners)) problems.push(issue("owners_invalid", "Owners must be an integer or null", `cars.${index}.owners`, car.advertId));
    if (car.writeOffCategory != null && !["S", "N"].includes(car.writeOffCategory)) problems.push(issue("write_off_invalid", "writeOffCategory must be S, N, or null", `cars.${index}.writeOffCategory`, car.advertId));
    car.images.forEach((image, imageIndex) => { if (!safeUrl(image.url)) problems.push(issue("image_url_invalid", "Image URLs must use https", `cars.${index}.images.${imageIndex}.url`, car.advertId)); });
    if (car.heroImage && !safeUrl(car.heroImage)) problems.push(issue("hero_url_invalid", "heroImage must use https", `cars.${index}.heroImage`, car.advertId));
  });
  return problems;
}

async function recordRejected(body: unknown, status: "failed" | "quarantined", problems: Issue[]): Promise<"stored" | "existing" | "conflict"> {
  const candidate = body as Record<string, unknown>;
  if (typeof candidate?.runId !== "string" || typeof candidate.retailerId !== "string" || typeof candidate.source !== "string") return "stored";
  const scrapedAt = new Date(typeof candidate.scrapedAt === "string" ? candidate.scrapedAt : "");
  if (Number.isNaN(scrapedAt.getTime())) return "stored";
  try {
    const [existing] = await db.select().from(stockImportRunsTable).where(eq(stockImportRunsTable.runId, candidate.runId));
    if (existing) return hash(existing.rawSnapshot) === hash(body) ? "existing" : "conflict";
    await db.insert(stockImportRunsTable).values({
      runId: candidate.runId, dealerId: config().dealerId,
      tenantDealerId: LUXXY_AUTOTRADER_CONTEXT.dealerId,
      dealerIntegrationId: LUXXY_AUTOTRADER_CONTEXT.dealerIntegrationId,
      retailerId: candidate.retailerId, source: candidate.source,
      schemaVersion: String(candidate.schemaVersion ?? "unknown"), scrapedAt, expectedCount: Number(candidate.expectedAdvertCount) || 0,
      receivedCount: Array.isArray(candidate.cars) ? candidate.cars.length : 0, complete: candidate.complete === true,
      status, failedAdvertIds: Array.isArray(candidate.failedAdvertIds) ? candidate.failedAdvertIds.filter((x): x is string => typeof x === "string") : [],
      errors: problems, rawSnapshot: body,
    }).onConflictDoNothing();
    return "stored";
  } catch { return "stored"; /* rejected imports must not mask the validation response */ }
}

const heroCaptionOrder = ["front right", "front", "front left", "side right", "side left", "rear right", "rear", "rear left"];
function normalizedImages(car: Import["cars"][number]) {
  const seen = new Set<string>();
  // Keep the first source occurrence: galleries occasionally repeat a URL.
  const images = car.images.filter((image) => safeUrl(image.url) && !seen.has(image.url) && (seen.add(image.url), true));
  const captionHero = heroCaptionOrder
    .map((caption) => images.find((image) => (image.caption ?? "").trim().toLowerCase() === caption))
    .find((image) => image !== undefined);
  const preferred = captionHero ?? (safeUrl(car.heroImage) ? { url: car.heroImage, caption: null } : images[0]);
  const all = preferred && !images.some((image) => image.url === preferred.url) ? [preferred, ...images] : images;
  return all.map((image, sortOrder) => ({ ...image, sortOrder, isHero: image.url === preferred?.url }));
}

function sourceValues(car: Import["cars"][number]) {
  return {
    title: car.title, variant: car.variant, make: car.make, model: car.model, trim: car.trim,
    year: car.year, priceType: car.priceType, currency: car.currency ?? "GBP", mileage: car.mileage,
    mileageText: car.mileageText, registration: car.registration, registrationBand: car.registrationBand,
    plate: car.plate, vrm: car.vrm, vrmVerified: car.vrmVerified ?? false, fuel: car.fuel,
    transmission: car.transmission, bodyType: car.bodyType, engineSize: car.engineSize, engineCC: car.engineCC,
    doors: car.doors, seats: car.seats, colour: car.colour, emissionClass: car.emissionClass, drivetrain: car.drivetrain,
    owners: car.owners == null ? null : Math.trunc(car.owners), writeOffCategory: car.writeOffCategory,
    advertUrl: car.advertUrl, dealerName: car.dealerName, dealerLocation: car.dealerLocation, imageCount: car.imageCount,
    sourceHeroImage: normalizedImages(car).find((image) => image.isHero)?.url ?? null, rawSourceData: car,
  };
}

async function syncImages(tx: any, vehicleId: string, car: Import["cars"][number], now: Date) {
  const incoming = normalizedImages(car);
  const old = await tx.select().from(vehicleImagesTable).where(and(eq(vehicleImagesTable.vehicleId, vehicleId), eq(vehicleImagesTable.origin, "source")));
  const before = old
    .filter((image: { isActive: boolean }) => image.isActive)
    .sort((a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder)
    .map((image: { sourceUrl: string; caption: string | null; sortOrder: number; isHero: boolean }) => ({
      url: image.sourceUrl, caption: image.caption, sortOrder: image.sortOrder, isHero: image.isHero,
    }));
  if (incoming.length) {
    await tx.insert(vehicleImagesTable).values(incoming.map((image) => ({
      vehicleId, tenantDealerId: LUXXY_AUTOTRADER_CONTEXT.dealerId,
      dealerIntegrationId: LUXXY_AUTOTRADER_CONTEXT.dealerIntegrationId,
      origin: "source" as const, sourceUrl: image.url, caption: image.caption,
      sortOrder: image.sortOrder, isHero: image.isHero, isActive: true, firstSeenAt: now, lastSeenAt: now,
    }))).onConflictDoUpdate({
      target: [vehicleImagesTable.vehicleId, vehicleImagesTable.sourceUrl],
      // Do not set firstSeenAt here; an upsert must retain the original sighting.
      set: {
        caption: sql`excluded.caption`,
        sortOrder: sql`excluded.sort_order`,
        isHero: sql`excluded.is_hero`,
        isActive: true,
        lastSeenAt: now,
      },
    });
  }
  const urls = incoming.map((image) => image.url);
  const absentImages = and(
    eq(vehicleImagesTable.vehicleId, vehicleId),
    eq(vehicleImagesTable.origin, "source"),
    eq(vehicleImagesTable.isActive, true),
    ...(urls.length ? [notInArray(vehicleImagesTable.sourceUrl, urls)] : []),
  );
  if (old.some((image: { isActive: boolean; sourceUrl: string }) => image.isActive && !urls.includes(image.sourceUrl))) {
    await tx.update(vehicleImagesTable).set({ isActive: false, isHero: false }).where(absentImages);
  }
  const after = incoming.map((image) => ({ url: image.url, caption: image.caption, sortOrder: image.sortOrder, isHero: image.isHero }));
  return { before, after };
}

router.post("/stock/imports/autotrader", async (req, res): Promise<void> => {
  if (!validSecret(req.get("x-stock-import-secret"))) {
    req.log.warn("Rejected unauthorized stock import");
    res.status(401).json({ status: "rejected", errors: [issue("unauthorized", "Invalid import secret")] }); return;
  }
  const settings = config();
  if (!settings.retailerId) {
    req.log.error("STOCK_RETAILER_ID is not configured");
    res.status(500).json({ status: "rejected", errors: [issue("configuration_error", "Stock import is not configured")] }); return;
  }
  const parsed = ImportAutotraderStockBody.safeParse(req.body);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((e) => issue("invalid_structure", e.message, e.path.join(".")));
    const recorded = await recordRejected(req.body, "failed", problems);
    if (recorded === "conflict") { res.status(409).json({ status: "rejected", errors: [issue("run_id_conflict", "runId was already used with a different payload")] }); return; }
    res.status(400).json({ status: "rejected", errors: problems }); return;
  }
  const data = parsed.data;
  const quarantineProblems: Issue[] = [];
  if (!data.complete) quarantineProblems.push(issue("incomplete_snapshot", "Snapshot must be complete"));
  if (data.count !== data.cars.length || data.expectedAdvertCount !== data.cars.length) quarantineProblems.push(issue("count_mismatch", "count and expectedAdvertCount must equal cars.length"));
  if (data.failedAdvertIds.length) quarantineProblems.push(issue("failed_adverts", "Snapshot contains failed advert IDs"));
  if (data.errors.length) quarantineProblems.push(issue("source_errors", "Snapshot contains source errors"));
  if (Date.now() - data.scrapedAt.getTime() > settings.maxAgeHours * 3_600_000 || data.scrapedAt.getTime() > Date.now() + 300_000)
    quarantineProblems.push(issue("stale_snapshot", "Snapshot is outside the allowed freshness window", "scrapedAt"));
  if (quarantineProblems.length) {
    const recorded = await recordRejected(req.body, "quarantined", quarantineProblems);
    if (recorded === "conflict") { res.status(409).json({ status: "rejected", errors: [issue("run_id_conflict", "runId was already used with a different payload")] }); return; }
    res.status(422).json({ status: "quarantined", errors: quarantineProblems }); return;
  }
  const problems = semanticIssues(data, settings).filter((problem) => problem.code !== "count_mismatch" && problem.code !== "stale_snapshot");
  if (problems.length) {
    const recorded = await recordRejected(req.body, "failed", problems);
    if (recorded === "conflict") { res.status(409).json({ status: "rejected", errors: [issue("run_id_conflict", "runId was already used with a different payload")] }); return; }
    res.status(400).json({ status: "rejected", errors: problems }); return;
  }
  const payloadHash = hash(req.body);
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock-autotrader-import'))`);
      const [prior] = await tx.select().from(stockImportRunsTable).where(eq(stockImportRunsTable.runId, data.runId));
      if (prior) {
        if (hash(prior.rawSnapshot) !== payloadHash) return { conflict: true as const };
        if (prior.status === "quarantined") return { priorQuarantined: true as const };
        if (prior.status !== "completed") return { conflict: true as const };
        return { replay: true as const, prior };
      }
       const current = await tx.select().from(vehiclesTable).where(and(
         eq(vehiclesTable.tenantDealerId, LUXXY_AUTOTRADER_CONTEXT.dealerId),
         eq(vehiclesTable.dealerId, settings.dealerId),
         eq(vehiclesTable.source, "autotrader"),
       ));
      const liveCount = current.filter((v) => v.sourceStatus === "live").length;
      if (liveCount && data.cars.length < liveCount * (1 - settings.maxDrop / 100)) {
        await tx.insert(stockImportRunsTable).values({ runId: data.runId, dealerId: settings.dealerId, tenantDealerId: LUXXY_AUTOTRADER_CONTEXT.dealerId, dealerIntegrationId: LUXXY_AUTOTRADER_CONTEXT.dealerIntegrationId, source: "autotrader", retailerId: data.retailerId, schemaVersion: "1", scrapedAt: data.scrapedAt, expectedCount: data.expectedAdvertCount, receivedCount: data.count, complete: data.complete, status: "quarantined", failedAdvertIds: [], errors: [issue("stock_drop", "Snapshot drop exceeds configured limit")], rawSnapshot: req.body });
        return { quarantined: true as const };
      }
      const [run] = await tx.insert(stockImportRunsTable).values({ runId: data.runId, dealerId: settings.dealerId, tenantDealerId: LUXXY_AUTOTRADER_CONTEXT.dealerId, dealerIntegrationId: LUXXY_AUTOTRADER_CONTEXT.dealerIntegrationId, source: "autotrader", retailerId: data.retailerId, schemaVersion: "1", scrapedAt: data.scrapedAt, expectedCount: data.expectedAdvertCount, receivedCount: data.count, complete: true, status: "processing", failedAdvertIds: [], errors: [], rawSnapshot: req.body }).returning();
      let created = 0, updated = 0, unchanged = 0, missing = 0;
      const now = new Date(), incomingIds = new Set(data.cars.map((car) => car.advertId));
      for (const car of data.cars) {
        const existing = current.find((vehicle) => vehicle.advertId === car.advertId);
        const values = sourceValues(car);
        const candidate = car.price == null ? null : Math.trunc(car.price);
        const suspicious = candidate != null && (candidate < settings.minPrice || (existing?.sourcePrice != null && Math.abs(candidate - existing.sourcePrice) / existing.sourcePrice * 100 > settings.maxPriceChange));
        const priceValues = suspicious ? { pendingSourcePrice: candidate, priceReviewRequired: true } : { sourcePrice: candidate, pendingSourcePrice: null, priceReviewRequired: false };
        if (!existing) {
          const [vehicle] = await tx.insert(vehiclesTable).values({ ...values, ...priceValues, importRunId: run.id, dealerId: settings.dealerId, tenantDealerId: LUXXY_AUTOTRADER_CONTEXT.dealerId, dealerIntegrationId: LUXXY_AUTOTRADER_CONTEXT.dealerIntegrationId, source: "autotrader", advertId: car.advertId, sourceStatus: "live", missingCount: 0, firstSeenAt: now, lastSeenAt: now }).returning();
          const imageChanges = await syncImages(tx, vehicle.id, car, now); created++;
          const changes = Object.entries({ ...values, ...priceValues })
            .filter(([, newValue]) => newValue !== null && newValue !== undefined)
            .map(([fieldName, newValue]) => ({ vehicleId: vehicle.id, importRunId: run.id, tenantDealerId: LUXXY_AUTOTRADER_CONTEXT.dealerId, dealerIntegrationId: LUXXY_AUTOTRADER_CONTEXT.dealerIntegrationId, fieldName, oldValue: null as unknown, newValue }));
          if (imageChanges.after.length) changes.push({ vehicleId: vehicle.id, importRunId: run.id, tenantDealerId: LUXXY_AUTOTRADER_CONTEXT.dealerId, dealerIntegrationId: LUXXY_AUTOTRADER_CONTEXT.dealerIntegrationId, fieldName: "sourceImages", oldValue: [], newValue: imageChanges.after });
          if (changes.length) await tx.insert(vehicleChangesTable).values(changes);
        } else {
          const databaseChanges: Record<string, unknown> = {};
          for (const [key, value] of Object.entries({ ...values, ...priceValues })) if (canonicalJson((existing as any)[key]) !== canonicalJson(value)) databaseChanges[key] = value;
          const imageChanges = await syncImages(tx, existing.id, car, now);
          const auditChanges: Record<string, { oldValue: unknown; newValue: unknown }> = {};
          for (const [fieldName, newValue] of Object.entries(databaseChanges)) {
            auditChanges[fieldName] = { oldValue: (existing as any)[fieldName] ?? null, newValue };
          }
          if (canonicalJson(imageChanges.before) !== canonicalJson(imageChanges.after)) {
            auditChanges.sourceImages = { oldValue: imageChanges.before, newValue: imageChanges.after };
          }
          const preserveMissingState = existing.inventoryStatus === "sold" || existing.inventoryStatus === "archived";
          await tx.update(vehiclesTable).set({
            ...databaseChanges, importRunId: run.id, lastSeenAt: now,
            ...(preserveMissingState ? {} : { sourceStatus: "live", missingCount: 0 }),
          }).where(eq(vehiclesTable.id, existing.id));
          const changes = Object.entries(auditChanges).map(([fieldName, change]) => ({
            vehicleId: existing.id, importRunId: run.id, tenantDealerId: LUXXY_AUTOTRADER_CONTEXT.dealerId, dealerIntegrationId: LUXXY_AUTOTRADER_CONTEXT.dealerIntegrationId, fieldName, oldValue: change.oldValue, newValue: change.newValue,
          }));
          if (changes.length) await tx.insert(vehicleChangesTable).values(changes);
          Object.keys(auditChanges).length ? updated++ : unchanged++;
        }
      }
      for (const vehicle of current) if (!incomingIds.has(vehicle.advertId)) {
        await tx.update(vehiclesTable).set({ sourceStatus: "missing", missingCount: vehicle.missingCount + 1, importRunId: run.id }).where(eq(vehiclesTable.id, vehicle.id)); missing++;
      }
      await tx.update(stockImportRunsTable).set({ status: "completed", addedCount: created, changedCount: updated, missingCount: missing }).where(eq(stockImportRunsTable.id, run.id));
      return { created, updated, unchanged, missing };
    });
    if ("conflict" in result) { res.status(409).json({ status: "rejected", errors: [issue("run_id_conflict", "runId was already used with a different payload")] }); return; }
    if ("priorQuarantined" in result) { res.status(422).json({ status: "quarantined", errors: [issue("previously_quarantined", "This import run was previously quarantined")] }); return; }
    if ("quarantined" in result) { res.status(422).json({ status: "quarantined", errors: [issue("stock_drop", "Snapshot drop exceeds configured limit")] }); return; }
    const replayed = result.replay === true;
    const replayUnchanged = replayed ? Math.max(0, data.cars.length - result.prior!.addedCount - result.prior!.changedCount) : result.unchanged;
    const reply = ImportAutotraderStockResponse.parse({ schemaVersion: 1, status: replayed ? "replayed" : "imported", runId: data.runId, source: "autotrader", retailerId: data.retailerId, received: data.cars.length, created: replayed ? result.prior!.addedCount : result.created, updated: replayed ? result.prior!.changedCount : result.updated, deleted: 0, unchanged: replayUnchanged, errors: [] });
    res.status(replayed ? 200 : 201).json(reply);
  } catch (error) {
    req.log.error({ err: error }, "Stock import failed");
    res.status(500).json({ status: "rejected", errors: [issue("unexpected_error", "Unable to import stock")] });
  }
});

async function projectVehicles(vehicles: Vehicle[]) {
  const ids = vehicles.map((vehicle) => vehicle.id);
  const images = await tenantStockRepository(compatibilityContext()).activeImages(ids);
  return vehicles.map((vehicle) => {
    const vehicleImages = images.filter((image) => image.vehicleId === vehicle.id).map((image) => ({ url: image.sourceUrl, caption: image.caption }));
    const hero = vehicle.websiteHeroImageOverride ?? images.find((image) => image.vehicleId === vehicle.id && image.isHero)?.sourceUrl ?? null;
    const raw = vehicle.rawSourceData;
    const imported = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    const specifications = imported?.specifications;
    const sourceExtras = imported?.sourceExtras;
    return { id: vehicle.id, advertId: vehicle.advertId, title: vehicle.websiteTitleOverride ?? vehicle.title, variant: vehicle.variant, make: vehicle.make, model: vehicle.model, trim: vehicle.trim, year: vehicle.year, price: vehicle.websitePriceOverride ?? vehicle.sourcePrice, priceType: vehicle.priceType, currency: vehicle.currency, mileage: vehicle.mileage, mileageText: vehicle.mileageText, registration: vehicle.registration, registrationBand: vehicle.registrationBand, plate: vehicle.plate, vrm: vehicle.vrm, vrmVerified: vehicle.vrmVerified, fuel: vehicle.fuel, transmission: vehicle.transmission, bodyType: vehicle.bodyType, engineSize: vehicle.engineSize, engineCC: vehicle.engineCC, doors: vehicle.doors, seats: vehicle.seats, colour: vehicle.colour, emissionClass: vehicle.emissionClass, drivetrain: vehicle.drivetrain, owners: vehicle.owners, writeOffCategory: vehicle.writeOffCategory, advertUrl: vehicle.advertUrl, dealerName: vehicle.dealerName, dealerLocation: vehicle.dealerLocation, imageCount: vehicle.imageCount, heroImage: hero, images: vehicleImages, specifications: specifications !== null && typeof specifications === "object" && !Array.isArray(specifications) ? specifications : null, sourceExtras: sourceExtras !== null && typeof sourceExtras === "object" && !Array.isArray(sourceExtras) ? sourceExtras : null };
  });
}
function visible(vehicle: Vehicle, settings: ReturnType<typeof config>) {
  return ["available", "reserved"].includes(vehicle.inventoryStatus) && vehicle.missingCount < settings.missingHideThreshold && !(vehicle.priceReviewRequired && vehicle.sourcePrice == null && vehicle.websitePriceOverride == null);
}
router.get("/stock", async (req, res): Promise<void> => {
  const settings = config();
  const repository = tenantStockRepository(compatibilityContext());
  const all = await repository.listVehicles();
  const cars = await projectVehicles(all.filter((vehicle) => visible(vehicle, settings)));
  const [latest] = await repository.latestCompletedRun();
  const snapshot = latest?.rawSnapshot as { dealerName?: unknown } | undefined;
  res.json(GetStockResponse.parse({ schemaVersion: 1, dealerName: typeof snapshot?.dealerName === "string" ? snapshot.dealerName : null, dealerLocation: cars[0]?.dealerLocation ?? null, count: cars.length, scrapedAt: latest?.scrapedAt ?? null, cars }));
});
router.get("/vehicles/:id", async (req, res): Promise<void> => {
  const parsed = GetVehicleParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid vehicle id" }); return; }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.data.id)) {
    res.status(400).json({ error: "Invalid vehicle id" }); return;
  }
  const [vehicle] = await tenantStockRepository(compatibilityContext()).findVehicle(parsed.data.id);
  if (!vehicle || !visible(vehicle, config())) { res.status(404).json({ error: "Vehicle not found" }); return; }
  const [projected] = await projectVehicles([vehicle]);
  res.json(GetVehicleResponse.parse(projected));
});
router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  req.log.error({ err: error }, "Stock route failed");
  if (!res.headersSent) res.status(500).json({ status: "rejected", errors: [issue("unexpected_error", "Unable to process stock request")] });
});
export default router;