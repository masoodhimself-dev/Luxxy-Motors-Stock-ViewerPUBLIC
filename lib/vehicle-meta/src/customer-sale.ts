import { saleWorkspaceTotals, saleWorkspaceBranding, type SaleWorkspaceRecord, type SaleWorkspaceDocument, type SaleWorkspaceDraft, type SaleWorkspacePayment, type SaleWorkspaceBranding } from './sale-workspace.ts';

/** Explicit customer contract: never serialize the staff record or its arbitrary JSON fields. */
export type CustomerSaleView = {
  reference: string; customer: string; vehicle: string; registration: string; status: string;
  totals: ReturnType<typeof saleWorkspaceTotals>;
  payments: Array<Pick<SaleWorkspacePayment, 'id' | 'amountPence' | 'signedAmountPence' | 'method' | 'date' | 'kind' | 'status' | 'receiptId'>>;
  documents: Array<Pick<SaleWorkspaceDocument, 'id' | 'number' | 'title' | 'type' | 'issuedAt'>>;
  fulfilment?: Pick<NonNullable<SaleWorkspaceDraft['fulfilment']>, 'method' | 'address' | 'recipient' | 'phone' | 'scheduledDate' | 'timeWindow' | 'completedAt' | 'completedRecipient'>;
  appointment?: SaleWorkspaceDraft['appointment'];
  dealer: SaleWorkspaceBranding; expiresAt: string;
};
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function customerSaleView(record: SaleWorkspaceRecord, branding: SaleWorkspaceBranding): CustomerSaleView {
  const f = record.draft.fulfilment;
  return copy({ reference: record.reference, customer: record.draft.customer, vehicle: record.draft.vehicle, registration: record.draft.registration,
    status: record.lifecycle?.status ?? (record.draft.handover ? 'sold' : 'draft'), totals: saleWorkspaceTotals(record.draft, record.payments),
    payments: record.payments.filter(p => p.status !== 'cancelled').map(p => ({ id: p.id, amountPence: p.amountPence, signedAmountPence: p.signedAmountPence, method: p.method, date: p.date, kind: p.kind, status: p.status, ...(p.receiptId ? { receiptId: p.receiptId } : {}) })),
    documents: record.documents.filter(d => d.snapshot.draft.customer === record.draft.customer && d.snapshot.draft.email === record.draft.email).map(d => ({ id: d.id, number: d.number, title: d.title, type: d.type, issuedAt: d.issuedAt })),
    ...(f ? { fulfilment: { method: f.method, address: f.address, recipient: f.recipient, phone: f.phone, scheduledDate: f.scheduledDate, timeWindow: f.timeWindow, ...(f.completedAt ? { completedAt: f.completedAt, completedRecipient: f.completedRecipient } : {}) } } : {}),
    ...(record.draft.appointment ? { appointment: record.draft.appointment } : {}), dealer: saleWorkspaceBranding(branding), expiresAt: record.customerAccess?.expiresAt ?? '' });
}

/** Keep issued customer/vehicle/money values exactly as issued; redact staff-only fields. */
export function customerSaleDocument(document: SaleWorkspaceDocument): SaleWorkspaceDocument {
  const original = document.snapshot.draft;
  const paymentRows: SaleWorkspacePayment[] = document.snapshot.payments.map(p => ({ id: p.id, amount: p.amount, amountPence: p.amountPence, signedAmountPence: p.signedAmountPence,
    method: p.method, date: p.date, reference: p.reference, kind: p.kind, status: p.status, recordedBy: '', recordedAt: p.recordedAt,
    ...(p.receiptId ? { receiptId: p.receiptId } : {}), ...(p.expectedDate ? { expectedDate: p.expectedDate } : {}) }));
  const f = original.fulfilment;
  const draft: SaleWorkspaceDraft = { id: original.id, customer: original.customer, email: original.email, phone: original.phone, address: original.address, vehicleId: original.vehicleId,
    vehicle: original.vehicle, registration: original.registration, price: original.price, partExchange: original.partExchange, pxRegistration: original.pxRegistration, pxDescription: original.pxDescription, pxValue: original.pxValue,
    deposit: '', paymentMethod: original.paymentMethod, notes: document.type === 'vehicle-details' ? original.notes : '', collection: original.collection, preparation: false, documents: true, handover: original.handover,
    exchanges: original.exchanges?.map(r => ({ registration: r.registration, description: r.description, value: r.value })),
    adjustments: original.adjustments?.map(r => ({ description: r.description, amount: r.amount, kind: r.kind })), payments: paymentRows,
    ...(f ? { fulfilment: { method: f.method, viewed: f.viewed, address: f.address, recipient: f.recipient, phone: f.phone, scheduledDate: f.scheduledDate, timeWindow: f.timeWindow, instructions: '',
      ...(f.completedAt ? { completedAt: f.completedAt, completedRecipient: f.completedRecipient } : {}) } } : {}) };
  return copy({ id: document.id, number: document.number, type: document.type, title: document.title, issuedAt: document.issuedAt, issuedBy: '', version: document.version, ...(document.content ? { content: document.content } : {}),
    ...(document.paymentId ? { paymentId: document.paymentId, paymentAmountPence: document.paymentAmountPence } : {}), balanceAtIssue: document.balanceAtIssue,
    snapshot: { draft, payments: paymentRows, totals: { price: document.snapshot.totals.price, allowance: document.snapshot.totals.allowance, adjustments: document.snapshot.totals.adjustments, totalDue: document.snapshot.totals.totalDue, deposit: document.snapshot.totals.deposit, confirmedPaid: document.snapshot.totals.confirmedPaid, pending: document.snapshot.totals.pending, balance: document.snapshot.totals.balance }, branding: saleWorkspaceBranding(document.snapshot.branding), ...(document.snapshot.vehicle ? { vehicle: { id: document.snapshot.vehicle.id, title: document.snapshot.vehicle.title, year: document.snapshot.vehicle.year, fuel: document.snapshot.vehicle.fuel, transmission: document.snapshot.vehicle.transmission, mileage: document.snapshot.vehicle.mileage, colour: document.snapshot.vehicle.colour, owners: document.snapshot.vehicle.owners, writeOffCategory: document.snapshot.vehicle.writeOffCategory, serviceHistory: document.snapshot.vehicle.serviceHistory, description: document.snapshot.vehicle.description } } : {}) } });
}
