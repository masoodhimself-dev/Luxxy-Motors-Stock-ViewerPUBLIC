import { hasSeparateDeliveryInvoice, type SaleWorkspaceDraft, type SaleWorkspaceRecord, type SaleWorkspaceTotals } from '@workspace/vehicle-meta';
import type { SaleAction } from './sales-action-menu';

export function saleActionUnavailable(
  sale: SaleWorkspaceRecord | null,
  draft: SaleWorkspaceDraft | null,
  totals: SaleWorkspaceTotals | null,
  access: { manage: boolean; record: boolean; handover: boolean; refund: boolean },
  refundDue: number,
): Partial<Record<SaleAction, string>> {
  const unavailable: Partial<Record<SaleAction, string>> = {};
  const sold = Boolean(sale?.completedAt || sale?.lifecycle?.status === 'sold');
  const returned = Boolean(sale?.standaloneReturn || sale?.returnReplacement?.direction === 'returned' || sale?.lifecycle?.status === 'returned');
  const closed = returned || sale?.lifecycle?.status === 'released';
  const stockBlock = draft?.vehicleId === sale?.draft.vehicleId ? sale?.stockActionBlock : undefined;

  if (!access.record) {
    unavailable.request = 'Ask someone with payment access to send a request.';
    unavailable.deposit = 'Ask someone with payment access to record a deposit.';
    unavailable.payment = 'Ask someone with payment access to record the payment.';
    unavailable.invoice = 'Ask someone with invoice access to create an invoice.';
  }
  if (!access.manage) unavailable.deposit ??= 'Ask a manager to reserve the car.';
  if (!access.handover) unavailable.handover = 'Ask someone with handover access.';
  if (!access.manage || !access.refund) unavailable.return = 'Ask a manager with refund access.';
  if (sold) unavailable.deposit = 'This car is already sold.';
  if (sale?.draft.fulfilment?.completedAt) unavailable.handover = 'The handover is already recorded.';
  if (sale && hasSeparateDeliveryInvoice(sale)) unavailable.invoice = 'View the saved vehicle and delivery invoices in Payments and documents.';

  if (!draft?.customer?.trim() || !draft.vehicleId || !totals || !(totals.price > 0) || !Number.isSafeInteger(totals.balance)) {
    unavailable.request ??= 'Add the customer, car and agreed price first.';
    unavailable.deposit ??= 'Add the customer, car and agreed price first.';
    unavailable.payment ??= 'Add the customer, car and agreed price first.';
    unavailable.invoice ??= 'Add the customer, car and agreed price first.';
  } else if (totals.balance <= 0) {
    const reason = totals.balance < 0 ? 'Review the customer credit in Payments and documents.' : 'The balance is settled.';
    unavailable.request ??= reason;
    unavailable.deposit ??= reason;
    unavailable.payment ??= reason;
    if (totals.balance < 0) unavailable.invoice ??= reason;
  }

  const stockReason = stockBlock === 'online-checkout' ? 'This car is held for an online payment.'
    : stockBlock === 'another-sale' ? 'This car is reserved or sold on another sale.' : '';
  const paymentBlock = closed ? 'This sale is closed.' : refundDue > 0 ? 'Record the outstanding refund first.' : stockReason;
  if (paymentBlock) {
    unavailable.request = paymentBlock;
    unavailable.deposit = paymentBlock;
    unavailable.payment = paymentBlock;
    unavailable.invoice = closed ? 'View the saved invoices in Payments and documents.' : paymentBlock;
  }
  if (closed || stockReason || refundDue > 0) {
    unavailable.handover = closed ? 'This sale is closed.' : stockReason || 'Record the outstanding refund first.';
  }

  if (stockReason && !returned) {
    unavailable.return = stockReason;
  } else if (returned && !sale?.standaloneReturn && sale?.returnReplacement?.direction !== 'returned') {
    unavailable.return ??= 'This vehicle has already been returned.';
  } else if (!returned && (!sale?.completedAt || sale.lifecycle?.status !== 'sold')) {
    unavailable.return ??= 'Open the completed sale to start a return.';
  } else if (!returned && sale && totals) {
    unavailable.return ??= saleReturnUnavailable(sale, totals);
  }
  return unavailable;
}

export function saleReturnUnavailable(sale: SaleWorkspaceRecord, totals: SaleWorkspaceTotals): string | undefined {
  if (totals.pending !== 0) return 'Resolve pending payments first.';
  if (sale.draft.partExchange || sale.draft.exchanges?.length) return 'Ask a manager to resolve the part exchange first.';
  if (sale.hasProviderPayments || Object.keys(sale.providerPayments ?? {}).length) return 'Resolve the payment with its provider first.';
  return undefined;
}
