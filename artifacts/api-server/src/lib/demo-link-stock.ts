import { createHash } from 'node:crypto';
import { db, dealerDemosTable, dealershipsTable, dealerSettingsTable } from '@workspace/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { DemoSetupError, insertDemo, validatedDemoInput } from './demo-creation';
import { runWithTenant } from './tenant-context';
import { importPlatformStock, type StockImportTransaction } from '../routes/stock';

type LinkDealer = { sourceUrl: string; retailerId: string };
export type AutoTraderDealer = LinkDealer;
type LinkPlatform = 'autotrader' | 'cazoo';
export const invalidDemoStockMessage = 'The stock connection did not return a complete, current export for this retailer. Try again or upload a complete JSON export.';

async function openPrivateDraft(
  tx: StockImportTransaction,
  dealer: LinkDealer,
  dealerName: string,
  platform: LinkPlatform,
  adminId: string,
  logoData?: string,
) {
  const prefix = platform === 'autotrader' ? 'at' : 'cazoo';
  const slug = `${prefix}-${createHash('sha256').update(dealer.retailerId).digest('hex').slice(0, 24)}`;
  const prepared = validatedDemoInput({
    slug, name: dealerName, platform, ...dealer, days: 14, logoData,
  }, true);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`private-demo-link:${prepared.id}`}))`);
  const [existing] = await tx.select({
    name: dealershipsTable.name,
    status: dealershipsTable.status,
    origin: dealershipsTable.canonicalOrigin,
    platform: dealershipsTable.stockPlatform,
    retailerId: dealershipsTable.retailerId,
    expiresAt: dealerDemosTable.expiresAt,
    convertedAt: dealerDemosTable.convertedAt,
    businessDetails: dealerDemosTable.businessDetails,
    hasLogo: sql<boolean>`${dealerDemosTable.logoData} IS NOT NULL`,
  }).from(dealershipsTable)
    .innerJoin(dealerDemosTable, eq(dealerDemosTable.dealerId, dealershipsTable.id))
    .where(eq(dealershipsTable.id, prepared.id))
    .for('update', { of: dealerDemosTable });
  if (existing) {
    if (existing.status !== 'draft' || existing.platform !== platform ||
        existing.retailerId !== dealer.retailerId || existing.convertedAt ||
        existing.businessDetails?.createdFromStockLink !== true || existing.expiresAt.getTime() <= Date.now()) {
      throw new DemoSetupError('This demo can’t be reopened from its stock link. Check it in Demo dealerships.', 409);
    }
    return {
      dealerId: prepared.id, origin: existing.origin, name: existing.name,
      created: false, hasLogo: existing.hasLogo || Boolean(prepared.logo), newLogo: prepared.logo,
    };
  }
  const created = await insertDemo(tx, prepared, adminId);
  await tx.update(dealerDemosTable).set({
    businessDetails: sql`coalesce(${dealerDemosTable.businessDetails}, '{}'::jsonb) || '{"createdFromStockLink":true}'::jsonb`,
  }).where(eq(dealerDemosTable.dealerId, created.dealerId));
  return { ...created, name: prepared.d.name, created: true, hasLogo: Boolean(prepared.logo), newLogo: null };
}

class DemoStockRejected extends Error {}

export async function importDemoLinkStock(
  req: Request,
  res: Response,
  dealer: LinkDealer,
  body: unknown,
  snapshot: { dealerName: string },
  adminId: string,
  options: { platform: LinkPlatform; logoData?: string } = { platform: 'autotrader' },
) {
  try {
    const result = await db.transaction(async tx => {
      const draft = await openPrivateDraft(tx, dealer, snapshot.dealerName, options.platform, adminId, options.logoData);
      let received: number | undefined;
      // Using the same transaction leaves no empty draft or artwork change after a rejected import.
      await runWithTenant({
        dealerId: draft.dealerId, canonicalOrigin: draft.origin, platform: options.platform,
        ...dealer, demo: true, kind: 'import',
      }, () => importPlatformStock(req, res, { body, transaction: tx, onImported: count => { received = count; } }));
      if (received === undefined) throw new DemoStockRejected();
      if (draft.newLogo) {
        const [changed] = await tx.update(dealerDemosTable).set({
          logoData: draft.newLogo, revision: sql`${dealerDemosTable.revision} + 1`, updatedBy: adminId,
        }).where(and(
          eq(dealerDemosTable.dealerId, draft.dealerId),
          sql`${dealerDemosTable.logoData} IS DISTINCT FROM ${draft.newLogo}`,
        )).returning({ id: dealerDemosTable.dealerId });
        if (changed) {
          await tx.update(dealerSettingsTable).set({
            config: sql`jsonb_set(${dealerSettingsTable.config}, '{identity,logoAsset}', '"/api/demo-logo"')`,
            revision: sql`${dealerSettingsTable.revision} + 1`,
          }).where(eq(dealerSettingsTable.dealerId, draft.dealerId));
        }
      }
      return { dealerId: draft.dealerId, dealerName: draft.name, received, created: draft.created, hasLogo: draft.hasLogo };
    });
    req.log?.info({ dealerId: result.dealerId, actor: adminId, received: result.received }, 'Imported private demo from a stock link');
    return result;
  } catch (error) {
    if (error instanceof DemoStockRejected) return null;
    const failure = error as { code?: string; cause?: { code?: string } };
    if (failure.code === '23505' || failure.cause?.code === '23505') {
      throw new DemoSetupError('This demo can’t be created from its stock link. Check Demo dealerships before retrying.', 409);
    }
    throw error;
  }
}
