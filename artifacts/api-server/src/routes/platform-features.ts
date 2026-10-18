import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { pool } from '@workspace/db';
import { dealerFeatureDefinitions, resolveDealerFeatures, type DealerFeatureKey } from '@workspace/vehicle-meta';
import { z } from 'zod/v4';
import { FeaturePolicyError, readFeatureRules, saveFeatureRule } from '../lib/dealer-features';

// Mounted behind platform-dealers' approved-host, administrator and origin checks.
const router = Router();
const input = z.object({ mode: z.enum(['inherit', 'enabled', 'disabled']), disabledAt: z.string().datetime({ offset: true }).nullable(), reason: z.string().trim().min(3).max(1000), expectedRevision: z.number().int().min(0) }).strict();
async function response(dealerId: string | null) {
  if (dealerId && !(await pool.query('SELECT id FROM dealerships WHERE id=$1', [dealerId])).rows.length) throw new FeaturePolicyError('Dealer not found.', 404);
  const rules = await readFeatureRules(dealerId);
  const audit = await pool.query('SELECT id,dealer_id AS "dealerId",feature_key AS "featureKey",before_rule AS "before",after_rule AS "after",reason,actor,created_at AS "createdAt" FROM feature_policy_audit WHERE dealer_id IS NOT DISTINCT FROM $1 ORDER BY created_at DESC,id DESC LIMIT 50', [dealerId]);
  return { scope: dealerId ? 'dealer' : 'platform', dealerId, evaluatedAt: new Date().toISOString(), features: resolveDealerFeatures(rules.defaults, rules.overrides), audit: audit.rows };
}
function failure(res: import('express').Response, error: unknown) {
  res.status(error instanceof FeaturePolicyError ? error.status : 503).json({ error: error instanceof FeaturePolicyError ? error.message : 'Feature controls could not be loaded or saved. Check that migration 0044 is applied.' });
}
for (const path of ['/features', '/dealers/:id/features']) {
  router.get(path, async (req, res) => { try { res.json(await response('id' in req.params ? String(req.params.id) : null)); } catch (error) { failure(res, error); } });
  router.put(`${path}/:key`, async (req, res) => {
    const parsed = input.safeParse(req.body);
    const key = req.params.key as DealerFeatureKey;
    if (!parsed.success || !dealerFeatureDefinitions.some(feature => feature.key === key)) { res.status(400).json({ error: 'Choose a supported feature, a mode, a valid date and a reason for the change.' }); return; }
    const dealerId = 'id' in req.params ? String(req.params.id) : null;
    try {
      await saveFeatureRule({ ...parsed.data, key, dealerId, actor: getAuth(req).userId! });
      res.json(await response(dealerId));
    } catch (error) { failure(res, error); }
  });
}
export default router;
