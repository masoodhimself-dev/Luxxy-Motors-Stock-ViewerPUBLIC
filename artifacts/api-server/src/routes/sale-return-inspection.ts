import { Router } from 'express';
import { pool } from '@workspace/db';
import { SaleWorkspaceError } from '@workspace/vehicle-meta';
import { requirePermission, requireStaff, staffLabel } from '../middlewares/staff-auth';
import { currentDealerId } from '../lib/tenant-context';
import { completeSaleReturnInspection } from '../lib/sale-return-inspection';

const router = Router();
router.use('/sale-return-inspection', requireStaff, (_req, res, next) => {
  res.set({ 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
  next();
});
router.post('/sale-return-inspection/:saleId', requirePermission('sales.manage'), async (req, res) => {
  try {
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 4096) throw new SaleWorkspaceError('The inspection note is too large.', 413);
    res.json(await completeSaleReturnInspection(pool, currentDealerId(), String(req.params.saleId), req.body ?? {}, staffLabel(req)));
  } catch (error) {
    if (error instanceof SaleWorkspaceError) { res.status(error.status).json({ error: error.message }); return; }
    req.log.error({ err: error }, 'Returned vehicle inspection failed');
    res.status(500).json({ error: 'The inspection could not be saved. Your vehicle and sale records remain unchanged.' });
  }
});
export default router;
