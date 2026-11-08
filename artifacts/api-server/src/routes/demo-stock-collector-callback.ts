import { timingSafeEqual } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import { z } from 'zod/v4';
import { DemoSetupError } from '../lib/demo-creation';
import { importDemoLinkStock, invalidDemoStockMessage } from '../lib/demo-link-stock';
import { demoStockCallbackProof, demoStockCollectorConfig } from '../lib/demo-stock-collector';
import { claimDemoStockCollection, finishDemoStockCollection, publicCollectionJob, readDemoStockCollection, rejectDemoStockCollection, type CollectionJob } from '../lib/demo-stock-collection-jobs';
import { isPlatformAdmin } from '../lib/platform-admin';
import { platformStockUploadLimit } from '../lib/platform-stock-upload';
import { serviceLifecycle } from '../lib/service-lifecycle';
import { createStockImportAdmission } from '../lib/stock-import-admission';
import { stockPayloadHash } from '../lib/stock-payload-hash';
import { multiTenantEnabled, normaliseTenantHost } from '../lib/tenant-context';
import { checkAutoTraderDemoSnapshot } from './stock';

export const demoStockCollectorCallbackPath = '/api/stock/demo-collector-callback';
const callback = express.Router();
const admission = createStockImportAdmission(1, Date.now, serviceLifecycle, () => true);
const failed = z.object({ status: z.literal('failed') }).strict();

const authenticate: RequestHandler = async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const config = demoStockCollectorConfig();
  if (!multiTenantEnabled() || config?.mode !== 'grok-webhook' ||
      normaliseTenantHost(req.get('host') ?? '') !== config.callbackHost) {
    res.status(404).json({ error: 'Stock callback unavailable.' });
    return;
  }
  const supplied = /^Bearer ([a-z0-9_-]{43})$/i.exec(req.get('authorization') ?? '')?.[1];
  if (!supplied) {
    res.status(401).json({ error: 'Invalid stock callback credential.' });
    return;
  }
  const id = z.uuid().safeParse(req.params.jobId);
  const job = id.success ? await readDemoStockCollection(id.data) : null;
  if (!job || job.retailer_id !== config.retailerId || !isPlatformAdmin(job.requested_by)) {
    res.status(404).json({ error: 'Stock collection not found.' });
    return;
  }
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(demoStockCallbackProof(config, job)))) {
    res.status(401).json({ error: 'Invalid stock callback credential.' });
    return;
  }
  if (job.expires_at.getTime() <= Date.now()) {
    res.status(410).json({ error: 'Stock collection expired.' });
    return;
  }
  if (!req.is('application/json')) {
    res.status(415).json({ error: 'Send a JSON stock snapshot.' });
    return;
  }
  res.locals.demoStockCollectorJob = job;
  next();
};

callback.post('/:jobId', authenticate, admission.middleware, express.json({ limit: platformStockUploadLimit }), async (req, res) => {
  await admission.run(req, res, async () => {
    const job = res.locals.demoStockCollectorJob as CollectionJob;
    if (job.expires_at.getTime() <= Date.now()) {
      res.status(410).json({ error: 'Stock collection expired.' });
      return;
    }
    if (failed.safeParse(req.body).success) {
      if (job.status === 'failed' || await rejectDemoStockCollection(job.id)) {
        res.json(publicCollectionJob((await readDemoStockCollection(job.id))!));
      } else res.status(409).json({ error: 'A snapshot is already being processed for this collection.' });
      return;
    }
    const hash = stockPayloadHash(req.body);
    if (job.status === 'ready' && job.payload_hash === hash) { res.json(publicCollectionJob(job)); return; }
    const snapshot = checkAutoTraderDemoSnapshot(req.body, job.retailer_id);
    if (!snapshot) {
      res.status(422).json({ error: invalidDemoStockMessage });
      return;
    }
    const claimToken = await claimDemoStockCollection(job.id, hash);
    if (!claimToken) {
      const current = await readDemoStockCollection(job.id);
      if (current?.status === 'ready' && current.payload_hash === hash) { res.json(publicCollectionJob(current)); return; }
      res.set('Retry-After', '5').status(409).json({ error: 'This stock collection cannot accept the snapshot right now.' });
      return;
    }
    try {
      const result = await importDemoLinkStock(req, res, { retailerId: job.retailer_id, sourceUrl: job.source_url }, req.body, snapshot, job.requested_by);
      if (!result) {
        await finishDemoStockCollection(job.id, claimToken, undefined, res.statusCode < 500 ? 'DealerOS could not import the collected stock. Review the demo or upload a complete JSON export.' : undefined);
        return;
      }
      const finished = await finishDemoStockCollection(job.id, claimToken, result);
      if (!finished) { res.status(409).json({ error: 'Stock collection is still being confirmed.' }); return; }
      res.json(publicCollectionJob(finished));
    } catch (error) {
      const rejected = error instanceof DemoSetupError && error.status < 500;
      await finishDemoStockCollection(job.id, claimToken, undefined, rejected ? error.message : undefined);
      if (res.headersSent) return;
      if (rejected) { res.status(error.status).json({ error: error.message }); return; }
      req.log?.warn('Private demo stock callback failed');
      res.status(503).json({ error: 'DealerOS could not confirm the private demo. Retry the identical snapshot.' });
    }
  });
});

export default callback;
