/** Browser-only practice data. No request client, API endpoint or live-store dependency belongs here. */
import {
  changeSaleWorkspace, createSaleWorkspace, finishSaleOperation, operationDocument,
  operationMoney, requestSalePayment, returnAndReplaceSale, returnSaleCar, refundSaleCredit,
  saleWorkspaceBranding, saleWorkspaceTotals, vehicleRegistration, SaleWorkspaceError,
  type SaleWorkspaceCommand, type SaleWorkspaceContext, type SaleWorkspaceDocument,
  type SaleWorkspaceMutation, type SaleWorkspaceRecord,
} from '@workspace/vehicle-meta';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { emptyDraft, saleRequestId, type SaleDraft } from './model';
import { markTestSaleDocument } from './sales-document';

const clone = <T,>(value: T): T => structuredClone(value);
export const isTestSale = (sale: Pick<SaleWorkspaceRecord, 'id' | 'reference'>) => sale.id.startsWith('test-') && sale.reference.startsWith('TEST-');
export function practiceDealer(dealer: DealerConfig): DealerConfig {
  const copy = clone(dealer) as DealerConfig & { invoiceSettings?: Record<string, unknown> };
  copy.invoiceSettings = { ...copy.invoiceSettings, paymentInstructions: '', footer: 'TEST ONLY — no live transaction.' };
  return copy;
}
function context(dealer: DealerConfig, vehicle?: Car, sale?: SaleWorkspaceRecord): SaleWorkspaceContext {
  let sequence = sale?.documents.length ?? 0;
  const branding = saleWorkspaceBranding(practiceDealer(dealer));
  return {
    now: new Date().toISOString(), actor: 'Practice staff', nextId: () => `test-${saleRequestId()}`,
    nextNumber: type => `TEST-${type.toUpperCase()}-${String(++sequence).padStart(4, '0')}`,
    branding, paperwork: { saleTerms: 'Sample sale terms.', reservationTerms: 'Sample reservation terms.' },
    ...(vehicle ? { vehicle: { id: vehicle.id, title: vehicle.title ?? undefined, year: vehicle.year, fuel: vehicle.fuel, transmission: vehicle.transmission, mileage: vehicle.mileage, colour: vehicle.colour, owners: vehicle.owners, writeOffCategory: vehicle.writeOffCategory } } : {}),
    requireFinalReview: false,
  };
}
function protectedResult<T extends { sale: SaleWorkspaceRecord; document?: SaleWorkspaceDocument }>(result: T): T {
  const sale = clone(result.sale);
  sale.documents = sale.documents.map(markTestSaleDocument);
  const document = result.document ? sale.documents.find(row => row.id === result.document!.id) : undefined;
  return { ...result, sale, ...(document ? { document } : {}) };
}
function requirePractice(sale: SaleWorkspaceRecord) {
  if (!isTestSale(sale)) throw new Error('Practice actions only accept a copied test sale.');
}
export function createTestSale(draft: SaleDraft, vehicle: Car | undefined, dealer: DealerConfig): SaleWorkspaceRecord {
  const ctx = context(dealer, vehicle);
  return protectedResult(createSaleWorkspace({ draft: clone(draft), requestId: saleRequestId() }, ctx, `TEST-SALE-${saleRequestId().slice(0, 8).toUpperCase()}`)).sale;
}
export function applyTestSaleCommand(sale: SaleWorkspaceRecord, command: SaleWorkspaceCommand, vehicle: Car | undefined, dealer: DealerConfig): SaleWorkspaceMutation {
  requirePractice(sale);
  return protectedResult(changeSaleWorkspace(clone(sale), clone(command), { expectedRevision: sale.revision, requestId: saleRequestId() }, context(dealer, vehicle, sale)));
}
export type TestSaleOperation =
  | { action: 'request-payment'; kind: 'deposit' | 'balance' | 'other'; amount: string; dueDate: string; note?: string }
  | { action: 'cancel-request'; paymentRequestId: string }
  | { action: 'delivery-charge'; amount: string }
  | { action: 'refund-credit'; amount: string; method: string; date: string; confirmReceived: boolean }
  | { action: 'return-car'; agreedCredit: string; reason: string; condition: string; mileage: number; returnedDate: string; financeConfirmed: boolean; received: boolean; acknowledge: boolean }
  | { action: 'return-replace'; replacementCar: Car; replacementPrice: string; agreedCredit: string; reason: string; condition: string; mileage: number; financeConfirmed: boolean; acknowledge: boolean };
export function applyTestSaleOperation(current: SaleWorkspaceRecord, input: TestSaleOperation, vehicle: Car | undefined, dealer: DealerConfig): SaleWorkspaceMutation & { replacement?: SaleWorkspaceRecord } {
  requirePractice(current);
  const ctx = context(dealer, vehicle, current);
  if (input.action === 'request-payment') return protectedResult(requestSalePayment(current, { ...input, note: input.note ?? '', tokenHash: `test-only-${saleRequestId()}`, expiresAt: new Date(Date.parse(ctx.now) + 30 * 86400000).toISOString() }, ctx));
  if (input.action === 'return-car') return protectedResult(returnSaleCar(current, input, ctx));
  if (input.action === 'refund-credit') return protectedResult(refundSaleCredit(current, input, ctx));
  if (input.action === 'return-replace') {
    const car = clone(input.replacementCar);
    if (car.id === current.draft.vehicleId || ['sold', 'hidden', 'archived', 'reserved'].includes(String(car.inventoryStatus))) throw new SaleWorkspaceError('Choose an available different practice vehicle.');
    const draft = { ...emptyDraft(), payments: [], customer: current.draft.customer, email: current.draft.email, phone: current.draft.phone, address: current.draft.address, vehicleId: car.id, vehicle: car.title || `${car.make ?? ''} ${car.model ?? ''}`.trim(), registration: vehicleRegistration(car), price: input.replacementPrice };
    const result = returnAndReplaceSale(current, { ...input, replacementDraft: draft }, ctx, `TEST-SALE-${saleRequestId().slice(0, 8).toUpperCase()}`);
    return { ...protectedResult({ sale: result.returned, document: result.creditDocument }), replacement: protectedResult({ sale: result.replacement }).sale };
  }
  const sale = clone(current);
  if (input.action === 'cancel-request') {
    const request = sale.paymentRequests?.find(row => row.id === input.paymentRequestId);
    if (!request) throw new Error('Choose the practice request.');
    request.status = 'cancelled'; finishSaleOperation(sale, ctx, 'Practice request cancelled');
    return { sale };
  }
  const amount = operationMoney(input.amount, 'delivery charge', true), previous = operationMoney(sale.draft.deliveryCharge || '0', 'delivery charge', true);
  if (sale.lifecycle?.status === 'returned' || sale.returnReplacement?.direction === 'returned') throw new SaleWorkspaceError('Open the current replacement deal.');
  if (sale.draft.fulfilment?.method !== 'delivery' && amount > 0) throw new SaleWorkspaceError('Choose delivery before adding its charge.');
  if (sale.draft.adjustments?.some(row => row.kind === 'fee' && /deliver/i.test(row.description))) throw new SaleWorkspaceError('Remove the duplicate delivery extra.');
  if (sale.documents.some(row => row.type === 'invoice') && amount < previous) throw new SaleWorkspaceError('An invoiced delivery charge needs a correction; it cannot be silently reduced.');
  sale.draft.deliveryCharge = (amount / 100).toFixed(2);
  let document: SaleWorkspaceDocument | undefined;
  if (sale.documents.some(row => row.type === 'invoice') && amount > previous) {
    document = operationDocument(sale, ctx, 'delivery-invoice', 'Delivery invoice', 'Additional delivery charge.');
    document.transaction = { kind: 'delivery-invoice', amountPence: amount - previous, saleReference: sale.reference, invoiceReferences: sale.documents.filter(row => row.type === 'invoice').map(row => row.number), deliveryAddress: sale.draft.fulfilment?.address || '', previousDeliveryPence: previous, totalDeliveryPence: amount };
  }
  finishSaleOperation(sale, ctx, 'Practice delivery charge saved');
  return protectedResult({ sale, ...(document ? { document } : {}) });
}
export const testSaleBalance = (sale: SaleWorkspaceRecord) => saleWorkspaceTotals(sale.draft, sale.payments);
