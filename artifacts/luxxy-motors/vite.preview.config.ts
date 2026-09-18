import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { previewResponse } from './preview/portal';
import baseConfig from './vite.config';
import { previewSettings } from './preview/settings';
import { previewStock } from './preview/stock';
import { brochureOrigin, createBrochureHandler } from '../api-server/src/lib/vehicle-brochure-handler';

// The same PDF renderer as production, supplied only with archived preview records.
const previewBrochure = createBrochureHandler({
  findVehicle: async (id) => previewStock.cars.find((car) => car.id === id) ?? null,
  readDealer: async () => ({
    name: previewSettings.identity.name,
    phone: previewSettings.contact.phone,
    email: previewSettings.contact.email,
    address: [previewSettings.address.street, previewSettings.address.city, previewSettings.address.postcode].filter(Boolean).join(', '),
  }),
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
            if (!url.pathname.startsWith('/api/')) return next();
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            if (req.method !== 'GET') {
              res.statusCode = 405;
              res.end(
                JSON.stringify({
                  error: 'Local preview only. No enquiry or booking has been sent.',
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
                response ?? { error: 'This service is unavailable in the local preview.' },
              ),
            );
          });
        },
      },
    ],
  }),
);
