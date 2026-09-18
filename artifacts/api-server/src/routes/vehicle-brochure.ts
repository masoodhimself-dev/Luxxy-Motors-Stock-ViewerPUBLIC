import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, dealerSettingsTable } from '@workspace/db';
import { findVisibleStockVehicle } from './stock';
import { brochureText } from '../lib/vehicle-brochure';
import { brochureOrigin, createBrochureHandler } from '../lib/vehicle-brochure-handler';

const router = Router();
const generate = createBrochureHandler({
  findVehicle: findVisibleStockVehicle,
  readDealer: async () => {
    // Deliberately do not use getOrCreateSettings: this endpoint must never write.
    const [settings] = await db.select({ config: dealerSettingsTable.config }).from(dealerSettingsTable)
      .where(eq(dealerSettingsTable.dealerId, process.env.STOCK_DEALER_ID ?? 'luxxy-motors'));
    const config = (settings?.config ?? {}) as Record<string, Record<string, unknown> | undefined>;
    return {
      name: brochureText(config.identity?.name) || 'Luxxy Motors',
      phone: brochureText(config.contact?.phone),
      email: brochureText(config.contact?.email),
      address: ['street', 'city', 'region', 'postcode'].map((key) => brochureText(config.address?.[key])).filter(Boolean).join(', '),
    };
  },
});

router.get('/vehicles/:id/brochure.pdf', async (req, res) => {
  const result = await generate(req.params.id, brochureOrigin(req.get('host'), req.get('x-forwarded-proto')));
  res.status(result.status).set(result.headers).send(result.body);
});

export default router;
