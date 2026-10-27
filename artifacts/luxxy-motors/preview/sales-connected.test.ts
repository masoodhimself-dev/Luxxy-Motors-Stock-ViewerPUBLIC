import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaleWorkspace, changeSaleWorkspace, publicSaleWorkspace, saleCompletionChecklistItems, type SaleWorkspaceContext, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { archiveSaleDocument } from '../../api-server/src/lib/sale-document-pdf';
let sequence = 0;
const context = (): SaleWorkspaceContext => ({ now: new Date().toISOString(), actor: 'Staff-only identity', nextId: () => 'test-' + ++sequence, nextNumber: type => type + '-' + ++sequence, branding: { identity: { name: 'Buyer Motors', logoText: 'BUYER', logoAsset: '' }, contact: { phone: '02000000000', email: 'dealer@test.invalid' }, address: { street: '', city: 'London', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } } });
const draft = (): SaleWorkspaceDraft => ({ id: 'draft', customer: 'Buyer A', email: 'buyer@test.invalid', phone: '07000000000', address: 'Buyer address', vehicleId: 'car-a', vehicle: 'Car A', registration: 'AB12 CDE', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: 'Cash', notes: 'secret staff note', collection: '', preparation: false, documents: false, handover: false });
const create = () => createSaleWorkspace({ draft: draft(), requestId: 'create-buyer-request' }, context(), 'SALE-A').sale;

test('stock lifecycle is explicit, revision guarded, and prevents switching a reserved car or releasing a sold car', () => {
  const first = create();
  const reserve = changeSaleWorkspace(first, { action: 'lifecycle', status: 'reserved' }, { expectedRevision: 1, requestId: 'reserve-request' }, context());
  assert.equal(reserve.sale.lifecycle?.status, 'reserved');
  assert.throws(() => changeSaleWorkspace(reserve.sale, { action: 'update', draft: { ...reserve.sale.draft, vehicleId: 'car-b' } }, { expectedRevision: reserve.sale.revision, requestId: 'switch-request' }, context()), /Release/);
  assert.throws(() => changeSaleWorkspace(reserve.sale, { action: 'lifecycle', status: 'sold' }, { expectedRevision: 1, requestId: 'stale-request' }, context()), /another device/);
  const checked = changeSaleWorkspace(reserve.sale, { action: 'checklists', completion: Object.fromEntries(saleCompletionChecklistItems.map(item => [item.id, 'checked'])) }, { expectedRevision: reserve.sale.revision, requestId: 'checked-before-sold' }, context()).sale;
  const sold = changeSaleWorkspace(checked, { action: 'lifecycle', status: 'sold' }, { expectedRevision: checked.revision, requestId: 'sold-request' }, context());
  assert.throws(() => changeSaleWorkspace(sold.sale, { action: 'lifecycle', status: 'released' }, { expectedRevision: sold.sale.revision, requestId: 'release-request' }, context()), /sold vehicle/);
});

test('PDF archive is deterministic and redacts staff-only notes', () => {
  const issued = changeSaleWorkspace(create(), { action: 'document', type: 'invoice' }, { expectedRevision: 1, requestId: 'invoice-pdf-request' }, context()).document!;
  const first = archiveSaleDocument(issued), second = archiveSaleDocument(issued);
  assert.equal(first.sha256, second.sha256); assert.equal(first.content, second.content);
  assert.equal(Buffer.from(first.content, 'base64').includes(Buffer.from('secret staff note')), false);
});

test('staff sale responses retain core history while removing private provider and request metadata',()=>{
 const sale=create();sale.requests={secret:{fingerprint:'private-transport-fingerprint'}};sale.providerPayments={pi_secret:{eventId:'provider-event',paymentId:'private-provider-payment'}};sale.customerAccess={tokenHash:'private-retired-link-hash',expiresAt:'2099-01-01T00:00:00Z'};
 const serialized=JSON.stringify(publicSaleWorkspace(sale));
 for(const secret of ['private-transport-fingerprint','private-provider-payment','private-retired-link-hash'])assert.equal(serialized.includes(secret),false);
 assert.equal(publicSaleWorkspace(sale).draft.customer,'Buyer A');
});
