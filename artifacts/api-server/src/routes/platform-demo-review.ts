import { getAuth } from '@clerk/express';
import { pool } from '@workspace/db';
import { buildDemoReview, type DemoReview } from '@workspace/vehicle-meta';
import { Router } from 'express';
import { z } from 'zod/v4';
import { applyDemoDealershipDetails, demoDealershipDetails } from '../lib/demo-business-details';
import { DemoSetupError, validatedDemoInput } from '../lib/demo-creation';
import { runWithTenant } from '../lib/tenant-context';
import { readPublicStockCars } from './stock';

// Mounted behind the existing Platform Admin host, origin and administrator checks.
const router = Router();
const selectDemo = `SELECT d.id,d.name,d.status,d.stock_platform,d.retailer_id,d.source_url,d.canonical_origin,
  m.expires_at,m.revision,m.converted_at,m.logo_data,m.footer_logo_data,m.recipient,m.business_details,s.config,s.revision AS settings_revision
  FROM dealerships d JOIN dealer_demos m ON m.dealer_id=d.id JOIN dealer_settings s ON s.dealer_id=d.id
  WHERE d.id=$1`;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
type Row = Record<string, any>;

async function review(row: Row): Promise<DemoReview> {
  const [latest] = (await pool.query(`SELECT expected_count,scraped_at,received_at FROM stock_import_runs
    WHERE dealer_id=$1 AND source=$2 AND status='completed' ORDER BY received_at DESC LIMIT 1`, [row.id, row.stock_platform])).rows;
  const vehicles = await runWithTenant({ dealerId: row.id, canonicalOrigin: row.canonical_origin,
    platform: row.stock_platform, retailerId: row.retailer_id, sourceUrl: row.source_url, kind: 'preview', demo: true }, readPublicStockCars);
  return buildDemoReview({
    dealer: { id: row.id, name: row.name, platform: row.stock_platform, sourceUrl: row.source_url,
      status: row.status, expiresAt: new Date(row.expires_at).toISOString(), revision: row.revision, settingsRevision: row.settings_revision },
    config: row.config, businessDetails: row.business_details, hasSavedLogo: Boolean(row.logo_data), vehicles,
    latestImport: latest ? { expectedCount: latest.expected_count, scrapedAt: new Date(latest.scraped_at).toISOString(), receivedAt: new Date(latest.received_at).toISOString() } : null,
  });
}

router.get('/dealers/:id/demo-review', async (req, res) => {
  try {
    const row = (await pool.query(selectDemo, [req.params.id])).rows[0];
    if (!row || row.converted_at) { res.status(404).json({ error: 'This private demo could not be found.' }); return; }
    res.json(await review(row));
  } catch {
    req.log?.warn({ dealerId: req.params.id }, 'Demo review could not be read');
    res.status(503).json({ error: 'The demo review could not be loaded. Please try again.' });
  }
});

const correction = z.object({
  expectedRevision: z.number().int().min(0),
  expectedSettingsRevision: z.number().int().min(0),
  dealershipDetails: demoDealershipDetails.optional(),
  logoData: z.string().max(400000).optional(),
}).strict().refine(value => value.dealershipDetails !== undefined || value.logoData !== undefined);

router.patch('/dealers/:id/demo-review', async (req, res) => {
  const input = correction.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'Supply the saved revision and valid dealership details or a PNG/JPEG logo.' }); return; }
  const client = await pool.connect();
  let committed = false;
  let released = false;
  try {
    await client.query('BEGIN');
    // Import and conversion lock the demo before the dealership. Keep that order.
    await client.query('SELECT dealer_id FROM dealer_demos WHERE dealer_id=$1 FOR UPDATE', [req.params.id]);
    const row = (await client.query(`${selectDemo} FOR SHARE OF d`, [req.params.id])).rows[0];
    if (!row || row.converted_at) { await client.query('ROLLBACK'); res.status(404).json({ error: 'This private demo could not be found.' }); return; }
    if (!['draft', 'active'].includes(row.status)) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Only a draft or active private demo can be changed here.' }); return; }
    if (row.revision !== input.data.expectedRevision) { await client.query('ROLLBACK'); res.status(409).json({ error: 'This demo has changed. Reload the review before saving again.' }); return; }
    const business = object(row.business_details);
    const details = input.data.dealershipDetails ? { ...object(business.dealershipDetails), ...input.data.dealershipDetails } : undefined;
    const prepared = validatedDemoInput({ slug: row.id.slice(5), name: row.name, platform: row.stock_platform,
      retailerId: row.retailer_id, sourceUrl: row.source_url, logoData: input.data.logoData ?? row.logo_data ?? undefined,
      footerLogoData: row.footer_logo_data ?? undefined, ...(details ? { dealershipDetails: details } : {}) }, true);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dealer-settings:${row.id}`]);
    const settingsRow = (await client.query('SELECT config,revision FROM dealer_settings WHERE dealer_id=$1 FOR UPDATE', [row.id])).rows[0];
    if (!settingsRow) throw new Error('Missing demo settings');
    if (settingsRow.revision !== input.data.expectedSettingsRevision) { await client.query('ROLLBACK'); res.status(409).json({ error: 'The dealership settings have changed. Reload the review before saving again.' }); return; }
    const settings = settingsRow.config;
    // Apply only the supplied correction, never old imported values over current Settings.
    const config = applyDemoDealershipDetails(settings, input.data.dealershipDetails);
    if (input.data.logoData !== undefined) config.identity = { ...object(config.identity), logoAsset: prepared.logo ? '/api/demo-logo' : '' };
    await client.query('UPDATE dealer_settings SET config=$2::jsonb,revision=revision+1,updated_at=now() WHERE dealer_id=$1', [row.id, JSON.stringify(config)]);
    const nextBusiness = { ...business, ...(details ? { dealershipDetails: prepared.d.dealershipDetails } : {}) };
    await client.query(`UPDATE dealer_demos SET logo_data=$2,business_details=$3::jsonb,revision=revision+1,updated_by=$4 WHERE dealer_id=$1`,
      [row.id, prepared.logo, JSON.stringify(nextBusiness), getAuth(req).userId]);
    await client.query('COMMIT');
    committed = true;
    // The response reads stock using the pool; do not hold an idle client while it waits.
    client.release();
    released = true;
    res.json(await review({ ...row, config, business_details: nextBusiness, logo_data: prepared.logo, revision: row.revision + 1, settings_revision: settingsRow.revision + 1 }));
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    res.status(error instanceof DemoSetupError ? error.status : 503).json({ error: error instanceof DemoSetupError ? error.message : committed ? 'The details were saved. Reload the demo review.' : 'The demo details could not be saved. Please try again.' });
  } finally { if (!released) client.release(); }
});

export default router;
