import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, dealerSettingsTable } from '@workspace/db';
import { findVisibleStockVehicle } from './stock';
import { brochureDealer } from '../lib/vehicle-brochure';
import { brochureOrigin, createBrochureHandler } from '../lib/vehicle-brochure-handler';

const router = Router();
const generate = createBrochureHandler({
  findVehicle: findVisibleStockVehicle,
  readDealer: async () => {
    // Deliberately do not use getOrCreateSettings: this endpoint must never write.
    const [settings] = await db.select({ config: dealerSettingsTable.config }).from(dealerSettingsTable)
      .where(eq(dealerSettingsTable.dealerId, process.env.STOCK_DEALER_ID ?? 'luxxy-motors'));
    return brochureDealer(settings?.config);
  },
});

router.get('/vehicles/:id/brochure.pdf', async (req, res) => {
  const result = await generate(req.params.id, brochureOrigin(req.get('host'), req.get('x-forwarded-proto')));
  res.status(result.status).set(result.headers).send(result.body);
});

export default router;
