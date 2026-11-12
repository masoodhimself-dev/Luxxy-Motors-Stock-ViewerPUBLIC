import { latestFullSaleInvoice, saleCalendarDate, saleStockConflictRefundDue, SaleWorkspaceError, type SaleWorkspaceRecord } from './sale-workspace.ts';
import { saleDepositConfirmationDue, salePaymentRequestAvailable, salePaymentRequestRemaining } from './sale-operations.ts';

export type SaleQueueFilter = 'all' | 'attention' | 'open' | 'closed';
export type SaleQueueOwner = 'all' | 'mine' | 'unassigned';
export const saleRefundAttention = 'Refund to record';

/** Normalise only a plate-shaped search, leaving names, emails and references intact. */
export function saleRegistrationSearch(query: string) {
  const plate = query.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{2,8}$/.test(plate) && /[A-Z]/.test(plate) && /\d/.test(plate) ? plate : '';
}

export function saleQueueFilters(queue: unknown = 'all', owner: unknown = 'all'): { queue: SaleQueueFilter; owner: SaleQueueOwner } {
  if (queue !== 'all' && queue !== 'attention' && queue !== 'open' && queue !== 'closed') throw new SaleWorkspaceError('Choose a valid sales view.', 400);
  if (owner !== 'all' && owner !== 'mine' && owner !== 'unassigned') throw new SaleWorkspaceError('Choose a valid sale owner filter.', 400);
  return { queue, owner };
}

export function saleQueueToday(now = new Date()) {
  return saleCalendarDate(now);
}

function saleQueueClosed(sale: SaleWorkspaceRecord) {
  return Boolean(sale.standaloneReturn || sale.returnReplacement?.direction === 'returned' ||
    sale.lifecycle?.status === 'released' || sale.lifecycle?.status === 'returned' || sale.draft.fulfilment?.completedAt);
}

export function saleQueueStatus(sale: SaleWorkspaceRecord, today: string, now = new Date().toISOString()) {
  const fulfilment = sale.draft.fulfilment;
  const closed = saleQueueClosed(sale);
  const refundDue = saleStockConflictRefundDue(sale);
  if (refundDue > 0) return { closed, attention: saleRefundAttention, refundDue };
  const pending = sale.payments.some(payment => payment.status === 'pending');
  if (pending) return { closed, attention: closed ? 'Payment history to review' : 'Payment to confirm' };
  if (closed) return { closed, attention: '' };
  if (saleDepositConfirmationDue(sale)) return { closed, attention: 'Deposit confirmation to send' };
  if (sale.paymentRequests?.some(request =>
    request.dueDate && request.dueDate <= today &&
    salePaymentRequestAvailable(sale, request, now) && salePaymentRequestRemaining(sale, request) > 0)) {
    return { closed, attention: 'Payment request due' };
  }
  if (fulfilment?.stage === 'unsuccessful') return { closed, attention: 'Delivery to rearrange' };
  if (fulfilment?.scheduledDate && fulfilment.scheduledDate <= today && fulfilment.stage !== 'to_arrange' &&
      (fulfilment.method !== 'delivery' || fulfilment.address?.trim() || fulfilment.stage === 'on_way')) return { closed, attention: fulfilment.method === 'delivery' ? 'Delivery due' : 'Collection due' };
  if (!sale.completedAt && sale.lifecycle?.status !== 'sold' && latestFullSaleInvoice(sale.documents)) {
    return { closed, attention: 'Invoice to review' };
  }
  return { closed, attention: '' };
}
