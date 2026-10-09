import { currentDealerId, multiTenantEnabled } from "../lib/tenant-context";
import { stockConnectionNeedsMigration } from "../lib/stock-platform";
import { and, eq, sql } from "drizzle-orm";
import { db, vehiclesTable, stockImportRunsTable, dealerImportKeysTable } from "@workspace/db";
import { isPlatformAdmin } from "../lib/platform-admin";
import { Router, type IRouter } from 'express';
import { EmailTemplateError, emailTemplateVariables } from '@workspace/vehicle-meta';
import { requirePermission, requireStaff } from '../middlewares/staff-auth';
import { dealerIntegrationsStore, IntegrationSettingsError } from '../lib/dealer-integrations-store';
import { previewEmailTemplate } from '../lib/email-template-preview';
import { siteOrigin } from '../lib/enquiry-links';
const router: IRouter = Router();
router.use(['/dealer-integrations', '/email-templates'], requireStaff, requirePermission('integrations.manage'), (req, res, next) => { res.set('Cache-Control', 'no-store'); if (req.get('origin') && req.get('origin') !== siteOrigin()) { res.status(403).json({ error: 'Open private settings from the dealership website.' }); return; } next(); });
function failure(error: unknown, res: import('express').Response) { const expected = error instanceof IntegrationSettingsError || error instanceof EmailTemplateError; res.status(expected ? error.status : 500).json({ error: expected ? error.message : 'Private settings could not be saved. Please try again.' }); }
router.use('/dealer-integrations/stock-connection', (req, res, next) => { if (!isPlatformAdmin(req.staff?.authUserId)) { res.status(403).json({ error: 'Only the platform administrator can manage stock connections.' }); return; } next(); });
router.get('/dealer-integrations/stock-connection', async (_req, res) => { try {
  const id = currentDealerId();
  const result = await dealerIntegrationsStore.readStockConnection();
  const [latest] = await db.select().from(stockImportRunsTable).where(and(eq(stockImportRunsTable.dealerId, id), eq(stockImportRunsTable.source, result.connection.platform))).orderBy(sql`${stockImportRunsTable.receivedAt} desc`).limit(1);
  const keys = multiTenantEnabled() ? await db.select().from(dealerImportKeysTable).where(eq(dealerImportKeysTable.dealerId, id)) : [];
  res.json({ ...result, shared: multiTenantEnabled(), importSecretConfigured: multiTenantEnabled() ? keys.some(key => !key.disabledAt) : Boolean(process.env.STOCK_IMPORT_SECRET), latest: latest ? { status: latest.status, receivedAt: latest.receivedAt, count: latest.receivedCount, errors: latest.errors } : null });
} catch (error) { failure(error, res); } });
router.put('/dealer-integrations/stock-connection', async (req, res) => { try {
  const id = currentDealerId();
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stock-import:${id}`}))`);
    const previous = await dealerIntegrationsStore.readStockConnection(tx);
    const candidate = req.body?.connection;
    if (candidate && (candidate.platform !== previous.connection.platform || candidate.retailerId !== previous.connection.retailerId)) {
      const [existing] = await tx.select({ id: vehiclesTable.id }).from(vehiclesTable).where(eq(vehiclesTable.dealerId, id)).limit(1);
      if (stockConnectionNeedsMigration(previous.connection, candidate, Boolean(existing))) throw new IntegrationSettingsError('This dealership already has vehicle records. Changing marketplace or retailer requires a reviewed stock migration to preserve sales, reservations and enquiries.', 409);
    }
    return dealerIntegrationsStore.updateStockConnection(req.body, tx);
  });
  res.json(result);
} catch (error) { failure(error, res); } });
router.get('/dealer-integrations/sales-paperwork', async (_req, res) => { try { res.json(await dealerIntegrationsStore.readSalesPaperwork()); } catch (error) { failure(error, res); } });
router.put('/dealer-integrations/sales-paperwork', async (req, res) => { try { res.json(await dealerIntegrationsStore.updateSalesPaperwork(req.body)); } catch (error) { failure(error, res); } });
router.get('/dealer-integrations', async (_req, res) => { try { res.json(await dealerIntegrationsStore.readMasked()); } catch (error) { failure(error, res); } });
router.put('/dealer-integrations', async (req, res) => { try { res.json(await dealerIntegrationsStore.update(req.body)); } catch (error) { failure(error, res); } });
router.post('/dealer-integrations/validate', async (_req, res) => { try { res.json((await dealerIntegrationsStore.readMasked()).readiness); } catch (error) { failure(error, res); } });
router.get('/email-templates', async (_req, res) => { try { res.json({ ...await dealerIntegrationsStore.listTemplates(), variables: emailTemplateVariables }); } catch (error) { failure(error, res); } });
router.put('/email-templates', async (req, res) => { try { res.json({ ...await dealerIntegrationsStore.updateTemplate(req.body), variables: emailTemplateVariables }); } catch (error) { failure(error, res); } });
router.put('/email-templates/appearance', async (req, res) => { try { res.json({ ...await dealerIntegrationsStore.updateAppearance(req.body), variables: emailTemplateVariables }); } catch (error) { failure(error, res); } });
router.post('/email-templates/:id/preview', async (req, res) => { try { res.json(previewEmailTemplate(req.params.id, req.body, (await dealerIntegrationsStore.listTemplates()).appearance)); } catch (error) { failure(error, res); } });
export default router;
