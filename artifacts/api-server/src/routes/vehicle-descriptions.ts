import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, vehiclesTable } from "@workspace/db";
import { z } from "zod/v4";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { currentDealerId } from "../lib/tenant-context";
import { enforceStaffWriteOrigin } from "../middlewares/staff-write-origin";
import {
  descriptionContextInput,
  descriptionAiEnabled,
  descriptionFactsHash,
  descriptionMetadata,
  descriptionText,
  descriptionVersion,
  descriptionView,
  generateVehicleDescription,
  publishedDescription,
  retainedOriginals,
  type DescriptionMetadata,
  type DescriptionVehicle,
} from "../lib/vehicle-descriptions";

class DescriptionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
const version = z.string().regex(/^[a-f0-9]{64}$/);
export function createVehicleDescriptionsRouter(
  provider = generateVehicleDescription,
) {
  const router = Router();
  router.use(
    "/staff/vehicle-descriptions",
    requireStaff,
    requirePermission("sales.manage"),
    (req, res, next) => {
      res.set("Cache-Control", "no-store, private");
      if (!enforceStaffWriteOrigin(req, res)) return;
      next();
    },
  );
  const lookup = (id: string) =>
    and(
      eq(vehiclesTable.id, id),
      eq(vehiclesTable.dealerId, currentDealerId()),
    );
  const view = (car: DescriptionVehicle) => ({
    ...descriptionView(car),
    aiAvailable: descriptionAiEnabled(currentDealerId()),
  });
  router.get("/staff/vehicle-descriptions/:id", async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      res.status(400).json({ error: "Invalid car." });
      return;
    }
    const [car] = await db
      .select()
      .from(vehiclesTable)
      .where(lookup(req.params.id));
    if (!car) {
      res.status(404).json({ error: "Car not found." });
      return;
    }
    res.json(view(car));
  });
  router.post("/staff/vehicle-descriptions/:id/generate", async (req, res) => {
    const parsed = z
      .object({ expectedVersion: version, requestId: z.string().uuid() })
      .strict()
      .safeParse(req.body);
    if (
      !parsed.success ||
      !z.string().uuid().safeParse(req.params.id).success
    ) {
      res.status(400).json({ error: "Reload this car before generating." });
      return;
    }
    if (!descriptionAiEnabled(currentDealerId())) {
      res.status(403).json({
        error: "AI vehicle descriptions are not enabled for this dealership.",
      });
      return;
    }
    const { requestId, expectedVersion } = parsed.data;
    let reserved: DescriptionVehicle | undefined;
    try {
      const result = await db.transaction(async (tx) => {
        // One budget admission at a time per tenant, across processes/replicas.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`vehicle-description:${currentDealerId()}`}))`,
        );
        const [car] = await tx
          .select()
          .from(vehiclesTable)
          .where(lookup(req.params.id))
          .for("update");
        if (!car) throw new DescriptionError("Car not found.", 404);
        const meta = descriptionMetadata(car),
          now = Date.now();
        if (meta.draft?.requestId === requestId) return view(car); // Idempotent retry never calls the provider again.
        if (descriptionVersion(car) !== expectedVersion)
          throw new DescriptionError(
            "This car changed. Reload and review its latest details.",
          );
        if (
          meta.draft?.status === "generating" &&
          now - Date.parse(meta.draft.startedAt) < 120_000
        )
          throw new DescriptionError(
            "A description is already being prepared. Reload shortly.",
          );
        if (meta.draft && now - Date.parse(meta.draft.startedAt) < 60_000)
          throw new DescriptionError(
            "Wait a minute before requesting another draft.",
            429,
          );
        const day = new Date().toISOString().slice(0, 10);
        const usage = await tx.execute(
          sql`SELECT coalesce(sum(CASE WHEN audit_metadata->'vehicleDescription'->'attempts'->>'day' = ${day} THEN (audit_metadata->'vehicleDescription'->'attempts'->>'count')::int ELSE 0 END),0) AS count FROM vehicles WHERE dealer_id=${currentDealerId()}`,
        );
        if (Number(usage.rows[0]?.count ?? 0) >= 30)
          throw new DescriptionError(
            "This dealership has used today’s 30 description requests. Existing drafts can still be edited.",
            429,
          );
        const next: DescriptionMetadata = {
          ...meta,
          firstOriginals: meta.firstOriginals ?? retainedOriginals(car),
          originalWebsiteDescription: meta.firstOriginals
            ? (meta.originalWebsiteDescription ?? null)
            : car.websiteDescription,
          attempts: {
            day,
            count: meta.attempts?.day === day ? meta.attempts.count + 1 : 1,
          },
          draft: {
            requestId,
            status: "generating",
            factsHash: descriptionFactsHash(car),
            startedAt: new Date().toISOString(),
          },
        };
        await tx
          .update(vehiclesTable)
          .set({
            auditMetadata: { ...car.auditMetadata, vehicleDescription: next },
          })
          .where(lookup(car.id));
        reserved = car;
        return null;
      });
      if (result) {
        res.json(result);
        return;
      }
      let generated: string | undefined;
      try {
        generated = descriptionText.parse(await provider(reserved!));
      } catch {
        /* No provider body, prompt, key or response enters logs. */
      }
      const final = await db.transaction(async (tx) => {
        const [car] = await tx
          .select()
          .from(vehiclesTable)
          .where(lookup(req.params.id))
          .for("update");
        if (!car) throw new DescriptionError("Car no longer exists.", 404);
        const meta = descriptionMetadata(car);
        if (
          meta.draft?.requestId !== requestId ||
          meta.draft.status !== "generating"
        )
          throw new DescriptionError(
            "A newer description has replaced this request.",
          );
        const next = {
          ...meta,
          draft: {
            ...meta.draft,
            status: generated ? ("ready" as const) : ("failed" as const),
            ...(generated ? { text: generated } : {}),
          },
        };
        const [updated] = await tx
          .update(vehiclesTable)
          .set({
            auditMetadata: { ...car.auditMetadata, vehicleDescription: next },
          })
          .where(lookup(car.id))
          .returning();
        return view(updated!);
      });
      if (!generated) {
        res.status(424).json({
          error:
            "AI could not prepare a description. Nothing was published. Your original advert is unchanged. Reload to review or write it yourself.",
        });
        return;
      }
      res.json(final);
    } catch (error) {
      res.status(error instanceof DescriptionError ? error.status : 503).json({
        error:
          error instanceof DescriptionError
            ? error.message
            : "Descriptions are temporarily unavailable. Nothing was published.",
      });
    }
  });
  router.put("/staff/vehicle-descriptions/:id", async (req, res) => {
    const parsed = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("save-context"),
            expectedVersion: version,
            context: descriptionContextInput,
          })
          .strict(),
        z
          .object({
            action: z.literal("save-draft"),
            expectedVersion: version,
            description: descriptionText,
          })
          .strict(),
        z
          .object({
            action: z.literal("publish"),
            expectedVersion: version,
            description: descriptionText,
            reviewed: z.literal(true),
          })
          .strict(),
        z
          .object({ action: z.literal("restore"), expectedVersion: version })
          .strict(),
      ])
      .safeParse(req.body);
    if (
      !parsed.success ||
      !z.string().uuid().safeParse(req.params.id).success
    ) {
      res.status(400).json({
        error:
          "Check the description and confirm your review before publishing.",
      });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        const [car] = await tx
          .select()
          .from(vehiclesTable)
          .where(lookup(req.params.id))
          .for("update");
        if (!car) throw new DescriptionError("Car not found.", 404);
        if (descriptionVersion(car) !== parsed.data.expectedVersion)
          throw new DescriptionError(
            "This car changed. Reload and review its latest details before saving.",
          );
        const meta = descriptionMetadata(car),
          action = parsed.data.action;
        if (
          meta.draft?.status === "generating" &&
          Date.now() - Date.parse(meta.draft.startedAt) < 120_000
        )
          throw new DescriptionError(
            "A description is being prepared. Reload shortly.",
          );
        if (
          action === "publish" &&
          meta.draft &&
          meta.draft.factsHash !== descriptionFactsHash(car)
        )
          throw new DescriptionError(
            "The source details changed after this draft. Save a reviewed draft from the latest details first.",
          );
        const next: DescriptionMetadata = {
          ...meta,
          firstOriginals: meta.firstOriginals ?? retainedOriginals(car),
          originalWebsiteDescription: meta.firstOriginals
            ? (meta.originalWebsiteDescription ?? null)
            : car.websiteDescription,
        };
        if (action === "save-context") {
          const input = parsed.data.context;
          next.context = {
            placement: input.placement,
            ...(input.annualTaxGbp !== null
              ? {
                  tax: {
                    annualPence: Math.round(input.annualTaxGbp * 100),
                    checkedAt: new Date().toISOString(),
                    sourceUrl: input.sourceUrl,
                  },
                }
              : {}),
          };
        }
        if (action === "save-draft")
          next.draft = {
            requestId: "staff-edited",
            status: "ready",
            text: parsed.data.description,
            startedAt: new Date().toISOString(),
            factsHash: descriptionFactsHash(car),
          };
        if (action === "publish") {
          next.publishedContext = meta.context ?? { placement: "inline" };
          next.publishedBody = parsed.data.description;
          next.publishedOriginals = retainedOriginals(car);
          next.publishedAt = new Date().toISOString();
          next.publishedBy = req.staff!.authUserId;
          delete next.draft;
        }
        if (action === "restore") {
          delete next.draft;
          delete next.publishedAt;
          delete next.publishedBy;
          delete next.publishedContext;
          delete next.publishedBody;
        }
        const [updated] = await tx
          .update(vehiclesTable)
          .set({
            ...(action === "publish"
              ? {
                  websiteDescription: publishedDescription(
                    parsed.data.description,
                    car,
                  ),
                }
              : action === "restore"
                ? {
                    websiteDescription: next.originalWebsiteDescription ?? null,
                  }
                : {}),
            auditMetadata: { ...car.auditMetadata, vehicleDescription: next },
          })
          .where(lookup(car.id))
          .returning();
        return view(updated!);
      });
      res.json(result);
    } catch (error) {
      res.status(error instanceof DescriptionError ? error.status : 503).json({
        error:
          error instanceof DescriptionError
            ? error.message
            : "The description could not be saved. Reload and try again.",
      });
    }
  });
  return router;
}
export default createVehicleDescriptionsRouter();
