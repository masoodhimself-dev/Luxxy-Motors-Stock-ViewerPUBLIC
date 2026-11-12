import { saleWorkspaceBranding, type SaleWorkspaceDocument, type SaleWorkspaceDraft, type SaleWorkspacePayment } from './sale-workspace.ts';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type SaleEmailContact = Pick<SaleWorkspaceDraft, 'customer' | 'email'>;

export function saleDocumentEmailRecipientProblem(saved: SaleEmailContact, issued: SaleEmailContact): string | undefined {
  const email = issued.email?.trim() ?? '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return 'This document has no valid email address. Check the customer details and create an updated document before emailing.';
  }
  if (email.toLowerCase() !== saved.email?.trim().toLowerCase() || issued.customer?.trim().toLowerCase() !== saved.customer?.trim().toLowerCase()) {
    return 'The customer details have changed since this document was issued. Create an updated document before emailing.';
  }
  return undefined;
}

/** Keep issued customer/vehicle/money values exactly as issued; redact staff-only fields. */
export function customerSaleDocument(document: SaleWorkspaceDocument): SaleWorkspaceDocument {
  const original = document.snapshot.draft;
  const vehicle = document.snapshot.vehicle;
  const review = document.type === 'invoice' ? vehicle?.invoiceReview : undefined;
  const customerVehicle = vehicle && {
    id: vehicle.id, title: vehicle.title, trim: vehicle.trim, year: vehicle.year, fuel: vehicle.fuel, transmission: vehicle.transmission,
    mileage: vehicle.mileage, colour: vehicle.colour, owners: vehicle.owners, writeOffCategory: vehicle.writeOffCategory,
    serviceHistory: vehicle.serviceHistory, description: vehicle.description, registration: vehicle.registration,
    engineSize: vehicle.engineSize, bodyType: vehicle.bodyType, doors: vehicle.doors, seats: vehicle.seats,
    emissionClass: vehicle.emissionClass, photoDataUrl: vehicle.photoDataUrl,
    ...(document.type === 'invoice' && Array.isArray(vehicle.invoicePhotoDataUrls) ? { invoicePhotoDataUrls: vehicle.invoicePhotoDataUrls.slice(0,3) } : {}),
    ...(review ? { invoiceReview: {
      registration: review.registration, mileage: review.mileage, reviewedAt: review.reviewedAt, verification: review.verification,
      motExpiry: review.motExpiry, motSource: review.motSource,
    } } : {}),
  };
  const paymentRows: SaleWorkspacePayment[] = document.snapshot.payments.map(p => ({ id: p.id, amount: p.amount, amountPence: p.amountPence, signedAmountPence: p.signedAmountPence,
    method: p.method, date: p.date, reference: p.reference, kind: p.kind, status: p.status, recordedBy: '', recordedAt: p.recordedAt,
    ...(p.receiptId ? { receiptId: p.receiptId } : {}), ...(p.expectedDate ? { expectedDate: p.expectedDate } : {}) }));
  const f = original.fulfilment;
  const draft: SaleWorkspaceDraft = { id: original.id, customer: original.customer, email: original.email, phone: original.phone, address: original.address, vehicleId: original.vehicleId,
    vehicle: original.vehicle, registration: original.registration, price: original.price, partExchange: original.partExchange, pxRegistration: original.pxRegistration, pxDescription: original.pxDescription, pxValue: original.pxValue,
    deposit: '', paymentMethod: original.paymentMethod, notes: document.type === 'vehicle-details' ? original.notes : '', collection: original.collection, preparation: false, documents: true, handover: original.handover,
    exchanges: original.exchanges?.map(r => ({ registration: r.registration, description: r.description, value: r.value })),
    adjustments: original.adjustments?.map(r => ({ description: r.description, amount: r.amount, kind: r.kind })), payments: paymentRows,
    ...(original.deliveryCharge !== undefined ? {deliveryCharge:original.deliveryCharge} : {}),
    ...(original.creditEntries ? {creditEntries:original.creditEntries.map(c=>({id:c.id,sourceSaleId:c.sourceSaleId,reference:c.reference,signedAmountPence:c.signedAmountPence,at:c.at}))} : {}),
    ...(original.returnCreditPence !== undefined ? {returnCreditPence:original.returnCreditPence} : {}),
    ...(f ? { fulfilment: { method: f.method, viewed: f.viewed, address: f.address, recipient: f.recipient, phone: f.phone, scheduledDate: f.scheduledDate, timeWindow: f.timeWindow, instructions: '',
      ...(f.completedAt ? { completedAt: f.completedAt, completedRecipient: f.completedRecipient } : {}) } } : {}) };
  return copy({ id: document.id, number: document.number, type: document.type, title: document.title, ...(document.invoiceKind ? { invoiceKind: document.invoiceKind } : {}), issuedAt: document.issuedAt, issuedBy: '', version: document.version, ...(document.content ? { content: document.content } : {}),
    ...(document.templateVersion ? { templateVersion: document.templateVersion } : {}),
    ...(document.transaction ? { transaction: copy(document.transaction) } : {}),
    ...(document.paymentId ? { paymentId: document.paymentId, paymentAmountPence: document.paymentAmountPence } : {}), balanceAtIssue: document.balanceAtIssue,
    ...(document.verification ? { verification: { url: document.verification.url } } : {}),
    snapshot: { draft, payments: paymentRows, totals: { price: document.snapshot.totals.price, allowance: document.snapshot.totals.allowance, adjustments: document.snapshot.totals.adjustments, totalDue: document.snapshot.totals.totalDue, deposit: document.snapshot.totals.deposit, confirmedPaid: document.snapshot.totals.confirmedPaid, pending: document.snapshot.totals.pending, balance: document.snapshot.totals.balance }, branding: saleWorkspaceBranding(document.snapshot.branding), ...(customerVehicle ? { vehicle: customerVehicle } : {}) } });
}
