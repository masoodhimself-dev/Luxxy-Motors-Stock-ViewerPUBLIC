import { Router, type Request, type Response } from 'express';
import { pool } from '@workspace/db';
import { fullSalesTermsPdfBytes } from '@workspace/vehicle-meta/full-sales-terms-pdf';
import { requirePermission, requireStaff, staffLabel } from '../middlewares/staff-auth';
import { currentDealerId, currentTenant } from '../lib/tenant-context';
import { siteOrigin } from '../lib/enquiry-links';
import { FullSalesTermsStore, SalesTermsError } from '../lib/full-sales-terms-store';
const router = Router();
const store = () => new FullSalesTermsStore(pool, currentDealerId(), currentTenant()?.canonicalOrigin ?? siteOrigin());
function failure(req: Request, res: Response, error: unknown) {
  if (error instanceof SalesTermsError) { res.status(error.status).json({ error: error.message }); return; }
  req.log.error({ err: error }, 'Full sales terms request failed');
  res.status((error as { code?: string }).code === '42P01' ? 503 : 500).json({ error: 'The terms could not be prepared. Your saved documents remain unchanged.' });
}
router.use('/sales-terms', requireStaff, (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
  if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > 300000) { res.status(413).json({ error: 'The terms request is too large.' }); return; } next();
});
router.get('/sales-terms', async (req, res) => { try { res.json(await store().settings()); } catch (e) { failure(req, res, e); } });
router.put('/sales-terms', requirePermission('settings.publish'), async (req, res) => { try { res.json(await store().save(req.body?.expectedRevision, req.body?.content, staffLabel(req))); } catch (e) { failure(req, res, e); } });
router.post('/sales-terms/publish', requirePermission('settings.publish'), async (req, res) => { try { if (req.body?.confirm !== true) throw new SalesTermsError('Confirm that this wording should be used for new sales.'); res.json(await store().publish(req.body?.expectedRevision, staffLabel(req))); } catch (e) { failure(req, res, e); } });
router.post('/sales-terms/preview', requirePermission('settings.publish'), async (req, res) => { try {
  const copies = req.body?.copies; if (copies !== 'dealer' && copies !== 'both') throw new SalesTermsError('Choose the copies to print.');
  const snapshot = await store().preview(req.body?.content, req.body?.category, staffLabel(req));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="terms-review-draft.pdf"' }).end(Buffer.from(fullSalesTermsPdfBytes(snapshot, copies)));
} catch (e) { failure(req, res, e); } });
router.get('/sales-terms/sales/:saleId', async (req, res) => { try { res.json({ documents: await store().list(String(req.params.saleId)) }); } catch (e) { failure(req, res, e); } });
router.post('/sales-terms/sales/:saleId', requirePermission('sales.manage'), async (req, res) => { try { res.status(201).json(await store().issue(String(req.params.saleId), { requestId: req.body?.requestId, expectedSaleRevision: req.body?.expectedSaleRevision, termsVersionId: req.body?.termsVersionId }, staffLabel(req))); } catch (e) { failure(req, res, e); } });
router.get('/sales-terms/sales/:saleId/:documentId/pdf', async (req, res) => { try {
  const result = await store().pdf(String(req.params.saleId), String(req.params.documentId), req.query.copies ?? 'dealer');
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="sale-terms.pdf"' }).end(result.bytes);
} catch (e) { failure(req, res, e); } });
export default router;
