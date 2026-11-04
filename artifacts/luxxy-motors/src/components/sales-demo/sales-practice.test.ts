import { afterEach, describe, expect, it, vi } from 'vitest';
import { saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { emptyDraft } from './model';
import { applyTestSaleCommand, applyTestSaleOperation, createTestSale } from './sales-practice';

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }));

const car = { id: 'car-one', title: 'Ford Focus', registration: 'AB18XYZ', year: 2018, price: 8000, inventoryStatus: 'available', images: [] } as unknown as Car;
const replacement = { ...car, id: 'car-two', title: 'Toyota Auris', registration: 'CD19XYZ', price: 10000 };
const draft = () => ({ ...emptyDraft(), customer: 'Alex Example', email: 'alex@example.invalid', vehicleId: car.id, vehicle: 'Ford Focus', registration: 'AB18XYZ', price: '8000' });
const receive = (sale: SaleWorkspaceRecord, amount: string, kind: 'deposit' | 'final-payment') => applyTestSaleCommand(sale, { action: 'invoice-payment', payment: { amount, kind, method: 'Bank transfer', date: '2026-11-04', reference: 'Test', status: 'confirmed' } }, car, dealerConfig).sale;
function completed() {
  let sale = receive(createTestSale(draft(), car, dealerConfig), '8000', 'final-payment');
  sale = applyTestSaleCommand(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true }, car, dealerConfig).sale;
  return applyTestSaleCommand(sale, { action: 'finish-invoice-sale', acknowledge: true }, car, dealerConfig).sale;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('isolated practice reducer adapter', () => {
  it('runs requests, deposits and invoices without network calls or changing real source stock', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    const fetch = vi.spyOn(globalThis, 'fetch');
    const originalCar = structuredClone(car), originalDealer = structuredClone(dealerConfig);
    const created = createTestSale(draft(), car, dealerConfig);
    const requested = applyTestSaleOperation(created, { action: 'request-payment', kind: 'deposit', amount: '200', dueDate: '2026-11-05' }, car, dealerConfig);
    expect(requested.sale.payments).toHaveLength(0);
    expect(requested.sale.lifecycle).toBeUndefined();
    expect(requested.document?.number).toContain('TEST ONLY');
    expect(requested.document?.snapshot.branding.invoiceSettings?.paymentInstructions).toBe('');
    const paid = receive(requested.sale, '200', 'deposit');
    expect(paid.lifecycle?.status).toBe('reserved');
    expect(saleWorkspaceTotals(paid.draft, paid.payments).balance).toBe(780000);
    const invoice = applyTestSaleCommand(paid, { action: 'issue-invoice', kind: 'deposit', acknowledge: true }, car, dealerConfig);
    expect(invoice.document?.invoiceKind).toBe('deposit');
    expect(invoice.document?.snapshot.branding.invoiceSettings?.footer).toContain('TEST ONLY');
    expect(invoice.document?.number).toContain('TEST ONLY');
    expect(car).toEqual(originalCar); expect(dealerConfig).toEqual(originalDealer);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains exact domain overpayment/final-payment rules and refuses a live record', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    const sale = createTestSale(draft(), car, dealerConfig);
    expect(() => receive(sale, '100', 'final-payment')).toThrow(/settle/);
    expect(() => receive(sale, '8001', 'deposit')).toThrow(/exceeds/);
    expect(() => applyTestSaleCommand({ ...sale, id: 'live-record' }, { action: 'issue-invoice', kind: 'full', acknowledge: true }, car, dealerConfig)).toThrow(/copied test sale/);
  });

  it('uses linked return credit once for a replacement without inventing another payment', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    const original = completed();
    const result = applyTestSaleOperation(original, { action: 'return-replace', replacementCar: replacement, replacementPrice: '10000', agreedCredit: '8000', reason: 'Practice exchange', condition: 'Inspected for practice', mileage: 50000, financeConfirmed: true, acknowledge: true }, car, dealerConfig);
    expect(result.sale.lifecycle?.status).toBe('returned');
    expect(result.replacement?.payments).toEqual([]);
    expect(saleWorkspaceTotals(result.replacement!.draft, result.replacement!.payments).balance).toBe(200000);
    expect(result.replacement?.lifecycle?.status).toBe('reserved');
    expect(original.lifecycle?.status).toBe('sold');
    expect(() => applyTestSaleOperation(result.sale, { action: 'return-replace', replacementCar: replacement, replacementPrice: '10000', agreedCredit: '8000', reason: 'Practice exchange', condition: 'Practice condition', mileage: 50000, financeConfirmed: true, acknowledge: true }, car, dealerConfig)).toThrow(/already been returned/);
  });

  it('records a standalone return/refund due and keeps the issued original invoice', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    const original = completed();
    const result = applyTestSaleOperation(original, { action: 'return-car', agreedCredit: '8000', reason: 'Practice return', condition: 'Practice condition', mileage: 50000, returnedDate: '2026-11-04', financeConfirmed: true, received: true, acknowledge: true }, car, dealerConfig);
    expect(result.sale.lifecycle?.status).toBe('returned');
    expect(result.sale.standaloneReturn?.refundDuePence).toBe(800000);
    expect(result.sale.documents.filter(row => row.type === 'invoice')).toHaveLength(1);
    expect(result.document?.transaction?.kind).toBe('return-only-credit');
    expect(result.sale.payments).toHaveLength(1);
    const refunded = applyTestSaleOperation(result.sale, { action: 'refund-credit', amount: '8000', method: 'Bank transfer', date: '2026-11-04', confirmReceived: true }, car, dealerConfig);
    expect(saleWorkspaceTotals(refunded.sale.draft, refunded.sale.payments).balance).toBe(0);
    expect(refunded.document?.paymentAmountPence).toBe(-800000);
    expect(original.payments).toHaveLength(1);
  });
});
