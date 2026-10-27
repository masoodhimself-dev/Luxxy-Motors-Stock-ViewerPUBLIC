import { saleWorkspaceBranding, type SaleWorkspaceDocument, type SaleWorkspaceDraft, type SaleWorkspacePayment } from './sale-workspace.ts';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

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
  return copy({ id: document.id, number: document.number, type: document.type, title: document.title, ...(document.invoiceKind ? { invoiceKind: document.invoiceKind } : {}), issuedAt: document.issuedAt, issuedBy: '', version: document.version, ...(document.content ? { content: document.content } : {}),
    ...(document.paymentId ? { paymentId: document.paymentId, paymentAmountPence: document.paymentAmountPence } : {}), balanceAtIssue: document.balanceAtIssue,
    ...(document.verification ? { verification: { url: document.verification.url } } : {}),
    snapshot: { draft, payments: paymentRows, totals: { price: document.snapshot.totals.price, allowance: document.snapshot.totals.allowance, adjustments: document.snapshot.totals.adjustments, totalDue: document.snapshot.totals.totalDue, deposit: document.snapshot.totals.deposit, confirmedPaid: document.snapshot.totals.confirmedPaid, pending: document.snapshot.totals.pending, balance: document.snapshot.totals.balance }, branding: saleWorkspaceBranding(document.snapshot.branding), ...(document.snapshot.vehicle ? { vehicle: { id: document.snapshot.vehicle.id, title: document.snapshot.vehicle.title, year: document.snapshot.vehicle.year, fuel: document.snapshot.vehicle.fuel, transmission: document.snapshot.vehicle.transmission, mileage: document.snapshot.vehicle.mileage, colour: document.snapshot.vehicle.colour, owners: document.snapshot.vehicle.owners, writeOffCategory: document.snapshot.vehicle.writeOffCategory, serviceHistory: document.snapshot.vehicle.serviceHistory, description: document.snapshot.vehicle.description, registration: document.snapshot.vehicle.registration, engineSize: document.snapshot.vehicle.engineSize, bodyType: document.snapshot.vehicle.bodyType, doors: document.snapshot.vehicle.doors, seats: document.snapshot.vehicle.seats, emissionClass: document.snapshot.vehicle.emissionClass, photoDataUrl: document.snapshot.vehicle.photoDataUrl } } : {}) } });
}
