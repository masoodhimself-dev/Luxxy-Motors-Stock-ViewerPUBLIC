import {
  createSaleWorkspace,
  saleWorkspaceTotals,
  saleWorkspacePence,
  SaleWorkspaceError,
  defaultInvoiceSettings,
  invoiceTextLimits,
  type SaleWorkspaceRecord,
  type SaleWorkspaceDocument,
  type SaleWorkspaceContext,
  type SaleWorkspaceDraft,
  type SaleWorkspaceEvent,
} from "./sale-workspace.ts";

export const salePaymentShareMethods = ['email', 'whatsapp', 'manual'] as const;
export type SalePaymentDefaults = {
  suggestedDepositPence: number | null;
  preferredShare: typeof salePaymentShareMethods[number];
};
export const defaultSalePaymentDefaults: SalePaymentDefaults = { suggestedDepositPence: null, preferredShare: 'email' };
export type SalePaymentDefaultsView = { paymentDefaults: SalePaymentDefaults; paymentInstructions: string };

export type SalePaymentRequest = {
  id: string;
  documentId: string;
  reference: string;
  kind: "deposit" | "balance" | "other";
  amountPence: number;
  dueDate: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  tokenHash: string;
  status: "active" | "cancelled" | "accepted";
  /** New requests are shared as documents; historical token links remain readable. */
  deliveryMode?: "document";
  sharedAt?: string;
  sharedBy?: string;
  sharedChannel?: 'whatsapp' | 'manual';
  acceptedAt?: string;
  acceptedBy?: string;
  acceptedAmountPence?: number;
  acceptedPaymentId?: string;
  agreement: string;
  baselinePaidPence: number;
  paymentReportedAt?: string;
  invoiceRequestedAt?: string;
};
export type SaleReviewIssue = {
  field: string;
  message: string;
  severity: "error" | "warning";
};
export type SaleFinalReview = {
  id: string;
  checkedAt: string;
  reviewedRevision: number;
  status: "passed" | "attention" | "unavailable" | "overridden";
  issues: SaleReviewIssue[];
  model?: string;
  summary: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Binds non-sale facts (vehicle, terms and delivery evidence) to the check. */
  contextHash?: string;
  override?: { actor: string; reason: string; at: string; ignoredReview?: Pick<SaleFinalReview, 'id' | 'status' | 'summary' | 'issues' | 'model' | 'checkedAt'> };
};
export type SaleReplacementProposal = {
  replacementVehicleId: string;
  replacementPrice: string;
  agreedCredit: string;
  reason: string;
  condition: string;
  mileage: number;
  financeConfirmed: true;
  acknowledge: true;
};
export type SaleReplacementReview = SaleFinalReview & {
  proposalKey: string;
  proposal: SaleReplacementProposal;
  /** Retry identity is retained with the proposal, never used as customer access. */
  requestId: string;
  requestFingerprint: string;
};
export const saleMoney = (pence: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    pence / 100,
  );
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function operationText(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || value.length > max)
    throw new SaleWorkspaceError(`Check ${label}.`);
  return value.trim();
}
export function operationMoney(
  value: unknown,
  label = "the amount",
  zero = false,
) {
  const amount = saleWorkspacePence(operationText(value, 16, label));
  if (!Number.isSafeInteger(amount) || amount < (zero ? 0 : 1))
    throw new SaleWorkspaceError(
      `Enter a valid ${label} with up to two decimal places.`,
    );
  return amount;
}
export function operationDate(value: unknown, label: string) {
  const text = operationText(value, 10, label),
    date = new Date(`${text}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  )
    throw new SaleWorkspaceError(`Choose a valid ${label}.`);
  return text;
}
export function operationRevision(
  record: SaleWorkspaceRecord,
  revision: unknown,
) {
  if (!Number.isSafeInteger(revision) || record.revision !== revision)
    throw new SaleWorkspaceError(
      "This deal changed. Reload it before continuing.",
      409,
    );
}
export function finishSaleOperation(
  record: SaleWorkspaceRecord,
  context: SaleWorkspaceContext,
  description: string,
  details?: Pick<SaleWorkspaceEvent, 'type' | 'documentId'>,
) {
  record.revision++;
  record.updatedAt = context.now;
  record.draft.payments = clone(record.payments);
  record.events.push({
    id: context.nextId(),
    type: "sale-operation",
    description,
    actor: context.actor,
    occurredAt: context.now,
    ...details,
  });
  return record;
}

export function saleDepositConfirmationShared(sale: SaleWorkspaceRecord, documentId: string) {
  return Boolean(sale.emailDeliveries?.some(row => row.documentId === documentId && row.status === 'sent') ||
    sale.events.some(event => event.type === 'deposit-confirmation-shared' && event.documentId === documentId));
}

/** This records an action staff took outside the portal. It never sends a message. */
export function markDepositConfirmationShared(
  record: SaleWorkspaceRecord,
  input: { documentId: unknown; acknowledge: unknown },
  context: SaleWorkspaceContext,
) {
  if (input.acknowledge !== true) throw new SaleWorkspaceError('Confirm that you already shared the receipt with the customer.');
  const document = record.documents.find(row => row.id === input.documentId && row.type === 'receipt');
  const deposit = document && record.payments.find(payment =>
    payment.receiptId === document.id && payment.id === document.paymentId && payment.kind === 'deposit' &&
    payment.status === 'confirmed' && payment.signedAmountPence > 0);
  if (!document || !deposit) throw new SaleWorkspaceError('This deposit receipt could not be found.', 404);
  if (record.lifecycle?.status === 'released' || record.lifecycle?.status === 'returned' ||
    record.standaloneReturn || record.returnReplacement?.direction === 'returned' ||
    record.payments.some(payment => payment.reversesPaymentId === deposit.id && payment.status === 'confirmed')) {
    throw new SaleWorkspaceError('This deposit confirmation is no longer current.', 409);
  }
  if (!saleDepositConfirmationShared(record, document.id)) {
    finishSaleOperation(record, context, `Deposit receipt ${document.number} marked as shared by staff`, {
      type: 'deposit-confirmation-shared',
      documentId: document.id,
    });
  }
}
export function operationDocument(
  record: SaleWorkspaceRecord,
  context: SaleWorkspaceContext,
  type: SaleWorkspaceDocument["type"],
  title: string,
  content: string,
): SaleWorkspaceDocument {
  const document: SaleWorkspaceDocument = {
    id: context.nextId(),
    number: context.nextNumber(type),
    type,
    ...(['invoice', 'statement', 'receipt', 'payment-request', 'credit-note', 'delivery-invoice'].includes(type) ? { templateVersion: 'sales-workspace-v2' as const } : {}),
    title,
    issuedAt: context.now,
    issuedBy: context.actor,
    version: 1,
    content,
    balanceAtIssue: saleWorkspaceTotals(record.draft, record.payments).balance,
    snapshot: {
      draft: clone(record.draft),
      payments: clone(record.payments),
      totals: saleWorkspaceTotals(record.draft, record.payments),
      branding: clone(context.branding),
      ...(context.vehicle ? { vehicle: clone(context.vehicle) } : {}),
    },
  };
  record.documents.push(document);
  return document;
}

export function saleCanRequestDeposit(record: SaleWorkspaceRecord) {
  return !record.completedAt && record.lifecycle?.status !== 'sold';
}

/** Requests never add a payment, reserve stock or imply a receipt. */
export function requestSalePayment(
  current: SaleWorkspaceRecord,
  input: {
    kind: unknown;
    amount: unknown;
    dueDate: unknown;
    note: unknown;
    paymentInstructions?: unknown;
    tokenHash?: string;
    expiresAt?: string;
  },
  context: SaleWorkspaceContext,
) {
  if (
    current.standaloneReturn ||
    current.lifecycle?.status === "returned" ||
    current.returnReplacement?.direction === "returned" ||
    current.lifecycle?.status === "released"
  )
    throw new SaleWorkspaceError(
      "This deal is closed. Open the current purchase before requesting payment.",
      409,
    );
  if (!current.draft.customer || !current.draft.vehicleId)
    throw new SaleWorkspaceError("Save the customer and vehicle first.");
  if (!["deposit", "balance", "other"].includes(String(input.kind)))
    throw new SaleWorkspaceError(
      "Choose deposit, balance or another agreed amount.",
    );
  if (input.kind === 'deposit' && !saleCanRequestDeposit(current))
    throw new SaleWorkspaceError('This car is already sold. Request the balance or another agreed payment.', 409);
  const record = clone(current),
    totals = saleWorkspaceTotals(record.draft, record.payments);
  const amountPence = operationMoney(input.amount),
    dueDate = operationDate(input.dueDate, "due date");
  if (amountPence > totals.balance)
    throw new SaleWorkspaceError(
      "The request cannot exceed the outstanding balance.",
    );
  if (
    (record.paymentRequests ?? []).some(
      (r) =>
        salePaymentRequestAvailable(record, r, context.now) &&
        salePaymentRequestRemaining(record, r) > 0,
    )
  )
    throw new SaleWorkspaceError(
      "Cancel or settle the current payment request before creating another.",
    );
  if (
    (record.paymentRequests ?? []).filter(
      (r) =>
        r.status === "active" &&
        Date.parse(r.expiresAt) > Date.parse(context.now),
    ).length >= 20
  )
    throw new SaleWorkspaceError(
      "Cancel an older payment request before creating another.",
    );
  const kind = input.kind as SalePaymentRequest["kind"],
    note = operationText(input.note ?? "", 1200, "the payment note");
  const paymentInstructions = input.paymentInstructions === undefined
    ? context.branding.invoiceSettings?.paymentInstructions ?? ''
    : operationText(input.paymentInstructions, invoiceTextLimits.paymentInstructions, 'the payment instructions');
  const paperworkContext = input.paymentInstructions === undefined ? context : {
    ...context,
    branding: {
      ...context.branding,
      invoiceSettings: { ...defaultInvoiceSettings, ...context.branding.invoiceSettings, paymentInstructions },
    },
  };
  const label =
    kind === "deposit"
      ? "Deposit"
      : kind === "balance"
        ? "Remaining balance"
        : "Agreed payment";
  const document = operationDocument(
    record,
    paperworkContext,
    "payment-request",
    kind === "deposit" ? "Deposit request" : "Payment request",
    `${label} requested: ${saleMoney(amountPence)}\nPayment reference: ${record.reference}\nDue date: ${dueDate}\n${note ? note + "\n" : ""}\nThis is a request for payment. It is not an invoice or confirmation that money has been received.\n${paymentInstructions || "Contact the dealership for payment instructions."}`,
  );
  document.transaction = { kind: 'payment-request', requestKind: kind, showSaleBreakdown: true, amountPence, dueDate, paymentReference: record.reference, saleReference: record.reference, ...(note ? { note } : {}) };
  const request: SalePaymentRequest = {
    id: context.nextId(),
    documentId: document.id,
    reference: document.number,
    kind,
    amountPence,
    dueDate,
    note,
    createdAt: context.now,
    expiresAt: input.expiresAt ?? "",
    tokenHash: input.tokenHash ?? "",
    ...(!input.tokenHash ? { deliveryMode: "document" as const } : {}),
    status: "active",
    agreement: salePaymentAgreement(record),
    baselinePaidPence: totals.confirmedPaid,
  };
  (record.paymentRequests ??= []).push(request);
  finishSaleOperation(
    record,
    context,
    `${label} request created for ${saleMoney(amountPence)}`,
  );
  return { sale: record, request, document };
}
/** A changed buyer/car/price/charge invalidates old links; ordinary received payments do not. */
export function salePaymentAgreement(record: SaleWorkspaceRecord) {
  const d = record.draft;
  return JSON.stringify([
    d.customer,
    d.email,
    d.phone,
    d.address,
    d.vehicleId,
    d.registration,
    d.price,
    d.adjustments,
    d.exchanges,
    d.deliveryCharge ?? "",
    d.creditEntries ?? [],
    d.returnCreditPence ?? 0,
    d.fulfilment?.recipient,
    d.fulfilment?.address,
    d.fulfilment?.phone,
  ]);
}
export function salePaymentRequestRemaining(
  record: SaleWorkspaceRecord,
  request: SalePaymentRequest,
) {
  if (request.status === 'accepted' || request.status === 'cancelled') return 0;
  const totals = saleWorkspaceTotals(record.draft, record.payments);
  const received = request.deliveryMode === 'document'
    ? record.payments.filter(payment => payment.paymentRequestId === request.id && payment.status === 'confirmed').reduce((sum, payment) => sum + payment.signedAmountPence, 0)
    : totals.confirmedPaid - (request.baselinePaidPence ?? totals.confirmedPaid);
  return Math.max(
    0,
    Math.min(
      totals.balance,
      request.amountPence -
        Math.max(0, received),
    ),
  );
}
export function salePaymentRequestAvailable(
  record: SaleWorkspaceRecord,
  request: SalePaymentRequest,
  now: string,
) {
  return (
    request.status === "active" &&
    (request.kind !== 'deposit' || saleCanRequestDeposit(record)) &&
    (request.deliveryMode === "document" || Date.parse(request.expiresAt) > Date.parse(now)) &&
    request.agreement === salePaymentAgreement(record) &&
    record.lifecycle?.status !== "released" &&
    record.lifecycle?.status !== "returned" &&
    !record.standaloneReturn &&
    record.returnReplacement?.direction !== "returned"
  );
}
export function saleDeterministicReview(
  record: SaleWorkspaceRecord,
  options: { allowCustomerCredit?: boolean } = {},
): SaleReviewIssue[] {
  const issues: SaleReviewIssue[] = [],
    d = record.draft,
    totals = saleWorkspaceTotals(d, record.payments);
  const error = (field: string, message: string) =>
    issues.push({ field, message, severity: "error" });
  const warn = (field: string, message: string) =>
    issues.push({ field, message, severity: "warning" });
  if (!d.customer.trim()) error("customer", "Add the customer name.");
  if (!d.vehicleId || !d.vehicle.trim())
    error("vehicle", "Choose the vehicle.");
  if (!d.registration.trim())
    warn("vehicle", "Confirm the registration before handover.");
  if (
    Object.values(totals).some((v) => !Number.isSafeInteger(v)) ||
    totals.price <= 0 ||
    totals.totalDue < 0
  )
    error("payments", "The sale contains invalid financial amounts.");
  const ids = new Set<string>();
  for (const payment of record.payments) {
    if (!payment.id || ids.has(payment.id))
      error("payments", "Duplicate payment identifier found.");
    ids.add(payment.id);
    if (
      !Number.isSafeInteger(payment.amountPence) ||
      payment.amountPence <= 0 ||
      payment.amountPence !== saleWorkspacePence(payment.amount) ||
      Math.abs(payment.signedAmountPence) !== payment.amountPence
    )
      error("payments", "A payment amount does not match its ledger value.");
    if (
      (["refund", "reversal"].includes(payment.kind) &&
        payment.signedAmountPence >= 0) ||
      (!["refund", "reversal"].includes(payment.kind) &&
        payment.signedAmountPence <= 0)
    )
      error("payments", "A refund or payment has an incorrect sign.");
    if (
      payment.reversesPaymentId &&
      !record.payments.some(
        (p) =>
          p.id === payment.reversesPaymentId &&
          p.status === "confirmed" &&
          p.signedAmountPence > 0,
      )
    )
      error("payments", "A payment correction has no valid original payment.");
  }
  const creditIds = new Set<string>();
  for (const credit of d.creditEntries ?? []) {
    if (
      !credit.id ||
      creditIds.has(credit.id) ||
      !Number.isSafeInteger(credit.signedAmountPence) ||
      credit.signedAmountPence === 0
    )
      error(
        "payments",
        "A credit transfer has an invalid or duplicate identifier.",
      );
    creditIds.add(credit.id);
  }
  for (const original of record.payments.filter(
    (p) =>
      p.status === "confirmed" &&
      p.signedAmountPence > 0 &&
      p.kind !== "refund-correction",
  )) {
    const reversed = -record.payments
      .filter(
        (p) => p.status === "confirmed" && p.reversesPaymentId === original.id,
      )
      .reduce((sum, p) => sum + p.signedAmountPence, 0);
    if (reversed > original.amountPence)
      error("payments", "Refunds exceed the original payment.");
  }
  // Issued snapshots are immutable, so later payments must not be compared
  // against an old balance. Check the arithmetic inside each saved snapshot.
  for (const document of record.documents) {
    if (!['invoice', 'statement', 'receipt', 'payment-request', 'credit-note', 'delivery-invoice'].includes(document.type)) continue;
    const snapshot = document.snapshot;
    if (!snapshot?.draft || !Array.isArray(snapshot.payments) || !snapshot.totals) {
      error('invoices', 'An issued financial document has an incomplete saved snapshot. Review the original paperwork.');
      continue;
    }
    const calculated = saleWorkspaceTotals(snapshot.draft, snapshot.payments);
    if (Object.entries(calculated).some(([key, value]) => !Number.isSafeInteger(value) || snapshot.totals[key as keyof typeof calculated] !== value) || document.balanceAtIssue !== calculated.balance) {
      error('invoices', 'An issued document’s saved amounts do not match its original ledger. Review the original paperwork and correction history.');
    }
  }
  if (totals.pending > 0)
    warn(
      "payments",
      `${saleMoney(totals.pending)} is awaiting confirmation and has not reduced the balance.`,
    );
  if (totals.balance < 0 && !options.allowCustomerCredit)
    error(
      "payments",
      `${saleMoney(-totals.balance)} is customer credit. Record its refund or agreed allocation before issuing the final invoice.`,
    );
  const delivery = saleWorkspacePence(d.deliveryCharge ?? "");
  if (delivery > 0 && d.fulfilment?.method !== "delivery")
    error("handover", "A delivery charge is present on a collection deal.");
  if (
    delivery > 0 &&
    d.adjustments?.some(
      (a) => a.kind === "fee" && /deliver/i.test(a.description),
    )
  )
    error(
      "handover",
      "Delivery appears in both extras and the delivery charge. Remove the duplicate.",
    );
  if (d.fulfilment?.method === "delivery" && !d.fulfilment.address.trim())
    error("handover", "Add the delivery address.");
  if (!d.email && !d.phone)
    warn("customer", "No customer contact details are recorded.");
  if (d.notes.length > 5000)
    warn(
      "deal",
      "The deal notes are long. Check any important agreement or disclosure is included in customer documents.",
    );
  return issues;
}
export function finalReviewCurrent(sale: SaleWorkspaceRecord) {
  return (
    (sale.finalReview?.status === "passed" || sale.finalReview?.status === "overridden") &&
    sale.finalReview.reviewedRevision === sale.revision
  );
}

/** Record an actual refund against held return credit. Never initiates a transfer. */
export function refundSaleCredit(
  current: SaleWorkspaceRecord,
  input: { amount: unknown; method: unknown; date: unknown; confirmReceived: unknown },
  context: SaleWorkspaceContext,
) {
  if (!current.standaloneReturn && current.returnReplacement?.direction !== 'replacement') throw new SaleWorkspaceError('Use this action only for remaining return or replacement credit.', 409);
  const amount = operationMoney(input.amount), totals = saleWorkspaceTotals(current.draft, current.payments);
  if (!Number.isSafeInteger(totals.balance) || totals.balance >= 0 || amount > -totals.balance) throw new SaleWorkspaceError('The refund exceeds the customer credit still held.');
  if (input.confirmReceived !== true) throw new SaleWorkspaceError('Confirm this refund has actually been paid to the customer.');
  const method = operationText(input.method, 100, 'refund method'), date = operationDate(input.date, 'refund date');
  const earliestDate = current.standaloneReturn?.returnedDate ?? current.returnReplacement!.at.slice(0, 10);
  if (!method || date > context.now.slice(0, 10) || date < earliestDate) throw new SaleWorkspaceError('Check the actual refund method and date.');
  const sale = clone(current), paymentId = context.nextId();
  sale.payments.push({ id: paymentId, amount: (amount / 100).toFixed(2), amountPence: amount, signedAmountPence: -amount, kind: 'refund', status: 'confirmed', method, date, reference: sale.standaloneReturn ? sale.reference : sale.returnReplacement!.otherReference, reason: sale.standaloneReturn ? 'Refund of returned vehicle credit' : 'Refund of replacement credit', recordedAt: context.now, recordedBy: context.actor });
  const document = operationDocument(sale, context, 'receipt', 'Credit refund receipt', `${sale.standaloneReturn ? 'Vehicle return' : 'Replacement'} credit refund recorded: ${(amount / 100).toFixed(2)} GBP\nMethod: ${method}\nDate: ${date}\nThis records a refund reported by staff; no bank transfer has been initiated by this portal.`);
  document.paymentId = paymentId; document.paymentAmountPence = -amount;
  finishSaleOperation(sale, context, `${sale.standaloneReturn ? 'Vehicle return' : 'Replacement'} credit refund recorded`);
  return { sale, document };
}

/** Physical return only. Credits charges, including unpaid debt, without inventing a cash movement. */
export function returnSaleCar(
  current: SaleWorkspaceRecord,
  input: { agreedCredit: unknown; reason: unknown; condition: unknown; mileage: unknown; returnedDate: unknown; financeConfirmed: unknown; received: unknown; acknowledge: unknown },
  context: SaleWorkspaceContext,
) {
  if (current.lifecycle?.status === 'returned' || current.standaloneReturn || current.returnReplacement?.direction === 'returned') throw new SaleWorkspaceError('This vehicle has already been returned.', 409);
  if (!current.completedAt || current.lifecycle?.status !== 'sold') throw new SaleWorkspaceError('Open the completed sale for the vehicle being returned.', 409);
  if (current.draft.partExchange || current.draft.exchanges?.length) throw new SaleWorkspaceError('This sale includes part-exchange property. Resolve its return and finance settlement with a manager first.', 409);
  if (Object.keys(current.providerPayments ?? {}).length) throw new SaleWorkspaceError('Resolve provider-managed funds with the provider before recording this return.', 409);
  if (input.received !== true || input.acknowledge !== true || input.financeConfirmed !== true) throw new SaleWorkspaceError('Confirm the vehicle is back, the return credit is agreed and third-party settlement is resolved.');
  const before = saleWorkspaceTotals(current.draft, current.payments);
  if (![before.totalDue, before.confirmedPaid, before.pending, before.balance].every(Number.isSafeInteger) || before.totalDue <= 0 || before.confirmedPaid < 0) throw new SaleWorkspaceError('Check the original agreement and recorded funds before returning the vehicle.', 409);
  if (before.pending !== 0) throw new SaleWorkspaceError('Resolve pending payments before returning the vehicle.', 409);
  const amount = operationMoney(input.agreedCredit, 'agreed return credit');
  if (amount > before.totalDue) throw new SaleWorkspaceError('The return credit cannot exceed the original agreed charges.');
  if (amount < Math.max(0, before.balance)) throw new SaleWorkspaceError('The agreed return credit must settle the original unpaid balance. Resolve the remaining agreement with a manager first.');
  const reason = operationText(input.reason, 2000, 'the return reason'), condition = operationText(input.condition, 4000, 'the returned vehicle condition');
  if (!reason || !condition) throw new SaleWorkspaceError('Record the return reason and returned vehicle condition.');
  if (!Number.isSafeInteger(input.mileage) || Number(input.mileage) < 0 || Number(input.mileage) > 2_000_000) throw new SaleWorkspaceError('Enter the returned vehicle mileage.');
  const returnedDate = operationDate(input.returnedDate, 'actual return date');
  if (returnedDate > context.now.slice(0, 10) || returnedDate < current.completedAt.slice(0, 10)) throw new SaleWorkspaceError('The actual return date must be between the completed sale and today.');
  const sale = clone(current);
  sale.draft.returnCreditPence = amount;
  const after = saleWorkspaceTotals(sale.draft, sale.payments), unpaidCancelledPence = Math.min(amount, Math.max(0, before.balance)), refundDuePence = Math.max(0, -after.balance);
  if (![after.totalDue, after.confirmedPaid, after.balance, unpaidCancelledPence, refundDuePence].every(Number.isSafeInteger)) throw new SaleWorkspaceError('Check the return amounts.');
  sale.standaloneReturn = { id: context.nextId(), creditPence: amount, originalTotalPence: before.totalDue, unpaidCancelledPence, refundDuePence, balanceDuePence: Math.max(0, after.balance), reason, condition, mileage: Number(input.mileage), returnedDate, at: context.now, actor: context.actor };
  sale.lifecycle = { status: 'returned', vehicleId: sale.draft.vehicleId, changedAt: context.now };
  for (const request of sale.paymentRequests ?? []) request.status = 'cancelled';
  const document = operationDocument(sale, context, 'credit-note', 'Vehicle return credit note', `Vehicle returned: ${sale.draft.vehicle} (${sale.draft.registration})\nAgreed return credit: ${saleMoney(amount)}\nUnpaid balance cancelled: ${saleMoney(unpaidCancelledPence)}\nRefund due at return: ${saleMoney(refundDuePence)}\nNo refund has been sent by this action.\nReason: ${reason}`);
  document.transaction = { kind: 'return-only-credit', amountPence: amount, originalSaleReference: sale.reference, originalInvoiceReferences: current.documents.filter(d => d.type === 'invoice').map(d => d.number), originalTotalPence: before.totalDue, unpaidCancelledPence, refundDuePence, balanceDuePence: Math.max(0, after.balance), reason, condition, mileage: Number(input.mileage), returnedDate };
  finishSaleOperation(sale, context, `Vehicle returned; ${saleMoney(amount)} agreed credit, ${saleMoney(unpaidCancelledPence)} unpaid balance cancelled; ${saleMoney(refundDuePence)} refund due. No money sent.`);
  return { sale, document };
}

/** A linked return/credit, never a deletion or invented cash receipt. Caller locks both cars and persists atomically. */
export function returnAndReplaceSale(
  current: SaleWorkspaceRecord,
  input: {
    replacementDraft: SaleWorkspaceDraft;
    agreedCredit: unknown;
    reason: unknown;
    condition: unknown;
    mileage: unknown;
    financeConfirmed: unknown;
    acknowledge: unknown;
  },
  context: SaleWorkspaceContext,
  replacementReference: string,
) {
  if (current.standaloneReturn || current.lifecycle?.status === 'returned' || current.returnReplacement?.direction === "returned")
    throw new SaleWorkspaceError("This vehicle has already been returned.", 409);
  if (!current.completedAt || current.lifecycle?.status !== "sold")
    throw new SaleWorkspaceError(
      "Return and replace is available for a completed sale.",
      409,
    );
  const before = saleWorkspaceTotals(current.draft, current.payments);
  if (before.balance !== 0 || before.pending !== 0)
    throw new SaleWorkspaceError(
      "Settle the original balance and pending payments before transferring credit.",
      409,
    );
  if (current.draft.exchanges?.length || current.draft.partExchange)
    throw new SaleWorkspaceError(
      "This sale includes part-exchange property. Resolve its return and finance settlement with a manager before using a replacement credit.",
      409,
    );
  if (Object.keys(current.providerPayments ?? {}).length)
    throw new SaleWorkspaceError(
      "This sale has provider-managed funds. Resolve the provider settlement before transferring its credit.",
      409,
    );
  if (input.acknowledge !== true || input.financeConfirmed !== true)
    throw new SaleWorkspaceError(
      "Confirm the agreed return and that finance or third-party settlement has been resolved.",
    );
  const amount = operationMoney(input.agreedCredit, "agreed return credit");
  if (amount > before.confirmedPaid)
    throw new SaleWorkspaceError(
      "Return credit cannot exceed the net funds retained on the original sale.",
    );
  const reason = operationText(input.reason, 2000, "the return reason"),
    condition = operationText(
      input.condition,
      4000,
      "the returned vehicle condition",
    );
  if (!reason || !condition)
    throw new SaleWorkspaceError("Record the return reason and condition.");
  if (
    !Number.isSafeInteger(input.mileage) ||
    Number(input.mileage) < 0 ||
    Number(input.mileage) > 2000000
  )
    throw new SaleWorkspaceError("Enter the returned vehicle mileage.");
  if (
    !input.replacementDraft.vehicleId ||
    input.replacementDraft.vehicleId === current.draft.vehicleId
  )
    throw new SaleWorkspaceError("Choose a different replacement vehicle.");
  const returned = clone(current);
  const replacement = createSaleWorkspace(
    { draft: input.replacementDraft, requestId: context.nextId() },
    context,
    replacementReference,
  ).sale;
  const transferId = context.nextId();
  returned.draft.returnCreditPence = amount;
  (returned.draft.creditEntries ??= []).push({
    id: transferId,
    sourceSaleId: replacement.id,
    reference: replacement.reference,
    signedAmountPence: -amount,
    at: context.now,
  });
  replacement.draft.creditEntries = [
    {
      id: transferId,
      sourceSaleId: current.id,
      reference: current.reference,
      signedAmountPence: amount,
      at: context.now,
    },
  ];
  const common = {
    transferId,
    creditPence: amount,
    reason,
    condition,
    mileage: Number(input.mileage),
    at: context.now,
    actor: context.actor,
  };
  const earlierLinks = [...(current.returnReplacementHistory ?? []), ...(current.returnReplacement ? [clone(current.returnReplacement)] : [])];
  if (earlierLinks.length) {
    returned.returnReplacementHistory = clone(earlierLinks);
    replacement.returnReplacementHistory = clone(earlierLinks);
  }
  returned.returnReplacement = {
    ...common,
    otherSaleId: replacement.id,
    otherReference: replacement.reference,
    direction: "returned",
  };
  returned.lifecycle = {
    status: "returned",
    vehicleId: returned.draft.vehicleId,
    changedAt: context.now,
  };
  replacement.returnReplacement = {
    ...common,
    otherSaleId: current.id,
    otherReference: current.reference,
    direction: "replacement",
  };
  replacement.lifecycle = {
    status: "reserved",
    vehicleId: replacement.draft.vehicleId,
    changedAt: context.now,
  };
  for (const request of returned.paymentRequests ?? [])
    request.status = "cancelled";
  const creditDocument = operationDocument(
    returned,
    context,
    "credit-note",
    "Return credit note",
    `Vehicle returned: ${current.draft.vehicle} (${current.draft.registration})\nAgreed credit: ${saleMoney(amount)}\nCredit transferred to replacement sale ${replacement.reference}. No cash refund recorded.\nReason: ${reason}\nReturned mileage: ${input.mileage}\nCondition: ${condition}`,
  );
  creditDocument.transaction = { kind: 'return-credit', amountPence: amount, originalSaleReference: current.reference, replacementSaleReference: replacement.reference, originalInvoiceReferences: current.documents.filter(document => document.type === 'invoice').map(document => document.number), reason, condition, mileage: Number(input.mileage) };
  finishSaleOperation(
    returned,
    context,
    `Vehicle returned; ${saleMoney(amount)} credit transferred to ${replacement.reference}`,
  );
  finishSaleOperation(
    replacement,
    context,
    `${saleMoney(amount)} credit received from ${current.reference}; replacement reserved`,
  );
  return { returned, replacement, creditDocument };
}
