import { expect, it } from 'vitest';
import { createSaleWorkspace, changeSaleWorkspace, type SaleWorkspaceContext, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { emptyDraft } from '@/components/sales-demo/model';
import { saleInvoiceIsCurrent } from './sale-invoice-current';

function issuedSale() {
  let sequence = 0;
  const context: SaleWorkspaceContext = {
    now: '2026-10-27T12:00:00Z', actor: 'Test staff', nextId: () => `id-${++sequence}`, nextNumber: type => `${type}-${++sequence}`,
    branding: { identity: { name: 'Test Motors', logoText: 'TEST', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } },
  };
  const draft: SaleWorkspaceDraft = { ...emptyDraft(), payments: [], customer: 'Test Buyer', vehicleId: 'test-car', vehicle: 'Test car', price: '1000', address: 'Test buyer address', fulfilment: { method: 'collection', viewed: 'viewed', address: '', recipient: 'Test Buyer', phone: '', scheduledDate: '2026-10-27', timeWindow: 'Afternoon', instructions: '' } };
  const sale = createSaleWorkspace({ draft, requestId: 'create-sale' }, context, 'SALE-TEST').sale;
  return changeSaleWorkspace(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true }, { expectedRevision: sale.revision, requestId: 'issue-invoice' }, context).sale;
}

it.each([
  ['customer contact', (draft: SaleWorkspaceDraft) => { draft.email = 'corrected@example.test'; }],
  ['agreed price', (draft: SaleWorkspaceDraft) => { draft.price = '1001'; }],
  ['agreed disclosures', (draft: SaleWorkspaceDraft) => { draft.notes = 'Agreed bodywork disclosure'; }],
  ['collection date', (draft: SaleWorkspaceDraft) => { draft.fulfilment!.scheduledDate = '2026-10-28'; }],
  ['delivery arrangements', (draft: SaleWorkspaceDraft) => { draft.fulfilment!.method = 'delivery'; draft.fulfilment!.address = 'A newly agreed delivery address'; }],
] as const)('still detects a genuine change to %s', (_label, change) => {
  const sale = issuedSale(), invoice = sale.documents[0], original = structuredClone(invoice);
  expect(saleInvoiceIsCurrent(invoice, sale.draft, sale.payments)).toBe(true);
  change(sale.draft);
  expect(saleInvoiceIsCurrent(invoice, sale.draft, sale.payments)).toBe(false);
  expect(invoice).toEqual(original);
});
