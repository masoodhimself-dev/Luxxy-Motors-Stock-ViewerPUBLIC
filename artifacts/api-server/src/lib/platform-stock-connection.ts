import { eq } from 'drizzle-orm';
import { db, dealerPrivateSettingsTable } from '@workspace/db';
import { DealerIntegrationsStore } from './dealer-integrations-store';

type RegisteredStockDealer = { id: string; stockPlatform: string; retailerId: string; sourceUrl: string };
export type EffectiveStockConnection = {
  status: 'known'; platform: 'autotrader' | 'cazoo'; retailerId: string; sourceUrl: string; enabled: boolean; usesOverride: boolean;
} | {
  status: 'unknown'; platform: null; retailerId: null; sourceUrl: null; enabled: null; usesOverride: null;
};
const unknown = (): EffectiveStockConnection => ({status:'unknown',platform:null,retailerId:null,sourceUrl:null,enabled:null,usesOverride:null});

/** Read one registered dealer explicitly. Platform requests have no dealer tenant context. */
export async function platformStockConnection(dealer: RegisteredStockDealer): Promise<EffectiveStockConnection> {
  try {
    const [row] = await db.select({encryptedPayload:dealerPrivateSettingsTable.encryptedPayload}).from(dealerPrivateSettingsTable).where(eq(dealerPrivateSettingsTable.dealerId, dealer.id));
    const store = new DealerIntegrationsStore({dealerId:dealer.id,databaseBacked:true,production:true});
    const saved = row ? store.readPrivateSnapshot(row.encryptedPayload).stockConnection : undefined;
    const connection = saved ?? {platform:dealer.stockPlatform,retailerId:dealer.retailerId,sourceUrl:dealer.sourceUrl,enabled:true};
    // The import path rejects an identity override; never display one as a working source.
    if ((connection.platform !== 'autotrader' && connection.platform !== 'cazoo') || connection.platform !== dealer.stockPlatform || connection.retailerId !== dealer.retailerId || typeof connection.enabled !== 'boolean' || typeof connection.sourceUrl !== 'string') return unknown();
    const source = new URL(connection.sourceUrl);
    const hosts = connection.platform === 'cazoo' ? ['cazoo.co.uk','www.cazoo.co.uk'] : ['autotrader.co.uk','www.autotrader.co.uk'];
    if (source.protocol !== 'https:' || source.username || source.password || (source.port && source.port !== '443') || !hosts.includes(source.hostname)) return unknown();
    // Explicit whitelist only: private provider credentials and the encrypted payload never leave here.
    return {status:'known',platform:connection.platform,retailerId:connection.retailerId,sourceUrl:connection.sourceUrl,enabled:connection.enabled,usesOverride:saved != null};
  } catch {
    // Registry data is not proof of the effective source when private settings cannot be read.
    return unknown();
  }
}
