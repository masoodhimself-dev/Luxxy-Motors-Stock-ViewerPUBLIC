import { saleDepositConfirmationShared, saleHandoverStatus, saleStockConflictRefundDue, saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { bookingDateLabel } from '@/lib/test-drive-dates';
import { saleMoney } from './sales-controls';
import './sale-quick-flow.css';

export function SaleHandoverSummary({ sale }: { sale: SaleWorkspaceRecord }) {
  const totals = saleWorkspaceTotals(sale.draft, sale.payments);
  const transferred = (sale.draft.creditEntries ?? []).reduce((sum, credit) => sum + credit.signedAmountPence, 0);
  const cash = totals.confirmedPaid - transferred;
  const refund = saleStockConflictRefundDue(sale);
  const returned = sale.lifecycle?.status === 'returned' || sale.standaloneReturn || sale.returnReplacement?.direction === 'returned';
  const released = sale.lifecycle?.status === 'released';
  const correction = !sale.standaloneReturn && (sale.corrections?.length ||
    (sale.completedAt && sale.payments.some(payment => payment.status === 'confirmed' && payment.signedAmountPence < 0)));
  const money = [
    refund ? `${saleMoney(refund)} to refund.` : cash > 0 ? `${saleMoney(cash)} received.` : cash < 0 ? `${saleMoney(-cash)} net paid out.` : '',
    !refund && transferred > 0 ? `${saleMoney(transferred)} transferred credit.` : '',
    !refund && correction ? 'Balance needs review.' : '',
    !refund && !correction && totals.balance < 0 ? `${saleMoney(-totals.balance)} to return.` : '',
    !refund && !correction && !returned && !released && totals.balance >= 0 && totals.totalDue > 0
      ? totals.balance === 0 ? 'Balance settled.' : `${saleMoney(totals.balance)} left to pay.` : '',
    totals.pending > 0 ? `${saleMoney(totals.pending)} awaiting confirmation.` : '',
  ].filter(Boolean);
  const receipt = [...sale.payments].reverse().find(payment =>
    payment.kind === 'deposit' && payment.status === 'confirmed' && payment.signedAmountPence > 0 &&
    sale.documents.some(document => document.id === payment.receiptId && document.type === 'receipt') &&
    !sale.payments.some(correction => correction.status === 'confirmed' && correction.reversesPaymentId === payment.id));
  const receiptNote = !returned && !released && receipt?.receiptId
    ? saleDepositConfirmationShared(sale, receipt.receiptId) ? 'Deposit receipt shared.' : 'Deposit receipt ready to share.'
    : '';

  const fulfilment = sale.draft.fulfilment;
  const status = saleHandoverStatus(fulfilment);
  const method = fulfilment?.method === 'delivery' ? 'Delivery' : 'Collection';
  const bookedDate = fulfilment?.scheduledDate;
  const date = bookedDate && Number.isFinite(Date.parse(`${bookedDate}T12:00:00Z`)) ? bookingDateLabel(bookedDate) : '';
  const handover = returned || released ? ''
    : status === 'Collected' || status === 'Delivered' ? `${status}.`
    : status === 'On the way' ? 'Delivery on the way.'
    : status === 'Delivery needs rearranging' ? `${method} needs rearranging.`
    : status === 'Booked' && date ? `${method} booked for ${date}${fulfilment?.timeWindow ? `, ${fulfilment.timeWindow}` : ''}.`
    : `${method} to arrange.`;

  const summary = [...money, receiptNote, handover].filter(Boolean).join(' ');
  if (!summary) return null;
  return <section className="sale-handover-summary" aria-label="Sale at a glance">
    <h2>Sale at a glance</h2>
    <p>{summary}</p>
  </section>;
}
