import { getAuth } from '@clerk/express';
import { db, dealerDemosTable, dealerSettingsTable, dealershipsTable } from '@workspace/db';
import { GetDealerSettingsResponse } from '@workspace/api-zod';
import { isWebsiteTemplateId, websiteTemplateDefinition, type WebsiteTemplateId } from '@workspace/vehicle-meta/website-templates';
import { and, eq, isNull } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { isPlatformAdmin } from '../lib/platform-admin';
import { currentDealerId, multiTenantEnabled, normaliseTenantHost, runWithTenant } from '../lib/tenant-context';
import publicRoutes from './index';
import { settingsSnapshot } from './dealer-settings';
import { withWebsiteTemplate } from '../lib/website-template-settings';
import { borzPage } from '../lib/borz-frontend';
import { demoShowcaseTarget, readDemoShowcaseToken } from '../lib/demo-showcase';

const router = Router({ mergeParams: true });
const websiteRouter = Router();
const websitePages = /^(?:\/|\/(?:stock|contact|warranty|saved|enquire)\/?|\/(?:vehicle|cars|s)\/[a-z0-9-]+\/?)$/i;
const websiteReads = /^\/(?:stock|dealer-settings|features|vehicles\/(?:short\/)?[a-z0-9-]+|website-assets\/[a-f0-9-]{36})\/?$/i;
const cachedMotRead = /^\/vehicles\/[a-f0-9-]{36}\/mot-history\/?$/i;

function settingsChanged(req: Request, res: Response, dealerId: string, revision: number) {
  res.set('x-settings-revision', String(revision)).status(409);
  if ((websitePages.test(req.path) || (req.params.templateId === 'borz' && borzPage(req.path))) && req.accepts('html')) {
    // The ID was checked before this function is called. It is still encoded as
    // a query value; no dealership name or arbitrary request content is rendered.
    const back = `/platform?dealer=${encodeURIComponent(dealerId)}&amp;tab=Website`;
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Settings changed · DealerOS</title><style>body{margin:0;background:#f3f4f5;color:#202b39;font-family:Arial,sans-serif}main{max-width:560px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #d8dde3}h1{font-size:30px;line-height:1.2;margin:0 0 16px}p{font-size:16px;line-height:1.7;margin:0 0 24px}a{display:inline-block;padding:14px 20px;background:#202b39;color:#fff;text-decoration:none;font-size:16px;font-weight:600}a:focus-visible{outline:3px solid #956d20;outline-offset:4px}@media(max-width:640px){main{margin:32px 18px;padding:24px}h1{font-size:27px}}</style></head><body><main><h1>Website settings have changed</h1><p>This preview used an older version of the dealership settings. Return to Platform Admin and open a fresh preview before applying a template.</p><a href="${back}">Reopen preview</a></main></body></html>`);
    return;
  }
  res.json({ error: 'Website settings have changed. Refresh and review the template again.', revision });
}

router.use(async (req, res, next) => {
  // A candidate HTML request continues past both mounted preview paths to the SPA.
  // Do not authorise it a second time as an ordinary draft-only preview.
  if (res.locals.privateWebsitePreview === true) { next('router'); return; }
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
  const candidate = req.params.templateId;
  const revisionText = req.params.templateRevision;
  const candidateRequested = candidate !== undefined || revisionText !== undefined;
  if (candidateRequested && (!isWebsiteTemplateId(candidate) || typeof revisionText !== 'string' || !/^(?:0|[1-9]\d*)$/.test(revisionText) || !Number.isSafeInteger(Number(revisionText)))) {
    res.status(400).json({ error: 'Choose a supported website template and a valid settings revision.' });
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
    settings: { revision: dealerSettingsTable.revision },
  }).from(dealershipsTable).leftJoin(dealerDemosTable, and(eq(dealerDemosTable.dealerId, dealershipsTable.id), isNull(dealerDemosTable.convertedAt)))
    .leftJoin(dealerSettingsTable, eq(dealerSettingsTable.dealerId, dealershipsTable.id))
    .where(eq(dealershipsTable.id, dealerId));
  const dealer = row?.dealer;
  const demo = row?.demo;
  if (!dealer || (dealer.status !== 'draft' && !(dealer.status === 'active' && (demo || candidateRequested))) || (demo && demo.expiresAt.getTime() <= Date.now())) {
    res.status(404).json({ error: 'This preview is available for drafts and current demonstrations.' });
    return;
  }
  if (candidateRequested) {
    if (!row.settings) { res.status(428).json({ error: 'The dealership website settings must be prepared before previewing a template.' }); return; }
    if (Number(revisionText) !== row.settings.revision) {
      settingsChanged(req, res, dealer.id, row.settings.revision);
      return;
    }
    res.locals.previewWebsiteTemplate = candidate;
    res.locals.previewSettingsRevision = row.settings.revision;
  }
  res.locals.privateWebsitePreview = true;
  res.locals.previewDemo = Boolean(demo);
  runWithTenant({
    dealerId: dealer.id, canonicalOrigin: dealer.canonicalOrigin,
    platform: dealer.stockPlatform, retailerId: dealer.retailerId, sourceUrl: dealer.sourceUrl,
    kind: 'preview',
  }, next);
});

websiteRouter.use('/api', async (req, res, next) => {
  if (req.path === '/dealer-settings' && isWebsiteTemplateId(res.locals.previewWebsiteTemplate)) {
    const snapshot = await settingsSnapshot();
    if (!res.locals.showcaseTemplates && snapshot.revision !== res.locals.previewSettingsRevision) {
      settingsChanged(req, res, currentDealerId(), snapshot.revision);
      return;
    }
    res.set({ 'x-settings-revision': String(snapshot.revision), ETag: `"${snapshot.revision}"` });
    res.json(GetDealerSettingsResponse.parse(withWebsiteTemplate(snapshot.config, res.locals.previewWebsiteTemplate)));
    return;
  }
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
  if (cachedMotRead.test(req.path)) {
    // Browsing a private demo can reuse public records without initiating a provider lookup.
    const url = new URL(req.url, 'https://preview.invalid');
    url.searchParams.set('cacheOnly', 'true');
    req.url = url.pathname + url.search;
  } else if (!websiteReads.test(req.path)) {
    res.status(404).json({ error: 'This action is unavailable on this website.' });
    return;
  }
  publicRoutes(req, res, error => {
    if (error) next(error);
    else res.status(404).json({ error: 'Preview data could not be found.' });
  });
});

websiteRouter.use((req, res, next) => {
  if (req.accepts('html') && res.locals.previewWebsiteTemplate === 'borz' && borzPage(req.path)) {
    res.locals.websitePreviewBase = req.baseUrl;
    res.locals.websitePreviewPath = req.path;
    next();
  } else if (websitePages.test(req.path) && req.accepts('html')) next();
  else res.status(404).json({ error: 'This page is unavailable on this website.' });
});

router.use(websiteRouter);

function unavailableShowcase(req: Request, res: Response, expired = false) {
  const title = expired ? 'This link has expired' : 'This link is unavailable';
  const message = 'Ask the person who shared it for a new link.';
  res.status(expired ? 410 : 404);
  if (req.method === 'GET' && req.accepts(['html', 'json']) === 'html' && !/(?:^|\/)api(?:\/|$)/.test(req.path)) {
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title}</title><style>body{margin:0;padding:32px;background:#f7f7f7;color:#202b39;font:16px/1.6 system-ui}main{max-width:36rem;margin:10vh auto}h1{font-size:clamp(1.5rem,4vw,2.2rem);line-height:1.2}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`);
    return;
  }
  res.json({ error: `${title}. ${message}` });
}

/** Possession grants only the selected read-only storefronts of one demo tenant. */
export const demoShowcaseRouter = Router();
demoShowcaseRouter.use((req, res, next) => {
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  const host = normaliseTenantHost(req.get('host') ?? '');
  if (!multiTenantEnabled() || !host || host !== normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST ?? '') ||
    (req.get('origin') && req.get('origin') !== `https://${host}`)) {
    unavailableShowcase(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).set('Allow', 'GET, HEAD').json({ error: 'This website is read only.' });
    return;
  }
  next();
});

const sharedWebsiteRouter = Router({ mergeParams: true });
sharedWebsiteRouter.use(async (req, res, next) => {
  const link = readDemoShowcaseToken(req.params.showcaseToken);
  if (!link || link.expiresAt <= Date.now()) {
    unavailableShowcase(req, res, Boolean(link));
    return;
  }
  const demo = await demoShowcaseTarget(link.dealerId);
  if (!demo || demo.expiresAt.getTime() <= Date.now()) {
    unavailableShowcase(req, res, Boolean(demo));
    return;
  }
  res.locals.showcaseTemplates = link.templates;
  res.locals.showcaseDealerName = demo.name;
  res.locals.previewDemo = true;
  runWithTenant({
    dealerId: demo.dealerId, canonicalOrigin: demo.canonicalOrigin,
    platform: demo.platform, retailerId: demo.retailerId, sourceUrl: demo.sourceUrl,
    kind: 'preview',
  }, next);
});
sharedWebsiteRouter.get('/api/designs', (_req, res) => {
  const ids: WebsiteTemplateId[] = res.locals.showcaseTemplates;
  res.json({
    dealerName: res.locals.showcaseDealerName,
    templates: ids.map(id => {
      const { name, description } = websiteTemplateDefinition(id);
      return { id, name, description };
    }),
  });
});
sharedWebsiteRouter.get('/', (req, res, next) => {
  if (!req.accepts('html')) { unavailableShowcase(req, res); return; }
  res.locals.privateWebsitePreview = true;
  next('router');
});
sharedWebsiteRouter.use('/design/:templateId', (req, res, next) => {
  const candidate = req.params.templateId;
  const ids: WebsiteTemplateId[] = res.locals.showcaseTemplates;
  if (!isWebsiteTemplateId(candidate) || !ids.includes(candidate)) {
    unavailableShowcase(req, res);
    return;
  }
  res.locals.previewWebsiteTemplate = candidate;
  res.locals.privateWebsitePreview = true;
  next();
}, websiteRouter);

demoShowcaseRouter.use('/:showcaseToken', sharedWebsiteRouter);
demoShowcaseRouter.use((req, res, next) => {
  if (res.locals.privateWebsitePreview === true) next();
  else unavailableShowcase(req, res);
});

export default router;
