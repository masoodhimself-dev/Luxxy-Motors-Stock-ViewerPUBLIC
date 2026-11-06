import { vehicleDetailPath } from '@workspace/vehicle-meta';
import { Router, type IRouter } from "express";
import { shareRequestOrigin } from '../lib/share-origin';
import {
  buildMissingVehicleSharePreview,
  renderSharePreviewHtml,
} from "../lib/share-preview";
import { getDealerIdentity } from "./dealer-settings";
import { findPublicVehicle } from "./stock";

const router: IRouter = Router();

/** Old shared links remain valid. The canonical page now renders its own crawler metadata. */
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

    if (vehicle) {
      res.set('Cache-Control', 'no-store').redirect(301, `${origin}${vehicleDetailPath(vehicle)}`);
      return;
    }
    const preview = buildMissingVehicleSharePreview({ vehicleId, dealer, origin });

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
