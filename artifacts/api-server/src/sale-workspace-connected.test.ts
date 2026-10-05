import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { SaleWorkspaceError, saleWorkspaceTotals, type SaleWorkspaceDraft, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { PostgresSaleWorkspaceStore, readSaleWorkspaceAssets, recordStripeReservationDeposit, recordStripeReservationRefund, type SaleWorkspaceDatabase } from './lib/sale-workspace-store';
const vehicleId = '00000000-0000-4000-8000-000000000001';
const reservationId = '00000000-0000-4000-8000-000000000002';
const draft = (): SaleWorkspaceDraft => ({ id: '', customer: 'Test buyer', email: 'buyer@test.invalid', phone: '', address: '', vehicleId, vehicle: 'A real stock car', registration: 'AB12 CDE', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false });
function fixture() {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  let records = new Map<string, SaleWorkspaceRecord>(), numbers: Record<string, number> = {};
  let vehicle = { inventory_status: 'available', source_status: 'live', source_price: 12345, audit_metadata: { sourceFact: 'keep-me' } };
  const statements: string[] = [];
  const query = async (q: string, p: any[] = []) => {
    statements.push(q);
    if (q.startsWith('SELECT config')) return { rows: [{ config: { identity: { name: 'Fixture dealer' } } }] };
    if (q.startsWith('SELECT id, coalesce')) return { rows: [{ id: vehicleId, title: 'A real stock car', year: 2020, fuel: 'Petrol', transmission: 'Manual', mileage: 12000 }] };
    if (q.startsWith('SELECT numbers')) return { rows: [{ numbers: clone(numbers) }] };
    if (q.startsWith('SELECT inventory_status')) return { rows: [clone(vehicle)] };
    if (q.startsWith('SELECT stage FROM leads')) return { rows: [{ stage: 'reserved' }] };
    if (q.startsWith('SELECT l.vehicle_id FROM leads')) return { rows: [{ vehicle_id: vehicleId }] };
    if (q.startsWith('SELECT id FROM leads')) return { rows: [] };
    if (q.startsWith('SELECT state FROM sale_workspace')) {
      let list = [...records.values()];
      if (q.includes("state->'requests'")) list = list.filter(s => s.requests?.[p[1]]);
      else if (q.includes("state->'providerPayments'")) list = list.filter(s => s.providerPayments?.[p[1]]);
      else if (q.includes('sourceReservationId')) list = list.filter(s => s.draft.sourceReservationId === p[1]);
      else if (q.includes('id = $2')) list = list.filter(s => s.id === p[1]);
      return { rows: list.map(state => ({ state: clone(state) })) };
    }
    if (q.startsWith('SELECT id FROM sale_workspace')) return { rows: [...records.values()].filter(s => s.id !== p[1] && s.draft.vehicleId === p[2] && ['reserved', 'sold'].includes(s.lifecycle?.status ?? '')).map(s => ({ id: s.id })) };
    if (q.startsWith('INSERT INTO sale_workspace (')) records.set(p[0], JSON.parse(p[4]));
    if (q.startsWith('UPDATE sale_workspace SET')) records.set(p[1], JSON.parse(p[3]));
    if (q.startsWith('UPDATE sale_workspace_counters')) numbers = JSON.parse(p[1]);
    if (q.startsWith('UPDATE vehicles SET inventory_status')) vehicle = { ...vehicle, inventory_status: p[2], audit_metadata: JSON.parse(p[3]) };
    if (q.startsWith('UPDATE vehicles SET audit_metadata')) vehicle.audit_metadata = { ...vehicle.audit_metadata, ...JSON.parse(p[2]) };
    return { rows: [] };
  };
  const database: SaleWorkspaceDatabase = { query, connect: async () => {
    const before = { records: clone([...records.entries()]), numbers: clone(numbers), vehicle: clone(vehicle) };
    return { query: async (q, p) => { if (q === 'ROLLBACK') { records = new Map(before.records); numbers = before.numbers; vehicle = before.vehicle; } return query(q, p); }, release: () => {} };
  } };
  const store = new PostgresSaleWorkspaceStore('fixture-dealer', (d, client) => readSaleWorkspaceAssets(d, 'fixture-dealer', client), database);
  return { database, store, vehicle: () => clone(vehicle), statements };
}

test('production availability mutations reject a competing buyer and preserve Grok source data', async () => {
  const f = fixture();
  const a = (await f.store.mutate({ draft: draft(), requestId: randomUUID(), actor: 'Staff A' })).sale;
  const b = (await f.store.mutate({ draft: { ...draft(), customer: 'Other buyer' }, requestId: randomUUID(), actor: 'Staff B' })).sale;
  const reserved = await f.store.mutate({ id: a.id, expectedRevision: a.revision, requestId: randomUUID(), actor: 'Staff A', command: { action: 'lifecycle', status: 'reserved' } });
  assert.equal(f.vehicle().inventory_status, 'reserved'); assert.equal(f.vehicle().source_price, 12345); assert.equal(f.vehicle().audit_metadata.sourceFact, 'keep-me');
  await assert.rejects(f.store.mutate({ id: b.id, expectedRevision: b.revision, requestId: randomUUID(), actor: 'Staff B', command: { action: 'lifecycle', status: 'reserved' } }), (e: unknown) => e instanceof SaleWorkspaceError && e.status === 409);
  assert.equal((await f.store.get(b.id)).revision, 1);
  await f.store.mutate({ id: a.id, expectedRevision: reserved.sale.revision, requestId: randomUUID(), actor: 'Staff A', command: { action: 'handover', recipient: 'Buyer', acknowledgeOutstanding: true } });
  assert.equal(f.vehicle().inventory_status, 'sold'); assert.equal(f.vehicle().source_status, 'live'); assert.equal(f.vehicle().source_price, 12345);
  assert.equal((await f.store.get(a.id)).lifecycle?.status, 'sold');
  assert.ok(f.statements.some(q => q.includes('pg_advisory_xact_lock'))); assert.ok(f.statements.some(q => q.includes('FROM vehicles') && q.includes('FOR UPDATE')));
});

test('verified Stripe deposits and cumulative refunds issue one receipt per effective change', async () => {
  const f = fixture(); const client = await f.database.connect();
  try {
    const input = { dealerId: 'fixture-dealer', reservationId, vehicleId, customerName: 'Stripe buyer', email: 'stripe@test.invalid', phone: '', vehicleTitle: 'A real stock car', expectedPricePence: 1200000, amountPence: 50000, currency: 'gbp', paymentIntentId: 'pi_fixtureOne', eventId: 'evt_fixtureOne' };
    const first = await recordStripeReservationDeposit(input, client); const snapshot = JSON.stringify(first.documents[0]);
    const repeat = await recordStripeReservationDeposit({ ...input, eventId: 'evt_retry' }, client);
    assert.equal(repeat.id, first.id); assert.equal(repeat.payments.length, 1); assert.equal(repeat.documents.length, 1);
    await assert.rejects(recordStripeReservationDeposit({ ...input, amountPence: 50001 }, client), /incompatible/);
    const partial = await recordStripeReservationRefund({ dealerId: input.dealerId, reservationId, paymentIntentId: input.paymentIntentId, eventId: 'evt_refund', amountRefundedPence: 10000 }, client);
    const second = await recordStripeReservationRefund({ dealerId: input.dealerId, reservationId, paymentIntentId: input.paymentIntentId, eventId: 'evt_refund2', amountRefundedPence: 20000 }, client);
    const again = await recordStripeReservationRefund({ dealerId: input.dealerId, reservationId, paymentIntentId: input.paymentIntentId, eventId: 'evt_refund2again', amountRefundedPence: 20000 }, client);
    assert.equal(partial.payments.length, 2); assert.equal(second.payments.length, 3); assert.equal(again.payments.length, 3); assert.equal(second.documents.length, 3);
    assert.equal(second.payments[1].signedAmountPence, -10000); assert.equal(second.payments[2].signedAmountPence, -10000); assert.equal(JSON.stringify(second.documents[0]), snapshot);
    const originalHistory = JSON.stringify(second.payments), originalDocuments = JSON.stringify(second.documents);
    const corrected = await recordStripeReservationRefund({ dealerId: input.dealerId, reservationId, paymentIntentId: input.paymentIntentId, eventId: 'evt_refundFailed', amountRefundedPence: 10000 }, client);
    assert.equal(corrected.payments.at(-1)?.kind, 'refund-correction'); assert.equal(corrected.payments.at(-1)?.signedAmountPence, 10000);
    assert.equal(corrected.documents.at(-1)?.title, 'Refund correction receipt'); assert.match(corrected.payments.at(-1)?.reason ?? '', /no new payment was charged/);
    assert.equal(JSON.stringify(corrected.payments.slice(0, 3)), originalHistory); assert.equal(JSON.stringify(corrected.documents.slice(0, 3)), originalDocuments);
    assert.equal(saleWorkspaceTotals(corrected.draft, corrected.payments).confirmedPaid, 40000);
    // Both financial and no-op event identities remain harmless when replayed after a later failure.
    for (const eventId of ['evt_refund2', 'evt_refund2again']) {
      const replay = await recordStripeReservationRefund({ dealerId: input.dealerId, reservationId, paymentIntentId: input.paymentIntentId, eventId, amountRefundedPence: 20000 }, client);
      assert.equal(replay.revision, corrected.revision); assert.equal(replay.payments.length, 4);
    }
    await assert.rejects(recordStripeReservationRefund({ dealerId: input.dealerId, reservationId, paymentIntentId: input.paymentIntentId, eventId: 'evt_refundFailed', amountRefundedPence: 0 }, client), /different details/);
    const succeededAgain = await recordStripeReservationRefund({ dealerId: input.dealerId, reservationId, paymentIntentId: input.paymentIntentId, eventId: 'evt_refundSucceededAgain', amountRefundedPence: 20000 }, client);
    assert.equal(succeededAgain.payments.length, 5); assert.equal(succeededAgain.payments.at(-1)?.signedAmountPence, -10000);
    const allFailed = await recordStripeReservationRefund({ dealerId: input.dealerId, reservationId, paymentIntentId: input.paymentIntentId, eventId: 'evt_allRefundsFailed', amountRefundedPence: 0 }, client);
    const failureReplay = await recordStripeReservationRefund({ dealerId: input.dealerId, reservationId, paymentIntentId: input.paymentIntentId, eventId: 'evt_allRefundsFailed', amountRefundedPence: 0 }, client);
    assert.equal(allFailed.payments.at(-1)?.signedAmountPence, 20000); assert.equal(allFailed.documents.length, 6); assert.equal(failureReplay.revision, allFailed.revision);
    assert.equal(saleWorkspaceTotals(allFailed.draft, allFailed.payments).confirmedPaid, 50000);
    assert.equal(JSON.stringify(allFailed.documents.slice(0, 3)), originalDocuments);
    const saved = (await client.query('SELECT state FROM sale_workspace WHERE dealer_id = $1 AND id = $2::uuid', [input.dealerId, allFailed.id])).rows[0].state as SaleWorkspaceRecord;
    assert.ok(saved.documentArchives?.[allFailed.documents.at(-1)!.id].sha256);
  } finally { client.release(); }
});

test('a failed refund restores real funds even after later payments and keeps any customer credit visible', async () => {
  const f = fixture(); const client = await f.database.connect();
  try {
    const input = { dealerId: 'fixture-dealer', reservationId, vehicleId, customerName: 'Stripe buyer', email: 'stripe@test.invalid', phone: '', vehicleTitle: 'A real stock car', expectedPricePence: 50000, amountPence: 50000, currency: 'gbp', paymentIntentId: 'pi_creditFixture', eventId: 'evt_creditDeposit' };
    await recordStripeReservationDeposit(input, client);
    const refund = { dealerId: input.dealerId, reservationId, paymentIntentId: input.paymentIntentId };
    const refunded = await recordStripeReservationRefund({ ...refund, eventId: 'evt_creditRefund', amountRefundedPence: 50000 }, client);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    await f.store.mutate({ id: refunded.id, expectedRevision: refunded.revision, requestId: randomUUID(), actor: 'Accounts', command: { action: 'payment', payment: { amount: '500', method: 'Cash', date, reference: '', kind: 'final-payment', status: 'confirmed' } } });
    const corrected = await recordStripeReservationRefund({ ...refund, eventId: 'evt_creditRefundFailed', amountRefundedPence: 0 }, client);
    assert.equal(saleWorkspaceTotals(corrected.draft, corrected.payments).balance, -50000); assert.equal(corrected.documents.at(-1)?.balanceAtIssue, -50000);
    const updated = await f.store.mutate({ id: corrected.id, expectedRevision: corrected.revision, requestId: randomUUID(), actor: 'Accounts', command: { action: 'update', draft: { ...corrected.draft, notes: 'Customer credit requires review.' } } });
    assert.equal(saleWorkspaceTotals(updated.sale.draft, updated.sale.payments).balance, -50000);
    await assert.rejects(f.store.mutate({ id: corrected.id, expectedRevision: updated.sale.revision, requestId: randomUUID(), actor: 'Accounts', command: { action: 'provider-refund-correction', paymentId: corrected.payments[0].id, amount: '100', reason: 'Injected staff command', date } }), (e: unknown) => e instanceof SaleWorkspaceError && e.status === 403);
    await assert.rejects(f.store.mutate({ id: corrected.id, expectedRevision: updated.sale.revision, requestId: randomUUID(), actor: 'Accounts', command: { action: 'update', draft: { ...updated.sale.draft, price: '400' } } }), /cannot exceed/);
    await assert.rejects(f.store.mutate({ id: corrected.id, expectedRevision: updated.sale.revision, requestId: randomUUID(), actor: 'Accounts', command: { action: 'reverse', paymentId: corrected.payments.at(-1)!.id, reason: 'No duplicate correction', date } }), /original payment/);
  } finally { client.release(); }
});

test('email acceptance merges into the current revision without overwriting a concurrent payment', async () => {
  const f = fixture();
  let a = (await f.store.mutate({ draft: draft(), requestId: randomUUID(), actor: 'Staff' })).sale;
  a = (await f.store.mutate({ id: a.id, expectedRevision: a.revision, requestId: randomUUID(), actor: 'Staff', command: { action: 'document', type: 'invoice' } })).sale;
  const delivery = { id: 'email-request-test', documentId: a.documents[0].id, to: a.draft.email, status: 'sending' as const, attemptedAt: new Date().toISOString() };
  a = (await f.store.mutate({ id: a.id, expectedRevision: a.revision, requestId: 'email-start-test', actor: 'Staff', command: { action: 'email-status', delivery } })).sale;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const paid = await f.store.mutate({ id: a.id, expectedRevision: a.revision, requestId: randomUUID(), actor: 'Other staff', command: { action: 'payment', payment: { amount: '500', method: 'Cash', date, reference: '', kind: 'deposit', status: 'confirmed' } } });
  const finished = await f.store.finishEmail(a.id, 'email-finish-test', { action: 'email-status', delivery: { ...delivery, status: 'sent', sentAt: new Date().toISOString(), providerId: 'resend-test' } }, 'Staff');
  assert.equal(finished.sale.revision, paid.sale.revision + 1); assert.equal(finished.sale.payments.length, 1); assert.equal(finished.sale.documents.length, 2); assert.equal(finished.sale.emailDeliveries?.[0].status, 'sent');
});
