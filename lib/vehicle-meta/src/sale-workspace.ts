import { invoiceBranding, type SalesPaperwork } from './invoice-settings.ts';
/** Shared sale ledger contract and deterministic business rules. No payment processor is called here. */
export type SaleWorkspaceExchange = { registration: string; description: string; value: string };
export type SaleWorkspaceAdjustment = { description: string; amount: string; kind: 'fee' | 'discount' };
export type SaleWorkspacePaymentKind = 'deposit' | 'part-payment' | 'final-payment' | 'refund' | 'reversal' | 'refund-correction';
export type SaleWorkspacePayment = {
  id: string; amount: string; amountPence: number; signedAmountPence: number;
  method: string; date: string; expectedDate?: string; reference: string; kind: SaleWorkspacePaymentKind;
  status: 'pending' | 'confirmed' | 'cancelled'; recordedBy: string; recordedAt: string;
  receiptId?: string; reversesPaymentId?: string; reason?: string;
};
export type SaleWorkspaceFulfilment = {
  method: 'collection' | 'delivery'; viewed: 'not-yet-viewed' | 'viewed';
  address: string; recipient: string; phone: string; scheduledDate: string;
  timeWindow: string; instructions: string; completedAt?: string; completedBy?: string;
  completedRecipient?: string;
};
export type SaleWorkspaceDraft = {
  id: string; customer: string; email: string; phone: string; address: string;
  vehicleId: string; vehicle: string; registration: string; price: string;
  partExchange: boolean; pxRegistration: string; pxDescription: string; pxValue: string;
  deposit: string; paymentMethod: string; notes: string; collection: string;
  preparation: boolean; documents: boolean; handover: boolean;
  exchanges?: SaleWorkspaceExchange[]; payments?: SaleWorkspacePayment[];
  adjustments?: SaleWorkspaceAdjustment[]; customerSource?: string;
  sourceEnquiryId?: string; sourceReservationId?: string;
  appointment?: { at: string; status: string };
  fulfilment?: SaleWorkspaceFulfilment;
};
export type SaleWorkspaceTotals = {
  price: number; allowance: number; adjustments: number; totalDue: number;
  deposit: number; confirmedPaid: number; pending: number; balance: number;
};
export type SaleWorkspaceBranding = {
  identity: { name: string; logoText: string; logoAsset: string; brandColors?: { primaryHsl: string; accentHsl: string } };
  contact: { phone: string; email: string; whatsapp?: string };
  address: { street: string; city: string; region: string; postcode: string; mapsUrl?: string };
  legal: { companyName: string; companyNumber: string; vatNumber: string; termsUrl?: string; privacyUrl?: string; cookieUrl?: string };
  presentation?: { linkColour?: string };
};
export type SaleWorkspaceVehicleSnapshot = { id?: string; title?: string; year?: number | null; fuel?: string | null; transmission?: string | null; mileage?: number | null; colour?: string | null; owners?: number | null; writeOffCategory?: string | null; serviceHistory?: string | null; description?: string | null };
export type SaleWorkspaceDocument = {
  id: string; number: string; type: 'invoice' | 'statement' | 'receipt' | 'handover' | 'terms' | 'reservation' | 'vehicle-details';
  title: string; issuedAt: string; issuedBy: string; version: number;
  paymentId?: string; paymentAmountPence?: number; balanceAtIssue: number;
  content?: string;
  snapshot: { draft: SaleWorkspaceDraft; payments: SaleWorkspacePayment[]; totals: SaleWorkspaceTotals; branding: SaleWorkspaceBranding; vehicle?: SaleWorkspaceVehicleSnapshot };
};
export type SaleWorkspaceEvent = { id: string; type: string; description: string; occurredAt: string; actor: string };
export type SaleWorkspaceRecord = {
  id: string; reference: string; revision: number; draft: SaleWorkspaceDraft;
  payments: SaleWorkspacePayment[]; documents: SaleWorkspaceDocument[]; events: SaleWorkspaceEvent[];
  createdAt: string; updatedAt: string;
  /** Server-private retry records. Responses omit these entries. */
  requests?: Record<string, { fingerprint: string; documentId?: string }>;
  completedAt?: string; packDocumentIds?: string[];
  lifecycle?: { status: "draft" | "reserved" | "sold" | "released"; vehicleId: string; changedAt: string };
  customerAccess?: { tokenHash: string; expiresAt: string; revokedAt?: string };
  documentArchives?: Record<string, { content: string; sha256: string }>;
  emailDeliveries?: Array<{ id: string; documentId: string; to: string; status: "prepared" | "sending" | "sent" | "failed"; attemptedAt: string; sentAt?: string; error?: string; providerId?: string }>;
  customerLinkEmail?: { id: string; to: string; status: "prepared" | "sending" | "sent" | "failed"; attemptedAt: string; sentAt?: string; error?: string };
  providerPayments?: Record<string, { paymentId: string; eventId: string; refundEvents?: Record<string, { amountRefundedPence: number }> }>;
};
export type SaleWorkspaceMutation = { sale: SaleWorkspaceRecord; document?: SaleWorkspaceDocument; replayed?: boolean; preview?: boolean };
export type SaleWorkspacePaymentInput = { amount: string; method: string; date: string; reference: string; kind: 'deposit' | 'part-payment' | 'final-payment'; status: 'pending' | 'confirmed' };
export type SaleWorkspaceCommand =
  | { action: 'update'; draft: SaleWorkspaceDraft }
  | { action: 'payment'; payment: SaleWorkspacePaymentInput }
  | { action: 'take-deposit'; payment: SaleWorkspacePaymentInput }
  | { action: 'complete-sale'; acknowledge: boolean }
  | { action: 'confirm'; paymentId: string; date?: string; reserveVehicle?: boolean }
  | { action: 'reverse'; paymentId: string; amount?: string; kind?: 'refund' | 'reversal'; reason: string; date: string }
  /** Internal provider reconciliation; there is no staff API for this command. */
  | { action: 'provider-refund-correction'; paymentId: string; amount: string; reason: string; date: string }
  | { action: 'document'; type: 'invoice' | 'statement' }
  | { action: 'lifecycle'; status: 'reserved' | 'sold' | 'released' }
  | { action: 'customer-link'; tokenHash: string; expiresAt: string }
  | { action: 'customer-revoke' }
  | { action: 'link-email-status'; delivery: NonNullable<SaleWorkspaceRecord['customerLinkEmail']> }
  | { action: 'email-status'; delivery: NonNullable<SaleWorkspaceRecord['emailDeliveries']>[number] }
  | { action: 'handover'; recipient: string; completedAt?: string; acknowledgeOutstanding?: boolean };
export type SaleWorkspaceContext = {
  now: string; actor: string; nextId: () => string;
  nextNumber: (type: SaleWorkspaceDocument['type']) => string;
  branding: SaleWorkspaceBranding; vehicle?: SaleWorkspaceVehicleSnapshot;
  paperwork?: SalesPaperwork;
};

export class SaleWorkspaceError extends Error {
  status: number;
  constructor(message: string, status = 422) { super(message); this.name = 'SaleWorkspaceError'; this.status = status; }
}

export function saleWorkspacePence(value: string): number {
  if (!value.trim()) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return NaN;
  const [pounds, pennies = ''] = value.trim().split('.');
  const result = Number(pounds) * 100 + Number(pennies.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : NaN;
}

export function saleWorkspaceTotals(draft: SaleWorkspaceDraft, ledger = draft.payments ?? []): SaleWorkspaceTotals {
  const price = saleWorkspacePence(draft.price);
  const exchangeRows = draft.exchanges ?? (draft.partExchange ? [{ registration: draft.pxRegistration, description: draft.pxDescription, value: draft.pxValue }] : []);
  const allowance = exchangeRows.reduce((sum, row) => sum + saleWorkspacePence(row.value), 0);
  const adjustments = (draft.adjustments ?? []).reduce((sum, row) => sum + saleWorkspacePence(row.amount) * (row.kind === 'discount' ? -1 : 1), 0);
  const confirmedPaid = ledger.filter(row => row.status === 'confirmed').reduce((sum, row) => sum + row.signedAmountPence, 0);
  const pending = ledger.filter(row => row.status === 'pending').reduce((sum, row) => sum + row.amountPence, 0);
  const totalDue = price + adjustments - allowance;
  return { price, allowance, adjustments, totalDue, deposit: confirmedPaid, confirmedPaid, pending, balance: totalDue - confirmedPaid };
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function text(value: unknown, limit: number, name: string): string {
  if (typeof value !== 'string' || value.length > limit) throw new SaleWorkspaceError(`Check ${name}.`);
  return value.trim();
}
function validDate(value: unknown): string {
  const date = text(value, 10, 'the payment date');
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new SaleWorkspaceError('Choose a valid payment date.');
  return date;
}
function receivedDate(value: unknown, now: string): string {
  const date = validDate(value);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  if (date > today) throw new SaleWorkspaceError('A received payment or refund cannot have a future date.');
  return date;
}
function positiveMoney(value: unknown): { amount: string; amountPence: number } {
  const amount = text(value, 16, 'the amount');
  const amountPence = saleWorkspacePence(amount);
  if (!Number.isSafeInteger(amountPence) || amountPence <= 0) throw new SaleWorkspaceError('Enter an amount greater than zero, with no more than two decimal places.');
  return { amount: (amountPence / 100).toFixed(2), amountPence };
}
function requestKey(value: unknown): string {
  const key = text(value, 128, 'the request reference');
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new SaleWorkspaceError('A unique request reference is required.');
  return key;
}
export function saleWorkspaceFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(saleWorkspaceFingerprint).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${saleWorkspaceFingerprint((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function cleanSaleWorkspaceDraft(input: unknown, reference: string, ledger: SaleWorkspacePayment[] = [], previous?: SaleWorkspaceDraft): SaleWorkspaceDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SaleWorkspaceError('Check the sale details.');
  const source = input as Record<string, unknown>;
  const fields: Array<[string, number]> = [['customer', 200], ['email', 320], ['phone', 80], ['address', 2000], ['vehicleId', 128], ['vehicle', 1000], ['registration', 32], ['price', 16], ['pxRegistration', 32], ['pxDescription', 1000], ['pxValue', 16], ['paymentMethod', 100], ['notes', 12000], ['collection', 80], ['customerSource', 200], ['sourceEnquiryId', 128], ['sourceReservationId', 128]];
  const draft = Object.fromEntries(fields.map(([name, limit]) => [name, text(source[name] ?? '', limit, name)])) as unknown as SaleWorkspaceDraft;
  if (previous && (previous.sourceEnquiryId || previous.sourceReservationId)) {
    draft.sourceEnquiryId = previous.sourceEnquiryId; draft.sourceReservationId = previous.sourceReservationId;
  }
  if (previous?.appointment) draft.appointment = clone(previous.appointment);
  draft.id = reference; draft.deposit = ''; draft.partExchange = source.partExchange === true;
  draft.preparation = source.preparation === true; draft.documents = source.documents === true;
  // Only the explicit handover command can complete a sale or change its completion evidence.
  draft.handover = previous?.handover ?? false;
  const array = (name: string, limit: number) => {
    const value = source[name] ?? [];
    if (!Array.isArray(value) || value.length > limit) throw new SaleWorkspaceError(`Check ${name}.`);
    return value as Record<string, unknown>[];
  };
  draft.exchanges = array('exchanges', 3).map(row => ({ registration: text(row.registration ?? '', 32, 'part-exchange registration').toUpperCase(), description: text(row.description ?? '', 1000, 'part-exchange description'), value: text(row.value ?? '', 16, 'part-exchange value') }));
  if (!source.exchanges && draft.partExchange) draft.exchanges = [{ registration: draft.pxRegistration, description: draft.pxDescription, value: draft.pxValue }];
  draft.adjustments = array('adjustments', 100).map(row => {
    if (row.kind !== 'fee' && row.kind !== 'discount') throw new SaleWorkspaceError('Choose fee or discount.');
    return { description: text(row.description ?? '', 300, 'fee or discount description'), amount: text(row.amount ?? '', 16, 'fee or discount amount'), kind: row.kind };
  });
  if (source.fulfilment) {
    if (typeof source.fulfilment !== 'object' || Array.isArray(source.fulfilment)) throw new SaleWorkspaceError('Check the handover arrangements.');
    const fulfilment = source.fulfilment as Record<string, unknown>;
    if (!['collection', 'delivery'].includes(String(fulfilment.method)) || !['not-yet-viewed', 'viewed'].includes(String(fulfilment.viewed))) throw new SaleWorkspaceError('Choose collection or delivery and the viewing status.');
    draft.fulfilment = {
      method: fulfilment.method as SaleWorkspaceFulfilment['method'], viewed: fulfilment.viewed as SaleWorkspaceFulfilment['viewed'],
      address: text(fulfilment.address ?? '', 2000, 'delivery address'), recipient: text(fulfilment.recipient ?? '', 200, 'recipient'), phone: text(fulfilment.phone ?? '', 80, 'delivery phone'),
      scheduledDate: text(fulfilment.scheduledDate ?? '', 10, 'handover date'), timeWindow: text(fulfilment.timeWindow ?? '', 100, 'time window'), instructions: text(fulfilment.instructions ?? '', 2000, 'delivery instructions'),
    };
    if (draft.fulfilment.scheduledDate) validDate(draft.fulfilment.scheduledDate);
  } else draft.fulfilment = previous?.fulfilment ?? { method: 'collection', viewed: 'not-yet-viewed', address: '', recipient: '', phone: '', scheduledDate: draft.collection.slice(0, 10), timeWindow: '', instructions: '' };
  if (previous?.fulfilment?.completedAt) draft.fulfilment = clone(previous.fulfilment);
  draft.payments = clone(ledger);
  const totals = saleWorkspaceTotals(draft, ledger);
  if (Object.values(totals).some(value => !Number.isSafeInteger(value))) throw new SaleWorkspaceError('Enter valid amounts with no more than two decimal places.');
  const previousBalance = previous ? saleWorkspaceTotals(previous, ledger).balance : 0;
  // A failed provider refund can restore funds after a buyer paid again. Keep that credit accurate,
  // and allow staff to correct the sale without creating or increasing an overpayment by editing.
  if (totals.totalDue < 0 || (totals.balance < 0 && (!previous || totals.balance < previousBalance))) throw new SaleWorkspaceError('Part exchanges, discounts and confirmed payments cannot exceed the sale total.');
  if (draft.exchanges.some(row => !row.registration || !Number.isSafeInteger(saleWorkspacePence(row.value)))) throw new SaleWorkspaceError('Give each part exchange a registration and valid value.');
  if (draft.adjustments.some(row => !row.description || !(saleWorkspacePence(row.amount) > 0))) throw new SaleWorkspaceError('Give each fee or discount a description and positive amount.');
  return draft;
}

function ready(record: SaleWorkspaceRecord) {
  if (!record.draft.customer || !record.draft.vehicle || !(saleWorkspaceTotals(record.draft, record.payments).price > 0)) throw new SaleWorkspaceError('Add the customer, vehicle and agreed price before recording a payment or issuing documents.');
}
function event(record: SaleWorkspaceRecord, context: SaleWorkspaceContext, type: string, description: string) {
  record.events.push({ id: context.nextId(), type, description, occurredAt: context.now, actor: context.actor });
}
function issueDocument(record: SaleWorkspaceRecord, context: SaleWorkspaceContext, type: SaleWorkspaceDocument['type'], title: string, payment?: SaleWorkspacePayment): SaleWorkspaceDocument {
  const amount = saleWorkspaceTotals(record.draft, record.payments);
  // A car can leave the current feed before the final payment. Reuse only facts already issued for that same vehicle.
  const vehicle = context.vehicle ?? [...record.documents].reverse().find(item => item.snapshot.vehicle?.id === record.draft.vehicleId)?.snapshot.vehicle;
  const document: SaleWorkspaceDocument = {
    id: context.nextId(), number: context.nextNumber(type), type, title, issuedAt: context.now, issuedBy: context.actor,
    version: record.documents.filter(item => item.type === type).length + 1,
    ...(payment ? { paymentId: payment.id, paymentAmountPence: payment.signedAmountPence } : {}),
    balanceAtIssue: amount.balance,
    ...(type === 'invoice' && context.paperwork?.saleTerms.trim() ? { content: context.paperwork.saleTerms.trim() } : {}),
    snapshot: clone({ draft: { ...record.draft, payments: record.payments }, payments: record.payments, totals: amount, branding: invoiceBranding(context.branding, context.paperwork?.invoiceDetails), ...(vehicle ? { vehicle } : {}) }),
  };
  if (payment) { payment.receiptId = document.id; document.snapshot.payments.find(row => row.id === payment.id)!.receiptId = document.id; document.snapshot.draft.payments = clone(document.snapshot.payments); }
  record.documents.push(document);
  event(record, context, 'document-issued', `${title} ${document.number} issued`);
  return document;
}
function receipt(record: SaleWorkspaceRecord, context: SaleWorkspaceContext, payment: SaleWorkspacePayment): SaleWorkspaceDocument {
  const titles: Record<SaleWorkspacePaymentKind, string> = { deposit: 'Deposit receipt', 'part-payment': 'Payment receipt', 'final-payment': 'Final payment receipt', refund: 'Refund receipt', reversal: 'Payment reversal', 'refund-correction': 'Refund correction receipt' };
  return issueDocument(record, context, 'receipt', titles[payment.kind], payment);
}
function confirmable(record: SaleWorkspaceRecord, payment: SaleWorkspacePayment) {
  const balance = saleWorkspaceTotals(record.draft, record.payments).balance;
  if (payment.amountPence > balance) throw new SaleWorkspaceError('This payment exceeds the outstanding balance.');
  if (payment.kind === 'final-payment' && payment.amountPence !== balance) throw new SaleWorkspaceError('A final payment must settle the outstanding balance. Choose part payment for a smaller amount.');
}

export function createSaleWorkspace(input: { draft: unknown; requestId: string }, context: SaleWorkspaceContext, reference: string): SaleWorkspaceMutation {
  const key = requestKey(input.requestId);
  const record: SaleWorkspaceRecord = { id: context.nextId(), reference, revision: 1, draft: cleanSaleWorkspaceDraft(input.draft, reference), payments: [], documents: [], events: [], createdAt: context.now, updatedAt: context.now, requests: { [key]: { fingerprint: saleWorkspaceFingerprint({ action: 'create', draft: input.draft }) } } };
  event(record, context, 'sale-created', 'Sale file created');
  return { sale: record };
}

export function changeSaleWorkspace(current: SaleWorkspaceRecord, command: SaleWorkspaceCommand, input: { expectedRevision: number; requestId: string }, context: SaleWorkspaceContext): SaleWorkspaceMutation {
  const key = requestKey(input.requestId);
  const fingerprint = saleWorkspaceFingerprint(command);
  const previousRequest = current.requests?.[key];
  if (previousRequest) {
    if (previousRequest.fingerprint !== fingerprint) throw new SaleWorkspaceError('This request reference has already been used for different details.', 409);
    return { sale: current, ...(previousRequest.documentId ? { document: current.documents.find(document => document.id === previousRequest.documentId) } : {}), replayed: true };
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== current.revision) throw new SaleWorkspaceError('This sale changed on another device. Reload it before saving.', 409);
  const record = clone(current);
  let document: SaleWorkspaceDocument | undefined;
  if (command.action === 'update') {
    const updated = cleanSaleWorkspaceDraft(command.draft, record.reference, record.payments, record.draft);
    if (record.completedAt && ['customer','email','phone','address','vehicleId','vehicle','registration','price','exchanges','adjustments'].some(key => JSON.stringify(updated[key as keyof SaleWorkspaceDraft]) !== JSON.stringify(record.draft[key as keyof SaleWorkspaceDraft]))) throw new SaleWorkspaceError('Completed sale details are locked. Use payment corrections and retain the issued invoice.', 409);
    if (record.lifecycle && ['reserved', 'sold'].includes(record.lifecycle.status) && updated.vehicleId !== record.draft.vehicleId) throw new SaleWorkspaceError('Release the sale reservation before changing its vehicle.', 409);
    if (record.customerAccess && (updated.customer !== record.draft.customer || updated.email !== record.draft.email || updated.vehicleId !== record.draft.vehicleId)) record.customerAccess.revokedAt = context.now;
    record.draft = updated;
    event(record, context, 'sale-updated', 'Sale details updated');
  } else if (command.action === 'lifecycle') {
    ready(record);
    if (!['reserved', 'sold', 'released'].includes(command.status)) throw new SaleWorkspaceError('Choose a valid stock action.');
    if (record.lifecycle?.status === 'sold' && command.status !== 'sold') throw new SaleWorkspaceError('A sold vehicle cannot be released from this sale.', 409);
    if (command.status === 'released' && saleWorkspaceTotals(record.draft, record.payments).confirmedPaid !== 0) throw new SaleWorkspaceError('Record the refund or payment correction before releasing this reservation.', 409);
    if (command.status === 'released' && record.lifecycle?.status !== 'reserved') throw new SaleWorkspaceError('Only a car reserved by this sale can be released.', 409);
    record.lifecycle = { status: command.status, vehicleId: record.draft.vehicleId, changedAt: context.now };
    event(record, context, 'stock-' + command.status, command.status === 'released' ? 'Vehicle reservation released' : 'Vehicle marked ' + command.status);
  } else if (command.action === 'customer-link') {
    ready(record);
    if (!/^[a-f0-9]{64}$/.test(command.tokenHash) || !Number.isFinite(Date.parse(command.expiresAt)) || Date.parse(command.expiresAt) <= Date.parse(context.now) || Date.parse(command.expiresAt) > Date.parse(context.now) + 90 * 86400000) throw new SaleWorkspaceError('Choose an access duration between one and 90 days.');
    record.customerAccess = { tokenHash: command.tokenHash, expiresAt: command.expiresAt };
    delete record.customerLinkEmail;
    event(record, context, 'customer-link-created', 'Private customer link created; any previous link replaced');
  } else if (command.action === 'customer-revoke') {
    if (record.customerAccess) record.customerAccess.revokedAt = context.now;
    event(record, context, 'customer-link-revoked', 'Private customer access revoked');
  } else if (command.action === 'link-email-status') {
    if (command.delivery.status === 'sending' && (!record.customerAccess || record.customerAccess.revokedAt || Date.parse(record.customerAccess.expiresAt) <= Date.parse(context.now))) throw new SaleWorkspaceError('Create an active customer link first.', 409);
    record.customerLinkEmail = clone(command.delivery);
    event(record, context, 'customer-link-email-' + command.delivery.status, 'Customer link email ' + command.delivery.status);
  } else if (command.action === 'email-status') {
    if (!record.documents.some(item => item.id === command.delivery?.documentId)) throw new SaleWorkspaceError('Document not found.', 404);
    const rows = record.emailDeliveries ??= [];
    const index = rows.findIndex(row => row.id === command.delivery.id);
    if (index < 0) rows.push(clone(command.delivery)); else rows[index] = clone(command.delivery);
    event(record, context, 'document-email-' + command.delivery.status, 'Document email ' + command.delivery.status);
  } else if (command.action === 'payment' || command.action === 'take-deposit') {
    ready(record);
    if (command.action === 'take-deposit') {
      if (record.completedAt || record.lifecycle?.status === 'sold') throw new SaleWorkspaceError('This sale is already completed.', 409);
      if (command.payment?.kind !== 'deposit' || command.payment?.status !== 'confirmed') throw new SaleWorkspaceError('Confirm a received deposit to reserve this car.');
      if (!context.paperwork?.reservationTerms.trim()) throw new SaleWorkspaceError('Add approved reservation terms in Settings → Invoice first.');
    }
    const { amount, amountPence } = positiveMoney(command.payment?.amount);
    if (!['pending', 'confirmed'].includes(command.payment?.status) || !['deposit', 'part-payment', 'final-payment'].includes(command.payment?.kind)) throw new SaleWorkspaceError('Check the payment type and status.');
    const method = text(command.payment.method, 100, 'the payment method');
    if (!method) throw new SaleWorkspaceError('Choose the payment method.');
    const payment: SaleWorkspacePayment = { id: context.nextId(), amount, amountPence, signedAmountPence: amountPence, method, date: command.payment.status === 'confirmed' ? receivedDate(command.payment.date, context.now) : validDate(command.payment.date), reference: text(command.payment.reference ?? '', 200, 'the payment reference'), kind: command.payment.kind, status: command.payment.status, recordedAt: context.now, recordedBy: context.actor };
    if (payment.status === 'pending') payment.expectedDate = payment.date;
    confirmable(record, payment);
    record.payments.push(payment);
    event(record, context, 'payment-recorded', `${payment.status === 'pending' ? 'Pending' : 'Confirmed'} ${payment.kind.replaceAll('-', ' ')}: £${amount} (${payment.date})`);
    if (payment.status === 'confirmed') document = receipt(record, context, payment);
    if (command.action === 'take-deposit') {
      record.lifecycle = { status: 'reserved', vehicleId: record.draft.vehicleId, changedAt: context.now };
      const agreement = issueDocument(record, context, 'reservation', 'Reservation agreement');
      agreement.content = context.paperwork!.reservationTerms.trim();
      const statement = issueDocument(record, context, 'statement', 'Deposit balance statement');
      record.packDocumentIds = [document!.id, agreement.id, statement.id];
      event(record, context, 'deposit-reserved', 'Deposit received; vehicle reserved for this customer');
    }
  } else if (command.action === 'confirm') {
    ready(record);
    const payment = record.payments.find(row => row.id === command.paymentId);
    if (!payment || payment.status !== 'pending') throw new SaleWorkspaceError('Only a pending payment can be confirmed.', 409);
    if (command.reserveVehicle) {
      if (payment.kind !== 'deposit' || record.completedAt || record.lifecycle?.status === 'sold') throw new SaleWorkspaceError('Only an active sale deposit can reserve this car.', 409);
      if (!context.paperwork?.reservationTerms.trim()) throw new SaleWorkspaceError('Add approved reservation terms in Settings → Invoice first.');
    }
    confirmable(record, payment); payment.status = 'confirmed'; payment.date = receivedDate(command.date ?? payment.date, context.now); payment.recordedBy = context.actor; payment.recordedAt = context.now;
    event(record, context, 'payment-confirmed', `Payment confirmed: £${payment.amount}`);
    document = receipt(record, context, payment);
    if (command.reserveVehicle) {
      record.lifecycle = { status: 'reserved', vehicleId: record.draft.vehicleId, changedAt: context.now };
      const agreement = issueDocument(record, context, 'reservation', 'Reservation agreement');
      agreement.content = context.paperwork!.reservationTerms.trim();
      const statement = issueDocument(record, context, 'statement', 'Deposit balance statement');
      record.packDocumentIds = [document.id, agreement.id, statement.id];
      event(record, context, 'deposit-reserved', 'Deposit received; vehicle reserved for this customer');
    }
  } else if (command.action === 'reverse') {
    const original = record.payments.find(row => row.id === command.paymentId);
    if (!original || original.status === 'cancelled' || original.signedAmountPence <= 0 || original.kind === 'refund-correction') throw new SaleWorkspaceError('Choose an active original payment.', 409);
    const reason = text(command.reason, 1000, 'the correction reason');
    if (!reason) throw new SaleWorkspaceError('Add a reason for the refund, reversal or cancellation.');
    const date = receivedDate(command.date, context.now);
    if (original.status === 'pending') { original.status = 'cancelled'; original.reason = reason; event(record, context, 'pending-cancelled', `Pending payment cancelled: ${reason}`); }
    else {
      const refunded = -record.payments.filter(row => row.reversesPaymentId === original.id && row.status === 'confirmed').reduce((sum, row) => sum + row.signedAmountPence, 0);
      const remaining = original.amountPence - refunded;
      if (remaining <= 0) throw new SaleWorkspaceError('This payment has already been fully reversed or refunded.', 409);
      const { amount, amountPence } = command.amount === undefined ? { amount: (remaining / 100).toFixed(2), amountPence: remaining } : positiveMoney(command.amount);
      if (amountPence > remaining) throw new SaleWorkspaceError('The correction cannot exceed the remaining amount of this payment.');
      if (command.kind && !['refund', 'reversal'].includes(command.kind)) throw new SaleWorkspaceError('Choose refund or reversal.');
      const payment: SaleWorkspacePayment = { id: context.nextId(), amount, amountPence, signedAmountPence: -amountPence, method: original.method, date, reference: original.reference, kind: command.kind ?? 'refund', status: 'confirmed', recordedAt: context.now, recordedBy: context.actor, reversesPaymentId: original.id, reason };
      record.payments.push(payment); event(record, context, 'payment-corrected', `${payment.kind}: £${amount}. ${reason}`); document = receipt(record, context, payment);
    }
  } else if (command.action === 'provider-refund-correction') {
    const original = record.payments.find(row => row.id === command.paymentId);
    if (!original || original.status !== 'confirmed' || original.kind !== 'deposit' || !Object.values(record.providerPayments ?? {}).some(provider => provider.paymentId === original.id)) throw new SaleWorkspaceError('Choose the confirmed provider deposit for this refund correction.', 409);
    const reason = text(command.reason, 1000, 'the refund correction reason');
    if (!reason) throw new SaleWorkspaceError('Add the provider refund correction reason.');
    const { amount, amountPence } = positiveMoney(command.amount);
    const refunded = -record.payments.filter(row => row.reversesPaymentId === original.id && row.status === 'confirmed').reduce((sum, row) => sum + row.signedAmountPence, 0);
    if (amountPence > refunded) throw new SaleWorkspaceError('The refund correction cannot exceed the recorded net refund.');
    const payment: SaleWorkspacePayment = { id: context.nextId(), amount, amountPence, signedAmountPence: amountPence, method: original.method, date: receivedDate(command.date, context.now), reference: original.reference, kind: 'refund-correction', status: 'confirmed', recordedAt: context.now, recordedBy: context.actor, reversesPaymentId: original.id, reason };
    // Restore confirmed funds even if later payments create a customer credit. This is a correction
    // of an external fact, never a new charge, and every prior receipt remains immutable.
    record.payments.push(payment); event(record, context, 'refund-status-corrected', `Refund correction: £${amount}. ${reason}`); document = receipt(record, context, payment);
  } else if (command.action === 'document') {
    ready(record);
    if (!['invoice', 'statement'].includes(command.type)) throw new SaleWorkspaceError('Choose an invoice or statement.');
    document = issueDocument(record, context, command.type, command.type === 'invoice' ? 'Sales invoice' : 'Balance statement');
  } else if (command.action === 'complete-sale') {
    ready(record);
    if (record.completedAt) throw new SaleWorkspaceError('This sale is already completed. Reopen its saved documents.', 409);
    if (command.acknowledge !== true) throw new SaleWorkspaceError('Review and confirm the customer, vehicle, payments and terms.');
    if (saleWorkspaceTotals(record.draft, record.payments).balance !== 0) throw new SaleWorkspaceError('Record the remaining payment or resolve the customer credit before completing this sale.');
    if (!context.paperwork?.saleTerms.trim()) throw new SaleWorkspaceError('Add approved terms of sale in Settings → Invoice first.');
    const f = record.draft.fulfilment;
    if (f?.method === 'delivery' && !f.address.trim()) throw new SaleWorkspaceError('Enter the delivery address before completing this sale.');
    const invoice = issueDocument(record, context, 'invoice', 'Sales invoice');
    const terms = issueDocument(record, context, 'terms', 'Terms and conditions of sale');
    terms.content = context.paperwork.saleTerms.trim();
    const details = issueDocument(record, context, 'vehicle-details', 'Vehicle details and disclosures');
    record.packDocumentIds = [invoice.id, ...record.documents.filter(d => d.type === 'receipt').map(d => d.id), terms.id, details.id];
    record.completedAt = context.now;
    record.lifecycle = { status: 'sold', vehicleId: record.draft.vehicleId, changedAt: context.now };
    document = invoice;
    event(record, context, 'sale-completed', 'Sale completed; invoice and document pack issued; vehicle removed from public stock');
  } else if (command.action === 'handover') {
    ready(record);
    if (record.draft.fulfilment?.completedAt) throw new SaleWorkspaceError('Handover is already recorded.', 409);
    const balance = saleWorkspaceTotals(record.draft, record.payments).balance;
    if (balance > 0 && command.acknowledgeOutstanding !== true) throw new SaleWorkspaceError('An outstanding balance remains. Explicitly acknowledge it before recording handover.', 409);
    const recipient = text(command.recipient, 200, 'the handover recipient');
    if (!recipient) throw new SaleWorkspaceError('Enter who received the vehicle.');
    const fulfilment = record.draft.fulfilment!;
    if (fulfilment.method === 'delivery' && !fulfilment.address) throw new SaleWorkspaceError('Add the delivery address before recording delivery.');
    const completedAt = command.completedAt ?? context.now;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(completedAt) || !Number.isFinite(new Date(completedAt).getTime())) throw new SaleWorkspaceError('Choose a valid handover time.');
    if (new Date(completedAt).getTime() > new Date(context.now).getTime()) throw new SaleWorkspaceError('Handover cannot be recorded for a future time.');
    record.draft.fulfilment = { ...fulfilment, completedAt: new Date(completedAt).toISOString(), completedBy: context.actor, completedRecipient: recipient };
    record.draft.handover = true;
    event(record, context, 'handover-completed', `${fulfilment.method === 'delivery' ? 'Delivered' : 'Collected'} by ${recipient}${balance ? ' with an acknowledged outstanding balance' : ''}`);
    document = issueDocument(record, context, 'handover', fulfilment.method === 'delivery' ? 'Delivery confirmation' : 'Collection confirmation');
  } else throw new SaleWorkspaceError('Unknown sale action.', 400);
  record.revision += 1; record.updatedAt = context.now; record.draft.payments = clone(record.payments);
  (record.requests ??= {})[key] = { fingerprint, ...(document ? { documentId: document.id } : {}) };
  return { sale: record, ...(document ? { document } : {}) };
}

export function publicSaleWorkspace(record: SaleWorkspaceRecord): SaleWorkspaceRecord {
  const { requests: _requests, documentArchives: _archives, providerPayments: _provider, customerAccess, ...publicRecord } = record;
  if (customerAccess) (publicRecord as SaleWorkspaceRecord).customerAccess = { tokenHash: "", expiresAt: customerAccess.expiresAt, ...(customerAccess.revokedAt ? { revokedAt: customerAccess.revokedAt } : {}) };
  return clone(publicRecord);
}

export function saleWorkspaceBranding(config: unknown): SaleWorkspaceBranding {
  const source = (config && typeof config === 'object' ? config : {}) as Record<string, any>;
  const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  return {
    identity: { name: clean(source.identity?.name), logoText: clean(source.identity?.logoText), logoAsset: clean(source.identity?.logoAsset), ...(source.identity?.brandColors ? { brandColors: { primaryHsl: clean(source.identity.brandColors.primaryHsl), accentHsl: clean(source.identity.brandColors.accentHsl) } } : {}) },
    contact: { phone: clean(source.contact?.phone), email: clean(source.contact?.email), whatsapp: clean(source.contact?.whatsapp) },
    address: { street: clean(source.address?.street), city: clean(source.address?.city), region: clean(source.address?.region), postcode: clean(source.address?.postcode), mapsUrl: clean(source.address?.mapsUrl) },
    legal: { companyName: clean(source.legal?.companyName), companyNumber: clean(source.legal?.companyNumber), vatNumber: clean(source.legal?.vatNumber), termsUrl: clean(source.legal?.termsUrl), privacyUrl: clean(source.legal?.privacyUrl), cookieUrl: clean(source.legal?.cookieUrl) },
    presentation: { linkColour: clean(source.presentation?.linkColour) },
  };
}
export function saleWorkspaceNumber(numbers: Record<string, number>, type: string, now: string): string {
  const year = now.slice(0, 4);
  const key = `${type}-${year}`;
  const sequence = (numbers[key] ?? 0) + 1;
  if (!Number.isSafeInteger(sequence)) throw new SaleWorkspaceError('The document number could not be allocated.', 500);
  numbers[key] = sequence;
  const prefixes: Record<string, string> = { sale: 'SALE', invoice: 'INV', statement: 'STM', receipt: 'RCP', handover: 'HND', terms: 'TERMS', reservation: 'RES', 'vehicle-details': 'VEH' };
  return `${prefixes[type] ?? type.toUpperCase()}-${year}-${String(sequence).padStart(5, '0')}`;
}
