import { beforeEach, expect, it } from 'vitest';
import { changeSaleWorkspace, createSaleWorkspace, markDepositConfirmationShared, requestSalePayment, saleWorkspaceTotals, type SaleWorkspaceContext, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { saleInvoiceIsCurrent } from '@/lib/sale-invoice-current';
import { saleNextStep } from './sale-next-step';

const now = '2026-11-04T18:00:00.000Z';
let sequence = 0;
const context = (): SaleWorkspaceContext => ({ now, actor: 'Test staff', nextId: () => `fixture-${++sequence}`, nextNumber: type => `${type}-${++sequence}`, branding: { identity: { name: 'Example Motors', logoText: 'EXAMPLE', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } } });
const fixture = () => createSaleWorkspace({ requestId: 'create-sale', draft: { customer: 'Fictional Buyer', vehicleId: 'car-1', vehicle: 'Ford Focus', registration: 'AB20XYZ', price: '10000' } }, context(), 'SALE-42').sale;
function request(kind: 'deposit' | 'balance' | 'other' = 'deposit') {
  return requestSalePayment(fixture(), { kind, amount: kind === 'balance' ? '10000' : '500', dueDate: '2026-11-10', note: '', tokenHash: 'historical-test-token', expiresAt: '2099-01-01T00:00:00Z' }, context()).sale;
}
function pay(sale = fixture(), amount = '500', kind: 'deposit' | 'part-payment' | 'final-payment' = 'deposit', status: 'pending' | 'confirmed' = 'confirmed') {
  return changeSaleWorkspace(sale, { action: status === 'confirmed' && kind === 'deposit' ? 'take-deposit' : 'payment', payment: { amount, kind, status, method: 'Bank transfer', date: '2026-11-04', reference: 'TEST', reserveConfirmed: true } }, { requestId: `payment-${++sequence}`, expectedRevision: sale.revision }, context()).sale;
}
function issued() {
  const sale = pay(fixture(), '10000', 'final-payment');
  return changeSaleWorkspace(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true }, { requestId: `invoice-${++sequence}`, expectedRevision: sale.revision }, context()).sale;
}
function delivery(sale: SaleWorkspaceRecord, documentId: string, status: 'sent' | 'prepared' | 'failed' | 'unknown' | 'sending') {
  (sale.emailDeliveries ??= []).push({ id: `email-${++sequence}`, documentId, status, to: 'buyer@example.test', attemptedAt: now });
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
beforeEach(() => { sequence = 0; });

it('starts with a deposit request while keeping immediate payment as a visible alternative in the note', () => {
  expect(saleNextStep(fixture(), now)).toMatchObject({ action: 'request', label: 'Request a deposit', note: expect.stringContaining('already paid') });
});

it.each(['prepared', 'failed', 'unknown', 'sending'] as const)('does not mistake a %s request email for a sent request or payment', status => {
  const sale = request(), savedRequest = sale.paymentRequests![0]; delivery(sale, savedRequest.documentId, status);
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'request', requestId: savedRequest.id });
  expect(saleWorkspaceTotals(sale.draft, sale.payments).confirmedPaid).toBe(0);
  expect(sale.lifecycle).toBeUndefined();
});

it.each(['sent', 'whatsapp', 'customer-report'] as const)('suggests recording money after %s without claiming it was received', source => {
  const sale = request(), savedRequest = sale.paymentRequests![0];
  if (source === 'sent') delivery(sale, savedRequest.documentId, 'sent');
  if (source === 'whatsapp') { savedRequest.sharedAt = now; savedRequest.sharedBy = 'Staff'; }
  if (source === 'customer-report') savedRequest.paymentReportedAt = now;
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'deposit', requestId: savedRequest.id, note: expect.stringMatching(/Check/) });
  expect(sale.payments).toHaveLength(0); expect(sale.lifecycle).toBeUndefined();
});

it('keeps a successfully sent request shared even if a later reminder fails', () => {
  const sale = request(), savedRequest = sale.paymentRequests![0]; delivery(sale, savedRequest.documentId, 'sent'); delivery(sale, savedRequest.documentId, 'failed');
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'deposit', requestId: savedRequest.id });
});

it.each(['cancelled', 'changed', 'expired'] as const)('does not direct staff back into a %s request', state => {
  const sale = request(), savedRequest = sale.paymentRequests![0]; savedRequest.sharedAt = now;
  if (state === 'cancelled') savedRequest.status = 'cancelled';
  if (state === 'changed') sale.draft.price = '11000';
  if (state === 'expired') savedRequest.expiresAt = '2026-11-01T00:00:00Z';
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'request', label: 'Request a deposit' });
  expect(saleNextStep(sale, now)?.requestId).toBeUndefined();
});

it('an overdue document request stays actionable without automatically releasing its car', () => {
  const sale = request(), savedRequest = sale.paymentRequests![0]; savedRequest.deliveryMode = 'document'; savedRequest.dueDate = '2026-10-01'; savedRequest.expiresAt = '2026-10-02T00:00:00Z'; savedRequest.sharedAt = now;
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'deposit', requestId: savedRequest.id });
  expect(sale.lifecycle).toBeUndefined();
});

it('checks an incomplete payment before suggesting more money or issuing paperwork', () => {
  const sale = pay(request(), '500', 'deposit', 'pending');
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'history', label: 'Check payments' });
  expect(saleWorkspaceTotals(sale.draft, sale.payments)).toMatchObject({ pending: 50000, confirmedPaid: 0, balance: 1000000 });
});

it('routes a payment received for conflicting stock to refund history', () => {
  const sale = fixture();
  const result = changeSaleWorkspace(sale, {
    action: 'invoice-payment',
    payment: { amount: '400', kind: 'part-payment', status: 'confirmed', method: 'Bank transfer', date: '2026-11-04', reference: 'TEST' },
    stockConflictReconciliation: { reason: 'Car reserved by another sale', acknowledge: true },
  }, { requestId: 'record-refund-payment', expectedRevision: sale.revision }, context()).sale;
  expect(saleNextStep(result, now)).toMatchObject({ action: 'history', label: 'Review payment for refund' });
});

it.each(['prepared', 'failed', 'unknown', 'sending'] as const)('does not treat a %s deposit confirmation as sent', status => {
  const sale = pay(), receiptId = sale.payments[0].receiptId!; delivery(sale, receiptId, status);
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'confirmation', documentId: receiptId });
});

it('offers further payment after the actual deposit confirmation is sent', () => {
  const sale = pay(); delivery(sale, sale.payments[0].receiptId!, 'sent');
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'payment', label: 'Take the next payment' });
});

it('offers further payment only after staff explicitly confirm sharing this receipt', () => {
  const sale = pay(), documentId = sale.payments[0].receiptId!;
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'confirmation', documentId });
  expect(() => markDepositConfirmationShared(sale, { documentId, acknowledge: false }, context())).toThrow(/already shared/);
  expect(saleNextStep(sale, now)?.action).toBe('confirmation');
  markDepositConfirmationShared(sale, { documentId, acknowledge: true }, context());
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'payment', label: 'Take the next payment' });
  expect(sale.emailDeliveries).toBeUndefined();
});

it('does not send an old deposit receipt after that deposit has been reversed', () => {
  const sale = pay(), original = sale.payments[0];
  sale.payments.push({ ...original, id: 'reversal', kind: 'reversal', signedAmountPence: -original.amountPence, reversesPaymentId: original.id, receiptId: undefined });
  expect(saleNextStep(sale, now)?.action).not.toBe('confirmation');
});

it('settled money leads to the invoice and does not itself mark the car handed over', () => {
  const sale = pay(fixture(), '10000', 'final-payment');
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'invoice', label: 'Create the sales invoice' });
  expect(sale.draft.fulfilment?.completedAt).toBeUndefined();
});

it('uses the real invoice-current comparison after contact details change', () => {
  const sale = issued(), document = sale.documents.find(row => row.invoiceKind === 'full')!;
  expect(saleInvoiceIsCurrent(document, sale.draft, sale.payments)).toBe(true);
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'mark-sold', documentId: document.id });
  sale.draft.email = 'corrected@example.test';
  expect(saleInvoiceIsCurrent(document, sale.draft, sale.payments)).toBe(false);
  expect(saleNextStep(sale, now)?.action).toBe('invoice');
});

it('does not mistake a deposit invoice for the current full invoice', () => {
  const sale = issued(), document = sale.documents.find(row => row.invoiceKind === 'full')!; document.invoiceKind = 'deposit';
  expect(saleNextStep(sale, now)?.action).toBe('invoice');
});

it.each(['collection', 'delivery'] as const)('distinguishes arranged %s from the actual handover', method => {
  const sale = issued(); sale.draft.fulfilment = { ...sale.draft.fulfilment!, method, stage: 'booked', scheduledDate: '2026-11-05' };
  // Arrangements are reflected in the newly issued document, as the real flow requires.
  const current = changeSaleWorkspace(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true }, { requestId: 'invoice-after-booking', expectedRevision: sale.revision }, context()).sale;
  expect(saleNextStep(current, now)).toMatchObject({ action: 'mark-sold', documentId: current.documents.at(-1)!.id });
  current.completedAt = now;
  expect(saleNextStep(current, now)).toMatchObject({ action: 'handover', label: 'Record the handover' });
  current.draft.fulfilment!.completedAt = now;
  expect(saleNextStep(current, now)).toMatchObject({ action: 'history', label: 'View sale documents' });
});

it('keeps an unconfirmed date at the arrange step', () => {
  const sale = issued(); sale.draft.fulfilment!.stage = 'to_arrange'; sale.draft.fulfilment!.scheduledDate = '2026-11-05';
  const current = changeSaleWorkspace(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true }, { requestId: 'invoice-after-date', expectedRevision: sale.revision }, context()).sale;
  current.completedAt = now;
  expect(saleNextStep(current, now)).toMatchObject({ action: 'handover', label: 'Arrange collection or delivery' });
});

it('rearranges an unsuccessful delivery instead of treating the old date as booked', () => {
  const sale = issued(); sale.draft.fulfilment = { ...sale.draft.fulfilment!, method: 'delivery', stage: 'unsuccessful', scheduledDate: '2026-11-01', failureReason: 'Recipient not available' };
  const current = changeSaleWorkspace(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true }, { requestId: 'invoice-after-failure', expectedRevision: sale.revision }, context()).sale;
  current.completedAt = now;
  expect(saleNextStep(current, now)).toMatchObject({ action: 'handover' });
  expect(saleNextStep(current, now)?.label).toMatch(/arrange/i); expect(saleNextStep(current, now)?.label).not.toBe('Record the handover');
});

it.each(['balance', 'other'] as const)('uses the existing %s request instead of asking for a separate deposit', kind => {
  const sale = request(kind), savedRequest = sale.paymentRequests![0];
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'request', requestId: savedRequest.id });
  savedRequest.sharedAt = now;
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'payment', requestId: savedRequest.id });
});

it('suggests recording the remaining funds on a part-paid request instead of sending the original PDF', () => {
  const sale = pay(request('balance'), '250', 'part-payment'), savedRequest = sale.paymentRequests![0];
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'payment', requestId: savedRequest.id });
});

it('asks for the next payment on a sold car with an outstanding balance even if it had an old deposit request', () => {
  const sale = request();
  sale.lifecycle = { status: 'sold', vehicleId: sale.draft.vehicleId, changedAt: now };
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'payment', label: 'Take the next payment' });
});

it('reviews a refund on a completed sale instead of asking the customer to pay it back', () => {
  const sale = issued(); sale.completedAt = now;
  sale.payments.push({ id: 'refund', amount: '500', amountPence: 50000, signedAmountPence: -50000, kind: 'refund', status: 'confirmed', date: '2026-11-04', method: 'Bank transfer', reference: '', recordedAt: now, recordedBy: 'Staff' });
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'history', label: 'Check payments' });
});

it.each(['returned', 'released'] as const)('does not suggest a new sale action for a %s car', status => {
  const sale = pay(); sale.lifecycle = { status, vehicleId: sale.draft.vehicleId, changedAt: now };
  expect(saleNextStep(sale, now)).toBeNull();
});

it('reviews a customer credit before proceeding to handover', () => {
  const sale = issued(); sale.draft.price = '9900';
  expect(saleNextStep(sale, now)).toMatchObject({ action: 'history', label: 'Check payments' });
});

it('does not mutate sales, payments, messages or stock facts while recommending a next action', () => {
  const cases = [fixture(), request(), pay(), issued(), pay(fixture(), '200', 'part-payment', 'pending')];
  for (const sale of cases) {
    const before = structuredClone(sale); freeze(sale);
    const first = saleNextStep(sale, now); expect(saleNextStep(sale, now)).toEqual(first);
    expect(sale).toEqual(before);
  }
});

it('does not claim a legacy deposit reserved the car when the saved reservation is absent', () => {
  const initial = fixture();
  const sale = changeSaleWorkspace(initial, { action: 'payment', payment: { amount: '500', kind: 'deposit', status: 'confirmed', method: 'Bank transfer', date: '2026-11-04', reference: 'legacy payment' } }, { requestId: 'legacy-deposit', expectedRevision: initial.revision }, context()).sale;
  expect(sale.lifecycle).toBeUndefined(); expect(sale.payments[0].receiptId).toBeTruthy();
  expect(saleNextStep(sale, now)?.note).not.toContain('car is reserved');
});
