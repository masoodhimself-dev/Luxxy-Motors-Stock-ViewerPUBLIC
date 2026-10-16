import express, { type Express } from 'express';
import path from 'node:path';
import { existsSync,readFileSync } from 'node:fs';
import { currentTenant } from './tenant-context';
import { tenantPageHtml } from './tenant-page-meta';

/** Serve the production SPA on the API origin, with no external path router. */
export function serveFrontend(app: Express, directory: string) {
  const root = path.resolve(directory);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) throw new Error(`Frontend build missing at ${index}. Run pnpm build first.`);
  const html=readFileSync(index,'utf8');
  const sendPage:express.RequestHandler=async(_req,res,next)=>{
    try{
      const tenant=currentTenant();
      if(!tenant){res.sendFile(index,{cacheControl:false});return;}
      const {pool}=await import('@workspace/db');
      const config=(await pool.query('SELECT config FROM dealer_settings WHERE dealer_id=$1',[tenant.dealerId])).rows[0]?.config;
      const name=typeof config?.identity?.name==='string'&&config.identity.name.trim()?config.identity.name.trim():'Our dealership';
      const city=typeof config?.address?.city==='string'?config.address.city.trim():'';
      res.set('Cache-Control','no-store').type('html').send(tenantPageHtml(html,name,city));
    }catch(error){next(error);}
  };
  app.get('/index.html',sendPage);
  app.use(express.static(root, { index: false }));
  app.get('/{*path}', (req, res, next) => {
    // Missing assets must be 404s, not HTML masquerading as JavaScript/images.
    if (path.extname(req.path) || !req.accepts('html')) return next();
    // Capability pages set no-store before reaching the SPA fallback.
    if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-cache');
    void sendPage(req,res,next);
  });
}
