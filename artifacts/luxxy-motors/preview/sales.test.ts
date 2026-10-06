import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PreviewSaleWorkspaceStore } from './sales';
import { previewStock } from './stock';
import { SaleWorkspaceError, type SaleWorkspaceBranding, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';

const branding: SaleWorkspaceBranding = { identity: { name: 'Test dealer', logoText: '', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } };
const draft = (): SaleWorkspaceDraft => ({ id: 'draft', customer: 'Test buyer', email: '', phone: '', address: '', vehicleId: '', vehicle: 'Ad hoc car', registration: '', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false });

test('file-backed sale store serialises simultaneous device writes and replays safely after restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'luxxy-sales-store-'));
  const filename = path.join(directory, 'sales.json');
  try {
    const assets = async () => ({ branding });
    const store = new PreviewSaleWorkspaceStore(filename, assets);
    const created = await store.mutate({ requestId: 'create-request-01', draft: draft() });
    const replay = await store.mutate({ requestId: 'create-request-01', draft: draft() });
    assert.equal(replay.replayed, true); assert.equal(replay.sale.id, created.sale.id); assert.equal((await store.list()).length, 1);
    const command = { action: 'payment' as const, payment: { amount: '500', method: 'Cash', date: '2026-10-04', reference: '', status: 'confirmed' as const, kind: 'deposit' as const } };
    const request = { id: created.sale.id, expectedRevision: created.sale.revision, requestId: 'payment-request-01', command };
    const concurrent = await Promise.all([store.mutate(request), store.mutate(request)]);
    assert.equal(concurrent.filter(result => result.replayed).length, 1);
    assert.equal(concurrent[0].document?.number, concurrent[1].document?.number);
    const stored = await store.get(created.sale.id); assert.equal(stored.payments.length, 1); assert.equal(stored.documents.length, 1);
    assert.equal(stored.requests, undefined);
    const competing = await Promise.allSettled([
      store.mutate({ ...request, expectedRevision: stored.revision, requestId: 'payment-device-01', command: { ...command, payment: { ...command.payment, amount: '100' } } }),
      store.mutate({ ...request, expectedRevision: stored.revision, requestId: 'payment-device-02', command: { ...command, payment: { ...command.payment, amount: '100' } } }),
    ]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = competing.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof SaleWorkspaceError); assert.equal(rejected.reason.status, 409);
    const restarted = new PreviewSaleWorkspaceStore(filename, assets);
    const oldRetry = await restarted.mutate(request); assert.equal(oldRetry.replayed, true); assert.equal(oldRetry.document?.balanceAtIssue, 1150000);
    const state = JSON.parse(await readFile(filename, 'utf8')); assert.equal(state.sales[0].payments.length, 2); assert.equal(state.numbers['receipt-2026'], 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failed validation does not persist sale updates or consume receipt numbers', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'luxxy-sales-validation-'));
  const filename = path.join(directory, 'sales.json');
  try {
    const store = new PreviewSaleWorkspaceStore(filename, async () => ({ branding }));
    const created = await store.mutate({ requestId: 'create-request-01', draft: draft() });
    const before = await readFile(filename, 'utf8');
    await assert.rejects(store.mutate({ id: created.sale.id, expectedRevision: created.sale.revision, requestId: 'payment-invalid-01', command: { action: 'payment', payment: { amount: '12001', method: 'Cash', date: '2026-10-04', reference: '', status: 'confirmed', kind: 'part-payment' } } }), /exceeds/);
    assert.equal(await readFile(filename, 'utf8'), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('local deposit and completion reserve then sell the car while retaining all receipts and immutable PDFs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'luxxy-sale-pack-'));
  const car = { id: 'isolated-sale-pack-car', title: 'Fictional test car', price: 12000, sourceStatus: 'present' } as any;
  previewStock.cars.push(car);
  try {
    const store = new PreviewSaleWorkspaceStore(path.join(directory, 'sales.json'), async () => ({ branding, paperwork: { saleTerms: 'TEST ONLY SALE TERMS', reservationTerms: 'TEST ONLY RESERVATION TERMS' } }));
    let sale = (await store.mutate({ requestId: 'local-pack-create', draft: { ...draft(), vehicleId: car.id, vehicle: car.title } })).sale;
    sale = (await store.mutate({ id: sale.id, expectedRevision: sale.revision, requestId: 'local-pack-deposit', command: { action: 'take-deposit', payment: { amount: '500', method: 'Cash', date: new Date().toISOString().slice(0,10), reference: '', kind: 'deposit', status: 'confirmed' } } })).sale;
    assert.equal(sale.lifecycle?.status, 'reserved'); assert.equal(sale.documents.length, 3);
    const original = await store.pdf(sale.id, sale.documents[0].id);
    sale = (await store.mutate({ id: sale.id, expectedRevision: sale.revision, requestId: 'local-pack-final', command: { action: 'payment', payment: { amount: '11500', method: 'Bank transfer', date: new Date().toISOString().slice(0,10), reference: '', kind: 'final-payment', status: 'confirmed' } } })).sale;
    const input = { id: sale.id, expectedRevision: sale.revision, requestId: 'local-pack-complete', command: { action: 'complete-sale', acknowledge: true } as const };
    sale = (await store.mutate(input)).sale;
    assert.equal(sale.lifecycle?.status, 'sold'); assert.equal(sale.draft.handover, false);
    assert.equal(sale.packDocumentIds?.length, 5);
    assert.equal((await store.mutate(input)).replayed, true);
    assert.equal((await store.pdf(sale.id, original.document.id)).archive.content, original.archive.content);
    for (const id of sale.packDocumentIds!) assert.equal(Buffer.from((await store.pdf(sale.id, id)).archive.content, 'base64').subarray(0,4).toString(), '%PDF');
  } finally { previewStock.cars.splice(previewStock.cars.indexOf(car), 1); await rm(directory, { recursive: true, force: true }); }
});
