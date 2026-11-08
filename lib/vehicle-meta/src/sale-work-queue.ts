import { latestFullSaleInvoice, SaleWorkspaceError, type SaleWorkspaceRecord } from './sale-workspace.ts';

export type SaleQueueFilter = 'all' | 'attention' | 'open' | 'closed';
export type SaleQueueOwner = 'all' | 'mine' | 'unassigned';

export function saleQueueFilters(queue: unknown = 'all', owner: unknown = 'all'): { queue: SaleQueueFilter; owner: SaleQueueOwner } {
  if (queue !== 'all' && queue !== 'attention' && queue !== 'open' && queue !== 'closed') throw new SaleWorkspaceError('Choose a valid sales view.', 400);
  if (owner !== 'all' && owner !== 'mine' && owner !== 'unassigned') throw new SaleWorkspaceError('Choose a valid sale owner filter.', 400);
  return { queue, owner };
}

export function saleQueueToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function saleQueueClosed(sale: SaleWorkspaceRecord) {
  return Boolean(sale.standaloneReturn || sale.returnReplacement?.direction === 'returned' ||
    sale.lifecycle?.status === 'released' || sale.lifecycle?.status === 'returned' || sale.draft.fulfilment?.completedAt);
}

export function saleQueueStatus(sale: SaleWorkspaceRecord, today: string) {
  const fulfilment = sale.draft.fulfilment;
  const closed = saleQueueClosed(sale);
  const pending = sale.payments.some(payment => payment.status === 'pending');
  if (pending) return { closed, attention: closed ? 'Payment history to review' : 'Payment to confirm' };
  if (closed) return { closed, attention: '' };
  if (sale.paymentRequests?.some(request => request.status === 'active' && request.dueDate && request.dueDate <= today)) {
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
