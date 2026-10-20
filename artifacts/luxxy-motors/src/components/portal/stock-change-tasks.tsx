import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { ArrowRight, Car, Check, ChevronDown } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { stockChangeDraftLink, stockChangeTasksQueryKey, type StockChangeTask, type useStockChangeTasks } from '@/lib/stock-change-tasks';
import { useStaffAccess } from './dealer-administration';
import './stock-change-tasks.css';

const money = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value);
const ukDate = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
const isUrgent = (task: StockChangeTask) => task.urgency === 'urgent' || task.upcomingAppointments > 0 || task.paidReservations > 0;
const limit = 4;

export function StockChangeTasks({ query, emailAccess, showEmpty = false }: {
  query: ReturnType<typeof useStockChangeTasks>;
  emailAccess: boolean;
  showEmpty?: boolean;
}) {
  const cache = useQueryClient();
  const access = useStaffAccess();
  const [customersOpen, setCustomersOpen] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const tasks = [...(query.data?.tasks ?? [])].sort((a, b) => Number(isUrgent(b)) - Number(isUrgent(a)) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const total = Math.max(query.data?.total ?? 0, tasks.length);
  const canReview = access.data?.permissions.includes('stock.manage') ?? false;
  if (!query.isLoading && !query.isError && !tasks.length && !showEmpty && !notice && !error) return null;

  async function review(task: StockChangeTask) {
    if (busy) return;
    setBusy(task.id); setError(''); setNotice('');
    try {
      await customFetch(`/api/staff/stock-change-tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: task.revision, action: 'reviewed' }),
      });
      setNotice(`${task.vehicleTitle} marked reviewed. Stock and customer commitments are unchanged.`);
      await query.refetch();
      await cache.invalidateQueries({ queryKey: ['dealer-operations'] });
    } catch (cause) {
      const conflict = Boolean(cause && typeof cause === 'object' && 'status' in cause && cause.status === 409);
      setError(conflict ? 'This stock change has been updated. The latest details are being loaded; review them before trying again.' : 'Could not mark this stock change reviewed. Please try again.');
      if (conflict) await cache.invalidateQueries({ queryKey: stockChangeTasksQueryKey });
    } finally { setBusy(null); }
  }

  return <section className="stock-change-tasks notifications-feed" aria-label="Stock changes">
    <header><div><h3>Stock changes <small>{total}</small></h3><p>Check the car and any customers affected. Customer emails are prepared for staff to review.</p></div></header>
    {query.isLoading && <p className="stock-change-state" role="status">Checking stock changes…</p>}
    {query.isError && <div className="stock-change-state stock-change-error"><p role="alert">Stock changes could not be refreshed.{tasks.length > 0 && ' The last loaded tasks are shown below.'}</p><Button size="sm" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Retry stock changes</Button></div>}
    {error && <p className="stock-change-state stock-change-error" role="alert">{error}</p>}
    {notice && <p className="stock-change-state stock-change-notice" role="status">{notice}</p>}
    <ul className="stock-change-list">{(expanded ? tasks : tasks.slice(0, limit)).map(task => {
      const open = customersOpen.has(task.id);
      const price = task.kind === 'price_drop';
      const customers = task.affectedCustomers ?? [];
      const hasCommitments = task.upcomingAppointments > 0 || task.paidReservations > 0;
      return <li key={task.id} className="stock-change-row" data-testid={`stock-change-${task.id}`} data-kind={task.kind} data-urgent={isUrgent(task)}>
        <div className="stock-change-summary">
          <Link href={`/portal?section=inventory&vehicleId=${encodeURIComponent(task.vehicleId)}`} className="stock-change-photo" aria-label={`Open ${task.vehicleTitle}`}>
            {task.imageUrl ? <img src={task.imageUrl} alt="" loading="lazy" /> : <Car size={26} aria-hidden="true" />}
          </Link>
          <div className="stock-change-copy">
            <div className="stock-change-labels"><span className="stock-change-kind">{price ? 'Price reduced' : 'Check availability'}</span>{isUrgent(task) && <span className="stock-change-urgent">Customer commitment to check</span>}</div>
            <h4><Link href={`/portal?section=inventory&vehicleId=${encodeURIComponent(task.vehicleId)}`}>{task.vehicleTitle}</Link></h4>
            {task.registration && <p className="stock-change-registration">{task.registration}</p>}
            {price ? <div className="stock-change-price">{task.previousPrice !== null && task.currentPrice !== null && <><del>{money(task.previousPrice)}</del><ArrowRight size={15} aria-hidden="true" /><strong>{money(task.currentPrice)}</strong></>}{task.reduction !== null && task.reduction > 0 && <span>Reduced by {money(task.reduction)}</span>}</div> : <><p className="stock-change-explanation">Not in the latest stock update. This does not confirm it is sold.</p><p className="stock-change-status">{task.publiclyVisible ? 'Still on the website — confirm availability.' : 'Hidden from public stock — check availability before contacting customers.'}{task.lastSeenAt && <> Last seen {ukDate(task.lastSeenAt)}.</>}</p></>}
            <div className="stock-change-impact"><span>{!customers.length && hasCommitments ? 'Open vehicle history to review the linked bookings and payments.' : `${customers.length} ${customers.length === 1 ? 'customer' : 'customers'} to review`}</span>{task.upcomingAppointments > 0 && <strong>{task.upcomingAppointments} booked {task.upcomingAppointments === 1 ? 'visit' : 'visits'}</strong>}{task.paidReservations > 0 && <strong>{task.paidReservations} paid {task.paidReservations === 1 ? 'reservation' : 'reservations'}</strong>}</div>
          </div>
          <div className="stock-change-actions">
            {customers.length > 0 && <Button type="button" size="sm" variant="outline" aria-expanded={open} aria-controls={`stock-customers-${task.id}`} onClick={() => setCustomersOpen(current => { const next = new Set(current); open ? next.delete(task.id) : next.add(task.id); return next; })}>{price ? 'Review interested customers' : 'Review affected customers'}<ChevronDown size={14} aria-hidden="true" className={open ? 'stock-change-chevron-open' : ''} /></Button>}
            {hasCommitments && <Link href={`/portal?section=history&view=vehicles&vehicleId=${encodeURIComponent(task.vehicleId)}`}>Review bookings &amp; payments<ArrowRight size={14} aria-hidden="true" /></Link>}
            <Link href={`/portal?section=inventory&vehicleId=${encodeURIComponent(task.vehicleId)}`}>Open car<ArrowRight size={14} aria-hidden="true" /></Link>
            {canReview && <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void review(task)} title="Closes this task only. It does not change stock, bookings, prices or payments."><Check size={14} aria-hidden="true" />{busy === task.id ? 'Marking reviewed…' : 'Mark reviewed'}</Button>}
          </div>
        </div>
        {open && <div id={`stock-customers-${task.id}`} className="stock-change-customers">
          <p className="stock-change-draft-note">Prepare a draft, check the details, then send it from Email. Existing bookings, agreed prices and payments stay unchanged.</p>
          <ul aria-label={`Customers affected by ${task.vehicleTitle}`}>{customers.map(customer => <li key={customer.enquiryId}>
            <div><h5><Link href={`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(customer.enquiryId)}`}>{customer.customerName}</Link></h5>{customer.email && <p className="stock-change-contact">{customer.email}</p>}{customer.phone && <p>{customer.phone}</p>}{customer.preferredContact && <p>Prefers {customer.preferredContact}</p>}{customer.appointmentAt && <p className="stock-change-visit">Visit {ukDate(customer.appointmentAt)}{customer.appointmentStatus ? ` (${customer.appointmentStatus.replaceAll('_', ' ')})` : ''}</p>}</div>
            <div className="stock-change-customer-actions">{customer.phone && <a href={`tel:${customer.phone.replace(/[^+\d]/g, '')}`}>Call</a>}{emailAccess && customer.email ? <Link href={stockChangeDraftLink(task.id, customer.enquiryId)}>Prepare email draft</Link> : <span>{customer.email ? 'Email access required' : 'No email address'}</span>}</div>
          </li>)}</ul>
        </div>}
      </li>;
    })}</ul>
    {tasks.length > limit && <div className="notifications-expand"><Button type="button" variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer stock changes' : `Show all ${tasks.length} stock changes`}</Button></div>}
    {total > tasks.length && <p className="stock-change-state">Showing {tasks.length} of {total} open stock changes. Review these to load older changes.</p>}
    {query.isSuccess && !tasks.length && showEmpty && <p className="stock-change-state">No stock changes need review.</p>}
  </section>;
}
