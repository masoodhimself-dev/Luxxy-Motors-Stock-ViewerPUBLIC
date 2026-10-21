import express, { type Express } from 'express';
import path from 'node:path';
import { existsSync,readFileSync } from 'node:fs';
import { currentTenant, currentDealerId, type TenantContext } from './tenant-context';
import { buildPublicPageSeo, renderPublicPageSeo, publicSeoOrigin, type PublicSeoVehicle } from './public-page-seo';

/** Serve the production SPA on the API origin, with no external path router. */
export type FrontendPageData = { settings?: unknown; vehicle?: PublicSeoVehicle | null };
type FrontendOptions = { loadPageData?: (pathname: string, tenant: TenantContext | undefined) => Promise<FrontendPageData> };

/** Only read published settings and the same public vehicle projection used by /api/vehicles/:id. */
async function loadPublicPageData(pathname: string, tenant: TenantContext | undefined): Promise<FrontendPageData> {
  if (!tenant && !publicSeoOrigin(process.env.PUBLIC_SITE_URL)) return {};
  const { pool } = await import('@workspace/db');
  const settings = (await pool.query('SELECT config FROM dealer_settings WHERE dealer_id=$1', [tenant?.dealerId ?? currentDealerId()])).rows[0]?.config;
  const match = /^\/vehicle\/([^/]+)\/?$/.exec(pathname);
  if (!match) return { settings };
  const { findPublicVehicle } = await import('../routes/stock');
  return { settings, vehicle: await findPublicVehicle(match[1]) };
}

export function serveFrontend(app: Express, directory: string, options: FrontendOptions = {}) {
  const root = path.resolve(directory);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) throw new Error(`Frontend build missing at ${index}. Run pnpm build first.`);
  const html=readFileSync(index,'utf8');
  const sendPage:express.RequestHandler=async(req,res,next)=>{
    try{
      const tenant = currentTenant();
      // Privileged/capability routes never need vehicle data or discoverable metadata.
      const publicRoute = ['/', '/index.html', '/stock', '/contact', '/warranty'].includes(req.path.replace(/\/$/, '') || '/') || /^\/vehicle\/[^/]+\/?$/.test(req.path);
      const data = publicRoute ? await (options.loadPageData ?? loadPublicPageData)(req.path, tenant) : {};
      const seo = buildPublicPageSeo({ pathname: req.path, canonicalOrigin: tenant?.canonicalOrigin ?? process.env.PUBLIC_SITE_URL, settings: data.settings, vehicle: data.vehicle, demo: tenant?.demo });
      // No shared HTML cache: price, availability and disclosures come from the current dealer snapshot.
      res.set('Cache-Control','no-store');
      if (seo.robots.startsWith('noindex')) res.set('X-Robots-Tag', seo.robots);
      res.status(seo.status).type('html').send(renderPublicPageSeo(html, seo));
    }catch(error){next(error);}
  };
  app.get('/index.html',sendPage);
  app.use(express.static(root, {
    index: false,
    setHeaders(res, file) {
      // Installed portals must pick up notification fixes without a stale worker.
      if (['portal-push-worker.js', 'portal.webmanifest'].includes(path.basename(file))) {
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
