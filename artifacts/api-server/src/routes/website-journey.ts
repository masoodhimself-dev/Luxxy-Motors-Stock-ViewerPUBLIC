import { Router, type Request } from 'express';
import { pool } from '@workspace/db';
import { currentDealerId, currentTenant } from '../lib/tenant-context';
import { publicLookupConnection } from '../lib/request-network';
import { requireStaff } from '../middlewares/staff-auth';
import { staffWriteOriginAllowed } from '../middlewares/staff-write-origin';
import { createWebsiteJourneyLimiter, parseWebsiteJourney, recordWebsiteJourney, websiteJourneyRange, websiteJourneyReport, WebsiteJourneyError, type WebsiteJourneyDatabase } from '../lib/website-journey';

export function websiteJourneyOriginAllowed(req: Pick<Request, 'method'> & { get(name: string): string | undefined }) {
  // Public telemetry has no approved server-to-server caller; fail closed without browser origin metadata.
  return Boolean((req.get('origin') || req.get('sec-fetch-site') === 'same-origin') && staffWriteOriginAllowed(req));
}

export function websiteJourneyRouter(database: WebsiteJourneyDatabase = pool) {
  const router = Router(), allow = createWebsiteJourneyLimiter();
  router.use(['/website-journey', '/staff/website-journey'], (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow' }); next();
  });
  router.post('/website-journey', async (req, res) => {
    if (!websiteJourneyOriginAllowed({ method: req.method, get: name => req.get(name) })) {
      res.status(403).json({ error: 'Use this dealership website.' }); return;
    }
    if (!req.is('application/json')) { res.status(415).json({ error: 'Use a JSON event.' }); return; }
    if (Number(req.get('content-length') ?? 0) > 128 || Buffer.byteLength(JSON.stringify(req.body) ?? '') > 128) {
      res.status(413).json({ error: 'Website event is too large.' }); return;
    }
    try {
      if (Object.keys(req.query).length) throw new WebsiteJourneyError('Send only a website event.');
      const stage = parseWebsiteJourney(req.body);
      if (req.get('dnt') === '1' || req.get('sec-gpc') === '1' || currentTenant()?.demo) { res.sendStatus(204); return; }
      const dealer = currentDealerId();
      if (!allow(dealer, publicLookupConnection(req))) { res.set('Retry-After', '600').status(429).json({ error: 'Please try later.' }); return; }
      await recordWebsiteJourney(database, dealer, stage);
      res.sendStatus(204);
    } catch (error) {
      if (error instanceof WebsiteJourneyError) { res.status(error.status).json({ error: error.message }); return; }
      req.log?.warn('Website event count could not be saved.');
      res.status(503).json({ error: 'Website event count is unavailable.' });
    }
  });
  router.get('/staff/website-journey', requireStaff, async (req, res) => {
    if (req.staff?.role !== 'owner') { res.status(403).json({ error: 'Only an owner can view website event counts.' }); return; }
    try {
      if (Object.keys(req.query).some(key => !['from', 'to'].includes(key))) throw new WebsiteJourneyError('Choose a reporting period only.');
      const range = websiteJourneyRange(req.query.from, req.query.to);
      res.json(await websiteJourneyReport(database, currentDealerId(), range.from, range.to));
    } catch (error) {
      if (error instanceof WebsiteJourneyError) { res.status(error.status).json({ error: error.message }); return; }
      req.log?.warn('Website event report could not load.');
      res.status(503).json({ error: 'Website event report is unavailable.' });
    }
  });
  return router;
}
export default websiteJourneyRouter();
