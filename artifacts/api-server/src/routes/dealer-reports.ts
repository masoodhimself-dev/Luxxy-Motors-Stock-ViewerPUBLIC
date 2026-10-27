import { Router } from 'express';
import { pool } from '@workspace/db';
import { currentDealerId } from '../lib/tenant-context';
import { requireStaff, staffHasPermission } from '../middlewares/staff-auth';
import { readDealerReport, type ReportPeriod } from '../lib/dealer-reports';

const router = Router();
router.get('/dealer-reports', requireStaff, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const period = req.query.period ?? '30d';
  if (period !== '30d' && period !== '90d') { res.status(400).json({ error: 'Choose a supported report period.' }); return; }
  try {
    const includeSales = staffHasPermission(req, 'finance.export');
    res.json(await readDealerReport(pool, currentDealerId(), period as ReportPeriod, includeSales));
  } catch (error) {
    req.log.error({ err: error }, 'Dealer reports could not be loaded');
    res.status(503).json({ error: 'Reports are temporarily unavailable. Please try again.' });
  }
});
export default router;
