import {
  createSaleWorkspace,
  saleWorkspaceTotals,
  saleWorkspacePence,
  SaleWorkspaceError,
  type SaleWorkspaceRecord,
  type SaleWorkspaceDocument,
  type SaleWorkspaceContext,
  type SaleWorkspaceDraft,
} from "./sale-workspace.ts";

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
  status: "active" | "cancelled";
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
  status: "passed" | "attention" | "unavailable";
  issues: SaleReviewIssue[];
  model?: string;
  summary: string;
  inputTokens?: number;
  outputTokens?: number;
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
  });
  return record;
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

/** Requests never add a payment, reserve stock or imply a receipt. */
export function requestSalePayment(
  current: SaleWorkspaceRecord,
  input: {
    kind: unknown;
    amount: unknown;
    dueDate: unknown;
    note: unknown;
    tokenHash: string;
    expiresAt: string;
  },
  context: SaleWorkspaceContext,
) {
  if (
    current.returnReplacement?.direction === "returned" ||
    current.lifecycle?.status === "released"
  )
    throw new SaleWorkspaceError(
      "This deal is closed. Open the current replacement deal.",
      409,
    );
  if (!current.draft.customer || !current.draft.vehicleId)
    throw new SaleWorkspaceError("Save the customer and vehicle first.");
  if (!["deposit", "balance", "other"].includes(String(input.kind)))
    throw new SaleWorkspaceError(
      "Choose deposit, balance or another agreed amount.",
    );
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
  const label =
    kind === "deposit"
      ? "Deposit"
      : kind === "balance"
        ? "Remaining balance"
        : "Agreed payment";
  const document = operationDocument(
    record,
    context,
    "payment-request",
    "Payment request",
    `${label} requested: ${saleMoney(amountPence)}\nPayment reference: ${record.reference}\nDue date: ${dueDate}\n${note ? note + "\n" : ""}\nThis is a request for payment. It is not an invoice or confirmation that money has been received.\n${context.branding.invoiceSettings?.paymentInstructions || "Contact the dealership for payment instructions."}`,
  );
  const request: SalePaymentRequest = {
    id: context.nextId(),
    documentId: document.id,
    reference: document.number,
    kind,
    amountPence,
    dueDate,
    note,
    createdAt: context.now,
    expiresAt: input.expiresAt,
    tokenHash: input.tokenHash,
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
  const totals = saleWorkspaceTotals(record.draft, record.payments);
  return Math.max(
    0,
    Math.min(
      totals.balance,
      request.amountPence -
        Math.max(
          0,
          totals.confirmedPaid -
            (request.baselinePaidPence ?? totals.confirmedPaid),
        ),
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
    Date.parse(request.expiresAt) > Date.parse(now) &&
    request.agreement === salePaymentAgreement(record) &&
    record.lifecycle?.status !== "released" &&
    record.returnReplacement?.direction !== "returned"
  );
}
export function saleDeterministicReview(
  record: SaleWorkspaceRecord,
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
  if (totals.pending > 0)
    warn(
      "payments",
      `${saleMoney(totals.pending)} is awaiting confirmation and has not reduced the balance.`,
    );
  if (totals.balance < 0)
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
    sale.finalReview?.status === "passed" &&
    sale.finalReview.reviewedRevision === sale.revision
  );
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
  if (current.returnReplacement?.direction === "returned")
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
