import { cazooDealershipLink } from '@workspace/vehicle-meta';
import { getAuth } from '@clerk/express';
import { Router } from 'express';
import { z } from 'zod/v4';
import { DemoSetupError } from '../lib/demo-creation';
import { importDemoLinkStock, invalidDemoStockMessage } from '../lib/demo-link-stock';
import { autoTraderDealerLink, collectDemoStock, demoStockCollectorConfig, DemoStockCollectorError, requestGrokDemoStock } from '../lib/demo-stock-collector';
import { publicCollectionJob, readDemoStockCollection, rejectDemoStockCollection, startDemoStockCollection } from '../lib/demo-stock-collection-jobs';
import { createStockImportAdmission, importAdmission } from '../lib/stock-import-admission';
import { serviceLifecycle } from '../lib/service-lifecycle';
import { checkAutoTraderDemoSnapshot, checkCazooDemoSnapshot } from './stock';
import { platformStockUploadLimit } from '../lib/platform-stock-upload';
import { demoDealershipDetails } from '../lib/demo-business-details';

const router = Router();
const input = z.object({ sourceUrl: z.string().trim().min(1).max(2048) }).strict();
const cazooInput = input.extend({ stock: z.record(z.string(), z.unknown()), logoData: z.string().min(1).max(400000).optional(), dealershipDetails: demoDealershipDetails.optional() });
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

// Grok's export arrives in the request. This workflow never calls a stock provider.
router.post('/demos/from-cazoo', async (req, res) => {
  await importAdmission.run(req, res, async () => {
    const parsed = cazooInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Paste a Cazoo dealership link and its stock JSON. Upload a PNG or JPEG if you have a logo.' });
      return;
    }
    const { sourceUrl, stock, logoData, dealershipDetails } = parsed.data;
    const dealer = cazooDealershipLink(sourceUrl);
    if (!dealer) {
      res.status(400).json({ error: 'Paste a Cazoo dealership page link that ends with the retailer number.' });
      return;
    }
    if (Buffer.byteLength(JSON.stringify(stock)) > platformStockUploadLimit) {
      res.status(413).json({ error: 'Use a stock JSON export of 5 MB or less.' });
      return;
    }
    const checked = checkCazooDemoSnapshot(stock, dealer.retailerId);
    if (!checked) {
      res.status(422).json({ error: 'Use a complete, current Grok Bot stock export for this Cazoo dealership. Check the retailer and make sure all adverts are included.' });
      return;
    }
    try {
      const result = await importDemoLinkStock(req, res, dealer, checked.body, checked.snapshot, getAuth(req).userId!, { platform: 'cazoo', logoData, dealershipDetails });
      if (!result) return;
      res.status(result.created ? 201 : 200).json({
        dealerId: result.dealerId,
        dealerName: result.dealerName,
        previewPath: `/platform/preview/${result.dealerId}`,
        received: result.received,
        hasLogo: result.hasLogo,
      });
    } catch (error) {
      if (error instanceof DemoSetupError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log?.error('Private Cazoo demo import failed');
      res.status(500).json({ error: 'Could not prepare the private demo. Try again with the same JSON.' });
    }
  });
});

export default router;
