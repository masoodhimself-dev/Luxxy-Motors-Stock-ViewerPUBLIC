import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { db, dealerDomainsTable, dealershipsTable, dealerImportKeysTable } from '@workspace/db';
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
    runWithTenant(tenant, next);
  })().catch(next);
};
