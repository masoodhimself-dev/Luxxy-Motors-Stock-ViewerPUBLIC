import { Router, type RequestHandler } from 'express';
import { currentDealerId } from '../lib/tenant-context';
import { publicLookupConnection } from '../lib/request-network';
import { createVehicleSheetImageHandler } from '../lib/vehicle-sheet-image';
import { findPublicVehicle } from './stock';

export function vehicleSheetImageRouter(findVehicle = findPublicVehicle, loadPhotos?: Parameters<typeof createVehicleSheetImageHandler>[0]['loadPhotos']) {
  const router = Router();
  const serve = createVehicleSheetImageHandler({ findVehicle, loadPhotos });
  const limits = new Map<string, { until: number; count: number }>();
  const limit: RequestHandler = (req, res, next) => {
    const key = `${currentDealerId()}:${publicLookupConnection(req)}`, now = Date.now();
    let entry = limits.get(key);
    if (!entry || entry.until <= now) {
      if (limits.size >= 5000) limits.delete(limits.keys().next().value!);
      entry = { until: now + 60_000, count: 0 }; limits.set(key, entry);
    }
    if (++entry.count > 30) { res.status(429).set({ 'Cache-Control': 'no-store', 'Retry-After': '60' }).send('Too many vehicle photographs. Please try again shortly.'); return; }
    next();
  };
  router.get('/vehicles/:id/sheet-image', limit, async (req, res) => {
    const result = await serve(currentDealerId(), String(req.params.id), req.query.source);
    res.status(result.status).set(result.headers).send(result.body);
  });
  return router;
}

export default vehicleSheetImageRouter();
