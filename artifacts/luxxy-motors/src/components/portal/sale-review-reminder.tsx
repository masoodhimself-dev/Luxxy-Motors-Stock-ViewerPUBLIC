import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { customFetch } from '@workspace/api-client-react';
import { googleReviewUrl, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { followUpIso, followUpLocal } from './enquiry-follow-up';
import { useStaffAccess } from './dealer-administration';

export function SaleReviewReminder({ sale, reviewUrl = '', onSaved }: { sale: SaleWorkspaceRecord; reviewUrl?: string; onSaved: (sale: SaleWorkspaceRecord) => void }) {
  const cache = useQueryClient(), access = useStaffAccess();
  const reminder = sale.reviewReminder;
  const [editing, setEditing] = useState(false), [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState(() => reminder?.at ? followUpLocal(reminder.at) : `${followUpLocal(new Date(Date.now() + 7 * 86400000).toISOString()).slice(0,10)}T10:00`);
  const url = googleReviewUrl(reviewUrl);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const attempt = useRef<{ requestId: string; expectedRevision: number; cancel?: true; at?: string } | null>(null);
  if ((!sale.completedAt && sale.lifecycle?.status !== 'sold') || !access.data?.permissions.includes('sales.manage')) return null;
  const active = Boolean(reminder && !reminder.cancelledAt);
  const validTime = followUpIso(time);
  const valid = Boolean(validTime && Date.parse(validTime) > Date.now() && Date.parse(validTime) <= Date.now() + 365 * 86400000 && url);
  async function save(cancel = false) {
    if (busy) return;
    if (!cancel && (!valid || !sale.draft.email)) { setError('Add the dealership’s Google review link in Settings and choose a future reminder time.'); return; }
    setBusy(true); setError('');
    attempt.current ??= { requestId: crypto.randomUUID(), expectedRevision: sale.revision, ...(cancel ? { cancel: true } : { at: validTime! }) };
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord }>(`/api/sale-workspace/${sale.id}/review-reminder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attempt.current) });
      attempt.current = null; onSaved(result.sale); setEditing(false); setEnabled(false);
      await Promise.all([cache.invalidateQueries({ queryKey: ['staff-notifications'] }),cache.invalidateQueries({ queryKey: ['/api/enquiries'] }),cache.invalidateQueries({ queryKey: ['sale-workspace'] })]);
    } catch (cause) {
      const status = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : 0;
      if (status >= 400 && status < 500) attempt.current = null;
      const detail = cause && typeof cause === 'object' && 'data' in cause && cause.data && typeof cause.data === 'object' && 'error' in cause.data ? String(cause.data.error) : '';
      setError(status === 409 ? 'This sale changed. Reopen it before updating the reminder.' : status >= 400 && status < 500 && detail ? detail : 'The reminder could not be confirmed. Retry to check the same request safely.');
    } finally { setBusy(false); }
  }
  const locked = busy || Boolean(attempt.current);
  return <section className="rounded-sm border border-border bg-secondary/30 p-4 sm:p-5 my-4" aria-label="Customer review reminder">
    <h3 className="font-display font-semibold text-lg">Ask for a Google review</h3>
    <p className="text-sm text-muted-foreground mt-1">An optional follow-up for the buyer. Staff review the email before sending.</p>
    {!sale.draft.email ? <p className="mt-3 text-sm">There’s no email address on this sale. You can request a review by phone.</p> : active && !editing ? <div className="mt-3 space-y-3">
      <p role="status">Reminder saved for {new Date(reminder!.at).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' })} (UK time). It appears on Home when due.</p>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href={`/portal?section=notifications&workView=email&compose=${reminder!.enquiryId}`}>Review email</Link></Button><Button variant="ghost" disabled={locked} onClick={() => setEditing(true)}>Change reminder</Button><Button variant="ghost" disabled={busy || Boolean(attempt.current && !attempt.current.cancel)} onClick={() => void save(true)}>{attempt.current?.cancel ? 'Retry cancellation' : 'Cancel reminder'}</Button></div>
      <p className="text-xs text-muted-foreground">No email has been sent by this reminder. Complete the follow-up in the customer’s enquiry after contacting them.</p>
    </div> : !url ? <div className="mt-3 space-y-3"><p className="text-sm">Add the dealership’s Google review link once in Settings before scheduling reminders.</p><Button asChild variant="outline"><Link href="/portal?section=settings&settingsTab=dealership&websiteSection=contact">Open review link settings</Link></Button>{editing && <Button variant="ghost" onClick={() => setEditing(false)}>Keep existing reminder</Button>}</div> : <div className="mt-3 space-y-3">
      {!editing && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={locked} onChange={event => setEnabled(event.target.checked)} className="mt-1"/>Remind staff to ask this customer for a review</label>}
      {(enabled || editing) && <><label className="block text-sm space-y-1"><span>Reminder date and time (UK)</span><Input type="datetime-local" value={time} disabled={locked} onChange={event => setTime(event.target.value)}/></label><p className="text-sm text-muted-foreground">Uses the Google review link saved in dealership Settings. <a href={url} target="_blank" rel="noopener noreferrer" className="underline">Check review link</a></p><div className="flex flex-wrap gap-2"><Button disabled={busy || (!attempt.current && !valid)} onClick={() => void save()}>{busy ? 'Saving…' : attempt.current ? 'Retry reminder' : 'Save review reminder'}</Button>{editing && <Button variant="ghost" disabled={locked} onClick={() => setEditing(false)}>Keep existing reminder</Button>}</div></>}
    </div>}
    {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
  </section>;
}
