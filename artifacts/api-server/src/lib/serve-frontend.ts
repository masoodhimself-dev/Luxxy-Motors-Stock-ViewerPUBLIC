import { isVehiclePagePath, vehicleDetailPath } from '@workspace/vehicle-meta';
import express, { type Express } from 'express';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { currentTenant, currentDealerId, type TenantContext } from './tenant-context';
import { borzDirectoryAccess, borzPage, renderBorzPage } from './borz-frontend';
import { publishedWebsiteTemplate } from './website-template-settings';
import { buildPublicPageSeo, renderPublicPageSeo, publicSeoOrigin, type PublicSeoVehicle } from './public-page-seo';

/** Serve the production SPA on the API origin, with no external path router. */
export type FrontendPageData = { settings?: unknown; vehicle?: PublicSeoVehicle | null };
type FrontendOptions = { loadPageData?: (pathname: string, tenant: TenantContext | undefined) => Promise<FrontendPageData> };

/** Only read published settings and the same public vehicle projection used by /api/vehicles/:id. */
async function loadPublicPageData(pathname: string, tenant: TenantContext | undefined): Promise<FrontendPageData> {
  if (!tenant && !publicSeoOrigin(process.env.PUBLIC_SITE_URL)) return {};
  const { pool } = await import('@workspace/db');
  const settings = (await pool.query('SELECT config FROM dealer_settings WHERE dealer_id=$1', [tenant?.dealerId ?? currentDealerId()])).rows[0]?.config;
  if (!isVehiclePagePath(pathname)) return { settings };
  const { findPublicVehicleByPath } = await import('../routes/stock');
  return { settings, vehicle: await findPublicVehicleByPath(pathname) };
}

export function serveFrontend(app: Express, directory: string, options: FrontendOptions = {}) {
  const root = path.resolve(directory);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) throw new Error(`Frontend build missing at ${index}. Run pnpm build first.`);
  const html = readFileSync(index, 'utf8');
  const borzSources = new Map<string, string>();
  const loadPageData = options.loadPageData ?? loadPublicPageData;
  const sendPage:express.RequestHandler=async(req,res,next)=>{
    try{
      const tenant = currentTenant();
      const shared = res.locals.sharedStaffPortal as { publishableKey: string } | undefined;
      if (shared) {
        const seo = buildPublicPageSeo({ pathname: '/portal', canonicalOrigin: tenant?.canonicalOrigin ?? process.env.PUBLIC_SITE_URL, demo: true });
        const publicInfo = process.env.STAFF_PORTAL_PUBLIC_INFO_ENABLED === 'true'
          ? '<meta name="dealeros-staff-privacy" content="/privacy">' : '';
        const markup = renderPublicPageSeo(html, seo).replace('</head>',
          `<meta name="dealeros-staff-portal" content="${shared.publishableKey}">${publicInfo}</head>`);
        res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }).type('html').send(markup);
        return;
      }
      const privatePreview = res.locals.privateWebsitePreview === true;
      const previewBorz = privatePreview && res.locals.previewWebsiteTemplate === 'borz' &&
        typeof res.locals.websitePreviewBase === 'string' && typeof res.locals.websitePreviewPath === 'string';
      if (privatePreview && !previewBorz) {
        const showcaseName: string | undefined = res.locals.showcaseDealerName;
        const seo = buildPublicPageSeo({ pathname: '/platform', canonicalOrigin: tenant?.canonicalOrigin, demo: true,
          ...(showcaseName ? { settings: { identity: { name: showcaseName } } } : {}) });
        if (showcaseName) seo.title = res.locals.previewWebsiteTemplate ? seo.siteName : `Website designs | ${seo.siteName}`;
        res.type('html').send(renderPublicPageSeo(html, seo));
        return;
      }
      const pathname: string = previewBorz ? res.locals.websitePreviewPath : req.path;
      const basePath: string = previewBorz ? res.locals.websitePreviewBase : '';
      const borzFile = (previewBorz || tenant?.kind === 'website') ? borzPage(pathname) : undefined;
      // Privileged/capability routes never need vehicle data or discoverable metadata.
      const publicRoute = ['/', '/index.html', '/stock', '/contact', '/warranty'].includes(pathname.replace(/\/$/, '') || '/') || isVehiclePagePath(pathname);
      const data = publicRoute || borzFile ? await loadPageData(pathname, tenant) : {};
      const renderBorz = Boolean(tenant && borzFile && (previewBorz || publishedWebsiteTemplate(data.settings) === 'borz'));
      if (data.vehicle && isVehiclePagePath(pathname) && ['available', 'reserved'].includes(data.vehicle.inventoryStatus ?? '')) {
        const canonicalPath = vehicleDetailPath(data.vehicle);
        if (pathname !== canonicalPath) {
          // Relative redirects stay inside the verified tenant or admitted preview.
          const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
          res.set('Cache-Control', 'no-store').redirect(privatePreview ? 302 : 301, basePath + canonicalPath + query);
          return;
        }
      }
      const readOnly = privatePreview || tenant?.demo === true;
      const canonicalOrigin = tenant?.canonicalOrigin ?? process.env.PUBLIC_SITE_URL;
      const seo = buildPublicPageSeo({ pathname, canonicalOrigin, settings: data.settings, vehicle: data.vehicle, demo: readOnly });
      // Extra Borz document routes use the same noindex posture as other
      // secondary pages. The primary stock, home and VDP SEO remain unchanged.
      if (renderBorz && !publicRoute) {
        seo.status = 200;
        seo.title = seo.siteName;
        seo.description = '';
      }
      // Price and availability updates are dealer scoped, never shared HTML cache.
      res.set('Cache-Control', readOnly ? 'private, no-store' : 'no-store');
      if (seo.robots.startsWith('noindex')) res.set('X-Robots-Tag', seo.robots);
      if (renderBorz && borzFile && tenant) {
        let source = borzSources.get(borzFile);
        if (!source) {
          const file = path.join(root, 'borz-template', borzFile);
          if (!existsSync(file)) { res.status(503).type('text').send('This website design is temporarily unavailable.'); return; }
          source = readFileSync(file, 'utf8');
          borzSources.set(borzFile, source);
        }
        const vehicleId = data.vehicle?.id;
        const markup = renderBorzPage(source, {
          basePath, readOnly, tenantKey: tenant.dealerId,
          canonicalOrigin: publicSeoOrigin(canonicalOrigin) ?? undefined,
          settingsUrl: basePath + '/api/dealer-settings',
          stockUrl: basePath + '/api/stock',
          featuresUrl: basePath + '/api/features',
          ...(vehicleId ? { vehicleId, vehicleUrl: basePath + '/api/vehicles/' + encodeURIComponent(vehicleId) } : {}),
        });
        res.status(seo.status).type('html').send(renderPublicPageSeo(markup, seo));
        return;
      }
      res.status(seo.status).type('html').send(renderPublicPageSeo(html, seo));
    }catch(error){next(error);}
  };
  app.get('/index.html',sendPage);
  app.use((req, res, next) => {
    if (borzDirectoryAccess(req.path) === 'blocked') {
      res.status(404).set('Cache-Control', 'no-store').type('text').send('Asset not found.');
      return;
    }
    next();
  });
  app.use(express.static(root, {
    index: false,
    setHeaders(res, file) {
      const name = path.basename(file);
      // Vite's content hash changes when these build assets change.
      if (path.dirname(file) === path.join(root, 'assets') && /-[\w-]{8}\.[a-z0-9]+$/i.test(name)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
      // Installed portals must pick up notification fixes without a stale worker.
      if (['portal-push-worker.js', 'portal.webmanifest'].includes(name)) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
    },
  }));
  // A rolling deploy may briefly route a new chunk request to the old instance.
  // Never let a CDN retain that temporary miss after the new build is ready.
  app.use('/assets', (_req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      .status(404).type('text/plain').send('Asset not found.');
  });
  app.get('/{*path}', (req, res, next) => {
    // Missing assets must be 404s, not HTML masquerading as JavaScript/images.
    if (path.extname(req.path) || !req.accepts('html')) return next();
    // Capability pages set no-store before reaching the SPA fallback.
    if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-cache');
    void sendPage(req,res,next);
  });
}
