import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { z } from 'zod/v4';
import { and, eq } from 'drizzle-orm';
import { db, dealershipsTable, dealerDomainsTable, dealerImportKeysTable, dealerSettingsTable, portalUsersTable } from '@workspace/db';
import { isPlatformAdmin } from '../lib/platform-admin';
import { normaliseTenantHost, multiTenantEnabled } from '../lib/tenant-context';
import { importSecretDigest } from '../middlewares/tenant';
import { newDealerSettings } from './dealer-settings';
const router = Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!multiTenantEnabled() || normaliseTenantHost(req.get('host') ?? '') !== normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST ?? '') || !isPlatformAdmin(getAuth(req).userId ?? undefined)) { res.status(403).json({ error: 'Platform administrator access required.' }); return; }
  if (req.get('origin') && req.get('origin') !== `https://${process.env.PLATFORM_ADMIN_HOST}`) { res.status(403).json({ error: 'Open platform administration on its approved domain.' }); return; } next();
});
router.get('/dealers', async (_req, res) => { const dealers = await db.select().from(dealershipsTable); res.json({ dealers }); });
const origin = z.string().url().refine(v => { const u = new URL(v); return u.protocol === 'https:' && (!u.port || u.port === '443') && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash && Boolean(normaliseTenantHost(u.host)); });
const creation = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), name: z.string().trim().min(1).max(120), canonicalOrigin: origin, platform: z.enum(['autotrader','cazoo']), retailerId: z.string().trim().min(1).max(128), sourceUrl: z.string().url(), ownerAuthUserId: z.string().regex(/^user_[A-Za-z0-9]+$/) }).strict();
router.post('/dealers', async (req, res) => {
  const input = creation.safeParse(req.body); if (!input.success) { res.status(400).json({ error: 'Supply valid dealership, HTTPS domain, source and owner Clerk ID.' }); return; }
  const d = input.data, source = new URL(d.sourceUrl); const host = normaliseTenantHost(new URL(d.canonicalOrigin).host)!;
  const allowed = d.platform === 'cazoo' ? ['cazoo.co.uk','www.cazoo.co.uk'] : ['autotrader.co.uk','www.autotrader.co.uk'];
  if (source.protocol !== 'https:' || source.username || source.password || (source.port && source.port !== '443') || !allowed.includes(source.hostname)) { res.status(400).json({ error: 'Source URL does not match the stock platform.' }); return; }
  const token = `dealer-verification=${randomBytes(24).toString('hex')}`;
  try {
    await db.transaction(async tx => {
      await tx.insert(dealershipsTable).values({ id: d.id, name: d.name, canonicalOrigin: new URL(d.canonicalOrigin).origin, stockPlatform: d.platform, retailerId: d.retailerId, sourceUrl: d.sourceUrl });
      await tx.insert(dealerDomainsTable).values({ hostname: host, dealerId: d.id, verificationToken: token });
      await tx.insert(portalUsersTable).values({ dealerId: d.id, authUserId: d.ownerAuthUserId, role: 'owner' });
      const config = newDealerSettings(d.name);
      await tx.insert(dealerSettingsTable).values({ dealerId: d.id, config });
    });
    res.status(201).json({ dealerId: d.id, status: 'draft', dns: { type: 'TXT', name: `_dealer-verification.${host}`, value: token }, next: 'Verify DNS ownership and connect the domain in Render before activation.' });
  } catch { res.status(409).json({ error: 'Dealer ID or domain already exists. No dealer created.' }); }
});
router.get('/dealers/:id/domains', async (req, res) => { res.json({ domains: await db.select().from(dealerDomainsTable).where(eq(dealerDomainsTable.dealerId, req.params.id)) }); });
router.post('/dealers/:id/domains', async (req, res) => {
  const hostname = normaliseTenantHost(String(req.body?.hostname ?? ''));
  const [dealer] = await db.select().from(dealershipsTable).where(eq(dealershipsTable.id, req.params.id));
  if (!dealer || !hostname) { res.status(400).json({ error: 'Choose a registered dealer and valid domain hostname.' }); return; }
  const token = `dealer-verification=${randomBytes(24).toString('hex')}`;
  try { await db.insert(dealerDomainsTable).values({ hostname, dealerId: dealer.id, verificationToken: token }); res.status(201).json({ dns: { type: 'TXT', name: `_dealer-verification.${hostname}`, value: token } }); }
  catch { res.status(409).json({ error: 'This domain is already registered.' }); }
});
router.post('/dealers/:id/verify-domain', async (req, res) => {
  const hostname = normaliseTenantHost(String(req.body?.hostname ?? ''));
  const [domain] = hostname ? await db.select().from(dealerDomainsTable).where(and(eq(dealerDomainsTable.hostname, hostname), eq(dealerDomainsTable.dealerId, req.params.id))) : [];
  if (!domain) { res.status(404).json({ error: 'Domain not found.' }); return; }
  try { const records = await resolveTxt(`_dealer-verification.${domain.hostname}`); if (!records.some(parts => parts.join('') === domain.verificationToken)) throw new Error(); }
  catch { res.status(409).json({ error: 'DNS ownership record not found. Domain remains inactive.' }); return; }
  await db.update(dealerDomainsTable).set({ verified: true }).where(eq(dealerDomainsTable.hostname, domain.hostname)); res.json({ hostname, verified: true, renderDomainSetupStillRequired: true });
});
router.post('/dealers/:id/import-key', async (req, res) => {
  const [dealer] = await db.select().from(dealershipsTable).where(eq(dealershipsTable.id, req.params.id)); if (!dealer) { res.status(404).json({ error: 'Dealer not found.' }); return; }
  const secret = randomBytes(32).toString('base64url'); const [key] = await db.insert(dealerImportKeysTable).values({ dealerId: dealer.id, secretHash: importSecretDigest(secret) }).returning();
  res.status(201).json({ keyId: key.id, secret, endpointPath: `/api/stock/imports/${dealer.id}/grok`, notice: 'Shown once. Save directly in the worker secure secret store; never in logs or chat.' });
});
router.delete('/dealers/:id/import-key/:keyId', async (req, res) => { await db.update(dealerImportKeysTable).set({ disabledAt: new Date() }).where(and(eq(dealerImportKeysTable.id, req.params.keyId), eq(dealerImportKeysTable.dealerId, req.params.id))); res.json({ revoked: true }); });
router.put('/dealers/:id/status', async (req, res) => {
  if (!['active','suspended','draft'].includes(req.body?.status)) { res.status(400).json({ error: 'Choose active, suspended or draft.' }); return; }
  const [dealer] = await db.select().from(dealershipsTable).where(eq(dealershipsTable.id, req.params.id)); if (!dealer) { res.status(404).json({ error: 'Dealer not found.' }); return; }
  const [domain] = await db.select().from(dealerDomainsTable).where(and(eq(dealerDomainsTable.hostname, normaliseTenantHost(new URL(dealer.canonicalOrigin).host)!), eq(dealerDomainsTable.dealerId, dealer.id), eq(dealerDomainsTable.verified, true)));
  if (req.body.status === 'active' && !domain) { res.status(409).json({ error: 'Verify the canonical domain first.' }); return; }
  await db.update(dealershipsTable).set({ status: req.body.status }).where(eq(dealershipsTable.id, dealer.id)); res.json({ dealerId: dealer.id, status: req.body.status });
});
export default router;
