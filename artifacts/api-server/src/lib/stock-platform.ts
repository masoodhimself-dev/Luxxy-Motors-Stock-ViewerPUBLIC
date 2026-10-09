import { URL } from "node:url";
import type { StockPlatform } from "@workspace/vehicle-meta";
export function stockPlatformIssues(cars: Array<{ advertUrl: string | null; sourceExtras: Record<string, unknown> | null }>, platform: StockPlatform): string[] {
  const hosts = platform === 'cazoo' ? ['cazoo.co.uk', 'www.cazoo.co.uk'] : ['autotrader.co.uk', 'www.autotrader.co.uk'];
  const issues: string[] = [];
  cars.forEach((car, index) => {
    const declared = car.sourceExtras?.sourcePlatform;
    if (declared != null && declared !== platform) issues.push(`cars.${index}: marketplace does not match the configured stock connection`);
    if (car.advertUrl) {
      try { const url = new URL(car.advertUrl); if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new Error(); }
      catch { issues.push(`cars.${index}: advert URL must belong to the configured marketplace`); }
    }
  });
  return issues;
}

/** A source change must never silently abandon existing customer-linked records. */
export function stockConnectionNeedsMigration(previous: { platform: string; retailerId: string }, next: { platform: string; retailerId: string }, hasVehicleRecords: boolean): boolean {
  return hasVehicleRecords && (previous.platform !== next.platform || previous.retailerId !== next.retailerId);
}
