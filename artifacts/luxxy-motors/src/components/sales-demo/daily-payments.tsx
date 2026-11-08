import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { dailySalePaymentsPageSize, type DailySalePaymentRow, type DailySalePaymentsResult } from '@workspace/vehicle-meta';
import { ArrowLeft, WalletCards } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saleMoney, todayLondon } from './sales-controls';
import './daily-payments.css';

const paymentLabels: Record<DailySalePaymentRow['kind'], string> = {
  deposit: 'Deposit',
  'part-payment': 'Part payment',
  'final-payment': 'Final payment',
  refund: 'Refund',
  reversal: 'Payment reversal',
  'refund-correction': 'Refund correction',
};

function DailyPaymentRows({ title, note, rows, count, offset, hasMore, loading, pending = false, onPage, onOpenSale }: {
  title: string;
  note?: string;
  rows: DailySalePaymentRow[];
  count: number;
  offset: number;
  hasMore: boolean;
  loading: boolean;
  pending?: boolean;
  onPage: (offset: number) => void;
  onOpenSale: (saleId: string) => void;
}) {
  const heading = useId();
  return <section className="daily-payment-section" data-tone={pending && count > 0 ? 'pending' : undefined} aria-labelledby={heading}>
    <h2 id={heading}>{title}</h2>
    {note && <p>{note}</p>}
    {rows.length ? <table className="daily-payment-table" aria-labelledby={heading}>
      <thead><tr><th scope="col">Payment</th><th scope="col">Sale and reference</th><th scope="col">Amount</th></tr></thead>
      <tbody>{rows.map(row => <tr key={`${row.saleId}:${row.id}`}>
        <td><strong>{paymentLabels[row.kind]}</strong><small>{row.method}</small></td>
        <td>
          <button type="button" className="daily-payment-sale-link" onClick={() => onOpenSale(row.saleId)}>{row.saleReference}</button>
          {(row.vehicle || row.registration) && <small>{[row.vehicle, row.registration].filter(Boolean).join(' · ')}</small>}
          {row.reference && <small>Payment ref. {row.reference}</small>}
        </td>
        <td className="daily-payment-amount">{saleMoney(row.amountPence)}</td>
      </tr>)}</tbody>
    </table> : <p className="daily-payment-empty">No entries for this date.</p>}
    {(offset > 0 || hasMore) && <nav className="daily-payment-pagination" aria-label={`${title} pages`}>
      <span>{rows.length ? `${offset + 1}–${offset + rows.length} of ${count}` : `${count} entries`}</span>
      <Button variant="outline" disabled={loading || offset === 0} onClick={() => onPage(Math.max(0, offset - dailySalePaymentsPageSize))}>Previous</Button>
      <Button variant="outline" disabled={loading || !hasMore} onClick={() => onPage(offset + dailySalePaymentsPageSize)}>Next</Button>
    </nav>}
  </section>;
}

export function DailyPayments({ onBack, onOpenSale }: { onBack: () => void; onOpenSale: (saleId: string) => void }) {
  const [date, setDate] = useState(todayLondon);
  const [confirmedOffset, setConfirmedOffset] = useState(0);
  const [pendingOffset, setPendingOffset] = useState(0);
  const title = useId();
  const { data, isFetching, isError, refetch } = useQuery<DailySalePaymentsResult>({
    queryKey: ['sale-workspace', 'daily-payments', date, confirmedOffset, pendingOffset],
    enabled: Boolean(date),
    placeholderData: previous => previous?.date === date ? previous : undefined,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ date, confirmedOffset: String(confirmedOffset), pendingOffset: String(pendingOffset) });
      return customFetch<DailySalePaymentsResult>(`/api/sale-workspace/daily-payments?${params}`, { signal });
    },
  });
  function changeDate(value: string) {
    setDate(value);
    setConfirmedOffset(0);
    setPendingOffset(0);
  }
  return <section className="daily-payments" aria-labelledby={title}>
    <header className="daily-payments-header">
      <div>
        <Button variant="ghost" className="daily-payments-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/>Back to sales</Button>
        <h1 id={title}><WalletCards size={25} aria-hidden="true"/>Daily payments</h1>
        <p>Check payments and refunds recorded for the selected date.</p>
      </div>
      <div className="daily-payment-date">
        <label>Payment date<Input type="date" value={date} onChange={event => changeDate(event.target.value)}/></label>
        <Button variant="outline" onClick={() => changeDate(todayLondon())}>Today</Button>
      </div>
    </header>
    <div aria-busy={isFetching} className="daily-payment-content">
      {!date && <p role="status">Choose a date to see its payments.</p>}
      {date && isFetching && !data && <p role="status">Loading payments…</p>}
      {date && isError && <div role="alert" className="daily-payment-error">
        <p>Payments could not be loaded for this date.</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button>
      </div>}
      {date && data && <>
        <dl className="daily-payment-totals">
          <div><dt>Received</dt><dd>{saleMoney(data.totals.receivedPence)}</dd></div>
          <div><dt>Refunded</dt><dd>{saleMoney(data.totals.refundsPence)}</dd></div>
          <div data-tone="net"><dt>Net received</dt><dd>{saleMoney(data.totals.receivedPence - data.totals.refundsPence)}</dd></div>
          <div data-tone={data.totals.pendingCount > 0 ? 'pending' : undefined}><dt>Awaiting confirmation</dt><dd>{saleMoney(data.totals.pendingPence)}</dd></div>
        </dl>
        {data.methods.length > 0 && <details className="daily-payment-method-detail">
          <summary>By payment method</summary>
          <table className="daily-payment-table daily-payment-methods" aria-label="Confirmed money by payment method">
            <thead><tr><th scope="col">Method</th><th scope="col">Received</th><th scope="col">Refunded</th></tr></thead>
            <tbody>{data.methods.map(row => <tr key={row.method}><th scope="row">{row.method}</th><td>{saleMoney(row.receivedPence)}</td><td>{saleMoney(row.refundsPence)}</td></tr>)}</tbody>
          </table>
        </details>}
        <DailyPaymentRows title="Confirmed payments and refunds" note={data.totals.adjustmentCount > 0 ? `Ledger adjustments total ${saleMoney(data.totals.adjustmentsPence)} and are excluded from cash totals.` : undefined} rows={data.confirmed} count={data.totals.confirmedCount} offset={data.confirmedOffset} hasMore={data.confirmedHasMore} loading={isFetching} onPage={setConfirmedOffset} onOpenSale={onOpenSale}/>
        <DailyPaymentRows title="Awaiting confirmation" note="Payments expected on this date are listed here until staff confirm receipt." rows={data.pending} count={data.totals.pendingCount} offset={data.pendingOffset} hasMore={data.pendingHasMore} loading={isFetching} pending onPage={setPendingOffset} onOpenSale={onOpenSale}/>
      </>}
    </div>
  </section>;
}
