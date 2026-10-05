import { Router, type IRouter } from 'express';
import { EmailTemplateError, emailTemplateVariables } from '@workspace/vehicle-meta';
import { requirePermission, requireStaff } from '../middlewares/staff-auth';
import { dealerIntegrationsStore, IntegrationSettingsError } from '../lib/dealer-integrations-store';
import { previewEmailTemplate } from '../lib/email-template-preview';
import { siteOrigin } from '../lib/enquiry-links';
const router: IRouter = Router();
router.use(['/dealer-integrations', '/email-templates'], requireStaff, requirePermission('integrations.manage'), (req, res, next) => { res.set('Cache-Control', 'no-store'); if (req.get('origin') && req.get('origin') !== siteOrigin()) { res.status(403).json({ error: 'Open private settings from the dealership website.' }); return; } next(); });
function failure(error: unknown, res: import('express').Response) { const expected = error instanceof IntegrationSettingsError || error instanceof EmailTemplateError; res.status(expected ? error.status : 500).json({ error: expected ? error.message : 'Private settings could not be saved. Please try again.' }); }
router.get('/dealer-integrations', async (_req, res) => { try { res.json(await dealerIntegrationsStore.readMasked()); } catch (error) { failure(error, res); } });
router.put('/dealer-integrations', async (req, res) => { try { res.json(await dealerIntegrationsStore.update(req.body)); } catch (error) { failure(error, res); } });
router.post('/dealer-integrations/validate', async (_req, res) => { try { res.json((await dealerIntegrationsStore.readMasked()).readiness); } catch (error) { failure(error, res); } });
router.get('/email-templates', async (_req, res) => { try { res.json({ ...await dealerIntegrationsStore.listTemplates(), variables: emailTemplateVariables }); } catch (error) { failure(error, res); } });
router.put('/email-templates', async (req, res) => { try { res.json({ ...await dealerIntegrationsStore.updateTemplate(req.body), variables: emailTemplateVariables }); } catch (error) { failure(error, res); } });
router.put('/email-templates/appearance', async (req, res) => { try { res.json({ ...await dealerIntegrationsStore.updateAppearance(req.body), variables: emailTemplateVariables }); } catch (error) { failure(error, res); } });
router.post('/email-templates/:id/preview', async (req, res) => { try { res.json(previewEmailTemplate(req.params.id, req.body, (await dealerIntegrationsStore.listTemplates()).appearance)); } catch (error) { failure(error, res); } });
export default router;
