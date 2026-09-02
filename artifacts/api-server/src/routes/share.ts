import { Router, type IRouter, type Request } from "express";
import {
  buildMissingVehicleSharePreview,
  buildVehicleSharePreview,
  renderSharePreviewHtml,
} from "../lib/share-preview";
import { getDealerIdentity } from "./dealer-settings";
import { findPublicVehicle } from "./stock";

const router: IRouter = Router();

function firstHeader(req: Request, name: string): string {
  const value = req.headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.split(",")[0].trim() : "";
}

/**
 * The public origin this request arrived on. Derived from the request rather
 * than configuration so dev, preview and the published domain all produce
 * previews that point back at themselves.
 */
function requestOrigin(req: Request): string {
  const host = firstHeader(req, "x-forwarded-host") || req.get("host") || "";
  const proto =
    firstHeader(req, "x-forwarded-proto") ||
    (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Crawler-facing preview for a shared vehicle link. The showroom itself is a
 * static SPA bundle, so this is the only place a per-vehicle Open Graph tag can
 * be rendered before JavaScript runs. Browsers are redirected to the vehicle
 * page, which is also the canonical URL.
 *
 * Mounted at `/share`, so the public URL is `/share/vehicle/:id`. The redirect
 * target assumes the web artifact is served from the domain root.
 */
router.get("/vehicle/:id", async (req, res): Promise<void> => {
  const vehicleId = req.params.id;
  const origin = requestOrigin(req);

  try {
    const [vehicle, dealer] = await Promise.all([
      findPublicVehicle(vehicleId),
      getDealerIdentity(),
    ]);

    const preview = vehicle
      ? buildVehicleSharePreview({ vehicle, vehicleId, dealer, origin })
      : buildMissingVehicleSharePreview({ vehicleId, dealer, origin });

    res
      .status(preview.status)
      .type("html")
      .set("Cache-Control", preview.status === 200 ? "public, max-age=300" : "public, max-age=60")
      .send(renderSharePreviewHtml(preview));
  } catch (error) {
    // A share link must still open the vehicle page even when the lookup fails,
    // so fall back to a preview-less redirect rather than an API error page.
    req.log.error({ err: error, vehicleId }, "Failed to render vehicle share preview");
    res
      .status(302)
      .set("Cache-Control", "no-store")
      .redirect(`${origin}/vehicle/${encodeURIComponent(vehicleId)}`);
  }
});

export default router;
