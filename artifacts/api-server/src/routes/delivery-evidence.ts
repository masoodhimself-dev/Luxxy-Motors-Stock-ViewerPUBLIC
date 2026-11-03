import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import {
  currentDealerId,
  currentTenant,
  multiTenantEnabled,
} from "../lib/tenant-context";
import { siteOrigin } from "../lib/enquiry-links";
import {
  PostgresDeliveryEvidence,
  DeliveryEvidenceError,
  type DeliveryEvidenceService,
} from "../lib/delivery-evidence";
import { WebsiteAssetError } from "../lib/website-asset-image";
import { deliveryDeclarationHtml } from "../lib/delivery-declaration";

export function createDeliveryEvidenceRouter(
  service: DeliveryEvidenceService = new PostgresDeliveryEvidence(),
) {
  const router = Router(),
    buckets = new Map<string, { until: number; count: number }>();
  const staff = "/staff/sales/:saleId/delivery-evidence";
  router.use([staff, "/delivery-evidence"], (req, res, next) => {
    res.set({
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    });
    const origin = req.get("origin");
    let allowed = !origin;
    if (origin)
      try {
        const source = new URL(origin),
          canonical = new URL(siteOrigin());
        allowed =
          source.origin === origin &&
          !source.username &&
          !source.password &&
          (source.origin === canonical.origin ||
            ((currentTenant()?.kind === "website" || !multiTenantEnabled()) &&
              source.protocol === canonical.protocol &&
              source.host.toLowerCase() ===
                (req.get("host") || "").toLowerCase()));
      } catch {
        allowed = false;
      }
    if (!allowed) {
      res
        .status(403)
        .json({ error: "Open the delivery link on this dealership website." });
      return;
    }
    if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > 2_810_000) {
      res.status(413).json({ error: "Choose an image smaller than 2 MB." });
      return;
    }
    const now = Date.now(),
      key = `${currentDealerId()}:${req.ip}:${req.method === "GET" ? "read" : "write"}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (buckets.size >= 10000)
        for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
      if (buckets.size >= 10000) {
        res.status(429).json({ error: "Try again shortly." });
        return;
      }
      bucket = { until: now + 60_000, count: 0 };
      buckets.set(key, bucket);
    }
    if (++bucket.count > 90) {
      res
        .set("Retry-After", "60")
        .status(429)
        .json({
          error: "Too many requests. Keep your photos and retry shortly.",
        });
      return;
    }
    next();
  });
  router.use(staff, requireStaff, requirePermission("sales.manage"));
  const fail = (req: Request, res: Response, error: unknown) => {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({
          error:
            error.issues.find((i) => i.code === "custom")?.message ||
            "Check the delivery fields and try again.",
        });
      return;
    }
    if (
      error instanceof DeliveryEvidenceError ||
      error instanceof WebsiteAssetError
    ) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if ((error as { code?: string })?.code === "23505") {
      res
        .status(409)
        .json({
          error: "This request was already used. Refresh the delivery file.",
        });
      return;
    }
    req.log?.warn("Delivery evidence request failed");
    res
      .status(503)
      .json({
        error:
          "Could not save or load the delivery evidence. Keep your photos and retry the same request.",
      });
  };
  const ids = (req: Request) => {
    for (const key of ["saleId", "jobId", "photoId"])
      if (req.params[key] && !z.uuid().safeParse(req.params[key]).success)
        throw new DeliveryEvidenceError("Delivery job not found.", 404);
  };
  router.get(staff, async (req, res) => {
    try {
      ids(req);
      res.json(await service.list(String(req.params.saleId)));
    } catch (e) {
      fail(req, res, e);
    }
  });
  router.post(staff, async (req, res) => {
    try {
      ids(req);
      const result = await service.create(
        String(req.params.saleId),
        req.body,
        req.staff!.authUserId,
      );
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (e) {
      fail(req, res, e);
    }
  });
  router.post(`${staff}/:jobId/revoke`, async (req, res) => {
    try {
      ids(req);
      z.object({})
        .strict()
        .parse(req.body ?? {});
      res.json(
        await service.revoke(
          String(req.params.saleId),
          String(req.params.jobId),
          req.staff!.authUserId,
        ),
      );
    } catch (e) {
      fail(req, res, e);
    }
  });
  router.post(`${staff}/:jobId/paper`, async (req, res) => {
    try {
      ids(req);
      res.json(
        await service.paper(
          String(req.params.saleId),
          String(req.params.jobId),
          req.body,
          req.staff!.authUserId,
        ),
      );
    } catch (e) {
      fail(req, res, e);
    }
  });
  router.get(`${staff}/:jobId/declaration`, async (req, res) => {
    try {
      ids(req);
      const job = await service.staffJob(
        String(req.params.saleId),
        String(req.params.jobId),
      );
      res
        .set(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        )
        .type("html")
        .send(deliveryDeclarationHtml(job.snapshot, new Date().toISOString()));
    } catch (e) {
      fail(req, res, e);
    }
  });
  router.get(`${staff}/:jobId/photos/:photoId`, async (req, res) => {
    try {
      ids(req);
      const photo = await service.staffPhoto(
        String(req.params.saleId),
        String(req.params.jobId),
        String(req.params.photoId),
      );
      res
        .set("Content-Disposition", 'inline; filename="delivery-photo"')
        .type(photo.mimeType)
        .send(photo.bytes);
    } catch (e) {
      fail(req, res, e);
    }
  });
  router.get("/delivery-evidence/:token", async (req, res) => {
    try {
      res.json(await service.read(String(req.params.token)));
    } catch (e) {
      fail(req, res, e);
    }
  });
  router.post("/delivery-evidence/:token/photos", async (req, res) => {
    try {
      res.json(await service.photo(String(req.params.token), req.body));
    } catch (e) {
      fail(req, res, e);
    }
  });
  router.post("/delivery-evidence/:token/submit", async (req, res) => {
    try {
      res.json(await service.submit(String(req.params.token), req.body));
    } catch (e) {
      fail(req, res, e);
    }
  });
  return router;
}
export default createDeliveryEvidenceRouter();
