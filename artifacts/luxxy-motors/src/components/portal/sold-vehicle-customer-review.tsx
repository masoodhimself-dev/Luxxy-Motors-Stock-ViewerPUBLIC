import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { CalendarClock, Check, ChevronDown, Mail, Phone } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { soldVehicleFollowUpsQueryKey, soldVehicleReviewPath, soldVehicleReviewQueryKey, type SoldVehicleCustomer, type SoldVehicleFollowUpReview, type useSoldVehicleFollowUps } from '@/lib/sold-vehicle-follow-ups';
import { useStaffAccess } from './dealer-administration';
import { SoldVehicleEmailComposer } from './sold-vehicle-email-composer';
import './sold-vehicle-customer-review.css';

const date = (at: string) => new Date(at).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
const pending = (row: SoldVehicleCustomer) => row.status === 'pending';
const needsCancellation = (row: SoldVehicleCustomer) => row.kind === 'appointment' && (row.appointments
  ? row.appointments.some(item => !item.cancelledAt && Date.parse(item.at) > Date.now())
  : !row.appointmentCancelledAt && Boolean(row.appointmentAt && Date.parse(row.appointmentAt) > Date.now()));
const emailLabel = (status: SoldVehicleCustomer['emailStatus']) => ['delivered', 'opened', 'clicked'].includes(status ?? '') ? 'Email delivered' : status === 'sent' ? 'Email sent — awaiting delivery' : status === 'unknown' ? 'Delivery unconfirmed — check Email before resending' : ['prepared', 'sending', 'scheduled', 'queued', 'delivery_delayed'].includes(status ?? '') ? 'Approved email queued — check Email' : status ? `Email ${status} — contact customer` : null;

/** Works before mark-sold as a read-only preview, then as a durable review from sales or Home. */
export function SoldVehicleCustomerReview({ saleId, onComplete }: { saleId: string; onComplete?: () => void }) {
  const cache = useQueryClient();
  const access = useStaffAccess();
  const path = soldVehicleReviewPath(saleId), key = soldVehicleReviewQueryKey(saleId);
  const query = useQuery({ queryKey: key, queryFn: () => customFetch<SoldVehicleFollowUpReview>(path),
    retry: false, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [emailQueue, setEmailQueue] = useState<string[]>([]);
  const [bulkChoice, setBulkChoice] = useState<'email' | 'phone' | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const review = query.data;
  const canManage = Boolean(access.data?.permissions.includes('sales.manage'));
  const emailAccess = canManage;
  const rows = review?.customers ?? [];
  const appointments = rows.filter(row => row.kind === 'appointment');
  const interests = rows.filter(row => row.kind === 'interest');
  const cancellable = appointments.filter(row => pending(row) && needsCancellation(row) && !row.blockedReason);
  const selected = selection ?? new Set(cancellable.map(row => row.enquiryId));
  const selectedRows = cancellable.filter(row => selected.has(row.enquiryId));
  const composing = rows.find(row => row.enquiryId === emailQueue[0]);
  async function refresh() {
    const latest = await query.refetch();
    await Promise.all([cache.invalidateQueries({ queryKey: soldVehicleFollowUpsQueryKey }),
      cache.invalidateQueries({ queryKey: ['staff-notifications'] }), cache.invalidateQueries({ queryKey: ['dealer-operations'] }),
      cache.invalidateQueries({ queryKey: ['/api/enquiries'] })]);
    if (latest.data?.remaining === 0) onComplete?.();
    return latest.data;
  }
  async function mutate(row: SoldVehicleCustomer, action: 'cancel_appointment' | 'complete', outcome?: 'phone' | 'email' | 'not_needed', note?: string) {
    return customFetch(`${path}/customers/${encodeURIComponent(row.enquiryId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, expectedRevision: row.revision, ...(action === 'cancel_appointment'
        ? { expectedAppointmentRevision: row.appointmentRevision, ...(row.appointments ? { expectedAppointments: row.appointments.filter(item => !item.cancelledAt && Date.parse(item.at) > Date.now()).map(item => ({ enquiryId: item.enquiryId, expectedRevision: item.revision })) } : {}) }
        : { outcome, ...(note ? { note } : {}) }) }) });
  }
  function failure(cause: unknown) {
    const conflict = Boolean(cause && typeof cause === 'object' && 'status' in cause && cause.status === 409);
    setError(conflict ? 'A booking or customer was updated by someone else. The latest details are being loaded; check them before continuing.'
      : 'This update could not be confirmed. Check the refreshed list before trying again. Unfinished work stays on Home.');
  }
  async function cancel(rowsToCancel: SoldVehicleCustomer[], prepareEmail: boolean) {
    if (busy || !rowsToCancel.length) return;
    setBusy(true); setError(''); setNotice(''); setBulkChoice(null);
    const completed: string[] = [];
    try {
      for (const row of rowsToCancel) { await mutate(row, 'cancel_appointment'); completed.push(row.enquiryId); }
      setNotice(`${completed.length} ${completed.length === 1 ? 'customer’s appointment cancelled' : 'customers’ appointments cancelled'}. ${prepareEmail ? 'Review each email before sending.' : 'Call each customer, then record the conversation below.'}`);
    } catch (cause) { failure(cause); }
    finally {
      await refresh(); setSelection(new Set()); setBusy(false);
      if (prepareEmail) setEmailQueue(completed.filter(id => rowsToCancel.find(row => row.enquiryId === id)?.email));
    }
  }
  async function complete(row: SoldVehicleCustomer, outcome: 'phone' | 'email' | 'not_needed', note?: string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await mutate(row, 'complete', outcome, note); setNotice(outcome === 'phone' ? 'Customer contact recorded.' : outcome === 'email' ? 'The existing email submission has been confirmed. No second email was sent.' : note ? 'Follow-up reviewed with your note. No customer contact has been claimed.' : 'Optional update marked not needed. The enquiry stays open.'); }
    catch (cause) { failure(cause); }
    finally { await refresh(); setBusy(false); }
  }
  if (query.isLoading) return <section className="sold-customer-review" aria-label="Sold car customers"><p role="status">Checking other bookings and interested customers…</p></section>;
  if (query.isError && !review) return <section className="sold-customer-review" aria-label="Sold car customers"><p role="alert">Other bookings and interested customers could not be loaded.</p><Button type="button" variant="outline" onClick={() => void query.refetch()}>Retry customer review</Button></section>;
  if (!review) return null;

  function customerRows(customers: SoldVehicleCustomer[]) {
    return <ul className="sold-customer-list">{customers.map(row => {
      const cancelled = row.kind === 'appointment' && Boolean(row.cancelledByReview || row.appointmentCancelledAt);
      const status = emailLabel(row.emailStatus);
      const emailSubmitted = ['sent', 'delivered', 'opened', 'clicked'].includes(row.emailStatus ?? '');
      const needsResolutionNote = Boolean(row.blockedReason || (row.kind === 'appointment' && !needsCancellation(row) && !row.email && !row.phone));
      return <li key={row.enquiryId} data-urgent={row.urgent && pending(row)} data-complete={!pending(row)}>
        <div className="sold-customer-main">
          {review!.sold && needsCancellation(row) && pending(row) && canManage && !row.blockedReason && <label className="sold-customer-select"><input type="checkbox" checked={selected.has(row.enquiryId)} disabled={busy} aria-label={`Select ${row.customerName} for cancellation`} onChange={event => { const next = new Set(selected); event.target.checked ? next.add(row.enquiryId) : next.delete(row.enquiryId); setSelection(next); setBulkChoice(null); }} /></label>}
          <div className="sold-customer-details"><h5><Link href={`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(row.enquiryId)}`}>{row.customerName}</Link></h5>
            {row.appointmentAt && <p className="sold-customer-date"><CalendarClock size={14} aria-hidden="true"/>{date(row.appointmentAt)}{(row.appointments?.length ?? 0) > 1 && <span>+ {row.appointments!.length - 1} other booking{row.appointments!.length > 2 ? 's' : ''}</span>}</p>}
            {row.urgent && pending(row) && <strong className="sold-customer-urgent">Call before they travel</strong>}
            {row.email && <p>{row.email}</p>}{row.phone && <p>{row.phone}{row.preferredContact === 'phone' && <span> · Prefers phone</span>}</p>}
            {cancelled && <span className="sold-customer-badge">Appointment cancelled{pending(row) ? ' — contact customer' : ''}</span>}
            {status && <p className="sold-customer-email-state">{status}</p>}
            {row.blockedReason && <p className="sold-customer-urgent" role="status">{row.blockedReason} Open the customer record to review what changed.</p>}
            {!pending(row) && <p className="sold-customer-done"><Check size={14} aria-hidden="true"/>{row.outcome === 'phone' ? 'Contact recorded by phone' : row.outcome === 'not_needed' ? row.kind === 'interest' && !row.note ? 'Optional update not needed' : 'Follow-up reviewed — see staff note' : status || 'Email sent'}</p>}
            {row.note && <p>{row.note}</p>}
          </div>
        </div>
        {review!.sold && pending(row) && <div className="sold-customer-actions">
          {row.phone && <a href={`tel:${row.phone.replace(/[^+\d]/g, '')}`}><Phone size={14} aria-hidden="true"/>Call customer</a>}
          {canManage && !row.blockedReason && <>
            {needsCancellation(row) ? <>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setSelection(new Set([row.enquiryId])); setBulkChoice(row.email && emailAccess ? 'email' : 'phone'); }}>Cancel appointment…</Button>
            </> : <>
              {row.email && emailAccess && !row.emailStatus && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEmailQueue([row.enquiryId])}><Mail size={14} aria-hidden="true"/>{cancelled ? 'Review cancellation email' : 'Prepare sold update'}</Button>}
              {emailSubmitted && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void complete(row, 'email')}>Email already submitted — finish follow-up</Button>}
              {row.emailStatus && <Link href={`/portal?section=notifications&workView=email&enquiryId=${encodeURIComponent(row.enquiryId)}`}>Check email history</Link>}
              {row.phone && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void complete(row, 'phone')}>I’ve spoken to them</Button>}
              {row.kind === 'interest' && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void complete(row, 'not_needed')}>Update not needed</Button>}
            </>}
          </>}
          {!row.email && <span>{!row.phone ? 'No usable email or phone — review the customer’s contact details' : row.emailBlocked ? 'Email unavailable after a delivery issue — contact by phone' : 'No email — contact by phone'}</span>}
          {row.email && !emailAccess && <span>Email access required</span>}
          {needsCancellation(row) && <span>Cancel the booking before completing this follow-up.</span>}
          {canManage && needsResolutionNote && <div className="sold-customer-resolution"><label>Resolution note<textarea aria-label={`Resolution note for ${row.customerName}`} value={resolutionNotes[row.enquiryId] ?? ''} maxLength={2000} rows={2} onChange={event => setResolutionNotes(current => ({ ...current, [row.enquiryId]: event.target.value }))} placeholder={row.blockedReason ? 'Explain where this customer or booking is being handled.' : 'Record that no usable contact details are available.'} /></label><Button type="button" size="sm" variant="outline" disabled={busy || (resolutionNotes[row.enquiryId]?.trim().length ?? 0) < 5} onClick={() => void complete(row, 'not_needed', resolutionNotes[row.enquiryId].trim())}>{row.blockedReason ? 'Record handled elsewhere' : 'Unable to contact — details unavailable'}</Button></div>}
        </div>}
      </li>;
    })}</ul>;
  }
  return <section className="sold-customer-review" aria-label="Sold car customers">
    <header><div><h3>{review.sold ? 'Customers to update' : 'Other customers interested in this car'}</h3><p>{review.sold ? `${review.remaining} ${review.remaining === 1 ? 'follow-up' : 'follow-ups'} left. Unfinished work stays on Home.` : 'When you mark this car sold, review the remaining visits and customer updates here.'}</p></div><span className="sold-review-count">{appointments.filter(pending).length} booked · {interests.filter(pending).length} interested</span></header>
    {error && <p className="sold-review-error" role="alert">{error}</p>}{notice && <p className="sold-review-notice" role="status">{notice}</p>}
    {review.sold && cancellable.length > 0 && canManage && <div className="sold-review-bulk">
      <p><strong>{selectedRows.length} selected</strong> · Cancel these visits, then contact each customer. No email is sent automatically.</p>
      {!bulkChoice ? <div><Button type="button" size="sm" disabled={busy || !selectedRows.some(row => row.email) || !emailAccess} onClick={() => setBulkChoice('email')}>Cancel selected &amp; prepare emails</Button><Button type="button" size="sm" variant="outline" disabled={busy || !selectedRows.length} onClick={() => setBulkChoice('phone')}>Cancel selected — I’ll call</Button></div>
        : <div className="sold-review-confirm" role="group" aria-label="Confirm appointment cancellations"><p>Cancel appointments for {selectedRows.map(row => row.customerName).join(', ')}? Their reminders will stop. {bulkChoice === 'email' ? 'You will review and send each email next; customers without email still need a call.' : 'Record each call afterwards.'}</p><Button type="button" size="sm" disabled={busy || !selectedRows.length} onClick={() => void cancel(selectedRows, bulkChoice === 'email')}>Confirm cancellation of {selectedRows.length} {selectedRows.length === 1 ? 'customer’s visits' : 'customers’ visits'}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setBulkChoice(null)} disabled={busy}>Keep appointments</Button></div>}
    </div>}
    {appointments.length > 0 && <div className="sold-review-group"><h4>Test drives <span>{appointments.length}</span></h4>{customerRows(appointments)}</div>}
    {interests.length > 0 && <details className="sold-review-group sold-review-interests"><summary>Other interested customers <span>{interests.length}</span><small>Optional update — enquiries stay open</small><ChevronDown size={15} aria-hidden="true"/></summary>{customerRows(interests)}</details>}
    {!rows.length && <p className="sold-review-clear"><Check size={16} aria-hidden="true"/>No other bookings or open enquiries to review.</p>}
    {!canManage && rows.length > 0 && <p className="sold-review-help">A member of staff with sale management access can complete these updates.</p>}
    {composing && <SoldVehicleEmailComposer key={composing.enquiryId} saleId={saleId} entry={{ id: composing.enquiryId, customerName: composing.customerName, reference: '', vehicleId: review.vehicleId }} onClose={() => { setEmailQueue(current => current.slice(1)); void refresh(); }} />}
    {emailQueue.length > 1 && <p className="sold-review-help" role="status">Reviewing email 1 of {emailQueue.length}. Each message needs approval before sending.</p>}
  </section>;
}

export function SoldVehicleFollowUpTasks({ query, showEmpty = false }: { query: ReturnType<typeof useSoldVehicleFollowUps>; showEmpty?: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const tasks = query.data?.tasks ?? [];
  if (!query.isLoading && !query.isError && !tasks.length && !showEmpty) return null;
  return <section className="sold-follow-up-tasks notifications-feed" aria-label="Sold car follow-ups"><header><div><h3>Sold cars — customer updates <small>{query.data?.total ?? tasks.length}</small></h3><p>Cancel remaining visits and let customers know before they travel.</p></div></header>
    {query.isLoading && <p className="sold-review-help" role="status">Checking sold car follow-ups…</p>}
    {query.isError && <div className="sold-review-error"><p role="alert">Sold car follow-ups could not be refreshed.</p><Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>Retry customer follow-ups</Button></div>}
    <ul className="sold-follow-up-list">{tasks.map(task => <li key={task.saleId}><div className="sold-follow-up-heading"><div><h4>{task.vehicleTitle}</h4><p>{task.remaining} {task.remaining === 1 ? 'customer' : 'customers'} to update{task.upcomingAppointments > 0 ? ` · ${task.upcomingAppointments} ${task.upcomingAppointments === 1 ? 'visit' : 'visits'} to cancel` : ''}</p>{task.customers.some(row => row.urgent && pending(row)) && <strong className="sold-customer-urgent">Visit soon — call before they travel</strong>}</div><Button type="button" size="sm" variant="outline" aria-expanded={expanded === task.saleId} onClick={() => setExpanded(expanded === task.saleId ? null : task.saleId)}>{expanded === task.saleId ? 'Close review' : 'Review customers'}</Button></div>{expanded === task.saleId && <SoldVehicleCustomerReview saleId={task.saleId} />}</li>)}</ul>
    {!tasks.length && query.isSuccess && showEmpty && <p className="sold-review-help">No sold car follow-ups need attention.</p>}
    {(query.data?.total ?? 0) > tasks.length && <p className="sold-review-help">Showing {tasks.length} of {query.data!.total} sold cars. Complete these updates to load older follow-ups.</p>}
  </section>;
}
