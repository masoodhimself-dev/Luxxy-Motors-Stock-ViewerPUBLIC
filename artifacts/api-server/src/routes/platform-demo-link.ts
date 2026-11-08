import { getAuth } from '@clerk/express';
import { Router } from 'express';
import { z } from 'zod/v4';
import { DemoSetupError } from '../lib/demo-creation';
import { importDemoLinkStock, invalidDemoStockMessage } from '../lib/demo-link-stock';
import { autoTraderDealerLink, collectDemoStock, demoStockCollectorConfig, DemoStockCollectorError, requestGrokDemoStock } from '../lib/demo-stock-collector';
import { publicCollectionJob, readDemoStockCollection, rejectDemoStockCollection, startDemoStockCollection } from '../lib/demo-stock-collection-jobs';
import { createStockImportAdmission } from '../lib/stock-import-admission';
import { serviceLifecycle } from '../lib/service-lifecycle';
import { checkAutoTraderDemoSnapshot } from './stock';

const router = Router();
const input = z.object({ sourceUrl: z.string().trim().min(1).max(2048) }).strict();
const demoLinkAdmission = createStockImportAdmission(1, Date.now, serviceLifecycle, () => true);

router.get('/demos/collection/:jobId', async (req, res) => {
  const id = z.uuid().safeParse(req.params.jobId);
  const job = id.success ? await readDemoStockCollection(id.data) : null;
  if (!job) { res.status(404).json({ error: 'Stock collection not found.' }); return; }
  res.json(publicCollectionJob(job));
});

// Mounted behind the Platform Admin host, administrator and origin checks.
router.post('/demos/from-autotrader', demoLinkAdmission.middleware, async (req, res) => {
  const parsed = input.safeParse(req.body);
  const dealer = parsed.success ? autoTraderDealerLink(parsed.data.sourceUrl) : null;
  if (!dealer) {
    res.status(400).json({ error: 'Paste the dealership’s Auto Trader stock page link. The link ends with the retailer number.' });
    return;
  }
  const collector = demoStockCollectorConfig();
  if (!collector) {
    res.status(503).json({ error: 'Auto Trader collection is not connected. Use the stock JSON upload to create this demo.' });
    return;
  }
  if (collector.mode === 'grok-webhook' && !collector.retailerIds.has(dealer.retailerId)) {
    res.status(422).json({ error: 'The Grok connection is not authorised for this retailer. Upload a complete JSON export instead.' });
    return;
  }
  await demoLinkAdmission.run(req, res, async () => {
    try {
      const adminId = getAuth(req).userId!;
      if (collector.mode === 'grok-webhook') {
        const { job, created } = await startDemoStockCollection(dealer, adminId);
        if (created) {
          const acknowledged = await requestGrokDemoStock(collector, job);
          if (acknowledged === false) await rejectDemoStockCollection(job.id);
        }
        res.status(202).json({ jobId: job.id, status: 'collecting' });
        return;
      }
      const body = await collectDemoStock(collector, dealer);
      if (res.destroyed) return;
      const snapshot = checkAutoTraderDemoSnapshot(body, dealer.retailerId);
      if (!snapshot) { res.status(422).json({ error: invalidDemoStockMessage }); return; }
      const result = await importDemoLinkStock(req, res, dealer, body, snapshot, adminId);
      if (!result) return;
      res.status(result.created ? 201 : 200).json({
        dealerId: result.dealerId, dealerName: result.dealerName, previewPath: `/platform/preview/${result.dealerId}`, received: result.received,
      });
    } catch (error) {
      if (error instanceof DemoStockCollectorError || error instanceof DemoSetupError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log?.error('Private demo stock link import failed');
      res.status(500).json({ error: 'The private demo could not be prepared. Retry the same link or use a stock JSON export.' });
    }
  });
});

export default router;
