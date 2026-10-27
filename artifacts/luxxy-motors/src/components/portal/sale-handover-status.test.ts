import { describe, it, expect } from 'vitest';
import { createSaleWorkspace, changeSaleWorkspace, saleHandoverStatus, type SaleWorkspaceContext, type SaleWorkspaceCommand, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { emptyDraft } from '@/components/sales-demo/model';
let serial = 0;
const context: SaleWorkspaceContext = {
  now: '2026-10-27T12:00:00Z', actor: 'Test staff', nextId: () => `test-${++serial}`, nextNumber: () => `TEST-${++serial}`,
  branding: { identity: { name: 'Test Motors', logoText: 'TEST', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } },
};
const create = () => createSaleWorkspace({ draft: { ...emptyDraft(), customer: 'Fictional buyer', vehicle: 'Test car', vehicleId: 'test-car', price: '1000' }, requestId: `create-${++serial}` }, context, 'TEST-1').sale;
const change = (sale: SaleWorkspaceRecord, command: SaleWorkspaceCommand) => changeSaleWorkspace(sale, command, { expectedRevision: sale.revision, requestId: `change-${++serial}` }, context).sale;
const updateArrangements = (sale: SaleWorkspaceRecord, changes: Partial<NonNullable<SaleWorkspaceRecord['draft']['fulfilment']>>) => change(sale, { action: 'update', draft: { ...sale.draft, fulfilment: { ...sale.draft.fulfilment!, ...changes } } });
const arrange = (sale: SaleWorkspaceRecord, stage: 'booked' | 'to_arrange', scheduledDate = '') => change(sale, { action: 'fulfilment', fulfilment: { ...sale.draft.fulfilment!, scheduledDate, stage } });

describe('collection and delivery status when editing the invoice', () => {
  it('allows an incomplete draft to be saved with collection still to arrange', () => {
    const draft = createSaleWorkspace({ draft: emptyDraft(), requestId: `create-${++serial}` }, context, 'TEST-INCOMPLETE').sale;
    const saved = change(draft, { action: 'update', draft: { ...draft.draft, notes: 'Still discussing details' } });
    expect(saved.draft.customer).toBe('');
    expect(saved.draft.fulfilment!.scheduledDate).toBe('');
    expect(saleHandoverStatus(saved.draft.fulfilment)).toBe('To arrange');
  });
  it('shows a date entered for a new sale as booked', () => {
    const sale = updateArrangements(create(), { scheduledDate: '2026-11-04' });
    expect(sale.draft.fulfilment!.scheduledDate).toBe('2026-11-04');
    expect(saleHandoverStatus(sale.draft.fulfilment)).toBe('Booked');
  });
  it('shows a date saved through Edit arrangements as booked', () => {
    const sale = arrange(create(), 'booked', '2026-11-04');
    expect(saleHandoverStatus(sale.draft.fulfilment)).toBe('Booked');
  });
  it('updates status when a date is added in the wizard after arrangements were saved without one', () => {
    const sale = updateArrangements(arrange(create(), 'to_arrange'), { scheduledDate: '2026-11-04' });
    expect(sale.draft.fulfilment!.scheduledDate).toBe('2026-11-04');
    expect(sale.draft.fulfilment!.stage).toBe('booked');
    expect(saleHandoverStatus(sale.draft.fulfilment)).toBe('Booked');
  });
  it('moves an earlier booking back to arrange when the date is removed', () => {
    const sale = updateArrangements(arrange(create(), 'booked', '2026-11-04'), { scheduledDate: '' });
    expect(sale.draft.fulfilment!.stage).toBe('to_arrange');
    expect(saleHandoverStatus(sale.draft.fulfilment)).toBe('To arrange');
  });
  it('requires a delivery address before displaying booked and updates it once supplied', () => {
    let sale = updateArrangements(arrange(create(), 'to_arrange'), { method: 'delivery', scheduledDate: '2026-11-04', address: '' });
    expect(saleHandoverStatus(sale.draft.fulfilment)).toBe('To arrange');
    sale = updateArrangements(sale, { address: '123 Test Road' });
    expect(saleHandoverStatus(sale.draft.fulfilment)).toBe('Booked');
  });
  it.each(['on_way', 'unsuccessful'] as const)('does not override the %s status', stage => {
    const initial = arrange(create(), 'booked', '2026-11-04');
    initial.draft.fulfilment = { ...initial.draft.fulfilment!, stage };
    const sale = updateArrangements(initial, { scheduledDate: '2026-11-05' });
    expect(sale.draft.fulfilment!.stage).toBe(stage);
  });
  it('keeps completed handover details locked', () => {
    const initial = arrange(create(), 'booked', '2026-11-04');
    initial.draft.fulfilment = { ...initial.draft.fulfilment!, completedAt: '2026-10-27T12:00:00Z' };
    const before = structuredClone(initial.draft.fulfilment);
    const sale = updateArrangements(initial, { scheduledDate: '2026-11-05' });
    expect(sale.draft.fulfilment).toEqual(before);
  });
  it('does not alter previously issued invoices or recorded payments when fixing the status', () => {
    let sale = arrange(create(), 'to_arrange');
    sale = change(sale, { action: 'invoice-payment', payment: { amount: '100', method: 'Cash', date: '2026-10-27', reference: 'TEST', kind: 'deposit', status: 'confirmed' } });
    sale = change(sale, { action: 'issue-invoice', kind: 'deposit', acknowledge: true });
    const invoices = structuredClone(sale.documents), payments = structuredClone(sale.payments);
    sale = updateArrangements(sale, { scheduledDate: '2026-11-04' });
    expect(saleHandoverStatus(sale.draft.fulfilment)).toBe('Booked');
    expect(sale.documents).toEqual(invoices);
    expect(sale.payments).toEqual(payments);
  });
});
