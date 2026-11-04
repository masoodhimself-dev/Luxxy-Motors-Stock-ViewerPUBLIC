import { saleHandoverStatus, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { salePaymentRequestAvailable, salePaymentRequestRemaining } from '../../../../lib/vehicle-meta/src/sale-operations';

/** Small list labels derived from saved facts, without sending private document snapshots. */
export function saleListStage(sale: SaleWorkspaceRecord, hasInvoice: boolean, now = new Date().toISOString()) {
  if (sale.standaloneReturn || sale.lifecycle?.status === 'returned' || sale.returnReplacement?.direction === 'returned') return 'Returned';
  if (sale.lifecycle?.status === 'released') return 'Released';
  const handover = saleHandoverStatus(sale.draft.fulfilment);
  if (handover === 'Collected' || handover === 'Delivered') return handover;
  if (sale.completedAt || sale.lifecycle?.status === 'sold') {
    if (handover === 'Booked') return sale.draft.fulfilment?.method === 'delivery' ? 'Delivery booked' : 'Collection booked';
    if (handover === 'On the way' || handover === 'Delivery needs rearranging') return handover;
    return 'Sold';
  }
  if (sale.lifecycle?.status === 'reserved') return 'Reserved';
  if ((sale.paymentRequests ?? []).some(request => request.kind === 'deposit' && salePaymentRequestAvailable(sale, request, now) && salePaymentRequestRemaining(sale, request) > 0)) return 'Deposit requested';
  return hasInvoice ? 'Invoice ready' : 'Draft';
}
