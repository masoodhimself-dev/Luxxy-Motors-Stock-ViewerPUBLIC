import express, { type Express } from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';

/** Serve the production SPA on the API origin, with no external path router. */
export function serveFrontend(app: Express, directory: string) {
  const root = path.resolve(directory);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) throw new Error(`Frontend build missing at ${index}. Run pnpm build first.`);
  app.use(express.static(root, { index: false }));
  app.get('/{*path}', (req, res, next) => {
    // Missing assets must be 404s, not HTML masquerading as JavaScript/images.
    if (path.extname(req.path) || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
