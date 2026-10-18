import { Router, type IRouter } from "express";
import { shareRequestOrigin } from '../lib/share-origin';
import {
  buildMissingVehicleSharePreview,
  buildVehicleSharePreview,
  renderSharePreviewHtml,
} from "../lib/share-preview";
import { getDealerIdentity } from "./dealer-settings";
import { findPublicVehicle } from "./stock";

const router: IRouter = Router();

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
  let origin: string;
  try { origin = shareRequestOrigin(req); }
  catch { res.status(400).set('Cache-Control', 'no-store').send('Invalid showroom address.'); return; }

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
