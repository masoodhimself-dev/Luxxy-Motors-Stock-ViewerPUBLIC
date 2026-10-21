import { Router } from 'express';
import { z } from 'zod/v4';
import { requirePermission, requireStaff } from '../middlewares/staff-auth';
import { normaliseWebsiteImage, WebsiteAssetError, websiteAssetLimits } from '../lib/website-asset-image';
import { readDealerWebsiteAsset, saveDealerWebsiteAsset } from '../lib/dealer-website-assets';
import { currentTenant } from '../lib/tenant-context';

const router = Router();
const uuid = z.string().uuid();
const upload = z.object({ requestId: uuid, image: z.string().max(Math.ceil(websiteAssetLimits.bytes / 3) * 4 + 32) }).strict();

router.post('/staff/website-assets', requireStaff, requirePermission('settings.publish'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const parsed = upload.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Choose one PNG, JPEG or WebP image under 2 MB.', code: 'INVALID_WEBSITE_IMAGE' }); return; }
  try {
    const image = await normaliseWebsiteImage(parsed.data.image);
    const result = await saveDealerWebsiteAsset(parsed.data.requestId, image, req.staff!.authUserId);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof WebsiteAssetError) {
      if (error.status === 429) res.set('Retry-After', '2');
      res.status(error.status).json({ error: error.message, code: error.code }); return;
    }
    // Never log a supplied data URL, filename, native-decoder error, or uploaded bytes.
    req.log.error('Website image upload could not be saved');
    const missingSchema = ['42P01', '42703'].includes((error as { code?: string })?.code ?? '');
    res.status(missingSchema ? 503 : 500).json({ error: missingSchema ? 'Website image uploads require migration 0047 on this deployment.' : 'The website image could not be saved. Try again.', code: missingSchema ? 'WEBSITE_IMAGE_STORAGE_UNAVAILABLE' : 'WEBSITE_IMAGE_SAVE_FAILED' });
  }
});

router.get('/website-assets/:id', async (req, res) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  if (!uuid.safeParse(req.params.id).success) { res.set('Cache-Control', 'no-store').status(404).end(); return; }
  try {
    const image = await readDealerWebsiteAsset(req.params.id);
    if (!image) { res.set('Cache-Control', 'no-store').status(404).end(); return; }
    const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.slice('image/'.length);
    res.set({ 'Cache-Control': currentTenant()?.demo ? 'no-store' : 'public, max-age=31536000, immutable', 'Content-Type': image.mimeType, 'Content-Length': String(image.byteSize), 'Content-Disposition': `inline; filename="website-image.${extension}"`, ETag: `"${image.digest}"` });
    if (req.fresh) { res.status(304).end(); return; }
    res.send(image.bytes);
  } catch {
    req.log.error('Website image could not be loaded');
    res.set('Cache-Control', 'no-store').status(503).end();
  }
});

export default router;
