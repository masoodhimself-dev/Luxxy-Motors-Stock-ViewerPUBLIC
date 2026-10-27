import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db } from '@workspace/db';
import { requireStaff } from '../middlewares/staff-auth';
import { currentDealerId } from '../lib/tenant-context';

const router = Router();
const uuid = z.string().uuid();
/** Retained historical service-photo reads for enquiry emails only.
 * Stock administration, preparation, plate edits, reservation release and
 * upload capabilities have no routes in the core portal.
 */
router.get('/staff/inventory/:id/photos/:photo', requireStaff, async (req, res) => {
  res.set({
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
  });
  if (!uuid.safeParse(req.params.id).success || !uuid.safeParse(req.params.photo).success) {
    res.status(404).end(); return;
  }
  const row = (await db.execute(sql`SELECT encode(jpeg,'hex') AS bytes FROM vehicle_service_photos WHERE id=${req.params.photo}::uuid AND vehicle_id=${req.params.id}::uuid AND dealer_id=${currentDealerId()}`)).rows[0];
  if (!row) { res.status(404).end(); return; }
  res.type('image/jpeg').send(Buffer.from(String(row.bytes), 'hex'));
});
export default router;
