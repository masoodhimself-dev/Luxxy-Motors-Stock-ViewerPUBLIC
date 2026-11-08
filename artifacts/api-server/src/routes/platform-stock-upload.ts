import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { importAdmission } from '../lib/stock-import-admission';
import { platformStockUploadBlock, platformStockUploadLimit, platformStockUploadTooLarge, readPlatformStockUploadTarget } from '../lib/platform-stock-upload';
import { runWithTenant } from '../lib/tenant-context';
import { importPlatformStock } from './stock';

// Mounted behind Platform Admin host, origin and administrator checks.
const router = Router();
router.post('/dealers/:id/stock-upload', async (req, res) => {
  if (!req.is('application/json')) { res.status(415).json({ error: 'Choose a stock JSON file.' }); return; }
  if (Number(req.get('content-length')) > platformStockUploadLimit ||
      (typeof res.locals.platformStockUploadBytes !== 'number' &&
       Buffer.byteLength(JSON.stringify(req.body) ?? '') > platformStockUploadLimit)) {
    res.status(413).json({ error: platformStockUploadTooLarge }); return;
  }
  await importAdmission.run(req, res, async () => {
    const target = await readPlatformStockUploadTarget(req.params.id);
    if (!target) { res.status(404).json({ error: 'Dealership not found.' }); return; }
    const blocked = platformStockUploadBlock(target);
    if (blocked) { res.status(409).json({ error: blocked }); return; }
    await runWithTenant({
      dealerId: target.id, canonicalOrigin: target.canonicalOrigin, platform: target.stockPlatform,
      retailerId: target.retailerId, sourceUrl: target.sourceUrl, demo: Boolean(target.demoExpiresAt), kind: 'import',
    }, () => importPlatformStock(req, res));
    if (res.statusCode === 201) req.log?.info({ actor: getAuth(req).userId, dealerId: target.id }, 'Platform administrator uploaded stock');
  });
});
export default router;
