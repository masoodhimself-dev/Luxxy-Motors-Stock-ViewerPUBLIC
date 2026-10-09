import { AsyncLocalStorage } from 'node:async_hooks';
export type TenantContext = { dealerId: string; canonicalOrigin: string; platform: 'autotrader' | 'cazoo'; retailerId: string; sourceUrl: string; importSecretHash?: string; kind?: 'website' | 'import' };
const scope = new AsyncLocalStorage<TenantContext>();
export const multiTenantEnabled = () => process.env.MULTI_TENANT_ENABLED === 'true';
export function currentTenant(): TenantContext | undefined { return scope.getStore(); }
export function runWithTenant<T>(tenant: TenantContext, work: () => T): T { return scope.run(Object.freeze({ ...tenant }), work); }
export function currentDealerId(): string {
  const tenant = currentTenant(); if (tenant) return tenant.dealerId;
  if (multiTenantEnabled()) throw new Error('A verified dealership context is required.');
  return process.env.STOCK_DEALER_ID ?? 'luxxy-motors';
}
export function normaliseTenantHost(value: string): string | null {
  if (!value || /[\s,/@\\?#]/.test(value)) return null;
  try { const url = new URL(`https://${value}`); const host = url.hostname.toLowerCase().replace(/\.$/, ''); return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) && !host.includes('..') ? host : null; } catch { return null; }
}
