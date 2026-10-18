import { Router, type Request, type Response } from 'express';
import { z } from 'zod/v4';
import { requirePermission, requireStaff } from '../middlewares/staff-auth';
import { requireDealerFeature } from '../middlewares/dealer-features';
import { currentDealerId, currentTenant, multiTenantEnabled } from '../lib/tenant-context';
import { siteOrigin } from '../lib/enquiry-links';
import { dealerFeatureEnabled } from '../lib/dealer-features';
import { PostgresTestDriveDeclarations, TestDriveDeclarationError, type TestDriveDeclarationService } from '../lib/test-drive-declarations';

/** Injectable service lets isolated tests exercise the real route and authorization rules. */
export function createTestDriveDeclarationsRouter(service: TestDriveDeclarationService = new PostgresTestDriveDeclarations()) {
  const router = Router(), attempts = new Map<string, { until: number; count: number }>();
  router.use(['/staff/enquiries/:id/test-drive-declarations', '/test-drive-declarations'], (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' });
    const origin = req.get('origin'); let allowedOrigin = !origin;
    if (origin) try {
      const source = new URL(origin), canonical = new URL(siteOrigin());
      allowedOrigin = !source.username && !source.password && source.origin === origin && (source.origin === canonical.origin || ((currentTenant()?.kind === 'website' || !multiTenantEnabled()) && source.protocol === canonical.protocol && source.host.toLowerCase() === (req.get('host') || '').toLowerCase()));
    } catch { allowedOrigin = false; }
    if (!allowedOrigin) { res.status(403).json({ error: 'Open the declaration on this dealership website.' }); return; }
    if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > 4096) { res.status(413).json({ error: 'Declaration request is too large.' }); return; }
    const now = Date.now(), key = `${currentDealerId()}:${req.ip}:${req.method === 'GET' ? 'read' : 'write'}`;
    let bucket = attempts.get(key);
    if (!bucket || bucket.until <= now) {
      if (attempts.size >= 10000) for (const [entry, value] of attempts) if (value.until <= now) attempts.delete(entry);
      if (attempts.size >= 10000) { res.set('Retry-After', '60').status(429).json({ error: 'Too many declaration requests. Try again shortly.' }); return; }
      bucket = { until: now + 60000, count: 0 }; attempts.set(key, bucket);
    }
    if (++bucket.count > (req.method === 'GET' ? 60 : 20)) { res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.until - now) / 1000)))).status(429).json({ error: 'Too many declaration requests. Try again shortly.' }); return; }
    next();
  });
  router.use('/staff/enquiries/:id/test-drive-declarations', requireStaff, requirePermission('sales.manage'));
  const uuid = z.uuid();
  const staffIds = (req: Request) => {
    if (!uuid.safeParse(req.params.id).success || (req.params.declarationId && !uuid.safeParse(req.params.declarationId).success)) throw new TestDriveDeclarationError('Declaration not found.', 404);
  };
  const failure = (req: Request, res: Response, error: unknown) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Check the declaration fields and confirm you have read the statement.' }); return; }
    if (error instanceof TestDriveDeclarationError) { res.status(error.status).json({ error: error.message }); return; }
    if ((error as { code?: string })?.code === '23505') { res.status(409).json({ error: 'This declaration token or request was already used. Generate a new link.' }); return; }
    req.log?.warn('Test drive declaration request failed'); res.status(503).json({ error: 'The declaration could not be loaded or saved. Retry the same request.' });
  };
  router.get('/staff/enquiries/:id/test-drive-declarations', async (req, res) => {
    try { staffIds(req); res.json(await service.list(req.params.id)); } catch (error) { failure(req, res, error); }
  });
  router.post('/staff/enquiries/:id/test-drive-declarations', requireDealerFeature('testDriveDeclarations'), async (req, res) => {
    try { staffIds(req); const result = await service.create(String(req.params.id), req.body, req.staff!.authUserId); res.status(result.replayed ? 200 : 201).json(result); } catch (error) { failure(req, res, error); }
  });
  router.post('/staff/enquiries/:id/test-drive-declarations/:declarationId/revoke', async (req, res) => {
    try { staffIds(req); z.object({}).strict().parse(req.body ?? {}); res.json(await service.revoke(req.params.id, req.params.declarationId, req.staff!.authUserId)); } catch (error) { failure(req, res, error); }
  });
  router.post('/staff/enquiries/:id/test-drive-declarations/:declarationId/checks', async (req, res) => {
    try { staffIds(req); res.json(await service.checks(req.params.id, req.params.declarationId, req.body, req.staff!.authUserId)); } catch (error) { failure(req, res, error); }
  });
  router.get('/test-drive-declarations/:token', async (req, res) => {
    try {
      const record = await service.read(req.params.token);
      let signingEnabled = false;
      try { signingEnabled = await dealerFeatureEnabled('testDriveDeclarations'); } catch { /* History remains readable; new signing fails closed. */ }
      res.json({ ...record, signingEnabled });
    } catch (error) { failure(req, res, error); }
  });
  router.post('/test-drive-declarations/:token', requireDealerFeature('testDriveDeclarations'), async (req, res) => {
    try { res.json(await service.accept(String(req.params.token), req.body)); } catch (error) { failure(req, res, error); }
  });
  return router;
}
export default createTestDriveDeclarationsRouter();
