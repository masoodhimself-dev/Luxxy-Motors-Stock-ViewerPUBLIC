import { getAuth } from '@clerk/express';
import { db, pool, dealerDemosTable, dealerSettingsTable, dealershipsTable } from '@workspace/db';
import { WEBSITE_TEMPLATES, isWebsiteTemplateId, type WebsiteTemplateId } from '@workspace/vehicle-meta/website-templates';
import { and, eq, isNull } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod/v4';
import { expectedSettingsRevision, PostgresSettingsVersionStore, SettingsVersionError } from '../lib/settings-versions';
import { publishedWebsiteTemplate, withWebsiteTemplate } from '../lib/website-template-settings';
import { demoShowcaseSelection, demoShowcaseTarget, makeDemoShowcaseLink } from '../lib/demo-showcase';

const router = Router();
const selection = z.object({ template: z.custom<WebsiteTemplateId>(isWebsiteTemplateId), reviewed: z.literal(true) }).strict();

async function target(id: string) {
  const [row] = await db.select({
    dealer: dealershipsTable,
    settings: { revision: dealerSettingsTable.revision, config: dealerSettingsTable.config },
    demo: { dealerId: dealerDemosTable.dealerId, expiresAt: dealerDemosTable.expiresAt },
  }).from(dealershipsTable)
    .leftJoin(dealerSettingsTable, eq(dealerSettingsTable.dealerId, dealershipsTable.id))
    .leftJoin(dealerDemosTable, and(eq(dealerDemosTable.dealerId, dealershipsTable.id), isNull(dealerDemosTable.convertedAt)))
    .where(eq(dealershipsTable.id, id));
  if (!row || !['draft', 'active'].includes(row.dealer.status) || (row.demo && row.demo.expiresAt.getTime() <= Date.now())) {
    throw new SettingsVersionError('This dealership is not available for a website template review.', 404);
  }
  if (!row.settings) throw new SettingsVersionError('The dealership website settings must be prepared before choosing a template.', 428);
  return { dealer: row.dealer, settings: row.settings };
}

function failure(req: Request, res: Response, error: unknown) {
  if (error instanceof SettingsVersionError) {
    if (error.revision !== undefined) res.set('x-settings-revision', String(error.revision));
    res.status(error.status).json({ error: error.message, ...(error.revision === undefined ? {} : { revision: error.revision }) });
    return;
  }
  req.log?.error({ err: error }, 'Website template settings request failed');
  res.status(500).json({ error: 'The dealership website template could not be loaded or changed.' });
}

// Mounted behind the Platform Admin host, origin and user checks in platform-dealers.
router.get('/dealers/:id/website-template', async (req, res) => {
  try {
    const { dealer, settings } = await target(req.params.id);
    res.set({ 'x-settings-revision': String(settings.revision), ETag: `"${settings.revision}"` });
    res.json({ dealerId: dealer.id, currentTemplate: publishedWebsiteTemplate(settings.config), revision: settings.revision,
      templates: WEBSITE_TEMPLATES, previewPath: `/platform/preview/${encodeURIComponent(dealer.id)}` });
  } catch (error) { failure(req, res, error); }
});

router.patch('/dealers/:id/website-template', async (req, res) => {
  try {
    const parsed = selection.safeParse(req.body);
    if (!parsed.success) throw new SettingsVersionError('Preview a supported website template and confirm that you have reviewed it before applying it.', 400);
    const expectedRevision = expectedSettingsRevision(req.headers['if-match']);
    const { dealer } = await target(req.params.id);
    const result = await new PostgresSettingsVersionStore(dealer.id, pool).publish({
      config: { template: parsed.data.template }, expectedRevision,
      actor: `Platform administrator ${getAuth(req).userId}`,
      validate: async (_input, current) => withWebsiteTemplate(current, parsed.data.template),
    });
    res.set({ 'x-settings-revision': String(result.revision), ETag: `"${result.revision}"` });
    res.json({ dealerId: dealer.id, currentTemplate: publishedWebsiteTemplate(result.config), revision: result.revision });
  } catch (error) { failure(req, res, error); }
});

router.post('/dealers/:id/demo-links', async (req, res) => {
  const parsed = demoShowcaseSelection.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose one to three different website designs and how long the link should last.' });
    return;
  }
  try {
    const demo = await demoShowcaseTarget(req.params.id);
    if (!demo || demo.expiresAt.getTime() <= Date.now()) {
      res.status(404).json({ error: 'Sharing is available for current dealership demos with website settings.' });
      return;
    }
    const link = makeDemoShowcaseLink(demo.dealerId, parsed.data, demo.expiresAt);
    if (!link) {
      res.status(503).json({ error: 'Website link sharing is unavailable. Contact Platform Admin.' });
      return;
    }
    res.status(201).json(link);
  } catch {
    req.log?.error('Could not create dealership website links');
    res.status(500).json({ error: 'The website link could not be created. Try again.' });
  }
});

export default router;
