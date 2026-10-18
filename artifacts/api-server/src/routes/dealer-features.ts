import { Router } from 'express';
import { effectiveDealerFeatures } from '../lib/dealer-features';
const router = Router();
router.get('/features', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const now = new Date();
    const features = await effectiveDealerFeatures(undefined, now);
    res.json({ features: Object.fromEntries(features.map(feature => [feature.key, feature.enabled])), evaluatedAt: now.toISOString() });
  } catch { res.status(503).json({ error: 'Feature availability could not be checked.' }); }
});
export default router;
