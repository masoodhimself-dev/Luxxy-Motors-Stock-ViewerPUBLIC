import { hasSeparateDeliveryInvoice, latestFullSaleInvoice, saleCanRequestDeposit, saleDepositConfirmationShared, salePaymentRequestAvailable, salePaymentRequestRemaining, saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';

import { saleInvoiceIsCurrent } from '@/lib/sale-invoice-current';

export type SaleNextStep = { action: 'request' | 'deposit' | 'payment' | 'confirmation' | 'invoice' | 'mark-sold' | 'handover' | 'history'; label: string; note: string; requestId?: string; documentId?: string };

/** Suggest from saved facts only. This never records money, sends messages or changes stock. */
export function saleNextStep(sale: SaleWorkspaceRecord, now = new Date().toISOString()): SaleNextStep | null {
  const totals = saleWorkspaceTotals(sale.draft, sale.payments);
  const sold = !saleCanRequestDeposit(sale);
  if (sale.lifecycle?.status === 'released' || sale.lifecycle?.status === 'returned' || sale.returnReplacement?.direction === 'returned' || sale.standaloneReturn) return null;
  if (totals.pending > 0 || totals.balance < 0 || sale.corrections?.length || (sale.completedAt && sale.payments.some(payment => payment.status === 'confirmed' && payment.signedAmountPence < 0))) return { action: 'history', label: 'Check payments', note: 'Review the payment history before continuing.' };
  const deposit = [...sale.payments].reverse().find(payment => payment.kind === 'deposit' && payment.status === 'confirmed' && payment.signedAmountPence > 0 && !sale.payments.some(row => row.reversesPaymentId === payment.id));
  const receipt = deposit && sale.documents.find(document => document.id === deposit.receiptId);
  if (receipt && !sold && !saleDepositConfirmationShared(sale, receipt.id)) return { action: 'confirmation', label: 'Send deposit confirmation', note: sale.lifecycle?.status === 'reserved' ? 'The deposit is recorded. Let the customer know the car is reserved.' : 'The deposit is recorded. Send the customer a receipt.', documentId: receipt.id };
  const request = [...(sale.paymentRequests ?? [])].reverse().find(row => salePaymentRequestAvailable(sale, row, now) && salePaymentRequestRemaining(sale, row) > 0);
  const requestAmountChanged = request && salePaymentRequestRemaining(sale, request) < request.amountPence;
  const requestShared = request && (request.sharedAt || sale.emailDeliveries?.some(delivery => delivery.documentId === request.documentId && delivery.status === 'sent'));
  if (request && request.kind === 'deposit' && !sold && sale.lifecycle?.status !== 'reserved') {
    return requestShared || request.paymentReportedAt || requestAmountChanged
      ? { action: 'deposit', label: 'Record the deposit', note: request.paymentReportedAt ? 'The customer says they have paid. Check the funds first.' : 'Has the deposit arrived? Check the amount received.', requestId: request.id }
      : { action: 'request', label: 'Send deposit request', note: 'Your request is saved. Share the PDF with the customer.', requestId: request.id };
  }
  if (request && request.kind !== 'deposit') {
    return requestShared || request.paymentReportedAt || requestAmountChanged
      ? { action: 'payment', label: 'Record the requested payment', note: 'Check the funds and record the amount received.', requestId: request.id }
      : { action: 'request', label: 'Send payment request', note: 'Your request is saved. Share the PDF with the customer.', requestId: request.id };
  }
  if (totals.balance > 0 && !sold && sale.lifecycle?.status !== 'reserved' && !sale.payments.some(payment => payment.status === 'confirmed')) return { action: 'request', label: 'Request a deposit', note: 'Or choose Take a payment if the customer has already paid.' };
  if (totals.balance > 0) return { action: 'payment', label: 'Take the next payment', note: 'Record part or all of the remaining balance when it arrives.' };
  if (sale.draft.fulfilment?.completedAt) return { action: 'history', label: 'View sale documents', note: 'The balance is settled and the car has been handed over.' };
  const fullInvoice = latestFullSaleInvoice(sale.documents);
  if (!fullInvoice || !saleInvoiceIsCurrent(fullInvoice, sale.draft, sale.payments, sale.documents)) {
    if (hasSeparateDeliveryInvoice(sale)) return { action: 'history', label: 'Review sale documents', note: 'Check the saved vehicle and delivery invoices before handing over the car.' };
    return { action: 'invoice', label: 'Create the sales invoice', note: 'The balance is settled. Prepare the paperwork for handover.' };
  }
  if (!sold) return { action: 'mark-sold', label: 'Review invoice and mark sold', note: 'Review the saved invoice and mark the car sold before handing it over.', documentId: fullInvoice.id };
  if (sale.draft.fulfilment?.stage === 'unsuccessful') return { action: 'handover', label: 'Rearrange collection or delivery', note: 'The previous handover was not completed. Agree a new date with the customer.' };
  const booked = sale.draft.fulfilment?.scheduledDate && sale.draft.fulfilment.stage !== 'to_arrange';
  return { action: 'handover', label: booked ? 'Record the handover' : 'Arrange collection or delivery', note: booked ? 'Confirm when the customer receives the car.' : 'Choose how and when the customer will receive the car.' };
}
