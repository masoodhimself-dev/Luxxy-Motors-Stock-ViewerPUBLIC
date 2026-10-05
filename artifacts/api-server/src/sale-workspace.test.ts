import assert from 'node:assert/strict';
import test from 'node:test';
import { changeSaleWorkspace, createSaleWorkspace, saleWorkspaceTotals, SaleWorkspaceError, type SaleWorkspaceCommand, type SaleWorkspaceContext, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { PostgresSaleWorkspaceStore, readSaleWorkspaceAssets, type SaleWorkspaceDatabase } from './lib/sale-workspace-store';

let sequence = 0;
const context = (): SaleWorkspaceContext => ({ now: '2026-10-04T12:00:00.000Z', actor: 'Test staff', nextId: () => `id-${++sequence}`, nextNumber: type => `${type}-${++sequence}`, branding: { identity: { name: 'Test Motors', logoText: 'TEST', logoAsset: '' }, contact: { phone: '02000000000', email: '' }, address: { street: '', city: 'London', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } }, vehicle: { year: 2016, fuel: 'Petrol', mileage: 38000 } });
const draft = (): SaleWorkspaceDraft => ({ id: 'draft', customer: 'Test customer', email: '', phone: '', address: '', vehicleId: 'test-car', vehicle: 'Test car', registration: '', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false, adjustments: [], exchanges: [] });
const create = () => createSaleWorkspace({ draft: draft(), requestId: 'request-create' }, context(), 'SALE-2026-00001').sale;
const payment = (amount: string, kind: 'deposit' | 'part-payment' | 'final-payment' = 'part-payment', status: 'pending' | 'confirmed' = 'confirmed'): SaleWorkspaceCommand => ({ action: 'payment', payment: { amount, kind, status, method: 'Bank transfer', date: '2026-10-04', reference: 'Test reference' } });

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
  const completed = changeSaleWorkspace(updated.sale, { ...handover, acknowledgeOutstanding: true }, { expectedRevision: updated.sale.revision, requestId: 'request-handover' }, context());
  assert.equal(completed.document?.title, 'Delivery confirmation'); assert.equal(completed.sale.draft.fulfilment?.viewed, 'not-yet-viewed'); assert.equal(saleWorkspaceTotals(completed.sale.draft, completed.sale.payments).balance, 1200000);
});

test('integer pence, three exchanges, overpayments and false final payments are validated', () => {
  assert.throws(() => changeSaleWorkspace(create(), payment('0.001'), { expectedRevision: 1, requestId: 'request-badmoney' }, context()), /decimal places/);
  assert.throws(() => changeSaleWorkspace(create(), payment('12001'), { expectedRevision: 1, requestId: 'request-overpaid' }, context()), /exceeds/);
  assert.throws(() => changeSaleWorkspace(create(), payment('500', 'final-payment'), { expectedRevision: 1, requestId: 'request-badfinal' }, context()), /settle/);
  const d = draft(); d.exchanges = Array.from({ length: 4 }, () => ({ registration: 'AB12 CDE', description: '', value: '100' }));
  assert.throws(() => createSaleWorkspace({ draft: d, requestId: 'request-manypx' }, context(), 'SALE-1'), /exchanges/);
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
  const completed = changeSaleWorkspace(create(), { action: 'handover', recipient: 'Original recipient', acknowledgeOutstanding: true }, { expectedRevision: 1, requestId: 'request-handover' }, context());
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
