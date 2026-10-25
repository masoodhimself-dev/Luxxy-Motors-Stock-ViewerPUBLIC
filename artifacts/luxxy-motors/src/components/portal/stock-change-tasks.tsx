import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch, getGetEnquiriesQueryKey } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { ArrowRight, Car, Check, ChevronDown, Mail, MessageCircle, Phone } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { customerWhatsAppNumber } from '@/lib/customer-whatsapp';
import { stockChangeDraftLink, stockChangeTasksQueryKey, type StockChangeCustomer, type StockChangeTask, type useStockChangeTasks } from '@/lib/stock-change-tasks';
import { useStaffAccess } from './dealer-administration';
import './stock-change-tasks.css';

const money = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value);
const ukDate = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
const isUrgent = (task: StockChangeTask) => task.urgency === 'urgent' || task.upcomingAppointments > 0 || task.paidReservations > 0;
const limit = 4;
const statusOf = (customer: StockChangeCustomer) => customer.outcome?.status ?? 'pending';
const needsDecision = (customer: StockChangeCustomer) => ['pending', 'follow_up'].includes(statusOf(customer));
const outcomeLabel = (customer: StockChangeCustomer) => {
  const outcome = customer.outcome;
  if (outcome?.status === 'contacted') return `Contacted${outcome.channel ? ` by ${outcome.channel === 'call' ? 'phone' : outcome.channel === 'whatsapp' ? 'WhatsApp' : 'email'}` : ''}`;
  if (outcome?.status === 'not_needed') return 'Not needed';
  if (outcome?.status === 'follow_up') return outcome.followUpAt ? `Follow up ${ukDate(outcome.followUpAt)}` : 'Follow-up needed';
  return 'To contact';
};

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
  const [contact, setContact] = useState<{ taskId: string; enquiryId: string } | null>(null);
  const [action, setAction] = useState<'' | 'contacted' | 'not_needed' | 'follow_up'>('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [note, setNote] = useState('');
  const [contactError, setContactError] = useState('');
  const tasks = [...(query.data?.tasks ?? [])].sort((a, b) => Number(isUrgent(b)) - Number(isUrgent(a)) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const total = Math.max(query.data?.total ?? 0, tasks.length);
  const canReview = access.data?.permissions.includes('stock.manage') ?? false;
  const canContact = access.data?.permissions.includes('sales.manage') ?? false;
  const selectedTask = tasks.find(task => task.id === contact?.taskId);
  const priceContactAvailable = selectedTask?.kind !== 'price_drop' || selectedTask?.availableForPriceUpdate !== false;
  const selectedCustomer = selectedTask?.affectedCustomers.find(customer => customer.enquiryId === contact?.enquiryId);
  if (!query.isLoading && !query.isError && !tasks.length && !showEmpty && !notice && !error) return null;

  function openContact(task: StockChangeTask, customer: StockChangeCustomer) {
    setContact({ taskId: task.id, enquiryId: customer.enquiryId });
    setAction('');
    setFollowUpAt(''); setNote(''); setContactError('');
  }
  async function refresh() {
    await query.refetch();
    await cache.invalidateQueries({ queryKey: ['dealer-operations'] });
  }
  async function review(task: StockChangeTask) {
    if (busy) return;
    setBusy(task.id); setError(''); setNotice('');
    try {
      await customFetch(`/api/staff/stock-change-tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: task.revision, action: 'reviewed' }),
      });
      setNotice(`${task.vehicleTitle} marked reviewed. Stock and customer commitments are unchanged.`);
      await refresh();
    } catch (cause) {
      const conflict = Boolean(cause && typeof cause === 'object' && 'status' in cause && cause.status === 409);
      setError(conflict ? 'This stock change has been updated. The latest details are being loaded; review them before trying again.' : 'Could not mark this stock change reviewed. Please try again.');
      if (conflict) await cache.invalidateQueries({ queryKey: stockChangeTasksQueryKey });
    } finally { setBusy(null); }
  }
  async function saveOutcome(event: FormEvent) {
    event.preventDefault();
    if (!selectedTask || !selectedCustomer || busy || !canContact) return;
    if (!action) { setContactError('Choose an outcome before saving.'); return; }
    const parsed = followUpAt ? new Date(followUpAt) : null;
    if (action === 'follow_up' && (!parsed || !Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now())) {
      setContactError('Choose a future date and time for the follow-up.'); return;
    }
    setBusy(`${selectedTask.id}:${selectedCustomer.enquiryId}`); setContactError(''); setNotice('');
    try {
      await customFetch(`/api/staff/stock-change-tasks/${encodeURIComponent(selectedTask.id)}/customers/${encodeURIComponent(selectedCustomer.enquiryId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: selectedTask.revision, expectedCustomerRevision: selectedCustomer.outcome?.revision ?? 0, action, ...(action === 'contacted' ? { channel: 'call' } : {}), ...(action === 'follow_up' ? { followUpAt: parsed!.toISOString() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      setNotice(`${selectedCustomer.customerName}: ${action === 'contacted' ? 'phone contact recorded' : action === 'not_needed' ? 'marked not needed' : 'follow-up saved'}.`);
      setContact(null);
      await refresh();
      await Promise.all([cache.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }), cache.invalidateQueries({ queryKey: ['staff-notifications'] })]);
    } catch (cause) {
      const conflict = Boolean(cause && typeof cause === 'object' && 'status' in cause && cause.status === 409);
      setContactError(conflict ? `${(cause as { data?: { error?: string } }).data?.error || 'This car or customer follow-up has changed.'} The latest details are being loaded. Check them before saving again, or open the customer’s enquiry to review an existing follow-up.` : 'The customer follow-up could not be saved. Nothing was marked complete. Try again.');
      if (conflict) await refresh();
    } finally { setBusy(null); }
  }

  return <section className="stock-change-tasks notifications-feed" aria-label="Stock changes">
    <header><div><h3>Stock changes <small>{total}</small></h3><p>Review affected customers and choose how to contact them. Messages are always sent by staff.</p></div></header>
    {query.isLoading && <p className="stock-change-state" role="status">Checking stock changes…</p>}
    {query.isError && <div className="stock-change-state stock-change-error"><p role="alert">Stock changes could not be refreshed.{tasks.length > 0 && ' The last loaded tasks are shown below.'}</p><Button size="sm" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Retry stock changes</Button></div>}
    {error && <p className="stock-change-state stock-change-error" role="alert">{error}</p>}
    {notice && <p className="stock-change-state stock-change-notice" role="status">{notice}</p>}
    <ul className="stock-change-list">{(expanded ? tasks : tasks.slice(0, limit)).map(task => {
      const open = customersOpen.has(task.id);
      const price = task.kind === 'price_drop';
      const customers = task.affectedCustomers ?? [];
      const customerTotal = Math.max(task.customerTotal ?? customers.length, customers.length);
      const remaining = task.pendingCustomerTotal ?? customers.filter(needsDecision).length;
      const pendingSuggested = price && remaining > 0;
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
            {price && task.availableForPriceUpdate === false && <p className="stock-change-availability-note">This car is reserved or unavailable. Review availability before sending a price update.</p>}
            <div className="stock-change-impact"><span>{!customerTotal && hasCommitments ? 'Open vehicle history to review the linked bookings and payments.' : `${remaining} of ${customerTotal} ${customerTotal === 1 ? 'customer' : 'customers'} remaining`}</span>{task.upcomingAppointments > 0 && <strong>{task.upcomingAppointments} booked {task.upcomingAppointments === 1 ? 'visit' : 'visits'}</strong>}{task.paidReservations > 0 && <strong>{task.paidReservations} paid {task.paidReservations === 1 ? 'reservation' : 'reservations'}</strong>}</div>
          </div>
          <div className="stock-change-actions">
            {customerTotal > 0 && <Button type="button" size="sm" variant="outline" aria-expanded={open} aria-controls={`stock-customers-${task.id}`} onClick={() => setCustomersOpen(current => { const next = new Set(current); open ? next.delete(task.id) : next.add(task.id); return next; })}>{price ? 'Review interested customers' : 'Review affected customers'}<ChevronDown size={14} aria-hidden="true" className={open ? 'stock-change-chevron-open' : ''} /></Button>}
            {hasCommitments && <Link href={`/portal?section=history&view=vehicles&vehicleId=${encodeURIComponent(task.vehicleId)}`}>Review bookings &amp; payments<ArrowRight size={14} aria-hidden="true" /></Link>}
            <Link href={`/portal?section=inventory&vehicleId=${encodeURIComponent(task.vehicleId)}`}>Open car<ArrowRight size={14} aria-hidden="true" /></Link>
            {canReview && <Button type="button" size="sm" variant="ghost" disabled={busy !== null || pendingSuggested} onClick={() => void review(task)} title={pendingSuggested ? 'Record an outcome for the remaining customers first.' : 'Closes this task only. Stock, bookings, prices and payments are unchanged.'}><Check size={14} aria-hidden="true" />{busy === task.id ? 'Marking reviewed…' : 'Mark reviewed'}</Button>}
          </div>
        </div>
        {open && <div id={`stock-customers-${task.id}`} className="stock-change-customers">
          <p className="stock-change-draft-note">Choose Email, WhatsApp or Call, then record the next step. Existing bookings, agreed prices and payments stay unchanged.</p>
          {customerTotal > customers.length && <p className="stock-change-draft-note" role="status">Showing {customers.length} of {customerTotal} customers. Remaining customers appear as you record outcomes.</p>}
          <ul aria-label={`Customers affected by ${task.vehicleTitle}`}>{customers.map(customer => <li key={customer.enquiryId}>
            <div><h5><Link href={`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(customer.enquiryId)}`}>{customer.customerName}</Link></h5><span className="stock-change-outcome" data-status={statusOf(customer)}>{outcomeLabel(customer)}</span>{customer.email && <p className="stock-change-contact">{customer.email}</p>}{customer.phone && <p>{customer.phone}</p>}{customer.preferredContact && <p>Prefers {customer.preferredContact}</p>}{customer.appointmentAt && <p className="stock-change-visit">Visit {ukDate(customer.appointmentAt)}{customer.appointmentStatus ? ` (${customer.appointmentStatus.replaceAll('_', ' ')})` : ''}</p>}{customer.outreach?.reason === 'recently_contacted' && <p className="stock-change-contact-reason">Recently contacted{customer.outreach.nextContactAt ? ` · next suggested ${ukDate(customer.outreach.nextContactAt)}` : ''}. Contact again only if useful.</p>}{customer.outreach?.reason === 'below_minimum_reduction' && <p className="stock-change-contact-reason">Below your price-update reminder threshold. Review only if useful.</p>}{customer.outcome?.note && <p className="stock-change-outcome-note">{customer.outcome.note}</p>}</div>
            <div className="stock-change-customer-actions">{canContact ? <Button size="sm" variant={needsDecision(customer) ? 'default' : 'outline'} type="button" onClick={() => openContact(task, customer)}>{needsDecision(customer) ? 'Contact customer' : 'View contact options'}</Button> : <span>Customer contact permission required</span>}</div>
          </li>)}</ul>
          {pendingSuggested && <p className="stock-change-draft-note">Record each customer’s outcome before marking this price update reviewed. A later follow-up stays on Home.</p>}
        </div>}
      </li>;
    })}</ul>
    {tasks.length > limit && <div className="notifications-expand"><Button type="button" variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer stock changes' : `Show all ${tasks.length} stock changes`}</Button></div>}
    {total > tasks.length && <p className="stock-change-state">Showing {tasks.length} of {total} open stock changes. Review these to load older changes.</p>}
    {query.isSuccess && !tasks.length && showEmpty && <p className="stock-change-state">No stock changes need review.</p>}
    <Dialog open={Boolean(contact)} onOpenChange={open => { if (!open && !busy) setContact(null); }}>
      <DialogContent className="stock-change-contact-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Contact customer</DialogTitle><DialogDescription>{selectedCustomer ? `${selectedCustomer.customerName} · ${selectedTask?.vehicleTitle}` : 'This stock change is no longer open. Close this panel and review the latest stock changes.'}</DialogDescription></DialogHeader>
        {selectedTask && selectedCustomer && <>
          <p className="stock-change-current-outcome">{outcomeLabel(selectedCustomer)}</p>
          {!priceContactAvailable && <p role="status" className="stock-change-availability-note">This car is reserved or unavailable. Review availability before sending a price update.</p>}
          <div className="stock-change-channel-options">
            {priceContactAvailable && emailAccess && selectedCustomer.email ? <Link href={stockChangeDraftLink(selectedTask.id, selectedCustomer.enquiryId)} aria-disabled={Boolean(busy)} onClick={event => { if (busy) event.preventDefault(); else setContact(null); }}><Mail size={18} aria-hidden="true" /><span>Email<small>Review the draft before sending</small></span><ArrowRight size={16} aria-hidden="true" /></Link> : priceContactAvailable && <p>{selectedCustomer.email ? 'Email access required' : 'No email address'}</p>}
            {priceContactAvailable && customerWhatsAppNumber(selectedCustomer.phone ?? '') ? <Link href={stockChangeDraftLink(selectedTask.id, selectedCustomer.enquiryId, 'whatsapp')} aria-disabled={Boolean(busy)} onClick={event => { if (busy) event.preventDefault(); else setContact(null); }}><MessageCircle size={18} aria-hidden="true" /><span>WhatsApp QR<small>Review and send from your phone</small></span><ArrowRight size={16} aria-hidden="true" /></Link> : priceContactAvailable && <p>{selectedCustomer.phone ? 'Check the customer number before using WhatsApp.' : 'No phone number'}</p>}
            {selectedCustomer.phone && <a href={`tel:${selectedCustomer.phone.replace(/[^+\d]/g, '')}`} aria-disabled={Boolean(busy)} onClick={event => { if (busy) event.preventDefault(); }}><Phone size={18} aria-hidden="true" /><span>Call<small>{selectedCustomer.phone}</small></span><ArrowRight size={16} aria-hidden="true" /></a>}
          </div>
          <form onSubmit={saveOutcome} className="stock-change-outcome-form">
            <h3>Record the next step</h3><p>Email sends and “I’ve sent it” in WhatsApp record contact automatically. Opening a link does not mark the customer contacted.</p>
            <label htmlFor="stock-contact-action">Outcome</label><NativeSelect id="stock-contact-action" required value={action} onChange={event => { setAction(event.target.value as typeof action); setContactError(''); }} disabled={Boolean(busy)}><option value="" disabled>Choose an outcome…</option><option value="contacted">I spoke to them by phone</option><option value="not_needed">No contact needed</option><option value="follow_up">Follow up later</option></NativeSelect>
            {action === 'follow_up' && <><label htmlFor="stock-contact-followup">Follow-up date and time (your device’s time zone)</label><Input id="stock-contact-followup" type="datetime-local" value={followUpAt} onChange={event => setFollowUpAt(event.target.value)} required disabled={Boolean(busy)} /></>}
            <label htmlFor="stock-contact-note">Private note (optional)</label><Textarea id="stock-contact-note" value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={2} disabled={Boolean(busy)} />
            {contactError && <p role="alert" className="stock-change-error">{contactError}</p>}
            <div className="stock-change-outcome-actions"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setContact(null)}>Cancel</Button><Button type="submit" disabled={Boolean(busy) || !action}>{busy ? 'Saving…' : 'Save outcome'}</Button></div>
          </form>
        </>}
      </DialogContent>
    </Dialog>
  </section>;
}
