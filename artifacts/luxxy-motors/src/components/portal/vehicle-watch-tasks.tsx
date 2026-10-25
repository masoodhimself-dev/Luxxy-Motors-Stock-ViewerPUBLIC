import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Bell, ArrowRight, Check, Mail } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useStaffAccess } from './dealer-administration';
import { vehicleWatchCountsKey, vehicleWatchKindLabel, vehicleWatchTaskPath, vehicleWatchTasksKey, type VehicleWatchPreview, type VehicleWatchRecipient, type VehicleWatchSendResult, type VehicleWatchTask, type useVehicleWatchTasks } from '@/lib/vehicle-watch-tasks';
import './vehicle-watch-tasks.css';

const batchLimit = 20;
const canSelect = (recipient: VehicleWatchRecipient) => recipient.status === 'pending' || recipient.status === 'failed';
const money = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value);
const sameIds = (left: string[], right: string[]) => { const sorted = [...right].sort(); return left.length === sorted.length && [...left].sort().every((id, index) => id === sorted[index]); };
const failedStatus = (error: unknown) => error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
const customerStatus = (recipient: VehicleWatchRecipient) => recipient.status === 'sent' ? 'Sent' : recipient.status === 'failed' ? 'Failed — review before retrying' : recipient.status === 'uncertain' ? 'Send unconfirmed — ask the owner to check delivery' : 'To update';

function WatchUpdateReview({ task, onClose, onRefresh }: { task: VehicleWatchTask; onClose: () => void; onRefresh: () => Promise<unknown> }) {
  const [subject, setSubject] = useState(task.subject), [message, setMessage] = useState(task.message);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<VehicleWatchPreview | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [error, setError] = useState(''), [result, setResult] = useState<VehicleWatchSendResult | null>(null);
  const [sendUnconfirmed, setSendUnconfirmed] = useState(false);
  const eligible = task.recipients.filter(canSelect);
  const changed = subject !== task.subject || message !== task.message;
  const readySelection = selected.size > 0 && selected.size <= batchLimit;
  function invalidate() { setPreview(null); setRequestId(null); setError(''); setSendUnconfirmed(false); setResult(null); }
  function close() {
    if (busy) return;
    if (changed && !result && !window.confirm('Leave this update? Your wording has not been saved.')) return;
    onClose();
  }
  function choose(id: string, checked: boolean) {
    if (busy || sendUnconfirmed) return;
    if (checked && selected.size >= batchLimit) { setError('Choose up to 20 customers in one reviewed batch.'); return; }
    const next = new Set(selected); checked ? next.add(id) : next.delete(id); setSelected(next); invalidate();
  }
  async function review() {
    if (busy || !readySelection || !subject.trim() || !message.trim() || sendUnconfirmed) return;
    setBusy('preview'); setError(''); setResult(null); setPreview(null); setRequestId(null);
    try {
      const response = await customFetch<VehicleWatchPreview>(`${vehicleWatchTaskPath(task.id)}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: task.revision, subject: subject.trim(), message: message.trim(), watchIds: [...selected] }) });
      if (response.subject !== subject.trim() || response.message !== message.trim() || !sameIds(response.recipients.map(recipient => recipient.id), [...selected]) || response.expectedRevision !== task.revision) {
        setError('The price, availability or recipient list changed. Your wording is kept. Close this review and reopen the latest update before sending.');
        await onRefresh(); return;
      }
      setPreview(response); setRequestId(crypto.randomUUID());
      if (!response.ready) setError(response.preview ? 'Fictional local preview. Email sending is disabled here; nothing was sent.' : 'Email is not ready for this update. Check the dealership’s email connection and verified recipients, then review again. Nothing has been sent.');
    } catch (cause) {
      setError(failedStatus(cause) === 409 ? 'This car or watch list has changed. Your wording is kept. Close this review and open the latest update before sending.' : 'The email preview could not be prepared. Your wording is kept. Try again.');
      if (failedStatus(cause) === 409) await onRefresh();
    } finally { setBusy(null); }
  }
  async function send() {
    if (busy || !preview?.ready || !requestId || !readySelection) return;
    setBusy('send'); setError('');
    try {
      const response = await customFetch<VehicleWatchSendResult>(`${vehicleWatchTaskPath(task.id)}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: preview.expectedRevision, subject: preview.subject, message: preview.message, watchIds: preview.recipients.map(recipient => recipient.id), previewHash: preview.previewHash, requestId }) });
      setResult(response); setPreview(null); setSendUnconfirmed(false); setSelected(new Set());
      await onRefresh();
    } catch (cause) {
      if ([400, 409, 410, 422].includes(failedStatus(cause))) {
        setPreview(null); setRequestId(null); setError('Sending stopped because the car, recipients or preview changed. Some earlier emails in this batch may already have been submitted; check the refreshed list before trying again. Your wording is kept. Close this review and reopen the latest update.');
      } else {
        setSendUnconfirmed(true); setError('The send result could not be confirmed. Do not start another batch. Use “Check send result” to check this same request safely.');
      }
      await onRefresh();
    } finally { setBusy(null); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="watch-update-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>Review watch update</DialogTitle><DialogDescription>{task.vehicleTitle} · {vehicleWatchKindLabel[task.kind]}. No message is sent until you approve it.</DialogDescription></DialogHeader>
    {error && <p className="watch-update-error" role="alert">{error}</p>}
    {result ? <div className="watch-update-result" role="status"><Check size={20} aria-hidden="true" /><div><h3>{result.sentCount} {result.sentCount === 1 ? 'email submitted' : 'emails submitted'}</h3><p>{result.message}</p>{result.failedCount > 0 && <p>{result.failedCount} failed. Review the refreshed list before retrying.</p>}{result.uncertainCount > 0 && <p>{result.uncertainCount} unconfirmed. Ask the owner to check the email provider delivery status. Do not send again until checked.</p>}{result.skippedCount > 0 && <p>{result.skippedCount} skipped because they no longer needed this update.</p>}<p>Each customer receives their own email. Other watchers’ addresses are not included.</p></div></div> : <>
      <div className="watch-update-recipients"><div className="watch-update-recipient-heading"><h3>Choose customers <small>{selected.size} selected</small></h3><Button variant="ghost" type="button" disabled={Boolean(busy) || sendUnconfirmed || !eligible.length} onClick={() => { setSelected(selected.size ? new Set() : new Set(eligible.slice(0, batchLimit).map(recipient => recipient.id))); invalidate(); }}>{selected.size ? 'Clear selection' : `Select first ${Math.min(batchLimit, eligible.length)}`}</Button></div>
      <p>Verified email addresses only. Send up to 20 at a time; each customer receives a separate email.</p>
      <ul aria-label="Watching customers">{task.recipients.map(recipient => <li key={recipient.id} data-status={recipient.status}><label><input type="checkbox" checked={selected.has(recipient.id)} disabled={Boolean(busy) || sendUnconfirmed || !canSelect(recipient)} onChange={event => choose(recipient.id, event.target.checked)} aria-label={`Select ${recipient.email}`} /><span><strong>{recipient.email}</strong><small>{customerStatus(recipient)}</small></span></label></li>)}</ul>
      {task.pendingCount > eligible.length && <p>{task.pendingCount} customers need an update. The remaining customers load as you finish these batches.</p>}
      </div>
      <div className="watch-update-fields"><label htmlFor="watch-update-subject">Email subject</label><Input id="watch-update-subject" value={subject} maxLength={200} disabled={Boolean(busy) || sendUnconfirmed} onChange={event => { setSubject(event.target.value); invalidate(); }} /><label htmlFor="watch-update-message">Message</label><Textarea id="watch-update-message" rows={7} maxLength={10000} value={message} disabled={Boolean(busy) || sendUnconfirmed} onChange={event => { setMessage(event.target.value); invalidate(); }} /><p>The vehicle link and a personal stop-watching link are included in each email.</p></div>
      {preview && <section className="watch-update-preview" aria-label="Email preview"><h3>Check before sending</h3><p><strong>{preview.subject}</strong></p><p className="watch-update-preview-message">{preview.message}</p><p>{preview.recipients.length} {preview.recipients.length === 1 ? 'verified customer' : 'verified customers'}. The latest vehicle information is checked again when you send.</p></section>}
    </>}
    <div className="watch-update-buttons"><Button variant="outline" type="button" disabled={Boolean(busy)} onClick={close}>{result ? 'Done' : 'Close review'}</Button>{!result && (preview?.ready ? <Button type="button" disabled={Boolean(busy)} onClick={() => void send()}><Mail size={16} aria-hidden="true" />{busy === 'send' ? 'Checking and sending…' : sendUnconfirmed ? 'Check send result' : `Send ${preview.recipients.length} ${preview.recipients.length === 1 ? 'email' : 'emails'}`}</Button> : <Button type="button" disabled={Boolean(busy) || !readySelection || !subject.trim() || !message.trim() || sendUnconfirmed} onClick={() => void review()}>{busy === 'preview' ? 'Checking update…' : 'Preview selected emails'}</Button>)}</div>
  </DialogContent></Dialog>;
}

export function VehicleWatchTasks({ query, showEmpty = false }: { query: ReturnType<typeof useVehicleWatchTasks>; showEmpty?: boolean }) {
  const access = useStaffAccess(), cache = useQueryClient();
  const [review, setReview] = useState<VehicleWatchTask | null>(null), [expanded, setExpanded] = useState(false);
  const tasks = query.data?.tasks ?? [];
  const total = Math.max(query.data?.total ?? 0, tasks.length);
  const canSend = Boolean(access.data?.permissions.includes('sales.manage'));
  if (!query.isLoading && !query.isError && !tasks.length && !showEmpty) return null;
  async function refresh() {
    await query.refetch();
    await Promise.all([cache.invalidateQueries({ queryKey: vehicleWatchCountsKey }), cache.invalidateQueries({ queryKey: ['staff-notifications'] })]);
  }
  return <section className="vehicle-watch-tasks notifications-feed" aria-label="Watching customers"><header><div><h3><Bell size={16} aria-hidden="true" />Watch updates <small>{total}</small></h3><p>Review price and availability updates for customers watching a car. Sending stays manual.</p></div></header>
    {query.isLoading && <p className="watch-update-state" role="status">Checking watch updates…</p>}
    {query.isError && <div className="watch-update-error"><p role="alert">Watch updates could not be refreshed.{tasks.length > 0 && ' The last loaded updates are shown below.'}</p><Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry watch updates</Button></div>}
    <ul className="vehicle-watch-task-list">{(expanded ? tasks : tasks.slice(0, 3)).map(task => <li key={task.id}><div className="vehicle-watch-task-summary"><span className="watch-update-kind" data-kind={task.kind}>{vehicleWatchKindLabel[task.kind]}</span><h4><Link href={`/portal?section=inventory&vehicleId=${encodeURIComponent(task.vehicleId)}`}>{task.vehicleTitle}</Link></h4>{task.kind === 'price_drop' && task.previousPrice !== null && task.currentPrice !== null && <p className="watch-update-prices"><del>{money(task.previousPrice)}</del><ArrowRight size={14} aria-hidden="true" /><strong>{money(task.currentPrice)}</strong></p>}<p>{task.pendingCount} {task.pendingCount === 1 ? 'customer' : 'customers'} to update · {task.totalCount} watching</p>{task.recipients.some(recipient => recipient.status === 'uncertain') && <p className="watch-update-warning">An earlier send is unconfirmed. Ask the owner to check the email provider delivery status. Do not send again until checked.</p>}</div>{canSend ? <Button type="button" size="sm" variant="outline" onClick={() => setReview(task)}>Review update</Button> : <span className="watch-update-help">Customer contact permission required</span>}</li>)}</ul>
    {tasks.length > 3 && <div className="notifications-expand"><Button type="button" size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer watch updates' : `Show all ${tasks.length} watch updates`}</Button></div>}
    {total > tasks.length && <p className="watch-update-state">Showing {tasks.length} of {total} watch updates. Finish these to load older updates.</p>}
    {query.isSuccess && !tasks.length && showEmpty && <p className="watch-update-state">No watch updates need review.</p>}
    {review && <WatchUpdateReview task={review} onClose={() => setReview(null)} onRefresh={refresh} />}
  </section>;
}
