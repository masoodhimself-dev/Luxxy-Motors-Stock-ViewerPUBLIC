import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { requirePermission, requireStaff } from '../middlewares/staff-auth';
import { currentDealerId, currentTenant } from '../lib/tenant-context';
import { shareRequestOrigin } from '../lib/share-origin';
import { searchReadiness } from '../lib/search-readiness';
import { indexNowReadiness } from '../lib/indexnow';
import { verifiedSeoScope } from './seo';

const router: IRouter = Router();
router.get('/staff/search-visibility', requireStaff, requirePermission('settings.publish'), async (req, res, next) => {
  try {
    const row = (await pool.query('SELECT config FROM dealer_settings WHERE dealer_id=$1', [currentDealerId()])).rows[0];
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' })
      .json({ ...searchReadiness(row?.config ?? {}, shareRequestOrigin(req), Boolean(currentTenant()?.demo)), indexNow: indexNowReadiness(verifiedSeoScope()) });
  } catch (error) { next(error); }
});
export default router;
