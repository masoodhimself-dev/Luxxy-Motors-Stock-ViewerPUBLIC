import { salePaymentRequestAvailable, salePaymentRequestRemaining, saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';

import { saleInvoiceIsCurrent } from '@/lib/sale-invoice-current';

export type SaleNextStep = { action: 'request' | 'deposit' | 'payment' | 'confirmation' | 'invoice' | 'handover' | 'history'; label: string; note: string; requestId?: string; documentId?: string };

/** Suggest from saved facts only. This never records money, sends messages or changes stock. */
export function saleNextStep(sale: SaleWorkspaceRecord, now = new Date().toISOString()): SaleNextStep | null {
  const totals = saleWorkspaceTotals(sale.draft, sale.payments);
  if (sale.lifecycle?.status === 'released' || sale.lifecycle?.status === 'returned' || sale.returnReplacement?.direction === 'returned' || sale.standaloneReturn) return null;
  if (totals.pending > 0 || totals.balance < 0 || sale.corrections?.length || (sale.completedAt && sale.payments.some(payment => payment.status === 'confirmed' && payment.signedAmountPence < 0))) return { action: 'history', label: 'Check payments', note: 'Review the payment history before continuing.' };
  const deposit = [...sale.payments].reverse().find(payment => payment.kind === 'deposit' && payment.status === 'confirmed' && payment.signedAmountPence > 0 && !sale.payments.some(row => row.reversesPaymentId === payment.id));
  const receipt = deposit && sale.documents.find(document => document.id === deposit.receiptId);
  if (receipt && !sale.completedAt && !sale.emailDeliveries?.some(delivery => delivery.documentId === receipt.id && delivery.status === 'sent')) return { action: 'confirmation', label: 'Send deposit confirmation', note: sale.lifecycle?.status === 'reserved' ? 'The deposit is recorded. Let the customer know the car is reserved.' : 'The deposit is recorded. Send the customer a receipt.', documentId: receipt.id };
  const request = [...(sale.paymentRequests ?? [])].reverse().find(row => salePaymentRequestAvailable(sale, row, now) && salePaymentRequestRemaining(sale, row) > 0);
  if (request && request.kind === 'deposit' && !sale.completedAt && sale.lifecycle?.status !== 'reserved') {
    const shared = request.sharedAt || sale.emailDeliveries?.some(delivery => delivery.documentId === request.documentId && delivery.status === 'sent');
    return shared || request.paymentReportedAt
      ? { action: 'deposit', label: 'Record the deposit', note: request.paymentReportedAt ? 'The customer says they have paid. Check the funds first.' : 'Has the deposit arrived? Check the amount received.', requestId: request.id }
      : { action: 'request', label: 'Send deposit request', note: 'Your request is saved. Send the PDF by email or WhatsApp.', requestId: request.id };
  }
  if (request && request.kind !== 'deposit') {
    const shared = request.sharedAt || sale.emailDeliveries?.some(delivery => delivery.documentId === request.documentId && delivery.status === 'sent');
    return shared || request.paymentReportedAt
      ? { action: 'payment', label: 'Record the requested payment', note: 'Check the funds and record the amount received.', requestId: request.id }
      : { action: 'request', label: 'Send payment request', note: 'Your request is saved. Send the PDF by email or WhatsApp.', requestId: request.id };
  }
  if (totals.balance > 0 && !sale.completedAt && sale.lifecycle?.status !== 'reserved' && !sale.payments.some(payment => payment.status === 'confirmed')) return { action: 'request', label: 'Request a deposit', note: 'Or choose Take a payment if the customer has already paid.' };
  if (totals.balance > 0) return { action: 'payment', label: 'Take the next payment', note: 'Record part or all of the remaining balance when it arrives.' };
  if (sale.draft.fulfilment?.completedAt) return { action: 'history', label: 'View sale documents', note: 'The balance is settled and the car has been handed over.' };
  if (!sale.documents.some(document => document.type === 'invoice' && document.invoiceKind === 'full' && saleInvoiceIsCurrent(document, sale.draft, sale.payments))) return { action: 'invoice', label: 'Create the sales invoice', note: 'The balance is settled. Prepare the paperwork for handover.' };
  if (sale.draft.fulfilment?.stage === 'unsuccessful') return { action: 'handover', label: 'Rearrange collection or delivery', note: 'The previous handover was not completed. Agree a new date with the customer.' };
  const booked = sale.draft.fulfilment?.scheduledDate && sale.draft.fulfilment.stage !== 'to_arrange';
  return { action: 'handover', label: booked ? 'Record the handover' : 'Arrange collection or delivery', note: booked ? 'Confirm when the customer receives the car.' : 'Choose how and when the customer will receive the car.' };
}
