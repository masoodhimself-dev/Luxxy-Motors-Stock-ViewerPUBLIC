import { brochureDealer } from '../api-server/src/lib/vehicle-brochure';
import { reservationPreview, readPreviewSettings, readPreviewEnquiries, writePreviewSettings } from './preview/reservations';
import { operationsPreview } from './preview/operations';
import { chatPreview } from './preview/chat';
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
            if ((url.pathname.startsWith('/my-purchase/') || url.pathname === '/reserve/payment-return')) { res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Cache-Control', 'no-store'); }
            if (!url.pathname.startsWith('/api/')) return next();
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            if (/^\/api\/(sales|signing|customer-intake-sessions)(\/|$)/.test(url.pathname)) {
              res.statusCode = 410;
              res.end(JSON.stringify({ error: 'The previous sales process has been removed.' }));
              return;
            }
            if (await operationsPreview(req, res, url, { readSettings: readPreviewSettings, writeSettings: writePreviewSettings, readEnquiries: readPreviewEnquiries })) return;
            if (await chatPreview(req, res, url)) return;
            if (await relationshipsPreview(req, res, url)) return;
            if (await dealerIntegrationsPreview(req, res, url)) return;
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
              '/api/dealer-settings': previewSettings,
              '/api/recent-handovers': { schemaVersion: 1, handovers: [] },
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
