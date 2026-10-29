import { staffMotSummary } from '@workspace/vehicle-meta';
import { accountInvitationsPreview } from './preview/account-invitations';
import { soldVehicleFollowUpsPreview } from './preview/sold-vehicle-follow-ups';
import { communicationsPreview } from "./preview/communications";
import { declarationQa } from './preview/declaration-qa';
import { plateEntryQa } from './preview/plate-entry-qa';
import { platformPreview } from "./preview/platform";
import { resolveDealerFeatures } from '@workspace/vehicle-meta';
import { brochureDealer } from '../api-server/src/lib/vehicle-brochure';
import { reservationPreview, readPreviewSettings, readPreviewEnquiries, writePreviewSettings } from './preview/reservations';
import { operationsPreview } from './preview/operations';
import { relationshipsPreview } from './preview/relationships';
import { dealerIntegrationsPreview } from './preview/dealer-integrations';
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { previewResponse } from './preview/portal';
import baseConfig from './vite.config';
import { previewSettings } from './preview/settings';
import { previewStock } from './preview/stock';
import { salesPreview } from './preview/sales';
import { brochureOrigin, createBrochureHandler } from '../api-server/src/lib/vehicle-brochure-handler';
import { searchReadiness } from '../api-server/src/lib/search-readiness';

// The same PDF renderer as production, supplied only with archived preview records.
const previewBrochure = createBrochureHandler({
  findVehicle: async (id) => previewStock.cars.find((car) => car.id === id) ?? null,
  readDealer: async () => brochureDealer(await readPreviewSettings()),
  preview: true,
});

// Separate, local-only entry point. Production keeps its existing auth and API.
export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: { '@clerk/react': fileURLToPath(new URL('./preview/clerk.tsx', import.meta.url)) },
    },
    server: { host: '127.0.0.1' },
    optimizeDeps: { entries: ['src/preview.tsx'] },
    plugins: [
      {
        name: 'local-showroom-preview',
        apply: 'serve',
        transformIndexHtml(html) {
          return html.replace('/src/main.tsx', '/src/preview.tsx');
        },
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            if ((url.pathname === '/join' || url.pathname.startsWith('/verify-invoice/'))) { res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Cache-Control', 'no-store'); }
            if (!url.pathname.startsWith('/api/')) return next();
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            if (url.pathname === '/api/staff/search-visibility' && req.method === 'GET') {
              res.end(JSON.stringify({ ...searchReadiness(await readPreviewSettings(), brochureOrigin(req.headers.host)), preview: true }));
              return;
            }
            if (url.pathname === '/api/staff/website-assets' && req.method === 'POST') {
              res.statusCode = 409;
              res.end(JSON.stringify({ error: 'Image uploads require the authenticated server. This local preview keeps your existing image unchanged.' }));
              return;
            }
            if (await accountInvitationsPreview(req, res, url)) return;
            if (await soldVehicleFollowUpsPreview(req, res, url)) return;
            if (await declarationQa(req, res, url)) return;
            if (await plateEntryQa(req, res, url)) return;
            if (/^\/api\/(sales|signing|customer-intake-sessions)(\/|$)/.test(url.pathname)) {
              res.statusCode = 410;
              res.end(JSON.stringify({ error: 'The previous sales process has been removed.' }));
              return;
            }
            if (await platformPreview(req, res, url)) return;
            if (await operationsPreview(req, res, url, { readSettings: readPreviewSettings, writeSettings: writePreviewSettings })) return;
            if (await relationshipsPreview(req, res, url)) return;
            if (await dealerIntegrationsPreview(req, res, url)) return;
            if (await communicationsPreview(req, res, url)) return;
            if (await reservationPreview(req, res, url)) return;
            if (await salesPreview(req, res, url)) return;
            if (req.method !== 'GET') {
              res.statusCode = 405;
              res.end(
                JSON.stringify({
                  error: 'This action is unavailable. No enquiry or booking has been sent.',
                }),
              );
              return;
            }
            const brochure = /^\/api\/vehicles\/([^/]+)\/brochure\.pdf$/.exec(url.pathname);
            if (brochure) {
              const result = await previewBrochure(brochure[1], brochureOrigin(req.headers.host));
              res.statusCode = result.status;
              for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
              res.end(result.body);
              return;
            }
            const responses: Record<string, unknown> = {
              '/api/stock': previewStock,
              '/api/staff/cars': {feed:{source:'Local stock preview',receivedAt:previewStock.scrapedAt,appliedAt:previewStock.scrapedAt,state:'current',scheduled:false},cars:previewStock.cars.map(car=>({...car,inventoryStatus:car.inventoryStatus??'available',staff:{source:'autotrader',sourceStatus:'live',inventoryStatus:car.inventoryStatus??'available',published:true,firstSeenAt:previewStock.scrapedAt,lastSeenAt:previewStock.scrapedAt,archivedAt:null,mot:staffMotSummary(null),changes:[],sale:null}}))},
              '/api/features': { features: Object.fromEntries(resolveDealerFeatures({}, {}).map(feature => [feature.key, feature.enabled])), evaluatedAt: new Date().toISOString() },
              '/api/dealer-settings': previewSettings,
            };
            const response =
              responses[url.pathname] ?? previewResponse(url.pathname, url.searchParams);
            res.statusCode = response ? 200 : 404;
            res.end(
              JSON.stringify(
                response ?? { error: 'This service is unavailable.' },
              ),
            );
          });
        },
      },
    ],
  }),
);
