import assert from 'node:assert/strict';
import test from 'node:test';
import { changeSaleWorkspace, createSaleWorkspace, saleWorkspacePence, saleWorkspaceTotals, saleCompletionChecklistItems, partExchangeChecklistItems, saleWorkspaceExchanges, saleWorkspaceChecklistProgress, SaleWorkspaceError, type SaleWorkspaceCommand, type SaleWorkspaceContext, type SaleWorkspaceDraft, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { PostgresSaleWorkspaceStore, readSaleWorkspaceAssets, type SaleWorkspaceDatabase } from './lib/sale-workspace-store';

let sequence = 0;
const context = (): SaleWorkspaceContext => ({ now: '2026-10-04T12:00:00.000Z', actor: 'Test staff', nextId: () => `id-${++sequence}`, nextNumber: type => `${type}-${++sequence}`, branding: { identity: { name: 'Test Motors', logoText: 'TEST', logoAsset: '' }, contact: { phone: '02000000000', email: '' }, address: { street: '', city: 'London', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } }, vehicle: { year: 2016, fuel: 'Petrol', mileage: 38000 } });
const draft = (): SaleWorkspaceDraft => ({ id: 'draft', customer: 'Test customer', email: '', phone: '', address: '', vehicleId: 'test-car', vehicle: 'Test car', registration: '', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false, adjustments: [], exchanges: [] });
const create = () => createSaleWorkspace({ draft: draft(), requestId: 'request-create' }, context(), 'SALE-2026-00001').sale;
const payment = (amount: string, kind: 'deposit' | 'part-payment' | 'final-payment' = 'part-payment', status: 'pending' | 'confirmed' = 'confirmed'): SaleWorkspaceCommand => ({ action: 'payment', payment: { amount, kind, status, method: 'Bank transfer', date: '2026-10-04', reference: 'Test reference' } });

const reviewChecks = (sale: SaleWorkspaceRecord) => changeSaleWorkspace(sale, {
  action: 'checklists', completion: Object.fromEntries(saleCompletionChecklistItems.map(item => [item.id, 'checked' as const])),
  partExchanges: saleWorkspaceExchanges(sale.draft).map(exchange => ({ registration: exchange.registration, items: Object.fromEntries(partExchangeChecklistItems.map(item => [item.id, 'checked' as const])) })),
}, { expectedRevision: sale.revision, requestId: `review-checks-${++sequence}` }, context()).sale;

test('every confirmed payment issues an immutable receipt with its original balance', () => {
  const sale = create();
  const first = changeSaleWorkspace(sale, payment('500', 'deposit'), { expectedRevision: sale.revision, requestId: 'request-deposit' }, context());
  assert.equal(first.document?.title, 'Deposit receipt'); assert.equal(first.document?.balanceAtIssue, 1150000);
  const frozen = JSON.stringify(first.document);
  const second = changeSaleWorkspace(first.sale, payment('2000'), { expectedRevision: first.sale.revision, requestId: 'request-partpay' }, context());
  const last = changeSaleWorkspace(second.sale, payment('9500', 'final-payment'), { expectedRevision: second.sale.revision, requestId: 'request-finalpay' }, context());
  assert.equal(last.document?.balanceAtIssue, 0); assert.equal(last.document?.paymentAmountPence, 950000);
  assert.equal(JSON.stringify(last.sale.documents[0]), frozen);
  assert.equal(last.sale.documents.length, 3); assert.equal(sale.payments.length, 0);
});

test('same request retries replay before checking the old revision, but changed payload conflicts', () => {
  const sale = create(); const command = payment('500', 'deposit'); const input = { expectedRevision: sale.revision, requestId: 'request-retry' };
  const first = changeSaleWorkspace(sale, command, input, context());
  const retry = changeSaleWorkspace(first.sale, command, input, context());
  assert.equal(retry.replayed, true); assert.equal(retry.document?.id, first.document?.id); assert.equal(retry.sale.payments.length, 1);
  assert.throws(() => changeSaleWorkspace(first.sale, payment('501'), input, context()), (error: unknown) => error instanceof SaleWorkspaceError && error.status === 409);
  assert.throws(() => changeSaleWorkspace(first.sale, payment('100'), { ...input, requestId: 'request-stale' }, context()), (error: unknown) => error instanceof SaleWorkspaceError && error.status === 409);
});

test('pending and imported simulated deposits never reduce the balance or issue receipts', () => {
  const input = draft(); input.deposit = '999'; input.payments = [{ amount: '999' } as any];
  const sale = createSaleWorkspace({ draft: input, requestId: 'request-import' }, context(), 'SALE-1').sale;
  assert.equal(saleWorkspaceTotals(sale.draft, sale.payments).balance, 1200000); assert.equal(sale.payments.length, 0);
  const pending = changeSaleWorkspace(sale, payment('500', 'deposit', 'pending'), { expectedRevision: sale.revision, requestId: 'request-pending' }, context());
  assert.equal(pending.document, undefined); assert.equal(saleWorkspaceTotals(pending.sale.draft, pending.sale.payments).balance, 1200000);
  const confirmed = changeSaleWorkspace(pending.sale, { action: 'confirm', paymentId: pending.sale.payments[0].id }, { expectedRevision: pending.sale.revision, requestId: 'request-confirm' }, context());
  assert.equal(confirmed.document?.paymentAmountPence, 50000); assert.equal(saleWorkspaceTotals(confirmed.sale.draft, confirmed.sale.payments).balance, 1150000);
});

test('partial refunds retain original payments and reject excess corrections', () => {
  const first = changeSaleWorkspace(create(), payment('500', 'deposit'), { expectedRevision: 1, requestId: 'request-deposit' }, context());
  const correction: SaleWorkspaceCommand = { action: 'reverse', paymentId: first.sale.payments[0].id, amount: '200', kind: 'refund', date: '2026-10-04', reason: 'Customer request' };
  const refund = changeSaleWorkspace(first.sale, correction, { expectedRevision: first.sale.revision, requestId: 'request-refund' }, context());
  assert.equal(refund.sale.payments.length, 2); assert.equal(refund.sale.payments[0].amountPence, 50000); assert.equal(refund.sale.payments[1].signedAmountPence, -20000);
  assert.equal(refund.document?.title, 'Refund receipt'); assert.equal(refund.document?.balanceAtIssue, 1170000);
  assert.throws(() => changeSaleWorkspace(refund.sale, { ...correction, amount: '301' }, { expectedRevision: refund.sale.revision, requestId: 'request-too-much' }, context()), /remaining amount/);
});

test('pending cancellation preserves the ledger without producing a receipt', () => {
  const pending = changeSaleWorkspace(create(), payment('500', 'deposit', 'pending'), { expectedRevision: 1, requestId: 'request-pending' }, context());
  const cancelled = changeSaleWorkspace(pending.sale, { action: 'reverse', paymentId: pending.sale.payments[0].id, reason: 'Not received', date: '2026-10-04' }, { expectedRevision: pending.sale.revision, requestId: 'request-cancel' }, context());
  assert.equal(cancelled.sale.payments[0].status, 'cancelled'); assert.equal(cancelled.document, undefined); assert.equal(saleWorkspaceTotals(cancelled.sale.draft, cancelled.sale.payments).pending, 0);
});

test('invoices freeze branding and vehicle facts, and later versions retain the first', () => {
  const c = context(); const issued = changeSaleWorkspace(create(), { action: 'document', type: 'invoice' }, { expectedRevision: 1, requestId: 'request-invoice' }, c);
  c.branding.identity.name = 'Changed dealership'; c.vehicle!.mileage = 99999;
  assert.equal(issued.document?.snapshot.branding.identity.name, 'Test Motors'); assert.equal(issued.document?.snapshot.vehicle?.mileage, 38000);
  const later = changeSaleWorkspace(issued.sale, { action: 'document', type: 'invoice' }, { expectedRevision: issued.sale.revision, requestId: 'request-invoice2' }, c);
  assert.equal(later.document?.version, 2); assert.equal(later.sale.documents[0].snapshot.branding.identity.name, 'Test Motors');
});

test('collection and unseen delivery are independent of payment status and require balance acknowledgement', () => {
  const sale = create();
  const deliveryDraft = { ...sale.draft, fulfilment: { method: 'delivery' as const, viewed: 'not-yet-viewed' as const, address: 'A real supplied delivery address', recipient: 'Buyer', phone: '', scheduledDate: '2026-10-06', timeWindow: 'Morning', instructions: '' } };
  const updated = changeSaleWorkspace(sale, { action: 'update', draft: deliveryDraft }, { expectedRevision: sale.revision, requestId: 'request-delivery' }, context());
  const handover: SaleWorkspaceCommand = { action: 'handover', recipient: 'Buyer' };
  assert.throws(() => changeSaleWorkspace(updated.sale, handover, { expectedRevision: updated.sale.revision, requestId: 'request-handover' }, context()), /outstanding balance/);
  const checked = reviewChecks(updated.sale);
  const completed = changeSaleWorkspace(checked, { ...handover, acknowledgeOutstanding: true }, { expectedRevision: checked.revision, requestId: 'request-handover' }, context());
  assert.equal(completed.document?.title, 'Delivery confirmation'); assert.equal(completed.sale.draft.fulfilment?.viewed, 'not-yet-viewed'); assert.equal(saleWorkspaceTotals(completed.sale.draft, completed.sale.payments).balance, 1200000);
});

test('integer pence, three exchanges, overpayments and false final payments are validated', () => {
  assert.throws(() => changeSaleWorkspace(create(), payment('0.001'), { expectedRevision: 1, requestId: 'request-badmoney' }, context()), /decimal places/);
  assert.throws(() => changeSaleWorkspace(create(), payment('12001'), { expectedRevision: 1, requestId: 'request-overpaid' }, context()), /exceeds/);
  assert.throws(() => changeSaleWorkspace(create(), payment('500', 'final-payment'), { expectedRevision: 1, requestId: 'request-badfinal' }, context()), /settle/);
  const d = draft(); d.exchanges = Array.from({ length: 4 }, () => ({ registration: 'AB12 CDE', description: '', value: '100' }));
  assert.throws(() => createSaleWorkspace({ draft: d, requestId: 'request-manypx' }, context(), 'SALE-1'), /exchanges/);
});

test('decimal parsing and aggregate arithmetic never accept rounded or unsafe penny amounts', () => {
  assert.equal(saleWorkspacePence('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.ok(Number.isNaN(saleWorkspacePence('90071992547409.92')));
  assert.equal(saleWorkspacePence('8.04'), 804);
  assert.equal(saleWorkspacePence('0.29'), 29);
  const large = { ...draft(), price: '90071992547409', adjustments: [{ kind: 'fee' as const, description: 'Fixture fee', amount: '1' }] };
  assert.ok(Number.isNaN(saleWorkspaceTotals(large).totalDue));
  assert.throws(() => createSaleWorkspace({ draft: large, requestId: 'request-overflow' }, context(), 'SALE-OVERFLOW'), /valid amounts/);
  for (const field of ['exchanges', 'adjustments']) {
    for (const malformed of [null, 'invalid row', []]) {
      assert.throws(() => createSaleWorkspace({ draft: { ...draft(), [field]: [malformed] }, requestId: 'request-invalid-row' }, context(), 'SALE-INVALID'), (error: unknown) => error instanceof SaleWorkspaceError && error.status === 422);
    }
  }
  const largeSale = createSaleWorkspace({ draft: { ...draft(), price: '90071992547409' }, requestId: 'request-large-sale' }, context(), 'SALE-LARGE').sale;
  const first = changeSaleWorkspace(largeSale, payment('90071992547409', 'part-payment', 'pending'), { expectedRevision: largeSale.revision, requestId: 'request-large-pending-one' }, context()).sale;
  assert.throws(() => changeSaleWorkspace(first, payment('90071992547409', 'part-payment', 'pending'), { expectedRevision: first.revision, requestId: 'request-large-pending-two' }, context()), /supported range/);
  assert.equal(first.payments.length, 1);
});

test('fifty mixed-method deals settle to the exact penny after fees, discounts, three exchanges and a partial refund', () => {
  const pounds = (value: number) => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
  for (let index = 0; index < 50; index += 1) {
    const agreedPrice = 1000000 + index * 137;
    const fee = 1023 + index;
    const discount = 2012 + index * 2;
    const allowances = [10001 + index, 20002 + index * 2, 30003 + index * 3];
    const due = agreedPrice + fee - discount - allowances.reduce((sum, value) => sum + value, 0);
    const d = { ...draft(), price: pounds(agreedPrice),
      adjustments: [{ kind: 'fee' as const, description: 'Delivery', amount: pounds(fee) }, { kind: 'discount' as const, description: 'Agreed discount', amount: pounds(discount) }],
      exchanges: allowances.map((value, n) => ({ registration: `TEST-${index}-${n}`, description: 'Fictional part exchange', value: pounds(value) })) };
    const c = { ...context(), paperwork: { saleTerms: 'Fictional approved test terms', reservationTerms: '' } };
    let sale = createSaleWorkspace({ draft: d, requestId: `create-fixture-${index}` }, c, `SALE-FIXTURE-${index}`).sale;
    assert.equal(saleWorkspaceTotals(sale.draft, sale.payments).totalDue, due);
    const deposit = { action: 'take-deposit', payment: { amount: '100.01', kind: 'deposit', status: 'confirmed', method: 'Cash', date: '2026-10-04', reference: '' } } as const;
    sale = changeSaleWorkspace(sale, deposit, { expectedRevision: sale.revision, requestId: `deposit-fixture-${index}` }, c).sale;
    const frozen = JSON.stringify(sale.documents[0]);
    sale = changeSaleWorkspace(sale, payment('500.02'), { expectedRevision: sale.revision, requestId: `part-fixture-${index}` }, c).sale;
    sale = changeSaleWorkspace(sale, { action: 'reverse', paymentId: sale.payments[1].id, amount: '20.03', kind: 'refund', reason: 'Fictional agreed refund', date: '2026-10-04' }, { expectedRevision: sale.revision, requestId: `refund-fixture-${index}` }, c).sale;
    assert.equal(saleWorkspaceTotals(sale.draft, sale.payments).confirmedPaid, 58000);
    const balance = due - 58000;
    assert.throws(() => changeSaleWorkspace(sale, payment(pounds(balance - 1), 'final-payment'), { expectedRevision: sale.revision, requestId: `bad-final-fixture-${index}` }, c), /settle/);
    sale = changeSaleWorkspace(sale, payment(pounds(balance), 'final-payment'), { expectedRevision: sale.revision, requestId: `final-fixture-${index}` }, c).sale;
    assert.equal(saleWorkspaceTotals(sale.draft, sale.payments).balance, 0);
    sale = reviewChecks(sale);
    const completed = changeSaleWorkspace(sale, { action: 'complete-sale', acknowledge: true }, { expectedRevision: sale.revision, requestId: `complete-fixture-${index}` }, c);
    assert.equal(completed.sale.lifecycle?.status, 'sold');
    assert.equal(completed.document?.snapshot.totals.balance, 0);
    assert.equal(completed.document?.snapshot.totals.totalDue, due);
    assert.equal(JSON.stringify(completed.sale.documents[0]), frozen);
    assert.equal(completed.sale.documents.filter(doc => doc.type === 'receipt').length, 4);
  }
});

test('pending expected dates are retained and confirmation uses the actual received date', () => {
  const command = payment('500', 'deposit', 'pending');
  if (command.action !== 'payment') throw new Error('Unexpected fixture');
  command.payment.date = '2026-10-05';
  const pending = changeSaleWorkspace(create(), command, { expectedRevision: 1, requestId: 'request-pending' }, context());
  const confirmed = changeSaleWorkspace(pending.sale, { action: 'confirm', paymentId: pending.sale.payments[0].id, date: '2026-10-04' }, { expectedRevision: pending.sale.revision, requestId: 'request-confirm' }, context());
  assert.equal(confirmed.sale.payments[0].expectedDate, '2026-10-05'); assert.equal(confirmed.document?.snapshot.payments[0].date, '2026-10-04');
  const future = payment('100'); if (future.action === 'payment') future.payment.date = '2026-10-05';
  assert.throws(() => changeSaleWorkspace(create(), future, { expectedRevision: 1, requestId: 'request-future' }, context()), /future date/);
});

test('a later details save cannot rewrite completed collection or delivery evidence', () => {
  const checked = reviewChecks(create());
  const completed = changeSaleWorkspace(checked, { action: 'handover', recipient: 'Original recipient', acknowledgeOutstanding: true }, { expectedRevision: checked.revision, requestId: 'request-handover' }, context());
  const changed = { ...completed.sale.draft, fulfilment: { ...completed.sale.draft.fulfilment!, method: 'delivery' as const, viewed: 'viewed' as const, recipient: 'Someone else', address: 'Another place' } };
  const updated = changeSaleWorkspace(completed.sale, { action: 'update', draft: changed }, { expectedRevision: completed.sale.revision, requestId: 'request-edit' }, context());
  assert.deepEqual(updated.sale.draft.fulfilment, completed.sale.draft.fulfilment);
  assert.equal(updated.sale.documents[0].title, 'Collection confirmation');
});

test('later documents retain supplied facts for the same car if it leaves the current stock feed', () => {
  const c = context(); c.vehicle = { ...c.vehicle, id: 'test-car' };
  const deposit = changeSaleWorkspace(create(), payment('500', 'deposit'), { expectedRevision: 1, requestId: 'request-deposit' }, c);
  c.vehicle = undefined;
  const final = changeSaleWorkspace(deposit.sale, payment('11500', 'final-payment'), { expectedRevision: deposit.sale.revision, requestId: 'request-finalpay' }, c);
  assert.equal(final.document?.snapshot.vehicle?.id, 'test-car'); assert.equal(final.document?.snapshot.vehicle?.mileage, 38000);
  const changed = changeSaleWorkspace(deposit.sale, { action: 'update', draft: { ...deposit.sale.draft, vehicleId: 'other-car', vehicle: 'Another vehicle' } }, { expectedRevision: deposit.sale.revision, requestId: 'request-othercar' }, c);
  const invoice = changeSaleWorkspace(changed.sale, { action: 'document', type: 'invoice' }, { expectedRevision: changed.sale.revision, requestId: 'request-otherinvoice' }, c);
  assert.equal(invoice.document?.snapshot.vehicle, undefined);
});

test('production store loads branding and vehicle facts on its held transaction client with a one-connection pool', { timeout: 1000 }, async () => {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  let records = new Map<string, any>(); let numbers: Record<string, number> = {};
  let connectionCalls = 0; let outsideQueries = 0; let held = false; let tail: Promise<void> = Promise.resolve();
  const assetQueries: string[] = [];
  const execute = async (query: string, parameters: any[] = []) => {
    if (query.startsWith('SELECT config')) { assert.equal(held, true); assetQueries.push(query); assert.equal(parameters[0], 'test-dealer'); return { rows: [{ config: context().branding }] }; }
    if (query.startsWith('SELECT id, coalesce')) { assert.equal(held, true); assetQueries.push(query); assert.equal(parameters[0], 'test-dealer'); return { rows: [{ id: parameters[1], title: 'Test car', year: 2016, fuel: 'Petrol', transmission: 'Manual', mileage: 38000 }] }; }
    if (query.startsWith('SELECT state')) {
      const candidates = [...records.values()];
      return { rows: (query.includes("state->'requests'") ? candidates.filter(sale => sale.requests?.[parameters[1]]) : query.includes('id = $2') ? candidates.filter(sale => sale.id === parameters[1]) : candidates).map(state => ({ state: clone(state) })) };
    }
    if (query.startsWith('SELECT numbers')) return { rows: [{ numbers: clone(numbers) }] };
    if (query.startsWith('INSERT INTO sale_workspace (')) records.set(parameters[0], JSON.parse(parameters[4]));
    if (query.startsWith('UPDATE sale_workspace_counters')) numbers = JSON.parse(parameters[1]);
    return { rows: [] };
  };
  const database: SaleWorkspaceDatabase = {
    query: async (query, parameters) => { outsideQueries += 1; assert.equal(held, false, 'No pool-level query may be requested while the dealer transaction is held.'); return execute(query, parameters); },
    connect: async () => {
      connectionCalls += 1;
      const previous = tail; let releaseQueue!: () => void; tail = new Promise<void>(resolve => { releaseQueue = resolve; });
      await previous; assert.equal(held, false); held = true;
      const checkpoint = { records: clone([...records.entries()]), numbers: clone(numbers) };
      return {
        query: async (query, parameters) => { if (query === 'ROLLBACK') { records = new Map(checkpoint.records); numbers = checkpoint.numbers; } return execute(query, parameters); },
        release: () => { assert.equal(held, true); held = false; releaseQueue(); },
      };
    },
  };
  const store = new PostgresSaleWorkspaceStore('test-dealer', (input, client) => readSaleWorkspaceAssets(input, 'test-dealer', client), database);
  const created = await store.mutate({ draft: { ...draft(), vehicleId: '00000000-0000-4000-8000-000000000001' }, requestId: 'request-created', actor: 'Staff' });
  const outcomes = await Promise.allSettled([
    store.mutate({ id: created.sale.id, expectedRevision: created.sale.revision, requestId: 'request-device-one', command: payment('500', 'deposit'), actor: 'First staff' }),
    store.mutate({ id: created.sale.id, expectedRevision: created.sale.revision, requestId: 'request-device-two', command: payment('100'), actor: 'Second staff' }),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const success = outcomes.find(outcome => outcome.status === 'fulfilled') as PromiseFulfilledResult<any>;
  assert.equal(success.value.document.snapshot.branding.identity.name, 'Test Motors'); assert.equal(success.value.document.snapshot.vehicle.mileage, 38000);
  const rejected = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof SaleWorkspaceError); assert.equal(rejected.reason.status, 409);
  assert.equal(connectionCalls, 3); assert.equal(outsideQueries, 0); assert.equal(assetQueries.length, 6); assert.equal(held, false);
  assert.equal((await store.list())[0].payments.length, 1); assert.equal(numbers['receipt-2026'], 1);
});

test('supplied reservation terms and required sale terms are frozen into their respective packs', () => {
  const c = { ...context(), paperwork: { saleTerms: 'APPROVED TEST SALE TERMS', reservationTerms: 'APPROVED TEST DEPOSIT TERMS' } };
  let sale = create();
  const deposit = { action: 'take-deposit', payment: { amount: '500', kind: 'deposit', status: 'confirmed', method: 'Cash', date: '2026-10-04', reference: '' } } as const;
  const reserved = changeSaleWorkspace(sale, deposit, { expectedRevision: sale.revision, requestId: 'deposit-and-reserve' }, c);
  assert.equal(reserved.sale.lifecycle?.status, 'reserved');
  assert.equal(reserved.sale.documents.length, 3); assert.equal(reserved.sale.packDocumentIds?.length, 3);
  assert.equal(reserved.sale.documents.find(d => d.type === 'reservation')?.content, 'APPROVED TEST DEPOSIT TERMS');
  assert.throws(() => changeSaleWorkspace(reserved.sale, { action: 'lifecycle', status: 'released' }, { expectedRevision: reserved.sale.revision, requestId: 'release-paid' }, c), /refund/);
  assert.throws(() => changeSaleWorkspace(reserved.sale, { action: 'complete-sale', acknowledge: true }, { expectedRevision: reserved.sale.revision, requestId: 'finish-unpaid' }, c), /remaining payment/);
  sale = changeSaleWorkspace(reserved.sale, payment('11500', 'final-payment'), { expectedRevision: reserved.sale.revision, requestId: 'final-payment-new' }, c).sale;
  sale = reviewChecks(sale);
  const input = { expectedRevision: sale.revision, requestId: 'complete-new-sale' };
  const finished = changeSaleWorkspace(sale, { action: 'complete-sale', acknowledge: true }, input, c);
  assert.equal(finished.sale.lifecycle?.status, 'sold'); assert.ok(finished.sale.completedAt); assert.equal(finished.sale.draft.handover, false);
  assert.equal(finished.sale.documents.find(d => d.type === 'terms')?.content, 'APPROVED TEST SALE TERMS');
  assert.equal(finished.sale.documents.filter(d => d.type === 'invoice').length, 1);
  const retry = changeSaleWorkspace(finished.sale, { action: 'complete-sale', acknowledge: true }, input, { ...c, paperwork: { saleTerms: 'CHANGED', reservationTerms: 'CHANGED' } });
  assert.equal(retry.replayed, true); assert.equal(retry.sale.documents.length, finished.sale.documents.length);
  assert.throws(() => changeSaleWorkspace(finished.sale, { action: 'update', draft: { ...finished.sale.draft, price: '13000' } }, { expectedRevision: finished.sale.revision, requestId: 'rewrite-completed' }, c), /locked/);
});


test('confirming a pending deposit includes the dealer-supplied reservation agreement in its receipt pack', () => {
  const initial = create();
  const pending = changeSaleWorkspace(initial, payment('500', 'deposit', 'pending'), { expectedRevision: initial.revision, requestId: 'pending-deposit-new' }, context()).sale;
  const command = { action: 'confirm', paymentId: pending.payments[0].id, reserveVehicle: true } as const;
  assert.equal(pending.payments[0].status, 'pending');
  const c = { ...context(), paperwork: { saleTerms: 'TEST', reservationTerms: 'APPROVED TEST RESERVATION' } };
  const reserved = changeSaleWorkspace(pending, command, { expectedRevision: pending.revision, requestId: 'confirm-reserved' }, c).sale;
  assert.equal(reserved.lifecycle?.status, 'reserved');
  assert.equal(reserved.documents.length, 3);
  assert.equal(reserved.documents.find(d => d.type === 'reservation')?.content, c.paperwork.reservationTerms);
});

test('received deposits reserve and issue receipts without missing, empty or whitespace reservation terms', () => {
  for (const reservationTerms of [undefined, '', ' \n\t ']) {
    const c = context();
    if (reservationTerms !== undefined) c.paperwork = { saleTerms: '', reservationTerms };
    const initial = create();
    const command = { action: 'take-deposit', payment: { amount: '500.05', kind: 'deposit', status: 'confirmed', method: 'Cash', date: '2026-10-04', reference: 'Received at showroom' } } as const;
    const input = { expectedRevision: initial.revision, requestId: 'deposit-no-terms' };
    const reserved = changeSaleWorkspace(initial, command, input, c);
    assert.equal(reserved.sale.lifecycle?.status, 'reserved');
    assert.equal(saleWorkspaceTotals(reserved.sale.draft, reserved.sale.payments).confirmedPaid, 50005);
    assert.equal(reserved.document?.title, 'Deposit receipt');
    assert.equal(reserved.document?.paymentAmountPence, 50005);
    assert.equal(reserved.document?.balanceAtIssue, 1149995);
    assert.deepEqual(reserved.sale.documents.map(d => d.type), ['receipt', 'statement']);
    assert.deepEqual(reserved.sale.packDocumentIds, reserved.sale.documents.map(d => d.id));
    const frozenReceipt = JSON.stringify(reserved.document);
    // An identical retry must not suddenly add an agreement if settings change afterwards.
    const retry = changeSaleWorkspace(reserved.sale, command, input, { ...c, paperwork: { saleTerms: 'Later sale terms', reservationTerms: 'Later reservation terms' } });
    assert.equal(retry.replayed, true);
    assert.equal(retry.sale.payments.length, 1);
    assert.deepEqual(retry.sale.documents, reserved.sale.documents);
    const paid = changeSaleWorkspace(reserved.sale, payment('11499.95', 'final-payment'), { expectedRevision: reserved.sale.revision, requestId: 'remaining-no-terms' }, c);
    assert.equal(JSON.stringify(paid.sale.documents[0]), frozenReceipt);
    assert.throws(() => changeSaleWorkspace(paid.sale, { action: 'complete-sale', acknowledge: true }, { expectedRevision: paid.sale.revision, requestId: 'complete-no-sale-terms' }, c), /approved terms of sale/);
    const checked = reviewChecks(paid.sale);
    const completed = changeSaleWorkspace(checked, { action: 'complete-sale', acknowledge: true }, { expectedRevision: checked.revision, requestId: 'complete-approved-sale' }, { ...c, paperwork: { saleTerms: 'Approved sale terms', reservationTerms: '' } });
    assert.equal(completed.sale.lifecycle?.status, 'sold');
    assert.deepEqual(completed.sale.documents.filter(d => completed.sale.packDocumentIds?.includes(d.id)).map(d => d.type).sort(), ['invoice', 'receipt', 'receipt', 'terms', 'vehicle-details'].sort());
    assert.equal(completed.sale.documents.find(d => d.type === 'terms')?.content, 'Approved sale terms');
    assert.equal(JSON.stringify(completed.sale.documents[0]), frozenReceipt);
  }
});

test('confirming a pending deposit without reservation terms records money once and reserves the car', () => {
  for (const reservationTerms of [undefined, '', ' \n ']) {
    const c = context();
    if (reservationTerms !== undefined) c.paperwork = { saleTerms: '', reservationTerms };
    const initial = create();
    const pending = changeSaleWorkspace(initial, payment('500', 'deposit', 'pending'), { expectedRevision: initial.revision, requestId: 'pending-without-terms' }, c).sale;
    assert.equal(pending.documents.length, 0);
    assert.equal(saleWorkspaceTotals(pending.draft, pending.payments).confirmedPaid, 0);
    const command = { action: 'confirm', paymentId: pending.payments[0].id, reserveVehicle: true } as const;
    const input = { expectedRevision: pending.revision, requestId: 'confirmed-without-terms' };
    const reserved = changeSaleWorkspace(pending, command, input, c);
    assert.equal(reserved.sale.lifecycle?.status, 'reserved');
    assert.equal(reserved.sale.payments[0].status, 'confirmed');
    assert.equal(reserved.document?.paymentAmountPence, 50000);
    assert.equal(saleWorkspaceTotals(reserved.sale.draft, reserved.sale.payments).balance, 1150000);
    assert.deepEqual(reserved.sale.documents.map(d => d.type), ['receipt', 'statement']);
    assert.deepEqual(reserved.sale.packDocumentIds, reserved.sale.documents.map(d => d.id));
    const replay = changeSaleWorkspace(reserved.sale, command, input, c);
    assert.equal(replay.replayed, true);
    assert.equal(replay.sale.revision, reserved.sale.revision);
    assert.equal(replay.sale.payments.length, 1);
    assert.equal(replay.sale.documents.length, 2);
    assert.equal(pending.payments[0].status, 'pending');
  }
});

test('guided invoices record deposits without extra paperwork and retain all dated payments', () => {
  const apply = (sale: ReturnType<typeof create>, command: SaleWorkspaceCommand, requestId: string) => changeSaleWorkspace(sale, command, { expectedRevision: sale.revision, requestId }, context());
  const received: SaleWorkspaceCommand = { action:'invoice-payment', payment:{amount:'500',method:'Cash',date:'2026-10-04',reference:'DEP-1',kind:'deposit',status:'confirmed'} };
  const deposited = apply(create(), received, 'guided-deposit');
  assert.equal(deposited.sale.lifecycle?.status, 'reserved');assert.equal(deposited.sale.documents.length, 0);
  const deposit = apply(deposited.sale, { action:'issue-invoice',kind:'deposit',acknowledge:true }, 'guided-deposit-invoice');
  assert.equal(deposit.document?.title, 'Deposit invoice');assert.equal(deposit.document?.invoiceKind,'deposit');assert.equal(deposit.sale.documents.length,1);
  const frozen=JSON.stringify(deposit.document);
  const interim=apply(deposit.sale,{action:'invoice-payment',payment:{amount:'500',method:'Bank transfer',date:'2026-10-04',reference:'BANK-2',kind:'part-payment',status:'confirmed'}},'guided-interim');
  const final=apply(interim.sale,{action:'invoice-payment',payment:{amount:'11000',method:'Debit card',date:'2026-10-04',reference:'CARD-3',kind:'final-payment',status:'confirmed'}},'guided-final');
  const invoice=apply(final.sale,{action:'issue-invoice',kind:'full',acknowledge:true},'guided-full-invoice');
  assert.equal(invoice.sale.documents.length,2);assert.equal(invoice.document?.snapshot.payments.length,3);assert.equal(invoice.document?.balanceAtIssue,0);
  assert.equal(JSON.stringify(invoice.sale.documents[0]),frozen);assert.equal(invoice.sale.lifecycle?.status,'reserved');assert.equal(invoice.sale.completedAt,undefined);
  const checked=reviewChecks(invoice.sale);
  const complete=apply(checked,{action:'finish-invoice-sale',acknowledge:true},'guided-sold');
  assert.equal(complete.sale.lifecycle?.status,'sold');assert.ok(complete.sale.completedAt);assert.equal(complete.sale.documents.length,2);
  const replay=changeSaleWorkspace(complete.sale,{action:'finish-invoice-sale',acknowledge:true},{expectedRevision:checked.revision,requestId:'guided-sold'},context());assert.equal(replay.replayed,true);
});

test('guided invoices reject unreceived or excessive payments and require a current settled full invoice for sold status', () => {
  const sale=create();const input={expectedRevision:sale.revision,requestId:'guided-invalid'};
  assert.throws(() => changeSaleWorkspace(sale,{action:'issue-invoice',kind:'deposit',acknowledge:true},input,context()),/received deposit/);
  assert.throws(() => changeSaleWorkspace(sale,{action:'invoice-payment',payment:{amount:'500',method:'Cash',date:'2026-10-04',reference:'',kind:'deposit',status:'pending'}},input,context()),/received funds/);
  assert.throws(() => changeSaleWorkspace(sale,{action:'invoice-payment',payment:{amount:'12001',method:'Cash',date:'2026-10-04',reference:'',kind:'deposit',status:'confirmed'}},input,context()),/exceeds/);
  const invoice=changeSaleWorkspace(sale,{action:'issue-invoice',kind:'full',acknowledge:true},input,context()).sale;
  assert.equal(invoice.lifecycle,undefined);
  assert.throws(() => changeSaleWorkspace(invoice,{action:'finish-invoice-sale',acknowledge:true},{expectedRevision:invoice.revision,requestId:'guided-unpaid-sold'},context()),/Settle/);
  const paid=changeSaleWorkspace(invoice,{action:'invoice-payment',payment:{amount:'12000',method:'Cash',date:'2026-10-04',reference:'',kind:'final-payment',status:'confirmed'}},{expectedRevision:invoice.revision,requestId:'guided-paid'},context()).sale;
  assert.throws(() => changeSaleWorkspace(paid,{action:'finish-invoice-sale',acknowledge:true},{expectedRevision:paid.revision,requestId:'guided-old-invoice'},context()),/updated full invoice/);
});

test('guided corrections preserve history without generating unwanted receipts', () => {
  const deposited=changeSaleWorkspace(create(),{action:'invoice-payment',payment:{amount:'500',method:'Cash',date:'2026-10-04',reference:'',kind:'deposit',status:'confirmed'}},{expectedRevision:1,requestId:'guided-correction-deposit'},context()).sale;
  const corrected=changeSaleWorkspace(deposited,{action:'reverse',paymentId:deposited.payments[0].id,amount:'100',kind:'refund',reason:'Customer refund',date:'2026-10-04',invoiceOnly:true},{expectedRevision:deposited.revision,requestId:'guided-correction'},context()).sale;
  assert.equal(corrected.documents.length,0);assert.equal(corrected.payments.length,2);assert.equal(saleWorkspaceTotals(corrected.draft,corrected.payments).confirmedPaid,40000);
});

test('staff may explicitly sell with an outstanding balance, then record later funds without losing the debt or invoice', () => {
  const sale=create();const issued=changeSaleWorkspace(sale,{action:'issue-invoice',kind:'full',acknowledge:true},{expectedRevision:sale.revision,requestId:'guided-credit-invoice'},context()).sale;
  const checked=reviewChecks(issued);
  const sold=changeSaleWorkspace(checked,{action:'finish-invoice-sale',acknowledge:true,acknowledgeOutstanding:true},{expectedRevision:checked.revision,requestId:'guided-credit-sold'},context()).sale;
  assert.equal(sold.lifecycle?.status,'sold');assert.equal(saleWorkspaceTotals(sold.draft,sold.payments).balance,1200000);assert.match(sold.events.at(-1)!.description,/staff acknowledged/);
  const paid=changeSaleWorkspace(sold,{action:'invoice-payment',payment:{amount:'12000',method:'Bank transfer',date:'2026-10-04',reference:'LATE-BANK',kind:'final-payment',status:'confirmed'}},{expectedRevision:sold.revision,requestId:'guided-credit-final'},context()).sale;
  assert.equal(saleWorkspaceTotals(paid.draft,paid.payments).balance,0);assert.equal(paid.lifecycle?.status,'sold');assert.equal(paid.documents.length,1);
  assert.throws(() => changeSaleWorkspace(sold,{action:'invoice-payment',payment:{amount:'500',method:'Cash',date:'2026-10-04',reference:'',kind:'deposit',status:'confirmed'}},{expectedRevision:sold.revision,requestId:'guided-sold-reserve'},context()),/already sold/);
});

test('final reminders do not block sale completion, handover or sold transitions', () => {
  const sale = create();
  const unchanged = JSON.stringify(sale);
  const invoice = changeSaleWorkspace(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true }, { expectedRevision: sale.revision, requestId: 'reminder-invoice' }, context()).sale;
  for (const command of [
    { action: 'finish-invoice-sale', acknowledge: true, acknowledgeOutstanding: true },
    { action: 'lifecycle', status: 'sold' },
    { action: 'handover', recipient: 'Buyer', acknowledgeOutstanding: true },
  ] as SaleWorkspaceCommand[]) {
    const result = changeSaleWorkspace(invoice, command, { expectedRevision: invoice.revision, requestId: 'reminder-' + command.action }, context()).sale;
    assert.equal(result.checklists, undefined);
    assert.equal(JSON.stringify(result.documents[0]), JSON.stringify(invoice.documents[0]));
    assert.deepEqual(result.payments, invoice.payments);
  }
  const paid = changeSaleWorkspace(sale, payment('12000', 'final-payment'), { expectedRevision: sale.revision, requestId: 'reminder-paid' }, context()).sale;
  const complete = changeSaleWorkspace(paid, { action: 'complete-sale', acknowledge: true }, { expectedRevision: paid.revision, requestId: 'reminder-complete' }, { ...context(), paperwork: { saleTerms: 'Approved fixture terms', reservationTerms: '' } }).sale;
  assert.ok(complete.completedAt);
  assert.equal(complete.checklists, undefined);
  assert.equal(JSON.stringify(sale), unchanged);
  assert.equal(saleWorkspaceChecklistProgress(sale).ready, true);
});

test('checklist evidence is attributed by the server, revision guarded and safely replayed', () => {
  const original = create();
  const command = { action: 'checklists', completion: { customer_vehicle: 'checked', disclosures: 'not_needed' } } as const;
  const input = { expectedRevision: original.revision, requestId: 'checklist-reviewed' };
  const saved = changeSaleWorkspace(original, command, input, context());
  assert.deepEqual(saved.sale.checklists?.completion.customer_vehicle, { status: 'checked', actor: 'Test staff', at: context().now });
  assert.equal(saved.sale.checklists?.completion.disclosures?.status, 'not_needed');
  assert.equal(saved.sale.events.filter(event => event.type === 'sale-check-updated').length, 2);
  const replay = changeSaleWorkspace(saved.sale, command, input, { ...context(), actor: 'Another staff' });
  assert.equal(replay.replayed, true); assert.deepEqual(replay.sale.checklists, saved.sale.checklists);
  assert.throws(() => changeSaleWorkspace(saved.sale, command, { ...input, requestId: 'checklist-stale' }, context()), (error: unknown) => error instanceof SaleWorkspaceError && error.status === 409);
  for (const completion of [{ invented: 'checked' }, { documents: true }, { documents: { status: 'checked', actor: 'spoofed' } }]) {
    assert.throws(() => changeSaleWorkspace(original, { action: 'checklists', completion } as any, input, context()), /checklist item/);
  }
  const reset = changeSaleWorkspace(saved.sale, { action: 'checklists', completion: { customer_vehicle: 'pending' } }, { expectedRevision: saved.sale.revision, requestId: 'checklist-pending' }, context()).sale;
  assert.equal(reset.checklists?.completion.customer_vehicle, undefined);
});

test('every part exchange needs its own intake checks and irrelevant registrations are refused', () => {
  const sale = createSaleWorkspace({ draft: { ...draft(), partExchange: true, exchanges: [{ registration: 'AB12 CDE', description: 'First fictional intake', value: '100' }, { registration: 'CD34 EFG', description: 'Second fictional intake', value: '200' }] }, requestId: 'checklist-px-create' }, context(), 'PX-CHECKS').sale;
  const finalOnly = changeSaleWorkspace(sale, { action: 'checklists', completion: Object.fromEntries(saleCompletionChecklistItems.map(item => [item.id, 'not_needed'])) }, { expectedRevision: sale.revision, requestId: 'checklist-px-final' }, context()).sale;
  assert.throws(() => changeSaleWorkspace(finalOnly, { action: 'lifecycle', status: 'sold' }, { expectedRevision: finalOnly.revision, requestId: 'checklist-px-blocked' }, context()), /intake checklist/);
  assert.throws(() => changeSaleWorkspace(finalOnly, { action: 'checklists', partExchanges: [{ registration: 'NO00 CAR', items: { identity: 'checked' } }] }, { expectedRevision: finalOnly.revision, requestId: 'checklist-px-other' }, context()), /vehicle on this sale/);
  const first = changeSaleWorkspace(finalOnly, { action: 'checklists', partExchanges: [{ registration: 'ab12cde', items: Object.fromEntries(partExchangeChecklistItems.map(item => [item.id, 'checked'])) }] }, { expectedRevision: finalOnly.revision, requestId: 'checklist-px-first' }, context()).sale;
  assert.equal(saleWorkspaceChecklistProgress(first).partExchanges[0].pending.length, 0);
  assert.equal(saleWorkspaceChecklistProgress(first).partExchanges[1].pending.length, 5);
  assert.equal(saleWorkspaceChecklistProgress(first).ready, false);
  const checked = reviewChecks(first);
  assert.equal(saleWorkspaceChecklistProgress(checked).ready, true);
  const sold = changeSaleWorkspace(checked, { action: 'lifecycle', status: 'sold' }, { expectedRevision: checked.revision, requestId: 'checklist-px-sold' }, context()).sale;
  assert.equal(sold.lifecycle?.status, 'sold'); assert.deepEqual(sold.checklists, checked.checklists);
});

test('changing sale details invalidates affected checks and cannot accept forged evidence in a draft', () => {
  const checked = reviewChecks(create());
  for (const changes of [{ customer: 'Another buyer' }, { vehicle: 'Another model' }, { price: '13000' }, { vin: 'WAUZZZ8V0GA000001' }]) {
    const changed = changeSaleWorkspace(checked, { action: 'update', draft: { ...checked.draft, ...changes, checklists: checked.checklists } as any }, { expectedRevision: checked.revision, requestId: 'checklist-edit-' + Object.keys(changes)[0] }, context()).sale;
    assert.deepEqual(changed.checklists?.completion, {});
    assert.equal(saleWorkspaceChecklistProgress(changed).ready, true);
  }
  const notes = changeSaleWorkspace(checked, { action: 'update', draft: { ...checked.draft, notes: 'Updated condition disclosure' } }, { expectedRevision: checked.revision, requestId: 'checklist-notes' }, context()).sale;
  assert.equal(notes.checklists?.completion.disclosures, undefined); assert.ok(notes.checklists?.completion.price_payments);
  const same = changeSaleWorkspace(checked, { action: 'update', draft: checked.draft }, { expectedRevision: checked.revision, requestId: 'checklist-same' }, context()).sale;
  assert.deepEqual(same.checklists, checked.checklists);
  const forged = createSaleWorkspace({ draft: { ...draft(), checklists: checked.checklists }, requestId: 'checklist-forged' }, context(), 'NO-FORGERY').sale;
  assert.equal(forged.checklists, undefined);
});

test('physical part-exchange changes reset only that car; buyer and allowance changes keep saved intake', () => {
  const original = createSaleWorkspace({ draft: { ...draft(), partExchange: true, exchanges: [{ registration: 'AB12 CDE', description: 'First car', value: '100' }, { registration: 'CD34 EFG', description: 'Second car', value: '200' }] }, requestId: 'px-reset-create' }, context(), 'PX-RESET').sale;
  const checked = reviewChecks(original);
  const altered = changeSaleWorkspace(checked, { action: 'update', draft: { ...checked.draft, exchanges: [{ ...checked.draft.exchanges![0], description: 'Condition corrected' }, checked.draft.exchanges![1]] } }, { expectedRevision: checked.revision, requestId: 'px-reset-one' }, context()).sale;
  assert.equal(altered.checklists?.partExchanges.AB12CDE, undefined);
  assert.deepEqual(altered.checklists?.partExchanges.CD34EFG, checked.checklists?.partExchanges.CD34EFG);
  const buyer = changeSaleWorkspace(checked, { action: 'update', draft: { ...checked.draft, customer: 'New owner' } }, { expectedRevision: checked.revision, requestId: 'px-reset-buyer' }, context()).sale;
  assert.deepEqual(buyer.checklists?.partExchanges, checked.checklists?.partExchanges);
  const allowance = changeSaleWorkspace(checked, { action: 'update', draft: { ...checked.draft, vin: 'WAUZZZ8V0GA000001', exchanges: [{ ...checked.draft.exchanges![0], value: '150' }, checked.draft.exchanges![1]] } }, { expectedRevision: checked.revision, requestId: 'px-allowance' }, context()).sale;
  assert.deepEqual(allowance.checklists?.partExchanges, checked.checklists?.partExchanges);
  assert.equal(saleWorkspaceChecklistProgress(allowance).ready, true);
});

test('payment changes reset the payments attestation without changing reviewed documents or other checks', () => {
  const invoice = changeSaleWorkspace(create(), { action: 'issue-invoice', kind: 'full', acknowledge: true }, { expectedRevision: 1, requestId: 'check-pay-invoice' }, context()).sale;
  const frozenDocuments = JSON.stringify(invoice.documents);
  const checked = reviewChecks(invoice);
  const paid = changeSaleWorkspace(checked, { action: 'invoice-payment', payment: { amount: '500', method: 'Cash', date: '2026-10-04', reference: '', kind: 'deposit', status: 'confirmed' } }, { expectedRevision: checked.revision, requestId: 'check-pay-change' }, context()).sale;
  assert.equal(paid.checklists?.completion.price_payments, undefined);
  assert.deepEqual(paid.checklists?.completion.documents, checked.checklists?.completion.documents);
  assert.equal(JSON.stringify(paid.documents), frozenDocuments);
  assert.equal(saleWorkspaceTotals(paid.draft, paid.payments).confirmedPaid, 50000);
});

test('old completed sales retain their history and can record handover without retroactive checklists', () => {
  const old = create(); old.lifecycle = { status: 'sold', vehicleId: old.draft.vehicleId, changedAt: '2026-09-01T10:00:00Z' }; old.completedAt = '2026-09-01T10:00:00Z';
  const before = JSON.stringify(old.documents);
  const handedOver = changeSaleWorkspace(old, { action: 'handover', recipient: 'Historic buyer', acknowledgeOutstanding: true }, { expectedRevision: old.revision, requestId: 'historic-handover' }, context()).sale;
  assert.equal(handedOver.checklists, undefined); assert.equal(JSON.stringify(old.documents), before);
  assert.throws(() => changeSaleWorkspace(old, { action: 'checklists', completion: { documents: 'checked' } }, { expectedRevision: old.revision, requestId: 'historic-forge' }, context()), /cannot be changed/);
});

test('legacy part-exchange scalar edits reset the final checks and effective intake evidence', () => {
  const initial = createSaleWorkspace({ draft: { ...draft(), partExchange: true, exchanges: undefined, pxRegistration: 'AB12 CDE', pxDescription: 'Legacy intake', pxValue: '1000' }, requestId: 'legacy-px-checks-create' }, context(), 'LEGACY-PX').sale;
  const checked = reviewChecks(initial);
  // Historical records may only contain the original scalar part-exchange fields.
  delete checked.draft.exchanges;
  for (const changes of [{ pxDescription: 'Condition corrected' }, { pxRegistration: 'XY34 ZAB' }]) {
    const altered = changeSaleWorkspace(checked, { action: 'update', draft: { ...checked.draft, ...changes } }, { expectedRevision: checked.revision, requestId: 'legacy-px-edit-' + Object.keys(changes)[0] }, context()).sale;
    assert.equal(altered.checklists?.completion.price_payments, undefined);
    assert.deepEqual(altered.checklists?.completion, {});
    assert.equal(saleWorkspaceChecklistProgress(altered).ready, false);
    assert.deepEqual(altered.checklists?.partExchanges, {});
  }
});

test('two part-exchange rows cannot share one attestation under equivalent registrations', () => {
  const initial = createSaleWorkspace({ draft: { ...draft(), partExchange: true, exchanges: [{ registration: 'AB12 CDE', description: 'First row', value: '100' }, { registration: 'ab12cde', description: 'Second row', value: '200' }] }, requestId: 'duplicate-px-check-create' }, context(), 'DUPLICATE-PX').sale;
  const checked = changeSaleWorkspace(initial, { action: 'checklists', completion: Object.fromEntries(saleCompletionChecklistItems.map(item => [item.id, 'checked'])) }, { expectedRevision: initial.revision, requestId: 'duplicate-px-final' }, context()).sale;
  assert.deepEqual(saleWorkspaceChecklistProgress(checked).invalidPartExchanges, ['AB12CDE']);
  assert.equal(saleWorkspaceChecklistProgress(checked).ready, false);
  assert.throws(() => changeSaleWorkspace(checked, { action: 'checklists', partExchanges: [{ registration: 'AB12 CDE', items: { identity: 'checked' } }] }, { expectedRevision: checked.revision, requestId: 'duplicate-px-attest' }, context()), /different registration/);
  assert.throws(() => changeSaleWorkspace(checked, { action: 'lifecycle', status: 'sold' }, { expectedRevision: checked.revision, requestId: 'duplicate-px-sold' }, context()), /different registration/);
  assert.equal(saleWorkspaceTotals(checked.draft, checked.payments).allowance, 30000);
});

test('review reminders are optional post-sale metadata with safe retries and immutable finances', () => {
  const current = create();
  const command = {action:'review-reminder' as const, at:'2026-10-11T09:00:00Z',url:'https://g.page/r/fictional/review'};
  const input={expectedRevision:current.revision,requestId:'review-reminder-one'};
  assert.throws(()=>changeSaleWorkspace(current,command,input,context()),/Complete the sale/);
  const sold={...current,completedAt:context().now,draft:{...current.draft,email:'buyer@example.test'}};
  const scheduled=changeSaleWorkspace(sold,command,input,context());
  assert.ok(scheduled.sale.reviewReminder?.enquiryId);
  assert.deepEqual(scheduled.sale.payments,sold.payments);
  assert.deepEqual(scheduled.sale.documents,sold.documents);
  assert.deepEqual(scheduled.sale.draft,sold.draft);
  assert.equal(changeSaleWorkspace(scheduled.sale,command,input,context()).replayed,true);
  const rescheduled=changeSaleWorkspace(scheduled.sale,{...command,at:'2026-10-12T09:00:00Z'},{expectedRevision:scheduled.sale.revision,requestId:'review-reminder-two'},context());
  assert.equal(rescheduled.sale.reviewReminder?.enquiryId,scheduled.sale.reviewReminder?.enquiryId);
  const cancelled=changeSaleWorkspace(rescheduled.sale,{action:'cancel-review-reminder'},{expectedRevision:rescheduled.sale.revision,requestId:'review-reminder-cancel'},context());
  assert.equal(cancelled.sale.reviewReminder?.cancelledAt,context().now);
  assert.deepEqual(cancelled.sale.documents,sold.documents);
  for (const invalid of [{...command,url:'javascript:alert(1)'},{...command,url:'https://google.com.evil.test/review'},{...command,at:'2026-10-01'},{...command,at:'2028-10-01'}]) assert.throws(()=>changeSaleWorkspace(sold,invalid,input,context()));
  assert.throws(()=>changeSaleWorkspace({...sold,draft:{...sold.draft,email:''}},command,input,context()),/customer email/);
});

test('review reminders use the dealership setting rather than any per-sale URL',()=>{
 const sold={...create(),completedAt:context().now};sold.draft.email='buyer@example.test';
 const command={action:'review-reminder' as const,at:'2026-10-11T09:00:00Z',url:'https://g.page/r/wrong/review'};
 const input={expectedRevision:sold.revision,requestId:'configured-review'};
 const first=changeSaleWorkspace(sold,command,input,{...context(),reviewUrl:'https://g.page/r/dealer/review'});
 assert.equal(first.sale.reviewReminder?.url,'https://g.page/r/dealer/review');
 assert.equal(changeSaleWorkspace(first.sale,command,input,{...context(),reviewUrl:'https://g.page/r/updated/review'}).replayed,true);
 assert.throws(()=>changeSaleWorkspace(sold,command,input,{...context(),reviewUrl:''}),/Settings/);
});
