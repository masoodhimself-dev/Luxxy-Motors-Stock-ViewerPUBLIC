import { Router, type Request, type Response } from 'express';
import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, stockAlertRateLimitsTable, stockAlertSettingsTable, stockAlertsTable } from '@workspace/db';
import { getStockFacetValue, hasStockAlertCriteria, normaliseStockAlertCriteria, stockAlertCriteriaLabel } from '@workspace/vehicle-meta/stock-filters';
import { splitStockFacetValues, stockFacetKeys, stockValueKey } from '@workspace/vehicle-meta/stock-filter-types';
import { requirePermission, requireStaff } from '../middlewares/staff-auth';
import { staffWriteOriginAllowed } from '../middlewares/staff-write-origin';
import { currentDealerId } from '../lib/tenant-context';
import {
  getStockAlertOrigin, isStockAlertTokenValid, stockAlertConfirmationMs, stockAlertDeliveryReady, stockAlertDurationMs,
  stockAlertRateKey, stockAlertSettingEnabled, stockAlertToken, stockAlertTokenId, stockAlertsEnabled,
} from '../lib/stock-alerts';
import { sendStockAlertConfirmation } from '../lib/stock-alert-worker';
import { readPublicStockCars } from './stock';

const router = Router();
const field = z.string().max(500).optional();
const criteriaSchema = z.object({
  make: field, model: field, minPrice: field, maxPrice: field, fuel: field,
  transmission: field, bodyType: field, search: z.string().max(200).optional(),
  ulez: z.boolean().optional(), colour: field, engine: field, seats: field, mileage: field,
});
const signupSchema = z.object({ email: z.string().trim().email().max(254), filters: criteriaSchema });
const tokenSchema = z.object({ token: z.string().max(80) });
const settingsSchema = z.object({ enabled: z.boolean() }).strict();
const alertStatuses = ['active', 'pending', 'expired', 'stopped'] as const;
type AlertStatus = typeof alertStatuses[number];
const maxListPage = 1000;
const listQuery = z.object({
  status: z.enum(['all', ...alertStatuses]).default('active'),
  page: z.coerce.number().int().min(1).max(maxListPage).default(1),
});
const listPageSize = 25;
const activeAlert = (dealerId: string, now: Date) => and(
  eq(stockAlertsTable.dealerId, dealerId), isNotNull(stockAlertsTable.confirmedAt),
  isNull(stockAlertsTable.unsubscribedAt), gt(stockAlertsTable.expiresAt, now),
);
const privateHeaders = (_req: Request, res: Response, next: () => void) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
  next();
};
const writeAllowed = (req: Request, res: Response) => {
  if (staffWriteOriginAllowed({ method: req.method, get: name => req.get(name) })) return true;
  res.status(403).json({ error: 'Open this action on the dealership website.' });
  return false;
};

async function staffCriteriaLabel() {
  const stock = await readPublicStockCars();
  const allowedFacets = Object.fromEntries(
    stockFacetKeys.map(key => [key, new Set(stock.map(car => stockValueKey(getStockFacetValue(car, key))))]),
  );
  return (stored: Record<string, unknown>) => {
    const criteria = normaliseStockAlertCriteria(stored);
    for (const key of stockFacetKeys) {
      const values = splitStockFacetValues(criteria[key]);
      criteria[key] = Array.from(new Set(values.map(value =>
        allowedFacets[key].has(value) || key === 'engine' || key === 'seats' ? value : 'other',
      ))).join(',');
    }
    return stockAlertCriteriaLabel(criteria, false) || 'Search details unavailable';
  };
}

async function consumeRate(bucket: string, value: string, now: Date, intervalMs: number, limit: number) {
  const key = stockAlertRateKey(bucket, value);
  const expiresAt = new Date(now.getTime() + intervalMs);
  const [row] = await db.insert(stockAlertRateLimitsTable).values({ key, expiresAt })
    .onConflictDoUpdate({
      target: stockAlertRateLimitsTable.key,
      set: {
        count: sql`case when ${stockAlertRateLimitsTable.expiresAt} <= ${now} then 1 else ${stockAlertRateLimitsTable.count} + 1 end`,
        expiresAt: sql`case when ${stockAlertRateLimitsTable.expiresAt} <= ${now} then excluded.expires_at else ${stockAlertRateLimitsTable.expiresAt} end`,
      },
      setWhere: sql`${stockAlertRateLimitsTable.expiresAt} <= ${now} or ${stockAlertRateLimitsTable.count} < ${limit}`,
    }).returning({ count: stockAlertRateLimitsTable.count });
  return Boolean(row);
}

router.use(['/stock-alerts', '/staff/stock-alerts'], privateHeaders);

router.get('/stock-alerts/status', async (_req, res) => {
  res.json({ enabled: await stockAlertsEnabled() });
});

router.post('/stock-alerts', async (req, res) => {
  if (!writeAllowed(req, res)) return;
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Enter a valid email address and search.' }); return; }
  const criteria = normaliseStockAlertCriteria(parsed.data.filters);
  if (!hasStockAlertCriteria(criteria)) { res.status(400).json({ error: 'Choose what you’re looking for first.' }); return; }
  const origin = getStockAlertOrigin();
  if (!origin || !(await stockAlertsEnabled())) { res.status(503).json({ error: 'Stock alerts are unavailable right now.' }); return; }

  const dealerId = currentDealerId();
  const now = new Date();
  const email = parsed.data.email.toLowerCase();
  if (!(await consumeRate('signup-ip', req.ip ?? 'unknown', now, 60 * 60_000, 10))
    || !(await consumeRate('signup-dealer', 'all', now, 60 * 60_000, 100))) {
    res.status(429).json({ error: 'Too many requests. Try again later.' }); return;
  }
  if (await consumeRate('signup-email', email, now, 15 * 60_000, 1)) {
    const [alert] = await db.insert(stockAlertsTable).values({ dealerId, email, pendingCriteria: { ...criteria }, requestedAt: now })
      .onConflictDoUpdate({ target: [stockAlertsTable.dealerId, stockAlertsTable.email], set: { pendingCriteria: { ...criteria }, requestedAt: now } })
      .returning({ id: stockAlertsTable.id, requestedAt: stockAlertsTable.requestedAt });
    const token = stockAlertToken(alert.id, 'confirm', alert.requestedAt.toISOString());
    try {
      await sendStockAlertConfirmation({ id: alert.id, email, token }, origin);
    } catch {
      res.status(503).json({ error: 'We couldn’t send the confirmation email. Try again later.' }); return;
    }
  }
  res.status(202).json({ accepted: true });
});

router.post('/stock-alerts/:action', async (req, res) => {
  if (!writeAllowed(req, res)) return;
  const action = req.params.action;
  const parsed = tokenSchema.safeParse(req.body);
  const token = parsed.success ? parsed.data.token : '';
  const id = stockAlertTokenId(token);
  if (!id || (action !== 'confirm' && action !== 'stop' && action !== 'renew')) {
    res.status(404).json({ error: 'This link is invalid.' }); return;
  }
  const now = new Date();
  const dealerId = currentDealerId();
  // A buyer can always stop a search through the original email.
  if (action !== 'stop' && !(await stockAlertsEnabled())) {
    res.status(503).json({ error: 'Stock alerts are unavailable right now.' }); return;
  }
  if (action !== 'confirm' && !isStockAlertTokenValid(token, id, 'manage')) {
    res.status(404).json({ error: 'This link is invalid.' }); return;
  }
  const result = await db.transaction(async tx => {
    const scope = and(eq(stockAlertsTable.dealerId, dealerId), eq(stockAlertsTable.id, id));
    const [alert] = await tx.select().from(stockAlertsTable).where(scope).for('update');
    if (!alert) return 'invalid';
    if (action === 'stop') {
      await tx.update(stockAlertsTable).set({ unsubscribedAt: alert.unsubscribedAt ?? now, pendingCriteria: null, nextCheckAt: null }).where(scope);
      return 'ok';
    }
    const expiresAt = new Date(now.getTime() + stockAlertDurationMs);
    if (action === 'renew') {
      if (!alert.confirmedAt || alert.unsubscribedAt || !alert.expiresAt || alert.expiresAt.getTime() < now.getTime() - 30 * 24 * 60 * 60_000) return 'expired';
      await tx.update(stockAlertsTable).set({ expiresAt, nextCheckAt: alert.nextCheckAt ?? now }).where(scope);
      return 'ok';
    }
    if (!isStockAlertTokenValid(token, id, 'confirm', alert.requestedAt.toISOString())) return 'invalid';
    if (now.getTime() - alert.requestedAt.getTime() > stockAlertConfirmationMs) return 'expired';
    if (!alert.pendingCriteria) return alert.confirmedAt && !alert.unsubscribedAt ? 'ok' : 'expired';
    await tx.update(stockAlertsTable).set({
      criteria: alert.pendingCriteria, pendingCriteria: null,
      confirmedAt: now, unsubscribedAt: null, expiresAt, nextCheckAt: now,
    }).where(scope);
    return 'ok';
  });
  if (result !== 'ok') {
    res.status(result === 'expired' ? 410 : 404).json({ error: result === 'expired' ? 'This link has expired.' : 'This link is invalid.' });
    return;
  }
  res.json({ success: true });
});

router.get('/staff/stock-alerts', requireStaff, async (_req, res) => {
  const dealerId = currentDealerId();
  const active = activeAlert(dealerId, new Date());
  const buyers = sql<number>`count(*)::integer`;
  const [enabled, emailReady, totals, groups] = await Promise.all([
    stockAlertSettingEnabled(), stockAlertDeliveryReady(),
    db.select({ buyers }).from(stockAlertsTable).where(active),
    db.select({ criteria: stockAlertsTable.criteria, buyers }).from(stockAlertsTable)
      .where(active).groupBy(stockAlertsTable.criteria).orderBy(desc(buyers)).limit(500),
  ]);
  const grouped = new Map<string, number>();
  if (groups.length) {
    const labelFor = await staffCriteriaLabel();
    for (const row of groups) {
      const label = labelFor(row.criteria);
      grouped.set(label, (grouped.get(label) ?? 0) + row.buyers);
    }
  }
  const searches = Array.from(grouped, ([label, count]) => ({ label, buyers: count }))
    .sort((left, right) => right.buyers - left.buyers || left.label.localeCompare(right.label)).slice(0, 25);
  res.json({ enabled, emailReady, totalBuyers: totals[0]?.buyers ?? 0, searches });
});

router.get('/staff/stock-alerts/requests', requireStaff, async (req, res) => {
  const query = listQuery.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: 'Choose a valid status and page.' }); return; }
  const { status: filter, page } = query.data;
  const dealerId = currentDealerId();
  const now = new Date();
  const confirmationCutoff = new Date(now.getTime() - stockAlertConfirmationMs);
  const status = sql<AlertStatus>`case
    when ${activeAlert(dealerId, now)} then 'active'
    when ${stockAlertsTable.pendingCriteria} is not null and ${stockAlertsTable.requestedAt} > ${confirmationCutoff.toISOString()}::timestamptz then 'pending'
    when ${stockAlertsTable.unsubscribedAt} is not null then 'stopped'
    else 'expired'
  end`;
  const rows = await db.select({
    id: stockAlertsTable.id,
    labelSource: sql<Record<string, unknown>>`case when ${status} = 'pending' or ${stockAlertsTable.confirmedAt} is null
      then coalesce(${stockAlertsTable.pendingCriteria}, ${stockAlertsTable.criteria}) else ${stockAlertsTable.criteria} end`,
    status,
    requestedAt: stockAlertsTable.requestedAt,
    confirmedAt: stockAlertsTable.confirmedAt,
    expiresAt: stockAlertsTable.expiresAt,
  }).from(stockAlertsTable).where(and(
    eq(stockAlertsTable.dealerId, dealerId),
    filter === 'all' ? undefined : sql`${status} = ${filter}`,
  )).orderBy(desc(stockAlertsTable.requestedAt), desc(stockAlertsTable.id))
    .limit(listPageSize + 1).offset((page - 1) * listPageSize);
  if (!rows.length) { res.json({ items: [], page, hasMore: false }); return; }
  const labelFor = await staffCriteriaLabel();
  const items = rows.slice(0, listPageSize).map(({ labelSource, ...row }) => ({
    ...row,
    label: labelFor(labelSource),
    confirmedAt: row.status === 'pending' ? null : row.confirmedAt,
    expiresAt: row.status === 'pending' ? null : row.expiresAt,
  }));
  res.json({ items, page, hasMore: page < maxListPage && rows.length > listPageSize });
});

router.put('/staff/stock-alerts/settings', requireStaff, requirePermission('settings.publish'), async (req, res) => {
  if (!writeAllowed(req, res)) return;
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Choose whether to enable stock alerts.' }); return; }
  const dealerId = currentDealerId();
  const { enabled } = parsed.data;
  await db.insert(stockAlertSettingsTable).values({ dealerId, enabled })
    .onConflictDoUpdate({ target: stockAlertSettingsTable.dealerId, set: { enabled } });
  res.json({ enabled });
});

export default router;
