import { Router, type IRouter } from 'express';
import { currentTenant, multiTenantEnabled } from '../lib/tenant-context';
import { blockedRobotsText, canonicalSeoOrigin, dealerRobotsText, dealerSitemapXml, type DealerSitemapData } from '../lib/seo-crawl';

export type SeoDealerScope = { dealerId: string; origin: string; demo: boolean };
export type SeoRouteDependencies = {
  /** Trusted middleware context only. A query/header dealer ID must never choose the scope. */
  scope: () => SeoDealerScope | null;
  load: (scope: SeoDealerScope) => Promise<DealerSitemapData>;
};

export function verifiedSeoScope(): SeoDealerScope | null {
  const tenant = currentTenant();
  if (tenant) {
    if (tenant.kind === 'import') return null;
    return { dealerId: tenant.dealerId, origin: canonicalSeoOrigin(tenant.canonicalOrigin), demo: tenant.demo === true };
  }
  // A standalone installation needs an explicit live origin. Local previews and the
  // platform host have no verified dealer and must not advertise a public sitemap.
  if (multiTenantEnabled() || !process.env.PUBLIC_SITE_URL?.trim()) return null;
  return { dealerId: process.env.STOCK_DEALER_ID ?? 'luxxy-motors', origin: canonicalSeoOrigin(process.env.PUBLIC_SITE_URL.trim()), demo: false };
}

export async function loadDealerSitemap(scope: SeoDealerScope): Promise<DealerSitemapData> {
  // Shared public inventory projection: visibility, source and tenancy stay identical
  // to /api/stock and server-rendered pages. No private vehicle fields are serialized.
  const [{ listPublicStockSitemapEntries }, { db, dealerSettingsTable }, { eq }] = await Promise.all([
    import('./stock'), import('@workspace/db'), import('drizzle-orm'),
  ]);
  const [vehicles, settings] = await Promise.all([
    listPublicStockSitemapEntries(),
    db.select({ config: dealerSettingsTable.config, updatedAt: dealerSettingsTable.updatedAt })
      .from(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, scope.dealerId)).limit(1),
  ]);
  const warranty = settings[0]?.config.warranty;
  return {
    vehicles,
    warrantyEnabled: Boolean(warranty && typeof warranty === 'object' && (warranty as Record<string, unknown>).enabled === true),
    settingsLastmod: settings[0]?.updatedAt,
  };
}

export function createSeoRouter(dependencies: SeoRouteDependencies = { scope: verifiedSeoScope, load: loadDealerSitemap }): IRouter {
  const router = Router();
  router.get('/robots.txt', (_req, res) => {
    try {
      const scope = dependencies.scope();
      res.set('Cache-Control', 'no-store').type('text/plain')
        .send(!scope || scope.demo ? blockedRobotsText : dealerRobotsText(scope.origin));
    } catch {
      // A missing/invalid canonical must never expose another dealer's origin.
      res.set('Cache-Control', 'no-store').type('text/plain').send(blockedRobotsText);
    }
  });
  router.get('/sitemap.xml', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const scope = dependencies.scope();
      if (!scope || scope.demo) { res.set('X-Robots-Tag', 'noindex, nofollow').status(404).type('text/plain').send('Sitemap unavailable.'); return; }
      const data = await dependencies.load(scope);
      res.type('application/xml').send(dealerSitemapXml(scope.origin, data));
    } catch {
      // Do not disguise database/stock failures as a successful empty sitemap.
      res.status(503).set('Retry-After', '60').type('text/plain').send('Sitemap temporarily unavailable.');
    }
  });
  return router;
}

export default createSeoRouter();
