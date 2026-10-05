import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createSaleWorkspace, changeSaleWorkspace, customerSaleDocument, customerSaleView, publicSaleWorkspace, type SaleWorkspaceContext, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { PreviewSaleWorkspaceStore } from './sales';
import { archiveSaleDocument } from '../../api-server/src/lib/sale-document-pdf';
let sequence = 0;
const context = (): SaleWorkspaceContext => ({ now: new Date().toISOString(), actor: 'Staff-only identity', nextId: () => 'test-' + ++sequence, nextNumber: type => type + '-' + ++sequence, branding: { identity: { name: 'Buyer Motors', logoText: 'BUYER', logoAsset: '' }, contact: { phone: '02000000000', email: 'dealer@test.invalid' }, address: { street: '', city: 'London', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } } });
const draft = (): SaleWorkspaceDraft => ({ id: 'draft', customer: 'Buyer A', email: 'buyer@test.invalid', phone: '07000000000', address: 'Buyer address', vehicleId: 'car-a', vehicle: 'Car A', registration: 'AB12 CDE', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: 'Cash', notes: 'secret staff note', collection: '', preparation: false, documents: false, handover: false });
const create = () => createSaleWorkspace({ draft: draft(), requestId: 'create-buyer-request' }, context(), 'SALE-A').sale;

test('customer contract and documents whitelist private staff state while preserving the issued money snapshot', () => {
  const issued = changeSaleWorkspace(create(), { action: 'document', type: 'invoice' }, { requestId: 'issue-invoice-request', expectedRevision: 1 }, context());
  const original = JSON.stringify(issued.document);
  const polluted = structuredClone(issued.sale);
  polluted.requests = { secret: { fingerprint: 'secret' } }; polluted.providerPayments = { pi_secret: { eventId: 'secret', paymentId: 'secret' } };
  polluted.customerAccess = { tokenHash: 'secret-token-hash', expiresAt: '2099-01-01T00:00:00Z' };
  (polluted.documents[0].snapshot.branding as any).apiKey = 'secret-api-key';
  (polluted.documents[0].snapshot.totals as any).staffSecret = 'secret-extra';
  const publicDoc = customerSaleDocument(polluted.documents[0]);
  const text = JSON.stringify(publicDoc);
  for (const secret of ['secret staff note', 'Staff-only identity', 'secret-api-key', 'secret-extra']) assert.equal(text.includes(secret), false, secret);
  assert.equal(publicDoc.number, issued.document!.number); assert.equal(publicDoc.snapshot.totals.totalDue, 1200000); assert.equal(publicDoc.snapshot.draft.customer, 'Buyer A');
  const view = JSON.stringify(customerSaleView(polluted, context().branding));
  for (const secret of ['secret staff note', 'Staff-only identity', 'secret-token-hash', 'pi_secret', 'requests']) assert.equal(view.includes(secret), false, secret);
  assert.equal(JSON.stringify(issued.document), original);
  const staffResponse = JSON.stringify(publicSaleWorkspace(polluted)); assert.equal(staffResponse.includes('secret-token-hash'), false); assert.equal(staffResponse.includes('pi_secret'), false);
});

test('stock lifecycle is explicit, revision guarded, and prevents switching a reserved car or releasing a sold car', () => {
  const first = create();
  const reserve = changeSaleWorkspace(first, { action: 'lifecycle', status: 'reserved' }, { expectedRevision: 1, requestId: 'reserve-request' }, context());
  assert.equal(reserve.sale.lifecycle?.status, 'reserved');
  assert.throws(() => changeSaleWorkspace(reserve.sale, { action: 'update', draft: { ...reserve.sale.draft, vehicleId: 'car-b' } }, { expectedRevision: reserve.sale.revision, requestId: 'switch-request' }, context()), /Release/);
  assert.throws(() => changeSaleWorkspace(reserve.sale, { action: 'lifecycle', status: 'sold' }, { expectedRevision: 1, requestId: 'stale-request' }, context()), /another device/);
  const sold = changeSaleWorkspace(reserve.sale, { action: 'lifecycle', status: 'sold' }, { expectedRevision: reserve.sale.revision, requestId: 'sold-request' }, context());
  assert.throws(() => changeSaleWorkspace(sold.sale, { action: 'lifecycle', status: 'released' }, { expectedRevision: sold.sale.revision, requestId: 'release-request' }, context()), /sold vehicle/);
});

test('customer token lookup is sale-scoped, stored hashed, expires/revokes, and archived PDF stays exact after edits', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'luxxy-customer-sale-'));
  const filename = path.join(directory, 'isolated.json');
  try {
    const service = new PreviewSaleWorkspaceStore(filename, async () => ({ branding: context().branding }));
    let a = (await service.mutate({ requestId: 'create-a-request', draft: draft() })).sale;
    const b = (await service.mutate({ requestId: 'create-b-request', draft: { ...draft(), customer: 'Buyer B', vehicle: 'Car B' } })).sale;
    a = (await service.mutate({ id: a.id, expectedRevision: a.revision, requestId: 'doc-a-request', command: { action: 'document', type: 'invoice' } })).sale;
    const token = 'a'.repeat(64), hash = createHash('sha256').update(token).digest('hex');
    a = (await service.mutate({ id: a.id, expectedRevision: a.revision, requestId: 'link-a-request', command: { action: 'customer-link', tokenHash: hash, expiresAt: new Date(Date.now() + 86400000).toISOString() } })).sale;
    assert.equal((await service.customer(token)).view.customer, 'Buyer A');
    assert.equal((await service.customer(token)).view.documents.length, 1);
    assert.equal((await readFile(filename, 'utf8')).includes(token), false);
    assert.equal((await service.get(a.id)).documentArchives, undefined);
    await assert.rejects(service.customer('b'.repeat(64)), /unavailable/);
    await assert.rejects(service.mutate({ id: b.id, expectedRevision: b.revision, requestId: 'link-b-request', command: { action: 'customer-link', tokenHash: hash, expiresAt: new Date(Date.now() + 86400000).toISOString() } }), /unique/);
    const before = await service.pdf(a.id, a.documents[0].id);
    a = (await service.mutate({ id: a.id, expectedRevision: a.revision, requestId: 'edit-a-request', command: { action: 'update', draft: { ...a.draft, customer: 'Updated buyer', price: '13000' } } })).sale;
    const after = await service.pdf(a.id, a.documents[0].id);
    assert.equal(before.archive.content, after.archive.content); assert.equal(Buffer.from(before.archive.content, 'base64').subarray(0, 4).toString(), '%PDF');
    assert.equal(before.document.snapshot.draft.customer, 'Buyer A');
    a = (await service.mutate({ id: a.id, expectedRevision: a.revision, requestId: 'revoke-a-request', command: { action: 'customer-revoke' } })).sale;
    await assert.rejects(service.customer(token), /unavailable/);
    const state = JSON.parse(await readFile(filename, 'utf8')); state.sales.find((s: any) => s.id === a.id).customerAccess = { tokenHash: hash, expiresAt: '2000-01-01T00:00:00Z' };
    const { writeFile } = await import('node:fs/promises'); await writeFile(filename, JSON.stringify(state)); await assert.rejects(service.customer(token), /expired/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('PDF archive is deterministic and redacts staff-only notes', () => {
  const issued = changeSaleWorkspace(create(), { action: 'document', type: 'invoice' }, { expectedRevision: 1, requestId: 'invoice-pdf-request' }, context()).document!;
  const first = archiveSaleDocument(issued), second = archiveSaleDocument(issued);
  assert.equal(first.sha256, second.sha256); assert.equal(first.content, second.content);
  assert.equal(Buffer.from(first.content, 'base64').includes(Buffer.from('secret staff note')), false);
});

test('public customer HTTP routes reject another sale document and serve only public immutable copies', async () => {
  const { createServer } = await import('node:http');
  const { salesPreview } = await import('./sales');
  const directory = await mkdtemp(path.join(tmpdir(), 'luxxy-customer-http-'));
  const store = new PreviewSaleWorkspaceStore(path.join(directory, 'state.json'), async () => ({ branding: context().branding }));
  const server = createServer((req, res) => void salesPreview(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`), store));
  server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    let a = (await store.mutate({ requestId: 'create-http-a', draft: draft() })).sale;
    let b = (await store.mutate({ requestId: 'create-http-b', draft: { ...draft(), customer: 'Another buyer', email: 'another@test.invalid' } })).sale;
    a = (await store.mutate({ id: a.id, expectedRevision: a.revision, requestId: 'doc-http-a', command: { action: 'document', type: 'invoice' } })).sale;
    b = (await store.mutate({ id: b.id, expectedRevision: b.revision, requestId: 'doc-http-b', command: { action: 'document', type: 'invoice' } })).sale;
    const token = 'f'.repeat(64);
    a = (await store.mutate({ id: a.id, expectedRevision: a.revision, requestId: 'link-http-a', command: { action: 'customer-link', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 86400000).toISOString() } })).sale;
    const view = await fetch(`${origin}/api/customer-sale/${token}`); assert.equal(view.status, 200); assert.equal(view.headers.get('cache-control'), 'no-store'); assert.equal(view.headers.get('referrer-policy'), 'no-referrer');
    const text = await view.text(); assert.equal(text.includes('Another buyer'), false); assert.equal(text.includes('secret staff note'), false); assert.equal(text.includes('tokenHash'), false);
    const safeDoc = await fetch(`${origin}/api/customer-sale/${token}/documents/${a.documents[0].id}`); assert.equal(safeDoc.status, 200); assert.equal((await safeDoc.text()).includes('secret staff note'), false);
    const wrongDoc = await fetch(`${origin}/api/customer-sale/${token}/documents/${b.documents[0].id}`); assert.equal(wrongDoc.status, 404);
    const wrongPdf = await fetch(`${origin}/api/customer-sale/${token}/documents/${b.documents[0].id}/pdf`); assert.equal(wrongPdf.status, 404);
    const pdf = await fetch(`${origin}/api/customer-sale/${token}/documents/${a.documents[0].id}/pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.deepEqual(Buffer.from(await pdf.arrayBuffer()).toString('base64'), (await store.pdf(a.id, a.documents[0].id)).archive.content);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
