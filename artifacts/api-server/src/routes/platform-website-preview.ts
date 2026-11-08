import { getAuth } from '@clerk/express';
import { db, dealerDemosTable, dealershipsTable } from '@workspace/db';
import { and, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { isPlatformAdmin } from '../lib/platform-admin';
import { currentDealerId, multiTenantEnabled, normaliseTenantHost, runWithTenant } from '../lib/tenant-context';
import publicRoutes from './index';

const router = Router({ mergeParams: true });
const websitePages = /^(?:\/|\/(?:stock|contact|warranty|saved|enquire)\/?|\/(?:vehicle|cars|s)\/[a-z0-9-]+\/?)$/i;
const websiteReads = /^\/(?:stock|dealer-settings|features|vehicles\/(?:short\/)?[a-z0-9-]+|website-assets\/[a-f0-9-]{36})\/?$/i;

router.use(async (req, res, next) => {
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  const host = normaliseTenantHost(req.get('host') ?? '');
  if (!multiTenantEnabled() || !host || host !== normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST ?? '') ||
    (req.get('origin') && req.get('origin') !== `https://${host}`) ||
    !isPlatformAdmin(getAuth(req).userId ?? undefined)) {
    res.status(403).json({ error: 'Sign in to Platform Admin to open this private preview.' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).set('Allow', 'GET, HEAD').json({ error: 'The private website preview is read only.' });
    return;
  }
  const dealerId = req.params.dealerId;
  if (typeof dealerId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(dealerId)) {
    res.status(404).json({ error: 'This dealership preview could not be found.' });
    return;
  }
  const [row] = await db.select({
    dealer: dealershipsTable,
    demo: { id: dealerDemosTable.dealerId, expiresAt: dealerDemosTable.expiresAt },
  }).from(dealershipsTable).leftJoin(dealerDemosTable, and(eq(dealerDemosTable.dealerId, dealershipsTable.id), isNull(dealerDemosTable.convertedAt)))
    .where(eq(dealershipsTable.id, dealerId));
  const dealer = row?.dealer;
  const demo = row?.demo;
  if (!dealer || (dealer.status !== 'draft' && !(dealer.status === 'active' && demo)) || (demo && demo.expiresAt.getTime() <= Date.now())) {
    res.status(404).json({ error: 'This preview is available for drafts and current demonstrations.' });
    return;
  }
  res.locals.privateWebsitePreview = true;
  res.locals.previewDemo = Boolean(demo);
  runWithTenant({
    dealerId: dealer.id, canonicalOrigin: dealer.canonicalOrigin,
    platform: dealer.stockPlatform, retailerId: dealer.retailerId, sourceUrl: dealer.sourceUrl,
    kind: 'preview',
  }, next);
});

router.use('/api', async (req, res, next) => {
  if (req.path === '/demo-logo' && res.locals.previewDemo === true) {
    const [artwork] = await db.select({ header: dealerDemosTable.logoData, footer: dealerDemosTable.footerLogoData })
      .from(dealerDemosTable).where(and(eq(dealerDemosTable.dealerId, currentDealerId()), isNull(dealerDemosTable.convertedAt)));
    const data = req.query.variant === 'footer' ? artwork?.footer || artwork?.header : artwork?.header;
    const image = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data ?? '');
    if (!image) { res.status(404).end(); return; }
    res.set('X-Content-Type-Options', 'nosniff').type(`image/${image[1]}`).send(Buffer.from(image[2], 'base64'));
    return;
  }
  if (req.path === '/reservations/payment-readiness') {
    res.json({ enabled: false, mode: null, prepared: false });
    return;
  }
  if (!websiteReads.test(req.path)) {
    res.status(404).json({ error: 'This action is unavailable in the private preview.' });
    return;
  }
  publicRoutes(req, res, error => {
    if (error) next(error);
    else res.status(404).json({ error: 'Preview data could not be found.' });
  });
});

router.use((req, res, next) => {
  if (websitePages.test(req.path) && req.accepts('html')) next();
  else res.status(404).json({ error: 'This page is unavailable in the private preview.' });
});

export default router;
