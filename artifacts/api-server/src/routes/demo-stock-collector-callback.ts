import { timingSafeEqual } from 'node:crypto';
import { db, demoOnboardingKeysTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
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
import { importSecretDigest, matchesImportSecret } from '../middlewares/tenant';
import { checkAutoTraderDemoSnapshot } from './stock';

export const demoStockCollectorCallbackPath = '/api/stock/demo-collector-callback';
const callback = express.Router();
const admission = createStockImportAdmission(1, Date.now, serviceLifecycle, () => true);
const failed = z.object({ status: z.literal('failed') }).strict();
const callbackCredentialPattern = /^[A-Za-z0-9_-]{43}$/;
const invalidCredential = { error: 'Invalid stock callback credential.' };

async function matchesOnboardingOwner(secret: string, ownerAuthUserId: string, callbackKey?: { id: string; validUntil: number }) {
  const [key] = await db.select({
    id: demoOnboardingKeysTable.id,
    secretHash: demoOnboardingKeysTable.secretHash,
    ownerAuthUserId: demoOnboardingKeysTable.ownerAuthUserId,
    revokedAt: demoOnboardingKeysTable.revokedAt,
    expiresAt: demoOnboardingKeysTable.expiresAt,
  }).from(demoOnboardingKeysTable).where(eq(demoOnboardingKeysTable.secretHash, importSecretDigest(secret)));
  if (!key || key.ownerAuthUserId !== ownerAuthUserId || key.revokedAt || !matchesImportSecret(secret, key.secretHash)) return false;
  return callbackKey
    ? key.id === callbackKey.id && callbackKey.validUntil > Date.now()
    : key.expiresAt.getTime() > Date.now();
}

const authenticate: RequestHandler = async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const config = demoStockCollectorConfig();
  if (!multiTenantEnabled() || config?.mode !== 'grok-webhook' ||
      normaliseTenantHost(req.get('host') ?? '') !== config.callbackHost) {
    res.status(404).json({ error: 'Stock callback unavailable.' });
    return;
  }
  const authorization = req.get('authorization');
  const onboardingSecret = req.get('x-demo-onboarding-secret');
  const supplied = config.callbackAuth === 'demo-onboarding'
    ? authorization === undefined ? onboardingSecret : undefined
    : onboardingSecret === undefined ? /^Bearer ([a-z0-9_-]{43})$/i.exec(authorization ?? '')?.[1] : undefined;
  if (!supplied || !callbackCredentialPattern.test(supplied) || req.get('x-stock-import-secret') !== undefined) {
    res.status(401).json(invalidCredential);
    return;
  }
  if (config.callbackAuth === 'demo-onboarding' && req.get('origin')) {
    res.status(403).json({ error: 'This callback is for the server-side onboarding worker.' });
    return;
  }
  const id = z.uuid().safeParse(req.params.jobId);
  const job = id.success ? await readDemoStockCollection(id.data) : null;
  if (!job || !config.retailerIds.has(job.retailer_id) || !isPlatformAdmin(job.requested_by)) {
    res.status(404).json({ error: 'Stock collection not found.' });
    return;
  }
  const valid = config.callbackAuth === 'demo-onboarding'
    ? await matchesOnboardingOwner(supplied, job.requested_by, config.callbackKey)
    : timingSafeEqual(Buffer.from(supplied), Buffer.from(demoStockCallbackProof(config, job)));
  if (!valid) {
    res.status(401).json(invalidCredential);
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
