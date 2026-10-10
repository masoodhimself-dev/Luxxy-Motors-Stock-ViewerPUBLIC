import { currentDealerId } from "../lib/tenant-context";
import { dealerIntegrationsStore } from '../lib/dealer-integrations-store';
import { createHash, randomBytes } from 'node:crypto';
import { siteUrl } from '../lib/enquiry-links';
import { sendTemplatedEmail } from '../lib/email-provider';
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
  try { res.json({ sales: await store().list(), preview: false }); } catch (error) { failure(req, res, error); }
});
router.get('/sale-workspace/paperwork', async (req, res) => { try { const p = await dealerIntegrationsStore.readSalesPaperwork(); res.json({ saleTerms: p.saleTerms, reservationTerms: p.reservationTerms, invoiceDetails: p.invoiceDetails }); } catch (error) { failure(req, res, error); } });
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
router.post('/sale-workspace/:id/payments', requirePermission('payments.record'), async (req, res) => { await mutate(req, res, { action: 'payment', payment: req.body?.payment }); });
router.post('/sale-workspace/:id/payments/:paymentId/confirm', requirePermission('payments.record'), (req, res, next) => req.body?.reserveVehicle === true ? requirePermission('sales.manage')(req, res, next) : next(), async (req, res) => { await mutate(req, res, { action: 'confirm', paymentId: String(req.params.paymentId), date: req.body?.date, reserveVehicle: req.body?.reserveVehicle === true }); });
router.post('/sale-workspace/:id/payments/:paymentId/reverse', requirePermission('payments.refund'), async (req, res) => { await mutate(req, res, { action: 'reverse', paymentId: String(req.params.paymentId), amount: req.body?.amount, kind: req.body?.kind, reason: req.body?.reason, date: req.body?.date }); });
router.post('/sale-workspace/:id/documents', requirePermission('payments.record'), async (req, res) => { await mutate(req, res, { action: 'document', type: req.body?.type }); });
router.post('/sale-workspace/:id/take-deposit', requirePermission('payments.record'), requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'take-deposit', payment: req.body?.payment }); });
router.post('/sale-workspace/:id/complete-sale', requirePermission('payments.record'), requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'complete-sale', acknowledge: req.body?.acknowledge }); });
router.post('/sale-workspace/:id/handover', requirePermission('sales.handover'), async (req, res) => { await mutate(req, res, { action: 'handover', recipient: req.body?.recipient, completedAt: req.body?.completedAt, acknowledgeOutstanding: req.body?.acknowledgeOutstanding }); });
router.post('/sale-workspace/:id/lifecycle', requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'lifecycle', status: req.body?.status }); });
router.post('/sale-workspace/:id/customer-links', requirePermission('sales.manage'), async (req, res) => {
  try {
    if (!uuid(req.params.id)) throw new SaleWorkspaceError('Sale not found.', 404);
    const days = Number(req.body?.days ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new SaleWorkspaceError('Choose an access duration between one and 90 days.');
    const token = req.body?.token ?? randomBytes(32).toString('hex');
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new SaleWorkspaceError('Check the secure customer link.');
    // Browser-generated token is retained in memory for retries; only its hash is stored.
    const expiresAt = req.body?.expiresAt ?? new Date(Date.now() + days * 86400000).toISOString();
    const result = await store().mutate({ id: req.params.id, expectedRevision: req.body?.expectedRevision, requestId: req.body?.requestId, actor: staffLabel(req), command: { action: 'customer-link', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt } });
    res.json({ ...result, customerUrl: `/my-purchase/${token}`, expiresAt: result.sale.customerAccess?.expiresAt, preview: false });
  } catch (error) { failure(req, res, error); }
});
router.post('/sale-workspace/:id/customer-links/revoke', requirePermission('sales.manage'), async (req, res) => { await mutate(req, res, { action: 'customer-revoke' }); });
router.post('/sale-workspace/:id/customer-links/email', requirePermission('sales.manage'), async (req, res) => {
  try {
    if (!uuid(req.params.id)) throw new SaleWorkspaceError('Sale not found.', 404);
    const token = req.body?.token, requestId = req.body?.requestId;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new SaleWorkspaceError('Check the customer link email request.');
    const service = store(); const { record: privateRecord, view } = await service.customer(token);
    if (privateRecord.id !== req.params.id) throw new SaleWorkspaceError('Customer link not found.', 404);
    let current = await service.get(req.params.id);
    const to = current.draft.email;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new SaleWorkspaceError('Add a valid customer email first.');
    let delivery = current.customerLinkEmail?.id === requestId ? current.customerLinkEmail : undefined;
    if (delivery && delivery.status !== 'sending') { res.json({ sale: current, replayed: true }); return; }
    delivery ??= { id: requestId, to, status: 'sending', attemptedAt: new Date().toISOString() };
    const started = await service.mutate({ id: current.id, expectedRevision: req.body?.expectedRevision, requestId: 'link-email-start-' + requestId, actor: staffLabel(req), command: { action: 'link-email-status', delivery } });
    current = started.sale;
    try {
      const url = siteUrl('/my-purchase/' + token);
      await sendTemplatedEmail({ templateId: 'customer_access_link', to, variables: { customer_name: current.draft.customer, dealer_name: view.dealer.identity.name, dealer_phone: view.dealer.contact.phone, vehicle_title: current.draft.vehicle, reference: current.reference, portal_url: url, expires_at: current.customerAccess!.expiresAt }, facts: [{ label: 'Sale', value: current.reference }, { label: 'Vehicle', value: current.draft.vehicle }, { label: 'Private page', value: url }, { label: 'Link expires', value: current.customerAccess!.expiresAt }], idempotencyKey: 'customer-link-' + current.id + '-' + requestId });
      delivery = { ...delivery, status: 'sent', sentAt: new Date().toISOString() };
    } catch (error) { delivery = { ...delivery, status: error instanceof Error && /disabled|Configure RESEND|private Resend/.test(error.message) ? 'prepared' : 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'Email delivery failed.' }; }
    const finished = await service.finishEmail(current.id, 'link-email-finish-' + requestId, { action: 'link-email-status', delivery }, staffLabel(req));
    res.json({ ...finished, preview: false });
  } catch (error) { failure(req, res, error); }
});
router.get('/sale-workspace/:id/documents/:documentId/pdf', async (req, res) => {
  try {
    if (!uuid(req.params.id)) throw new SaleWorkspaceError('Sale not found.', 404);
    const { document, archive } = await store().pdf(req.params.id, req.params.documentId);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${document.number.replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`); res.setHeader('ETag', '"' + archive.sha256 + '"'); res.end(Buffer.from(archive.content, 'base64'));
  } catch (error) { failure(req, res, error); }
});
router.post('/sale-workspace/:id/documents/:documentId/email', requirePermission('payments.record'), async (req, res) => {
  try {
    if (!uuid(req.params.id)) throw new SaleWorkspaceError('Sale not found.', 404);
    const requestId = req.body?.requestId;
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new SaleWorkspaceError('A unique email request is required.');
    const service = store();
    let current = await service.get(req.params.id);
    const document = current.documents.find(d => d.id === req.params.documentId);
    if (!document) throw new SaleWorkspaceError('Document not found.', 404);
    const to = document.snapshot.draft.email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new SaleWorkspaceError('The issued document needs a valid customer email. Issue an updated document after correcting the email.');
    let delivery = current.emailDeliveries?.find(row => row.id === requestId);
    if (delivery?.documentId && delivery.documentId !== document.id) throw new SaleWorkspaceError('This request was used for another document.', 409);
    if (delivery?.status === 'sent' || delivery?.status === 'failed' || delivery?.status === 'prepared') { res.json({ sale: current, preview: false, replayed: true }); return; }
    delivery ??= { id: requestId, documentId: document.id, to, status: 'sending', attemptedAt: new Date().toISOString() };
    const started = await service.mutate({ id: current.id, expectedRevision: req.body?.expectedRevision, requestId: 'email-start-' + requestId, actor: staffLabel(req), command: { action: 'email-status', delivery } });
    current = started.sale;
    try {
      const { archive } = await service.pdf(current.id, document.id);
      const providerId = await sendTemplatedEmail({ templateId: document.type === 'invoice' ? 'invoice' : document.type === 'statement' ? 'balance_statement' : document.type === 'receipt' ? 'payment_receipt' : 'document_email', to,
        variables: { customer_name: document.snapshot.draft.customer, customer_email: to, dealer_name: document.snapshot.branding.identity.name, dealer_email: document.snapshot.branding.contact.email, dealer_phone: document.snapshot.branding.contact.phone, reference: current.reference, vehicle_title: document.snapshot.draft.vehicle, vehicle_registration: document.snapshot.draft.registration, document_title: document.title, document_type: document.title, document_number: document.number, issued_at: document.issuedAt, amount: `GBP ${((document.paymentAmountPence ?? document.snapshot.totals.totalDue) / 100).toFixed(2)}`, amount_received: `GBP ${(document.snapshot.totals.confirmedPaid / 100).toFixed(2)}`, balance: `GBP ${(document.balanceAtIssue / 100).toFixed(2)}` },
        facts: [{ label: 'Document', value: `${document.title} ${document.number}` }, { label: 'Vehicle', value: document.snapshot.draft.vehicle }, { label: 'Balance at issue', value: `GBP ${(document.balanceAtIssue / 100).toFixed(2)}` }],
        idempotencyKey: 'sale-document-' + document.id + '-' + requestId, attachments: [{ filename: document.number + '.pdf', content: archive.content }] });
      delivery = { ...delivery, status: 'sent', sentAt: new Date().toISOString(), providerId };
    } catch (error) { delivery = { ...delivery, status: error instanceof Error && /disabled|Configure RESEND|private Resend/.test(error.message) ? 'prepared' : 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'Email delivery failed.' }; }
    const finished = await service.finishEmail(current.id, 'email-finish-' + requestId, { action: 'email-status', delivery }, staffLabel(req));
    res.json({ ...finished, preview: false });
  } catch (error) { failure(req, res, error); }
});
// These token-gated routes deliberately sit outside the staff middleware.
router.use('/customer-sale', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store, private'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
router.get('/customer-sale/:token', async (req, res) => { try { const { view } = await store().customer(req.params.token); res.json({ sale: view }); } catch (error) { failure(req, res, error); } });
router.get('/customer-sale/:token/documents/:documentId', async (req, res) => { try { res.json({ document: await store().customerDocument(req.params.token, req.params.documentId) }); } catch (error) { failure(req, res, error); } });
router.get('/customer-sale/:token/documents/:documentId/pdf', async (req, res) => {
  try {
    const service = store(); const { record } = await service.customer(req.params.token);
    await service.customerDocument(req.params.token, req.params.documentId);
    const { document, archive } = await service.pdf(record.id, req.params.documentId);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${document.number.replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`); res.end(Buffer.from(archive.content, 'base64'));
  } catch (error) { failure(req, res, error); }
});
export default router;
