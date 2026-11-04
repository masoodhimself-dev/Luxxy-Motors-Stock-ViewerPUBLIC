import { useState } from 'react';
import { salePaymentRequestAvailable, salePaymentRequestRemaining, saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { Check, Clock3, History } from '@/components/icons';
import { saleMoney } from './sales-controls';

/** A display stage is derived from saved facts. It never changes stock or money. */
export function saleProgress(sale: SaleWorkspaceRecord | null, now = new Date().toISOString()) {
  if (!sale) return { stage: 'Available', next: 'Choose the car and customer.', tone: 'neutral' };
  const totals = saleWorkspaceTotals(sale.draft, sale.payments), fulfilment = sale.draft.fulfilment;
  const cash = sale.payments.filter(payment => payment.status === 'confirmed').reduce((amount, payment) => amount + payment.signedAmountPence, 0);
  const credit = (sale.draft.creditEntries ?? []).reduce((amount, entry) => amount + entry.signedAmountPence, 0);
  const balanceNeedsReview = !sale.standaloneReturn && Boolean(sale.corrections?.length || sale.completedAt && sale.payments.some(payment => payment.status === 'confirmed' && (payment.signedAmountPence < 0 || payment.kind === 'refund-correction')));
  const moneyNote = balanceNeedsReview ? `Calculated balance ${saleMoney(Math.abs(totals.balance))} to review. Check the original invoice and correction history.`
    : totals.balance < 0 ? `${saleMoney(-totals.balance)} to return to the customer.`
    : totals.balance > 0 ? `${saleMoney(totals.balance)} left to pay.`
    : totals.pending > 0 ? `${saleMoney(totals.pending)} awaiting confirmation. Pending payments are not received money.` : '';
  if (sale.lifecycle?.status === 'returned' || sale.standaloneReturn || sale.returnReplacement?.direction === 'returned') return { stage: 'Returned', next: sale.standaloneReturn && totals.balance < 0 ? `${saleMoney(-totals.balance)} to return to the customer.` : balanceNeedsReview ? moneyNote : totals.balance < 0 ? `${saleMoney(-totals.balance)} to return to the customer.` : 'Check the return and inspection record.', tone: 'amber' };
  if (sale.lifecycle?.status === 'released') return { stage: 'Reservation released', next: 'Start a new sale when another customer is ready.', tone: 'neutral' };
  if (fulfilment?.completedAt) return { stage: fulfilment.method === 'delivery' ? 'Delivered' : 'Collected', next: moneyNote || 'Sale and handover complete.', tone: moneyNote ? 'amber' : 'green' };
  if (sale.completedAt || sale.lifecycle?.status === 'sold') {
    const method = fulfilment?.method === 'delivery' ? 'Delivery' : 'Collection';
    if (fulfilment?.stage === 'unsuccessful') return {stage:`${method} not completed`,next:[moneyNote,`Rearrange ${method.toLowerCase()} with the customer.`].filter(Boolean).join(' '),tone:'amber'};
    if (fulfilment?.stage === 'on_way' && fulfilment.method === 'delivery') return {stage:'Delivery on the way',next:moneyNote || 'Confirm the handover when the customer receives the car.',tone:moneyNote?'amber':'blue'};
    const booked = !!fulfilment?.scheduledDate && fulfilment.stage !== 'to_arrange';
    return { stage: booked ? `${method} booked` : 'Sold', next: moneyNote || (booked ? 'Confirm the handover when the customer receives the car.' : 'Arrange collection or delivery.'), tone: moneyNote ? 'amber' : 'green' };
  }
  if (sale.lifecycle?.status === 'reserved') {
    const funds = [cash > 0 ? `${saleMoney(cash)} paid` : cash < 0 ? `${saleMoney(-cash)} refunded` : !credit ? `${saleMoney(0)} paid` : '', credit > 0 ? `${saleMoney(credit)} transferred credit` : credit < 0 ? `${saleMoney(-credit)} credit transferred out` : ''].filter(Boolean).join(' · ');
    return { stage: 'Reserved', next: [funds, moneyNote || 'No balance left to pay.'].filter(Boolean).join(' · '), tone: 'amber' };
  }
  if ((sale.paymentRequests ?? []).some(request => request.kind === 'deposit' && salePaymentRequestAvailable(sale, request, now) && salePaymentRequestRemaining(sale, request) > 0)) return { stage: 'Deposit requested', next: 'Waiting for payment. The car is not reserved yet.', tone: 'blue' };
  if (sale.documents.some(document => document.type === 'invoice')) return { stage: 'Invoice created', next: moneyNote || 'Check the sale, then mark the car sold when agreed.', tone: 'blue' };
  return { stage: 'In progress', next: moneyNote || 'Choose the next step for this customer.', tone: 'neutral' };
}

export function SaleProgress({ sale }: { sale: SaleWorkspaceRecord | null }) {
  const progress = saleProgress(sale);
  return <div className="sales-flow-progress" role="status"><span data-tone={progress.tone}>{progress.tone === 'green' ? <Check size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}{progress.stage}</span><p>{progress.next}</p></div>;
}

export function SaleTimeline({ sale }: { sale: SaleWorkspaceRecord }) {
  const [expanded, setExpanded] = useState(false);
  const events = [...sale.events].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  return <section className="sales-flow-timeline" aria-label="What’s happened">
    <div><h2><History size={18} aria-hidden="true" />What’s happened</h2>{events.length > 3 && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Show less' : `See all (${events.length})`}</button>}</div>
    {events.length ? <ol>{(expanded ? events : events.slice(0, 3)).map(event => <li key={event.id}>
      <span className="sales-flow-timeline-dot" aria-hidden="true" /><div><strong>{event.description}</strong><small>{event.actor} · <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></small></div>
    </li>)}</ol> : <p>No actions saved yet.</p>}
  </section>;
}
