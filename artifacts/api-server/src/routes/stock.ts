import { publicPriceReductions, recordMissingStockTasks, recordPublishedStockPrice, resolveReappearedStockTasks } from '../lib/stock-change-tasks';
import { descriptionDisclosures, descriptionMetadata, taxDescription, publishedDescription, retainedOriginals } from '../lib/vehicle-descriptions';
import { and as tenantAnd, eq as tenantEq } from "drizzle-orm";
import { matchesImportSecret } from "../middlewares/tenant";
import { currentDealerId, currentTenant, multiTenantEnabled } from "../lib/tenant-context";
import { stockPlatformIssues } from "../lib/stock-platform";
import { importAdmission } from '../lib/stock-import-admission';
import { stockDescriptionExtras } from "@workspace/vehicle-meta";
import { dealerIntegrationsStore } from "../lib/dealer-integrations-store";
import { stockSourceData, projectedStockSourceData } from "../lib/stock-source-data";
import { timingSafeEqual } from "node:crypto";
import { canonicalJson, stockPayloadHash as hash, retainedStockPayloadHash } from "../lib/stock-payload-hash";
import { sendConditionalStock } from '../lib/stock-http-cache';
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, or, desc, eq, inArray, notInArray, isNull, isNotNull, lt, sql } from "drizzle-orm";
import {
  GetStockResponse,
  GetVehicleParams,
  GetVehicleResponse,
  ImportAutotraderStockBody,
  ImportAutotraderStockResponse,
  ImportGrokStockBody,
  ImportGrokStockResponse,
} from "@workspace/api-zod";
import {
  db,
  stockImportRunsTable,
  vehicleChangesTable,
  vehicleImagesTable,
  vehiclesTable,
  type Vehicle,
  type VehicleImage,
} from "@workspace/db";

const router: IRouter = Router();
type Issue = { code: string; message: string; path: string | null; advertId: string | null };
type Import = typeof ImportAutotraderStockBody._output;
type ImportSource = "autotrader" | "grok";

const envNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const config = async (transaction?: unknown) => { const { connection } = await dealerIntegrationsStore.readStockConnection(transaction); return ({
  dealerId: currentDealerId(),
  retailerId: connection.retailerId,
  platform: connection.platform,
  enabled: connection.enabled,
  maxAgeHours: envNumber("STOCK_MAX_AGE_HOURS", 24),
  maxDrop: envNumber("STOCK_MAX_DROP_PERCENT", 30),
  minPrice: envNumber("STOCK_MIN_PRICE", 500),
  maxPriceChange: envNumber("STOCK_MAX_PRICE_CHANGE_PERCENT", 50),
  missingHideThreshold: envNumber("STOCK_MISSING_HIDE_THRESHOLD", 2),
}); };
const issue = (code: string, message: string, path: string | null = null, advertId: string | null = null): Issue => ({ code, message, path, advertId });
const safeUrl = (value: string | null): value is string => {
  if (!value) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};
const validSecret = (provided: string | undefined): boolean => {
  const tenant = currentTenant();
  if (multiTenantEnabled()) return Boolean(tenant?.kind === "import" && tenant.importSecretHash && provided && matchesImportSecret(provided, tenant.importSecretHash));
  const expected = process.env.STOCK_IMPORT_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
};

function semanticIssues(data: Import, settings: Awaited<ReturnType<typeof config>>): Issue[] {
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
    const [existing] = await db.select().from(stockImportRunsTable).where(and(eq(stockImportRunsTable.runId, candidate.runId), eq(stockImportRunsTable.dealerId, currentDealerId())));
    if (existing) return retainedStockPayloadHash(existing) === hash(body) ? "existing" : "conflict";
    await db.insert(stockImportRunsTable).values({
      runId: candidate.runId, dealerId: (await config()).dealerId, retailerId: candidate.retailerId, source: (await config()).platform,
      schemaVersion: String(candidate.schemaVersion ?? "unknown"), scrapedAt, expectedCount: Number(candidate.expectedAdvertCount) || 0,
      receivedCount: Array.isArray(candidate.cars) ? candidate.cars.length : 0, complete: candidate.complete === true,
      status, failedAdvertIds: Array.isArray(candidate.failedAdvertIds) ? candidate.failedAdvertIds.filter((x): x is string => typeof x === "string") : [],
      errors: problems, rawSnapshot: body, payloadHash: hash(body),
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
    sourceHeroImage: normalizedImages(car).find((image) => image.isHero)?.url ?? null, rawSourceData: stockSourceData(car).facts,
  };
}

async function syncImages(tx: any, vehicleId: string, car: Import["cars"][number], now: Date, old: VehicleImage[]) {
  const manualUrls = new Set(old.filter(image => image.origin === 'manual').map(image => image.sourceUrl));
  const incoming = normalizedImages(car).filter(image => !manualUrls.has(image.url));
  const oldByUrl = new Map(old.map(image => [image.sourceUrl, image]));
  const before = old
    .filter(image => image.origin === 'source' && image.isActive)
    .sort((a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder)
    .map((image: { sourceUrl: string; caption: string | null; sortOrder: number; isHero: boolean }) => ({
      url: image.sourceUrl, caption: image.caption, sortOrder: image.sortOrder, isHero: image.isHero,
    }));
  const changed = incoming.filter(image => {
    const saved = oldByUrl.get(image.url);
    return !saved || !saved.isActive || saved.caption !== image.caption || saved.sortOrder !== image.sortOrder || saved.isHero !== image.isHero;
  });
  if (changed.length) {
    await tx.insert(vehicleImagesTable).values(changed.map((image) => ({
      vehicleId, origin: "source" as const, sourceUrl: image.url, caption: image.caption,
      sortOrder: image.sortOrder, isHero: image.isHero, isActive: true, firstSeenAt: now, lastSeenAt: now,
    }))).onConflictDoUpdate({
      target: [vehicleImagesTable.vehicleId, vehicleImagesTable.sourceUrl],
      setWhere: eq(vehicleImagesTable.origin, 'source'),
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
  if (old.some(image => image.origin === 'source' && image.isActive && !urls.includes(image.sourceUrl))) {
    await tx.update(vehicleImagesTable).set({ isActive: false, isHero: false }).where(absentImages);
  }
  const after = incoming.map((image) => ({ url: image.url, caption: image.caption, sortOrder: image.sortOrder, isHero: image.isHero }));
  return { before, after };
}

async function importStock(req: Request, res: Response, source: ImportSource): Promise<void> {
  const identity = {
    runId: typeof req.body?.runId === "string" ? req.body.runId : null,
    retailerId: typeof req.body?.retailerId === "string" ? req.body.retailerId : null,
  };
  if (!validSecret(req.get("x-stock-import-secret"))) {
    req.log.warn("Rejected unauthorized stock import");
    res.status(401).json({ ...identity, status: "rejected", errors: [issue("unauthorized", "Invalid import secret")] }); return;
  }
  const settings = await config();
  if (!settings.retailerId) {
    req.log.error("STOCK_RETAILER_ID is not configured");
    res.status(500).json({ ...identity, status: "rejected", errors: [issue("configuration_error", "Stock import is not configured")] }); return;
  }
  const parsed = (source === "grok" ? ImportGrokStockBody : ImportAutotraderStockBody).safeParse(req.body);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((e) => issue("invalid_structure", e.message, e.path.join(".")));
    const recorded = await recordRejected(req.body, "failed", problems);
    if (recorded === "conflict") { res.status(409).json({ ...identity, status: "rejected", errors: [issue("run_id_conflict", "runId was already used with a different payload")] }); return; }
    res.status(400).json({ ...identity, status: "rejected", errors: problems }); return;
  }
  // Persist marketplace identity separately from the transport adapter.
  const data = parsed.data;
  if (!settings.enabled) { res.status(409).json({ ...identity, status: "rejected", errors: [issue("feed_paused", "Stock imports are paused")] }); return; }
  if (source === "autotrader" && settings.platform !== "autotrader") { res.status(400).json({ ...identity, status: "rejected", errors: [issue("platform_mismatch", "Use the Grok route for the configured marketplace")] }); return; }
  const platformProblems = stockPlatformIssues(data.cars, settings.platform);
  if (multiTenantEnabled() && data.cars.some(car => car.sourceExtras?.sourcePlatform !== settings.platform))
    platformProblems.push("Every car must declare the configured sourceExtras.sourcePlatform");
  if (platformProblems.length) { res.status(422).json({ ...identity, status: "rejected", errors: platformProblems.map(message => issue("platform_mismatch", message)) }); return; }
  const quarantineProblems: Issue[] = [];
  if (!data.complete) quarantineProblems.push(issue("incomplete_snapshot", "Snapshot must be complete"));
  if (data.count !== data.cars.length || data.expectedAdvertCount !== data.cars.length) quarantineProblems.push(issue("count_mismatch", "count and expectedAdvertCount must equal cars.length"));
  if (data.failedAdvertIds.length) quarantineProblems.push(issue("failed_adverts", "Snapshot contains failed advert IDs"));
  if (data.errors.length) quarantineProblems.push(issue("source_errors", "Snapshot contains source errors"));
  if (quarantineProblems.length) {
    const recorded = await recordRejected(req.body, "quarantined", quarantineProblems);
    if (recorded === "conflict") { res.status(409).json({ ...identity, status: "rejected", errors: [issue("run_id_conflict", "runId was already used with a different payload")] }); return; }
    res.status(422).json({ ...identity, status: "quarantined", errors: quarantineProblems }); return;
  }
  const problems = semanticIssues(data, settings).filter((problem) => problem.code !== "count_mismatch" && problem.code !== "stale_snapshot");
  if (problems.length) {
    const recorded = await recordRejected(req.body, "failed", problems);
    if (recorded === "conflict") { res.status(409).json({ ...identity, status: "rejected", errors: [issue("run_id_conflict", "runId was already used with a different payload")] }); return; }
    res.status(422).json({ ...identity, status: "rejected", errors: problems }); return;
  }
  const payloadHash = hash(req.body);
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock-import:${settings.dealerId}`}))`);
      const [prior] = await tx.select().from(stockImportRunsTable).where(and(eq(stockImportRunsTable.runId, data.runId), eq(stockImportRunsTable.dealerId, currentDealerId())));
      if (prior) {
        if (retainedStockPayloadHash(prior) !== payloadHash) return { conflict: true as const };
        if (prior.status === "quarantined") return { priorQuarantined: true as const };
        if (prior.status !== "completed") return { conflict: true as const };
        return { replay: true as const, prior };
      }
      // Replay detection precedes freshness/order checks, under the same dealer lock.
      if (Date.now() - data.scrapedAt.getTime() > settings.maxAgeHours * 3_600_000 || data.scrapedAt.getTime() > Date.now() + 300_000) {
        const errors = [issue("stale_snapshot", "Snapshot is outside the allowed freshness window", "scrapedAt")];
        await tx.insert(stockImportRunsTable).values({ runId: data.runId, dealerId: settings.dealerId, source: settings.platform, retailerId: data.retailerId, schemaVersion: "1", scrapedAt: data.scrapedAt, expectedCount: data.expectedAdvertCount, receivedCount: data.count, complete: data.complete, status: "quarantined", failedAdvertIds: [], errors, rawSnapshot: req.body, payloadHash });
        return { freshnessQuarantine: true as const, errors };
      }
      const [latest] = await tx.select().from(stockImportRunsTable).where(and(eq(stockImportRunsTable.dealerId, settings.dealerId), eq(stockImportRunsTable.status, "completed"))).orderBy(desc(stockImportRunsTable.scrapedAt)).limit(1);
      if (latest && data.scrapedAt.getTime() < latest.scrapedAt.getTime()) return { superseded: true as const };
      const active = await config(tx);
      if (!active.enabled || active.platform !== settings.platform || active.retailerId !== settings.retailerId) return { connectionChanged: true as const };
      const current = await tx.select().from(vehiclesTable).where(and(eq(vehiclesTable.dealerId, settings.dealerId), eq(vehiclesTable.source, settings.platform)));
      const liveCount = current.filter((v) => v.sourceStatus === "live").length;
      if (liveCount && data.cars.length < liveCount * (1 - settings.maxDrop / 100)) {
        await tx.insert(stockImportRunsTable).values({ runId: data.runId, dealerId: settings.dealerId, source: settings.platform, retailerId: data.retailerId, schemaVersion: "1", scrapedAt: data.scrapedAt, expectedCount: data.expectedAdvertCount, receivedCount: data.count, complete: data.complete, status: "quarantined", failedAdvertIds: [], errors: [issue("stock_drop", "Snapshot drop exceeds configured limit")], rawSnapshot: req.body, payloadHash });
        return { quarantined: true as const };
      }
      const [run] = await tx.insert(stockImportRunsTable).values({ runId: data.runId, dealerId: settings.dealerId, source: settings.platform, retailerId: data.retailerId, schemaVersion: "1", scrapedAt: data.scrapedAt, expectedCount: data.expectedAdvertCount, receivedCount: data.count, complete: true, status: "processing", failedAdvertIds: [], errors: [], rawSnapshot: req.body, payloadHash }).returning();
      let created = 0, updated = 0, unchanged = 0, missing = 0;
      const now = new Date(), incomingIds = new Set(data.cars.map((car) => car.advertId));
      const currentByAdvert = new Map(current.map(vehicle => [vehicle.advertId, vehicle]));
      const present = current.filter(vehicle => incomingIds.has(vehicle.advertId));
      const imageRows = present.length ? await tx.select().from(vehicleImagesTable).where(and(or(eq(vehicleImagesTable.isActive, true), eq(vehicleImagesTable.origin, 'manual')), inArray(vehicleImagesTable.vehicleId, present.map(vehicle => vehicle.id)))) : [];
      const imagesByVehicle = new Map<string, VehicleImage[]>();
      for (const image of imageRows) { const rows = imagesByVehicle.get(image.vehicleId) ?? []; rows.push(image); imagesByVehicle.set(image.vehicleId, rows); }
      for (const car of data.cars) {
        const existing = currentByAdvert.get(car.advertId);
        const values = sourceValues(car);
        const sourceCheckMetadata = stockSourceData(car).checks;
        const candidate = car.price == null ? null : Math.trunc(car.price);
        const suspicious = candidate != null && (candidate < settings.minPrice || (existing?.sourcePrice != null && Math.abs(candidate - existing.sourcePrice) / existing.sourcePrice * 100 > settings.maxPriceChange));
        const priceValues = suspicious ? { pendingSourcePrice: candidate, priceReviewRequired: true } : { sourcePrice: candidate, pendingSourcePrice: null, priceReviewRequired: false };
        if (!existing) {
          const [vehicle] = await tx.insert(vehiclesTable).values({ ...values, ...priceValues, auditMetadata: { sourceCheckMetadata }, importRunId: run.id, dealerId: settings.dealerId, source: settings.platform, advertId: car.advertId, sourceStatus: "live", missingCount: 0, firstSeenAt: now, lastSeenAt: now }).returning();
          const imageChanges = await syncImages(tx, vehicle.id, car, now, []); created++;
          const changes = Object.entries({ ...values, ...priceValues })
            .filter(([, newValue]) => newValue !== null && newValue !== undefined)
            .map(([fieldName, newValue]) => ({ vehicleId: vehicle.id, importRunId: run.id, fieldName, oldValue: null as unknown, newValue }));
          if (imageChanges.after.length) changes.push({ vehicleId: vehicle.id, importRunId: run.id, fieldName: "sourceImages", oldValue: [], newValue: imageChanges.after });
          if (changes.length) await tx.insert(vehicleChangesTable).values(changes);
        } else {
          const databaseChanges: Record<string, unknown> = {};
          for (const [key, value] of Object.entries({ ...values, ...priceValues })) {
            if ((existing.auditMetadata as any)?.plateCorrection && ["plate", "vrm", "vrmVerified"].includes(key)) continue;
            const previous = key === 'rawSourceData' ? stockSourceData(existing.rawSourceData).facts : (existing as any)[key];
            if (canonicalJson(previous) !== canonicalJson(value)) databaseChanges[key] = value;
          }
          const imageChanges = await syncImages(tx, existing.id, car, now, imagesByVehicle.get(existing.id) ?? []);
          const auditChanges: Record<string, { oldValue: unknown; newValue: unknown }> = {};
          for (const [fieldName, newValue] of Object.entries(databaseChanges)) {
            auditChanges[fieldName] = { oldValue: (existing as any)[fieldName] ?? null, newValue };
          }
          if (canonicalJson(imageChanges.before) !== canonicalJson(imageChanges.after)) {
            auditChanges.sourceImages = { oldValue: imageChanges.before, newValue: imageChanges.after };
          }
          const preserveMissingState = ["sold", "archived", "hidden"].includes(existing.inventoryStatus);
          const [updatedVehicle] = await tx.update(vehiclesTable).set({
            ...databaseChanges,
            // Merge against the row at update time, never a stale read that could
            // overwrite a sale reservation created while this import was running.
            auditMetadata: sql`coalesce(${vehiclesTable.auditMetadata}, '{}'::jsonb) || ${JSON.stringify({ sourceCheckMetadata })}::jsonb`,
            importRunId: run.id, lastSeenAt: now,
            ...(preserveMissingState ? {} : { sourceStatus: "live", missingCount: 0, archivedAt: null, retirementStartedAt: null }),
          }).where(tenantAnd(eq(vehiclesTable.id, existing.id), tenantEq(vehiclesTable.dealerId, currentDealerId()))).returning();
          await recordPublishedStockPrice(tx, existing, updatedVehicle, `import:${run.id}:${existing.id}`, now, settings.missingHideThreshold, run.id, settings.platform);
          const changes = Object.entries(auditChanges).map(([fieldName, change]) => ({
            vehicleId: existing.id, importRunId: run.id, fieldName, oldValue: change.oldValue, newValue: change.newValue,
          }));
          if (changes.length) await tx.insert(vehicleChangesTable).values(changes);
          Object.keys(auditChanges).length ? updated++ : unchanged++;
        }
      }
      await resolveReappearedStockTasks(tx, settings.dealerId, present.filter(vehicle => !["sold", "archived", "hidden"].includes(vehicle.inventoryStatus) && vehicle.sourceStatus === "missing").map(vehicle => vehicle.id), now, run.id);
      const absent = current.filter(vehicle => !incomingIds.has(vehicle.advertId));
      if (absent.length) {
        // Bounded batches preserve exactly the rows observed by this snapshot,
        // without one query per historical missing advert or unbounded parameters.
        for (let start = 0; start < absent.length; start += 500) {
          await tx.update(vehiclesTable).set({ sourceStatus: "missing", missingCount: sql`${vehiclesTable.missingCount} + 1`, importRunId: run.id }).where(and(eq(vehiclesTable.dealerId, settings.dealerId), eq(vehiclesTable.source, settings.platform), inArray(vehiclesTable.id, absent.slice(start, start + 500).map(vehicle => vehicle.id))));
        }
        await recordMissingStockTasks(tx, absent, run.id, now);
        missing = absent.length;
      }
      await tx.update(stockImportRunsTable).set({ status: "completed", addedCount: created, changedCount: updated, missingCount: missing }).where(tenantAnd(eq(stockImportRunsTable.id, run.id), tenantEq(stockImportRunsTable.dealerId, currentDealerId())));
      return { created, updated, unchanged, missing };
    });
    if ("freshnessQuarantine" in result) { res.status(422).json({ ...identity, status: "quarantined", errors: result.errors }); return; }
    if ("superseded" in result) { res.status(409).json({ ...identity, status: "rejected", errors: [issue("superseded_snapshot", "A newer snapshot has already been applied", "scrapedAt")] }); return; }
    if ("connectionChanged" in result) { res.status(409).json({ ...identity, status: "rejected", errors: [issue("connection_changed", "Stock connection changed during import; check the active connection before retrying")] }); return; }
    if ("conflict" in result) { res.status(409).json({ ...identity, status: "rejected", errors: [issue("run_id_conflict", "runId was already used with a different payload")] }); return; }
    if ("priorQuarantined" in result) { res.status(422).json({ ...identity, status: "quarantined", errors: [issue("previously_quarantined", "This import run was previously quarantined")] }); return; }
    if ("quarantined" in result) { res.status(422).json({ ...identity, status: "quarantined", errors: [issue("stock_drop", "Snapshot drop exceeds configured limit")] }); return; }
    const replayed = result.replay === true;
    const replayUnchanged = replayed ? Math.max(0, data.cars.length - result.prior!.addedCount - result.prior!.changedCount) : result.unchanged;
    const reply = (source === "grok" ? ImportGrokStockResponse : ImportAutotraderStockResponse).parse({ schemaVersion: 1, status: replayed ? "replayed" : "imported", runId: data.runId, source, retailerId: data.retailerId, received: data.cars.length, created: replayed ? result.prior!.addedCount : result.created, updated: replayed ? result.prior!.changedCount : result.updated, deleted: 0, unchanged: replayUnchanged, errors: [] });
    res.status(replayed ? 200 : 201).json(reply);
  } catch (error) {
    req.log.error({ err: error }, "Stock import failed");
    res.status(500).json({ ...identity, status: "rejected", errors: [issue("unexpected_error", "Unable to import stock")] });
  }
}

router.post("/stock/imports/autotrader", async (req, res): Promise<void> => {
  await importAdmission.run(req, res, () => importStock(req, res, "autotrader"));
});

router.post("/stock/imports/:dealerId/grok", async (req, res): Promise<void> => {
  if (!multiTenantEnabled() || req.params.dealerId !== currentDealerId()) { res.status(404).json({ error: "Stock connection not found" }); return; }
  await importAdmission.run(req, res, () => importStock(req, res, "grok"));
});
router.post("/stock/imports/grok", async (req, res): Promise<void> => {
  await importAdmission.run(req, res, () => importStock(req, res, "grok"));
});

export async function projectVehicles(vehicles: Vehicle[]) {
  const reductions = await publicPriceReductions(vehicles);
  const ids = vehicles.map((vehicle) => vehicle.id);
  const images = ids.length ? await db.select().from(vehicleImagesTable).where(and(inArray(vehicleImagesTable.vehicleId, ids), eq(vehicleImagesTable.isActive, true))).orderBy(vehicleImagesTable.sortOrder) : [];
  const byVehicle = new Map<string, VehicleImage[]>();
  for (const image of images) {
    const gallery = byVehicle.get(image.vehicleId);
    if (gallery) gallery.push(image); else byVehicle.set(image.vehicleId, [image]);
  }
  return vehicles.map((vehicle) => {
    const gallery = byVehicle.get(vehicle.id) ?? [];
    const vehicleImages = gallery.map((image) => ({ url: image.sourceUrl, caption: image.caption }));
    const hero = vehicle.websiteHeroImageOverride ?? gallery.find((image) => image.isHero)?.sourceUrl ?? null;
    const raw = projectedStockSourceData(vehicle.rawSourceData, vehicle.auditMetadata);
    const imported = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    const specifications = vehicle.websiteDescription ? { ...(imported?.specifications as Record<string, unknown> ?? {}), description: publishedDescription(vehicle.websiteDescription, vehicle) } : imported?.specifications;
    const sourceExtras = stockDescriptionExtras({ ...vehicle, title: vehicle.websiteTitleOverride ?? vehicle.title, price: vehicle.websitePriceOverride ?? vehicle.sourcePrice, specifications: imported?.specifications as Record<string, unknown> | null, sourceExtras: imported?.sourceExtras as Record<string, unknown> | null });
    delete sourceExtras.websitePriceReduction;
    const reduction = reductions.get(vehicle.id);
    if (reduction) sourceExtras.websitePriceReduction = reduction;
    if (vehicle.websiteDescription) { sourceExtras.description = publishedDescription(vehicle.websiteDescription, vehicle); sourceExtras.originalAdvertDescriptions = retainedOriginals(vehicle); sourceExtras.descriptionOrigin = 'staff-reviewed'; const metadata = descriptionMetadata(vehicle); sourceExtras.vehicleDescriptionBody = metadata.publishedBody ?? vehicle.websiteDescription; sourceExtras.vehicleDescriptionPlacement = metadata.publishedContext?.placement ?? 'inline'; sourceExtras.vehicleDescriptionDisclosures = descriptionDisclosures(vehicle); sourceExtras.vehicleDescriptionTax = taxDescription(metadata.publishedContext); }
    return { id: vehicle.id, inventoryStatus: vehicle.inventoryStatus, advertId: vehicle.advertId, title: vehicle.websiteTitleOverride ?? vehicle.title, variant: vehicle.variant, make: vehicle.make, model: vehicle.model, trim: vehicle.trim, year: vehicle.year, price: vehicle.websitePriceOverride ?? vehicle.sourcePrice, priceType: vehicle.priceType, currency: vehicle.currency, mileage: vehicle.mileage, mileageText: vehicle.mileageText, registration: vehicle.registration, registrationBand: vehicle.registrationBand, plate: vehicle.plate, vrm: vehicle.vrm, vrmVerified: vehicle.vrmVerified, fuel: vehicle.fuel, transmission: vehicle.transmission, bodyType: vehicle.bodyType, engineSize: vehicle.engineSize, engineCC: vehicle.engineCC, doors: vehicle.doors, seats: vehicle.seats, colour: vehicle.colour, emissionClass: vehicle.emissionClass, drivetrain: vehicle.drivetrain, owners: vehicle.owners, writeOffCategory: vehicle.writeOffCategory, advertUrl: vehicle.advertUrl, dealerName: vehicle.dealerName, dealerLocation: vehicle.dealerLocation, imageCount: vehicle.imageCount, heroImage: hero, images: vehicleImages, specifications: specifications !== null && typeof specifications === "object" && !Array.isArray(specifications) ? specifications : null, sourceExtras: sourceExtras !== null && typeof sourceExtras === "object" && !Array.isArray(sourceExtras) ? sourceExtras : null };
  });
}
function visible(vehicle: Pick<Vehicle, 'archivedAt' | 'inventoryStatus' | 'missingCount' | 'priceReviewRequired' | 'sourcePrice' | 'websitePriceOverride'>, settings: Awaited<ReturnType<typeof config>>) {
  return !vehicle.archivedAt && ["available", "reserved"].includes(vehicle.inventoryStatus) && vehicle.missingCount < settings.missingHideThreshold && !(vehicle.priceReviewRequired && vehicle.sourcePrice == null && vehicle.websitePriceOverride == null);
}
router.get("/stock", async (req, res): Promise<void> => {
  const settings = await config();
  const all = await db.select().from(vehiclesTable).where(and(
    eq(vehiclesTable.dealerId, settings.dealerId), eq(vehiclesTable.source, settings.platform),
    inArray(vehiclesTable.inventoryStatus, ['available', 'reserved']), isNull(vehiclesTable.archivedAt),
    lt(vehiclesTable.missingCount, settings.missingHideThreshold),
    or(eq(vehiclesTable.priceReviewRequired, false), isNotNull(vehiclesTable.sourcePrice), isNotNull(vehiclesTable.websitePriceOverride)),
  )).orderBy(vehiclesTable.advertId);
  const cars = await projectVehicles(all.filter((vehicle) => vehicle.source === settings.platform && visible(vehicle, settings)));
  // Only the source label and check time are needed; don't transfer a whole
  // raw inventory snapshot from Postgres on every public stock page request.
  const [latest] = await db.select({ scrapedAt: stockImportRunsTable.scrapedAt, dealerName: sql<unknown>`${stockImportRunsTable.rawSnapshot} -> 'dealerName'` }).from(stockImportRunsTable).where(and(eq(stockImportRunsTable.dealerId, settings.dealerId), eq(stockImportRunsTable.status, "completed"), eq(stockImportRunsTable.source, settings.platform))).orderBy(desc(stockImportRunsTable.receivedAt)).limit(1);
  sendConditionalStock(req, res, { dealerId: settings.dealerId, source: settings.platform }, GetStockResponse.parse({ schemaVersion: 1, dealerName: typeof latest?.dealerName === "string" ? latest.dealerName : null, dealerLocation: cars[0]?.dealerLocation ?? null, count: cars.length, scrapedAt: latest?.scrapedAt ?? null, cars }));
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicVehicle = Awaited<ReturnType<typeof projectVehicles>>[number];

/** Read-only crawl inventory. Shares the website visibility rules, without photo/raw-data projection. */
export async function listPublicStockSitemapEntries(): Promise<{ id: string }[]> {
  const settings = await config();
  const vehicles = await db.select({
    id: vehiclesTable.id, archivedAt: vehiclesTable.archivedAt, inventoryStatus: vehiclesTable.inventoryStatus,
    missingCount: vehiclesTable.missingCount, priceReviewRequired: vehiclesTable.priceReviewRequired,
    sourcePrice: vehiclesTable.sourcePrice, websitePriceOverride: vehiclesTable.websitePriceOverride,
  }).from(vehiclesTable).where(and(
    eq(vehiclesTable.dealerId, settings.dealerId), eq(vehiclesTable.source, settings.platform),
    inArray(vehiclesTable.inventoryStatus, ['available', 'reserved']), isNull(vehiclesTable.archivedAt),
    lt(vehiclesTable.missingCount, settings.missingHideThreshold),
    or(eq(vehiclesTable.priceReviewRequired, false), isNotNull(vehiclesTable.sourcePrice), isNotNull(vehiclesTable.websitePriceOverride)),
  )).orderBy(vehiclesTable.advertId);
  // updatedAt can change on an unchanged stock check; it is not a public content
  // publication timestamp, so sitemap entries intentionally omit vehicle lastmod.
  return vehicles.filter(vehicle => visible(vehicle, settings)).map(vehicle => ({ id: vehicle.id }));
}

/** Read-only brochure lookup: match /stock across every import source. */
export async function findVisibleStockVehicle(id: string): Promise<PublicVehicle | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const settings = await config();
  const [vehicle] = await db.select().from(vehiclesTable).where(and(eq(vehiclesTable.id, id), eq(vehiclesTable.dealerId, settings.dealerId)));
  if (!vehicle || vehicle.source !== settings.platform || !visible(vehicle, settings)) return null;
  const [projected] = await projectVehicles([vehicle]);
  return projected ?? null;
}

/**
 * A single vehicle exactly as the website is allowed to show it, or null when
 * the id is unknown, malformed or the vehicle is no longer on sale. Shared with
 * the share-preview route so crawlers never see hidden or sold stock.
 */
export async function findPublicVehicle(id: string): Promise<PublicVehicle | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const settings = await config();
  const [vehicle] = await db.select().from(vehiclesTable).where(and(eq(vehiclesTable.id, id), eq(vehiclesTable.dealerId, settings.dealerId), eq(vehiclesTable.source, settings.platform)));
  if (!vehicle || vehicle.source !== settings.platform || !visible(vehicle, settings)) return null;
  const [projected] = await projectVehicles([vehicle]);
  return projected ?? null;
}

router.get("/vehicles/:id", async (req, res): Promise<void> => {
  const parsed = GetVehicleParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid vehicle id" }); return; }
  if (!UUID_PATTERN.test(parsed.data.id)) {
    res.status(400).json({ error: "Invalid vehicle id" }); return;
  }
  const projected = await findPublicVehicle(parsed.data.id);
  if (!projected) { res.status(404).json({ error: "Vehicle not found" }); return; }
  res.json(GetVehicleResponse.parse(projected));
});
router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  req.log.error({ err: error }, "Stock route failed");
  if (!res.headersSent) res.status(500).json({ status: "rejected", errors: [issue("unexpected_error", "Unable to process stock request")] });
});
export default router;
