import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, stockAlertSettingsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { currentDealerId, currentTenant } from './tenant-context';
import { dealerFeatureEnabled } from './dealer-features';
import { dealerIntegrationsStore, effectiveResendSettings, integrationReadiness } from './dealer-integrations-store';
import { publicSeoOrigin } from './public-page-seo';

export const stockAlertDurationMs = 60 * 24 * 60 * 60 * 1_000;
export const stockAlertConfirmationMs = 24 * 60 * 60 * 1_000;
const tokenPattern = /^([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\.([\w-]{43})$/;
type Purpose = 'confirm' | 'manage';

function secret() {
  const key = process.env.STOCK_ALERT_TOKEN_SECRET?.trim();
  if (!key || key.length < 32) throw new Error('Stock alert token signing is unavailable.');
  return key;
}

export function getStockAlertOrigin() {
  const tenant = currentTenant();
  return tenant?.demo || tenant?.kind === 'import' ? null : publicSeoOrigin(tenant?.canonicalOrigin ?? process.env.PUBLIC_SITE_URL?.trim());
}

export function stockAlertEmailReady() {
  return process.env.STOCK_ALERT_EMAIL_ENABLED === 'true'
    && (process.env.STOCK_ALERT_TOKEN_SECRET?.trim().length ?? 0) >= 32
    && Boolean(getStockAlertOrigin());
}

export function stockAlertToken(id: string, purpose: Purpose, version = '') {
  const digest = createHmac('sha256', secret())
    .update(JSON.stringify(['stock-alert', currentDealerId(), purpose, id, version]))
    .digest('base64url');
  return `${id}.${digest}`;
}

export function stockAlertTokenId(token: string) {
  return tokenPattern.exec(token)?.[1] ?? null;
}

export function isStockAlertTokenValid(token: string, id: string, purpose: Purpose, version = '') {
  if (stockAlertTokenId(token) !== id || (process.env.STOCK_ALERT_TOKEN_SECRET?.trim().length ?? 0) < 32) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(stockAlertToken(id, purpose, version)));
}

export function stockAlertRateKey(bucket: string, value: string) {
  return createHmac('sha256', secret()).update(JSON.stringify(['stock-alert-rate', currentDealerId(), bucket, value])).digest('hex');
}

export async function stockAlertSettingEnabled() {
  const [settings] = await db.select({ enabled: stockAlertSettingsTable.enabled }).from(stockAlertSettingsTable)
    .where(eq(stockAlertSettingsTable.dealerId, currentDealerId())).limit(1);
  return settings?.enabled === true;
}

export async function stockAlertDeliveryReady() {
  if (!stockAlertEmailReady() || !(await dealerFeatureEnabled('customerEmails'))) return false;
  const resend = effectiveResendSettings(await dealerIntegrationsStore.readPrivate());
  return resend.enabled && integrationReadiness({ resend }).resend.ready;
}

export async function stockAlertsEnabled() {
  return stockAlertEmailReady() && await stockAlertSettingEnabled() && await stockAlertDeliveryReady();
}
