import { and as tenantAnd, eq as tenantEq } from "drizzle-orm";
import { currentDealerId } from "../lib/tenant-context";
import { Router, type Request, type Response } from 'express';
import { clerkClient } from '@clerk/express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, pool, enquiriesTable, stockImportRunsTable, vehiclesTable, vehicleChangesTable } from '@workspace/db';
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { requirePermission, requireStaff, staffLabel } from '../middlewares/staff-auth';
import { isStaffRole } from '../lib/staff-permissions';
import { dealerOperationsSummary, paymentLedgerCsv, stockHealth } from '../lib/dealer-operations';
const router = Router();
const dealerId = () => currentDealerId();
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
class OperationError extends Error { constructor(message: string, public status = 400) { super(message); } }
function fail(req: Request, res: Response, error: unknown) {
  if (error instanceof OperationError) { res.status(error.status).json({ error: error.message }); return; }
  req.log.error({ err: error }, 'Dealer operations request failed');
  const missing = ['42P01', '42703'].includes((error as { code?: string }).code ?? '');
  res.status(missing ? 503 : 500).json({ error: missing ? 'Dealer operations requires the prepared database migrations on this deployment.' : 'Dealer operations could not be loaded or saved.' });
}
async function sales() {
  const result = await pool.query('SELECT state FROM sale_workspace WHERE dealer_id=$1 ORDER BY updated_at DESC', [dealerId()]);
  return result.rows.map(row => row.state) as SaleWorkspaceRecord[];
}
function staleAfterHours() { const hours = Number(process.env.STOCK_STALE_AFTER_HOURS); return Number.isFinite(hours) && hours > 0 ? hours : 36; }
async function monitoredStockRuns() {
  const [recent, successful] = await Promise.all([
    db.select().from(stockImportRunsTable).where(eq(stockImportRunsTable.dealerId, dealerId())).orderBy(desc(stockImportRunsTable.receivedAt)).limit(100),
    db.select().from(stockImportRunsTable).where(and(eq(stockImportRunsTable.dealerId, dealerId()), eq(stockImportRunsTable.status, 'completed'), eq(stockImportRunsTable.complete, true))).orderBy(desc(stockImportRunsTable.receivedAt)).limit(1),
  ]);
  return successful[0] && !recent.some(run => run.id === successful[0].id) ? [...recent, successful[0]] : recent;
}
router.get('/dealer-operations', requireStaff, async (req, res) => {
  try {
    const [enquiries, saleRows, stockRuns, [{ count }]] = await Promise.all([
      db.select().from(enquiriesTable).where(eq(enquiriesTable.dealerId, dealerId())),
      sales(),
      monitoredStockRuns(),
      db.select({ count: sql<number>`count(*)::int` }).from(vehiclesTable).where(and(eq(vehiclesTable.dealerId, dealerId()), sql`${vehiclesTable.inventoryStatus} in ('available','reserved')`, sql`${vehiclesTable.missingCount} < ${Number.isFinite(Number(process.env.STOCK_MISSING_HIDE_THRESHOLD)) && Number(process.env.STOCK_MISSING_HIDE_THRESHOLD) >= 0 ? Number(process.env.STOCK_MISSING_HIDE_THRESHOLD) : 2}`, sql`not (${vehiclesTable.priceReviewRequired} and ${vehiclesTable.sourcePrice} is null and ${vehiclesTable.websitePriceOverride} is null)`)),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json(dealerOperationsSummary({ enquiries, sales: saleRows, stockRuns, stockCount: count, staleAfterHours: staleAfterHours() }));
  } catch (error) { fail(req, res, error); }
});
function exportDate(value: unknown): string | undefined {
  if (value === undefined) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) !== value) throw new OperationError('Choose valid export dates.');
  return value;
}
router.get('/dealer-operations/payments.csv', requireStaff, requirePermission('finance.export'), async (req, res) => {
  try {
    const from = exportDate(req.query.from); const to = exportDate(req.query.to);
    if (from && to && from > to) throw new OperationError('The export end date must follow the start date.');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="luxxy-payments.csv"');
    res.send(paymentLedgerCsv(await sales(), { from, to }));
  } catch (error) { fail(req, res, error); }
});
router.get('/staff/stock-health', requireStaff, async (req, res) => {
  try {
    const runs = await monitoredStockRuns();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...stockHealth(runs, new Date(), staleAfterHours()), imports: runs.map(run => ({ runId: run.runId, status: run.status, source: run.source, receivedAt: run.receivedAt, scrapedAt: run.scrapedAt, expectedCount: run.expectedCount, receivedCount: run.receivedCount, addedCount: run.addedCount, changedCount: run.changedCount, missingCount: run.missingCount, errors: run.errors })) });
  } catch (error) { fail(req, res, error); }
});
router.patch('/staff/vehicles/:id/price', requireStaff, requirePermission('stock.manage'), async (req, res) => {
  try {
    const price = req.body?.price;
    if (!uuid(req.params.id) || !(price === null || (typeof price === 'number' && Number.isInteger(price) && price >= 0 && price <= 10_000_000))) throw new OperationError('Enter a valid advertised price in pounds, or clear the override.');
    const updated = await db.transaction(async tx => {
      const [vehicle] = await tx.select().from(vehiclesTable).where(and(eq(vehiclesTable.id, req.params.id), eq(vehiclesTable.dealerId, dealerId()))).for('update');
      if (!vehicle) throw new OperationError('Vehicle not found.', 404);
      if (req.body?.expectedUpdatedAt && new Date(req.body.expectedUpdatedAt).getTime() !== vehicle.updatedAt.getTime()) throw new OperationError('This vehicle has changed. Refresh before changing its price.', 409);
      const [result] = await tx.update(vehiclesTable).set({ websitePriceOverride: price, updatedAt: new Date() }).where(tenantAnd(eq(vehiclesTable.id, vehicle.id), tenantEq(vehiclesTable.dealerId, currentDealerId()))).returning();
      await tx.insert(vehicleChangesTable).values({ vehicleId: vehicle.id, fieldName: 'websitePriceOverride', oldValue: vehicle.websitePriceOverride, newValue: price, auditMetadata: { actor: staffLabel(req), authUserId: req.staff?.authUserId, reason: 'Staff price override' } });
      return { id: result.id, price: result.websitePriceOverride ?? result.sourcePrice, websitePriceOverride: result.websitePriceOverride, updatedAt: result.updatedAt };
    });
    res.json(updated);
  } catch (error) { fail(req, res, error); }
});
router.get('/staff/access', requireStaff, (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.json({ role: req.staff!.role, permissions: req.staff!.permissions, user: { authUserId: req.staff!.authUserId, name: req.staff!.name, email: req.staff!.email } });
});
function member(row: Record<string, any>) { return { id: row.id, authUserId: row.auth_user_id, name: row.name, email: row.email, role: row.role, active: !row.disabled_at, createdAt: row.created_at, lastSeenAt: row.last_seen_at }; }
router.get('/staff/team', requireStaff, requirePermission('team.manage'), async (req, res) => {
  try { const result = await pool.query('SELECT * FROM portal_users WHERE dealer_id=$1 ORDER BY created_at', [dealerId()]); res.setHeader('Cache-Control','no-store'); res.json({ members: result.rows.map(member) }); } catch (error) { fail(req,res,error); }
});
router.post('/staff/team', requireStaff, requirePermission('team.manage'), async (req,res) => {
  try {
    const role = req.body?.role;
    if (!isStaffRole(role)) throw new OperationError('Choose owner, salesperson or accounts.');
    const authUserId = typeof req.body?.authUserId === 'string' ? req.body.authUserId.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!authUserId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OperationError('Enter the email address of an existing registered account.');
    const profile = authUserId ? await clerkClient.users.getUser(authUserId) : (await clerkClient.users.getUserList({ emailAddress: [email], limit: 2 })).data[0];
    if (!profile) throw new OperationError('This account has not registered yet. Ask the staff member to register, then add their email here.',404);
    const primaryEmail = profile.primaryEmailAddress?.emailAddress ?? profile.emailAddresses[0]?.emailAddress ?? null;
    const name = [profile.firstName,profile.lastName].filter(Boolean).join(' ') || profile.username || primaryEmail;
    const result = await pool.query('INSERT INTO portal_users (dealer_id,auth_user_id,email,name,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT (auth_user_id) DO NOTHING RETURNING *', [dealerId(), profile.id,primaryEmail,name,role]);
    if (!result.rows[0]) throw new OperationError('That account is already on the staff list. Change its role from the existing row.',409);
    res.status(201).json({ member: member(result.rows[0]) });
  } catch(error) { fail(req,res,error); }
});
router.patch('/staff/team/:id', requireStaff, requirePermission('team.manage'), async (req,res) => {
  const client = await pool.connect();
  try {
    if (!uuid(req.params.id) || (req.body?.role !== undefined && !isStaffRole(req.body.role)) || (req.body?.active !== undefined && typeof req.body.active !== 'boolean') || (req.body?.role === undefined && req.body?.active === undefined)) throw new OperationError('Check the staff role and access settings.');
    await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`portal-staff:${dealerId()}`]);
    const selected = await client.query('SELECT * FROM portal_users WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE',[dealerId(),req.params.id]);
    const current = selected.rows[0]; if (!current) throw new OperationError('Staff member not found.',404);
    const role = req.body.role ?? current.role;
    const active = req.body.active ?? !current.disabled_at;
    if (current.role === 'owner' && !current.disabled_at && (role !== 'owner' || !active)) {
      const owners = await client.query("SELECT count(*)::int AS count FROM portal_users WHERE dealer_id=$1 AND role='owner' AND disabled_at IS NULL",[dealerId()]);
      if (owners.rows[0].count <= 1) throw new OperationError('Keep at least one active owner. Add another owner before changing this account.',409);
    }
    const result = await client.query('UPDATE portal_users SET role=$3,disabled_at=$4 WHERE dealer_id=$1 AND id=$2::uuid RETURNING *',[dealerId(),req.params.id,role,active ? null : new Date()]);
    await client.query('COMMIT'); res.json({ member: member(result.rows[0]) });
  } catch(error) { await client.query('ROLLBACK'); fail(req,res,error); } finally { client.release(); }
});
export default router;
