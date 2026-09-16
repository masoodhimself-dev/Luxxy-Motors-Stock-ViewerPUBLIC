import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config';
import { dealerConfig } from './src/config/dealer';
import { previewStock } from './preview/stock';

// Separate, local-only entry point. Production keeps its existing auth and API.
export default mergeConfig(baseConfig, defineConfig({
  server: { host: '127.0.0.1' },
  plugins: [{
    name: 'local-showroom-preview',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace('/src/main.tsx', '/src/preview.tsx');
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Local preview only. No enquiry or booking has been sent.' }));
          return;
        }
        const responses: Record<string, unknown> = {
          '/api/stock': previewStock,
          '/api/dealer-settings': dealerConfig,
          '/api/recent-handovers': { schemaVersion: 1, handovers: [] },
          '/api/enquiries/availability': { date: url.searchParams.get('date'), timezone: 'Europe/London', slots: [] },
        };
        const response = responses[url.pathname];
        res.statusCode = response ? 200 : 404;
        res.end(JSON.stringify(response ?? { error: 'This service is unavailable in the local preview.' }));
      });
    },
  }],
}));
