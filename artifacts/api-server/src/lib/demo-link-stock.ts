import { createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import type { Request, Response } from 'express';
import { DemoSetupError, insertDemo, validatedDemoInput } from './demo-creation';
import type { autoTraderDealerLink } from './demo-stock-collector';
import { runWithTenant } from './tenant-context';
import { type checkAutoTraderDemoSnapshot, importPlatformStock } from '../routes/stock';

export type AutoTraderDealer = NonNullable<ReturnType<typeof autoTraderDealerLink>>;
type ValidatedSnapshot = NonNullable<ReturnType<typeof checkAutoTraderDemoSnapshot>>;
export const invalidDemoStockMessage = 'The stock connection did not return a complete, current export for this retailer. Try again or upload a complete JSON export.';

async function openPrivateDraft(
  dealer: AutoTraderDealer,
  dealerName: string,
  adminId: string,
) {
  const slug = `at-${createHash('sha256').update(dealer.retailerId).digest('hex').slice(0, 24)}`;
  const prepared = validatedDemoInput({
    slug, name: dealerName, platform: 'autotrader', ...dealer, days: 14,
  }, true);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`private-demo-link:${prepared.id}`]);
    const { rows: [existing] } = await client.query(
      `SELECT t.name, t.status, t.canonical_origin, t.stock_platform, t.retailer_id,
              d.expires_at, d.converted_at, d.business_details
         FROM dealerships t LEFT JOIN dealer_demos d ON d.dealer_id = t.id
        WHERE t.id = $1`,
      [prepared.id],
    );
    if (existing) {
      if (existing.status !== 'draft' || existing.stock_platform !== 'autotrader' ||
          existing.retailer_id !== dealer.retailerId || existing.converted_at ||
          existing.business_details?.createdFromStockLink !== true ||
          !existing.expires_at || new Date(existing.expires_at).getTime() <= Date.now()) {
        throw new DemoSetupError('This demo can’t be reopened from its stock link. Check it in Demo dealerships.', 409);
      }
      await client.query('COMMIT');
      return { dealerId: prepared.id, origin: String(existing.canonical_origin), name: String(existing.name), created: false };
    }
    const created = await insertDemo(client, prepared, adminId);
    await client.query(
      "UPDATE dealer_demos SET business_details = business_details || '{\"createdFromStockLink\":true}'::jsonb WHERE dealer_id = $1",
      [created.dealerId],
    );
    await client.query('COMMIT');
    return { ...created, name: prepared.d.name, created: true };
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') {
      throw new DemoSetupError('This demo was created in another session. Try the link again.', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function importDemoLinkStock(req: Request, res: Response, dealer: AutoTraderDealer, body: unknown, snapshot: ValidatedSnapshot, adminId: string) {
  const draft = await openPrivateDraft(dealer, snapshot.dealerName, adminId);
  let received: number | undefined;
  await runWithTenant({
    dealerId: draft.dealerId, canonicalOrigin: draft.origin, platform: 'autotrader',
    ...dealer, demo: true, kind: 'import',
  }, () => importPlatformStock(req, res, { body, onImported: count => { received = count; } }));
  if (received === undefined) return null;
  req.log?.info({ dealerId: draft.dealerId, actor: adminId, received }, 'Imported private demo from a stock link');
  return { dealerId: draft.dealerId, dealerName: draft.name, received, created: draft.created };
}
