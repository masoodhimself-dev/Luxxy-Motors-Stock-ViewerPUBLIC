import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { db, dealerDomainsTable, dealershipsTable, dealerImportKeysTable, dealerDemosTable } from '@workspace/db';
import { multiTenantEnabled, normaliseTenantHost, runWithTenant, type TenantContext } from '../lib/tenant-context';
export function importSecretDigest(secret: string): string { return createHash('sha256').update(secret).digest('hex'); }
export function matchesImportSecret(secret: string, digest: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(digest)) return false;
  return timingSafeEqual(Buffer.from(importSecretDigest(secret), 'hex'), Buffer.from(digest, 'hex'));
}
export const resolveTenant: RequestHandler = (req, res, next) => {
  if (!multiTenantEnabled() || req.path === '/api/healthz') { next(); return; }
  void (async () => {
    const rejectImport = (httpStatus: number, code: string, message: string) => res.status(httpStatus).json({
      status: 'rejected', runId: typeof req.body?.runId === 'string' ? req.body.runId : null,
      retailerId: typeof req.body?.retailerId === 'string' ? req.body.retailerId : null,
      errors: [{ code, message, path: null, advertId: null }],
    });
    const hostname = normaliseTenantHost(req.get('host') ?? '');
    if (!hostname) { res.status(421).json({ error: 'Unrecognised dealership domain.' }); return; }
    const administratorHost = normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST ?? '');
    if (hostname === administratorHost && req.path === '/') { res.redirect(302, '/platform'); return; }
    if (hostname === administratorHost && (req.path === '/platform' || /^\/(assets|sign-in|sign-up)(?:\/|$)/.test(req.path))) { next(); return; }
    const importRoute = /^\/api\/stock\/imports\/([a-z0-9-]+)\/grok\/?$/.exec(req.path);
    let tenant: TenantContext;
    if (importRoute) {
      if (hostname !== normaliseTenantHost(process.env.STOCK_IMPORT_API_HOST ?? '')) { rejectImport(421, 'wrong_import_host', 'Use the approved stock import host.'); return; }
      const [dealer] = await db.select().from(dealershipsTable).where(and(eq(dealershipsTable.id, importRoute[1]), eq(dealershipsTable.status, 'active')));
      if (!dealer) { rejectImport(401, 'unauthorized', 'Invalid stock connection.'); return; }
      const keys = await db.select().from(dealerImportKeysTable).where(and(eq(dealerImportKeysTable.dealerId, dealer.id), isNull(dealerImportKeysTable.disabledAt)));
      const supplied = req.get('x-stock-import-secret') ?? '';
      const key = keys.find(k => matchesImportSecret(supplied, k.secretHash));
      if (!key) {
        const [otherKey] = supplied ? await db.select().from(dealerImportKeysTable).where(and(eq(dealerImportKeysTable.secretHash, importSecretDigest(supplied)), isNull(dealerImportKeysTable.disabledAt))) : [];
        rejectImport(otherKey ? 403 : 401, otherKey ? 'dealer_credential_mismatch' : 'unauthorized', 'Invalid stock connection.'); return;
      }
      tenant = { dealerId: dealer.id, canonicalOrigin: dealer.canonicalOrigin, platform: dealer.stockPlatform, retailerId: dealer.retailerId, sourceUrl: dealer.sourceUrl, importSecretHash: key.secretHash, kind: 'import' };
    } else {
      // Never trust a client tenant ID or arbitrary X-Forwarded-Host value.
      const [row] = await db.select({ dealer: dealershipsTable }).from(dealerDomainsTable).innerJoin(dealershipsTable, eq(dealershipsTable.id, dealerDomainsTable.dealerId)).where(and(eq(dealerDomainsTable.hostname, hostname), eq(dealerDomainsTable.verified, true), eq(dealershipsTable.status, 'active')));
      if (!row) { res.status(421).json({ error: 'Unrecognised dealership domain.' }); return; }
      tenant = { dealerId: row.dealer.id, canonicalOrigin: row.dealer.canonicalOrigin, platform: row.dealer.stockPlatform, retailerId: row.dealer.retailerId, sourceUrl: row.dealer.sourceUrl, kind: 'website' };
    }
    const [demo] = await db.select().from(dealerDemosTable).where(eq(dealerDemosTable.dealerId, tenant.dealerId));
    // Conversion retains the row and its uploaded logo assets for continuity.
    // Only an unconverted row carries demo restrictions or an expiry date.
    const demonstration = Boolean(demo && !demo.convertedAt);
    if (demo && demonstration) {
      if (demo.expiresAt.getTime() <= Date.now()) { res.status(410).json({ error: 'This demonstration has expired. Contact the platform administrator.' }); return; }
      tenant.demo = true;
      res.set({ 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      if (req.path === '/api/reservations/payment-readiness') { res.json({enabled:false,mode:null,prepared:true}); return; }
      if (req.path === '/api/reservations/checkout' || req.path.startsWith('/api/reservations/stripe') || req.path.startsWith('/api/staff/stripe-reservations')) { res.status(403).json({ error: 'Real payments are disabled in demonstrations.' }); return; }
      if (req.path === '/robots.txt') { res.type('text/plain').send('User-agent: *\nDisallow: /\n'); return; }
    }
    const demoLogo=req.query.variant==='footer'?(demo?.footerLogoData||demo?.logoData):demo?.logoData;
    if (req.path === '/api/demo-logo' && demoLogo) { const [meta, data] = demoLogo.split(','); res.type(meta.includes('png')?'image/png':'image/jpeg').send(Buffer.from(data,'base64')); return; }
    if (req.path === '/api/demo-status') { res.json({ demo: demonstration, ...(demonstration ? { emailRestricted: true, paymentsDisabled: true } : {}) }); return; }
    runWithTenant(tenant, next);
  })().catch(next);
};
