import { requireDealerFeature } from '../middlewares/dealer-features';
import { currentDealerId } from "../lib/tenant-context";
import { dealerIntegrationsStore } from '../lib/dealer-integrations-store';
import { Router, type Request, type Response } from 'express';
import { pool } from '@workspace/db';
import { SaleWorkspaceError, type SaleWorkspaceCommand } from '@workspace/vehicle-meta';
import { requireStaff, requirePermission, staffLabel } from '../middlewares/staff-auth';
import { PostgresSaleWorkspaceStore, readSaleWorkspaceAssets } from '../lib/sale-workspace-store';

const router = Router();
const dealerId = () => currentDealerId();
const uuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function store() {
  const id = dealerId();
  return new PostgresSaleWorkspaceStore(id, (draft, client) => readSaleWorkspaceAssets(draft, id, client), pool);
}
function failure(req: Request, res: Response, error: unknown) {
  if (error instanceof SaleWorkspaceError) { res.status(error.status).json({ error: error.message }); return; }
  const missingSchema = (error as { code?: string; cause?: { code?: string } })?.code === '42P01' || (error as { cause?: { code?: string } })?.cause?.code === '42P01';
  req.log.error({ err: error }, 'Sale workspace request failed');
  res.status(missingSchema ? 503 : 500).json({ error: missingSchema ? 'Shared sales storage needs migration 0016 before it can be used on this deployment.' : 'The sale could not be saved. Please try again.' });
}
router.use('/sale-workspace', requireStaff, (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > 256_000) { res.status(413).json({ error: 'Sale request is too large.' }); return; }
  next();
});
router.get('/sale-workspace', async (req, res) => {
  try { for(const key of ['q','offset','enquiryId','reservationId'])if(req.query[key]!==undefined&&typeof req.query[key]!=='string')throw new SaleWorkspaceError('Check the sales search.',400); const offset=req.query.offset===undefined?0:Number(req.query.offset);if(typeof req.query.q!=='string'&&req.query.q!==undefined)throw new SaleWorkspaceError('Check the sales search.',400);res.json({...(await store().list({q:req.query.q as string|undefined,offset,enquiryId:typeof req.query.enquiryId==='string'?req.query.enquiryId:undefined,reservationId:typeof req.query.reservationId==='string'?req.query.reservationId:undefined})),preview:false}); } catch (error) { failure(req, res, error); }
});
router.get('/sale-workspace/paperwork', async (req, res) => { try { const p = await dealerIntegrationsStore.readSalesPaperwork(); res.json({ saleTerms: p.saleTerms, reservationTerms: p.reservationTerms, invoiceSettings: p.invoiceSettings, correctionSettings: p.correctionSettings }); } catch (error) { failure(req, res, error); } });
router.get('/sale-workspace/:id', async (req, res) => {
  try { if (!uuid(req.params.id)) throw new SaleWorkspaceError('Sale not found.', 404); res.json({ sale: await store().get(req.params.id), preview: false }); } catch (error) { failure(req, res, error); }
});
router.post('/sale-workspace', requirePermission('sales.manage'), async (req, res) => {
  try {
    const mutation = await store().mutate({ requestId: req.body?.requestId, draft: req.body?.draft, actor: staffLabel(req) });
    res.status(mutation.replayed ? 200 : 201).json({ ...mutation, preview: false });
  } catch (error) { failure(req, res, error); }
});
async function mutate(req: Request, res: Response, command: SaleWorkspaceCommand) {
  try {
    const id = String(req.params.id);
    if (!uuid(id)) throw new SaleWorkspaceError('Sale not found.', 404);
    const mutation = await store().mutate({ id, command, requestId: req.body?.requestId, expectedRevision: req.body?.expectedRevision, actor: staffLabel(req) });
    res.json({ ...mutation, preview: false });
  } catch (error) { failure(req, res, error); }
}
router.put('/sale-workspace/:id', requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'update', draft: req.body?.draft }); });
router.delete('/sale-workspace/:id', requirePermission('sales.manage'), async (req, res) => {
  try {
    if (!uuid(req.params.id)) throw new SaleWorkspaceError('Sale draft not found.', 404);
    if (req.body?.confirm !== true) throw new SaleWorkspaceError('Confirm deletion of this empty sale draft first.');
    res.json(await store().deleteEmptyDraft(req.params.id, req.body?.expectedRevision));
  } catch (error) { failure(req, res, error); }
});
router.post('/sale-workspace/:id/checklists', requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'checklists', completion: req.body?.completion, partExchanges: req.body?.partExchanges }); });
router.post('/sale-workspace/:id/corrections', requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'correction-note', description: req.body?.description, reference: req.body?.reference }); });
router.post('/sale-workspace/:id/payments', requirePermission('payments.record'), async (req, res) => { await mutate(req, res, { action: 'payment', payment: req.body?.payment }); });
router.post('/sale-workspace/:id/payments/:paymentId/confirm', requirePermission('payments.record'), (req, res, next) => req.body?.reserveVehicle === true ? requirePermission('sales.manage')(req, res, next) : next(), async (req, res) => { await mutate(req, res, { action: 'confirm', paymentId: String(req.params.paymentId), date: req.body?.date, reserveVehicle: req.body?.reserveVehicle === true }); });
router.post('/sale-workspace/:id/payments/:paymentId/reverse', requirePermission('payments.refund'), async (req, res) => { await mutate(req, res, { action: 'reverse', paymentId: String(req.params.paymentId), amount: req.body?.amount, kind: req.body?.kind, reason: req.body?.reason, date: req.body?.date, method: req.body?.method, invoiceOnly: req.body?.invoiceOnly === true }); });
router.post('/sale-workspace/:id/documents', requirePermission('payments.record'), async (req, res) => { await mutate(req, res, { action: 'document', type: req.body?.type }); });
router.post('/sale-workspace/:id/invoice-payments', requirePermission('payments.record'), (req, res, next) => req.body?.payment?.kind === 'deposit' ? requirePermission('sales.manage')(req, res, next) : next(), async (req, res) => { await mutate(req, res, { action: 'invoice-payment', payment: req.body?.payment }); });
router.post('/sale-workspace/:id/issue-invoice', requirePermission('payments.record'), async (req, res) => { await mutate(req, res, { action: 'issue-invoice', kind: req.body?.kind, acknowledge: req.body?.acknowledge }); });
router.post('/sale-workspace/:id/finish-invoice-sale', requirePermission('payments.record'), requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'finish-invoice-sale', acknowledge: req.body?.acknowledge, acknowledgeOutstanding: req.body?.acknowledgeOutstanding === true }); });
router.post('/sale-workspace/:id/take-deposit', requirePermission('payments.record'), requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'take-deposit', payment: req.body?.payment }); });
router.post('/sale-workspace/:id/complete-sale', requirePermission('payments.record'), requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'complete-sale', acknowledge: req.body?.acknowledge }); });
router.post('/sale-workspace/:id/fulfilment', requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'fulfilment', fulfilment: req.body?.fulfilment }); });
router.post('/sale-workspace/:id/handover', requirePermission('sales.handover'), async (req, res) => { await mutate(req, res, { action: 'handover', recipient: req.body?.recipient, completedAt: req.body?.completedAt, acknowledgeOutstanding: req.body?.acknowledgeOutstanding }); });
router.post('/sale-workspace/:id/lifecycle', requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'lifecycle', status: req.body?.status }); });
router.get('/sale-workspace/:id/documents/:documentId/pdf', async (req, res) => {
  try {
    if (!uuid(req.params.id)) throw new SaleWorkspaceError('Sale not found.', 404);
    const { document, archive } = await store().pdf(req.params.id, req.params.documentId);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${document.number.replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`); res.setHeader('ETag', '"' + archive.sha256 + '"'); res.end(Buffer.from(archive.content, 'base64'));
  } catch (error) { failure(req, res, error); }
});
router.post('/sale-workspace/:id/documents/:documentId/email', requirePermission('payments.record'), requireDealerFeature('customerEmails'), async (req,res)=>{
  try {
    const {approveSaleDocumentEmail}=await import('../lib/sale-document-email');
    const result=await approveSaleDocumentEmail({saleId:String(req.params.id),documentId:String(req.params.documentId),requestId:req.body?.requestId,expectedRevision:req.body?.expectedRevision,actorId:req.staff!.authUserId,actorName:staffLabel(req)});
    res.json({...result,preview:false});
  }catch(error){failure(req,res,error);}
});
// These token-gated routes deliberately sit outside the staff middleware.
router.get('/invoice-verification/:saleId/:documentId/:token', async (req, res) => {
  res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
  try {
    if (!uuid(req.params.saleId) || !uuid(req.params.documentId) || !/^[a-f0-9]{64}$/.test(req.params.token)) throw new SaleWorkspaceError('This invoice could not be verified.', 404);
    res.json(await store().verifyInvoice(req.params.saleId, req.params.documentId, req.params.token));
  } catch (error) { failure(req, res, error); }
});
export default router;
