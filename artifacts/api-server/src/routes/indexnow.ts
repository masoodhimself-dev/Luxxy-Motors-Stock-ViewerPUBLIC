import { timingSafeEqual } from 'node:crypto';
import { Router, type IRouter } from 'express';
import { requirePermission, requireStaff } from '../middlewares/staff-auth';
import { indexNowConfiguration, indexNowReadiness, IndexNowError, submitIndexNow, type IndexNowTransport } from '../lib/indexnow';
import { loadDealerSitemap, verifiedSeoScope, type SeoRouteDependencies } from './seo';

type Dependencies = SeoRouteDependencies & { transport?: IndexNowTransport; now?: () => number };
const COOLDOWN_MS = 5 * 60_000;

/** Mount after verified tenant resolution; API actions retain normal staff permission/origin checks. */
export function createIndexNowRouter(dependencies: Dependencies = { scope: verifiedSeoScope, load: loadDealerSitemap }): IRouter {
  const router = Router();
  // Per-process guard supplements the explicit manual action. It is not a durable
  // multi-instance quota or submission history, and never claims to be one.
  const attempts = new Map<string, number>();
  const inFlight = new Set<string>();
  const now = dependencies.now ?? Date.now;
  router.get('/:keyFile', (req, res, next) => {
    const match = /^([a-f0-9]{64})\.txt$/.exec(String(req.params.keyFile));
    if (!match) { next(); return; }
    res.set('Cache-Control', 'no-store');
    try {
      const configuration = indexNowConfiguration(dependencies.scope());
      if (!configuration || !timingSafeEqual(Buffer.from(match[1]), Buffer.from(configuration.key))) {
        res.status(404).type('text/plain').send('Verification file unavailable.'); return;
      }
      res.type('text/plain; charset=utf-8').send(configuration.key);
    } catch { res.status(404).type('text/plain').send('Verification file unavailable.'); }
  });
  router.use('/api/staff/search-visibility/indexnow', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }); next();
  });
  router.get('/api/staff/search-visibility/indexnow', requireStaff, requirePermission('settings.publish'), (_req, res, next) => {
    try { res.json(indexNowReadiness(dependencies.scope())); } catch (error) { next(error); }
  });
  router.post('/api/staff/search-visibility/indexnow', requireStaff, requirePermission('settings.publish'), async (req, res, next) => {
    const scope = dependencies.scope();
    if (!scope) { res.status(404).json({ error: 'A verified live dealership is required.' }); return; }
    if (scope.demo) { res.status(403).json({ error: 'Search notifications are unavailable for demonstrations.', code: 'DEMO_EXCLUDED' }); return; }
    if (!req.body || req.body.confirmed !== true || Object.keys(req.body).some(key => key !== 'confirmed')) {
      res.status(400).json({ error: 'Confirm the notification of current public pages.', code: 'INDEXNOW_CONFIRMATION_REQUIRED' }); return;
    }
    const configuration = indexNowConfiguration(scope);
    if (!configuration) { res.status(409).json({ error: 'IndexNow is not enabled and configured on this server.', code: 'INDEXNOW_DISABLED' }); return; }
    const time = now();
    // Bound memory to recent manual attempts, not one permanent entry per dealer.
    for (const [key, timestamp] of attempts) if (time - timestamp >= COOLDOWN_MS) attempts.delete(key);
    const last = attempts.get(scope.dealerId);
    if (inFlight.has(scope.dealerId) || (last !== undefined && time - last < COOLDOWN_MS)) {
      res.status(429).set('Retry-After', String(Math.max(1, Math.ceil((COOLDOWN_MS - (time - (last ?? time))) / 1000))))
        .json({ error: 'Please wait before notifying search engines again.', code: 'INDEXNOW_COOLDOWN' }); return;
    }
    if (attempts.size >= 5000) { res.status(503).set('Retry-After', '60').json({ error: 'Search notifications are temporarily busy.' }); return; }
    attempts.set(scope.dealerId, time); inFlight.add(scope.dealerId);
    try {
      const data = await dependencies.load(scope);
      res.json(await submitIndexNow(configuration, scope, data, dependencies.transport));
    } catch (error) {
      if (error instanceof IndexNowError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
      next(error);
    } finally { inFlight.delete(scope.dealerId); }
  });
  return router;
}

export default createIndexNowRouter();
