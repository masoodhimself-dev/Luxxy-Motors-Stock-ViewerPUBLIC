import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { customFetch, getGetEnquiriesQueryKey, useLogEnquiryConversation, type Enquiry } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { callOutcomes, type CallOutcome } from '@/lib/enquiry-desk-model';
import { appointmentLabel } from '@/lib/test-drive-dates';
import { FollowUpFields, followUpIso } from './enquiry-follow-up';
import { workspaceError } from './enquiry-workspace-tools';

export function ConversationEditor({ entry, onClose, onSaved }: { entry: Enquiry; onClose: () => void; onSaved: (entry: Enquiry) => void | Promise<void> }) {
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<CallOutcome>('information_given');
  const [schedule, setSchedule] = useState(false);
  const [time, setTime] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mutation = useLogEnquiryConversation();
  const outstanding = Boolean(entry.followUpAt && !entry.followUpCompletedAt);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError('');
    if (!note.trim()) { setError('Add a note about this conversation.'); return; }
    const nextAt = schedule ? followUpIso(time) : null;
    if (schedule && (!nextAt || Date.parse(nextAt) <= Date.now())) { setError('Choose a valid future UK date and time.'); return; }
    if (outcome === 'callback_requested' && !schedule && !outstanding) { setError('Schedule the next follow-up for this callback.'); return; }
    busy.current = true;
    try {
      const updated = await mutation.mutateAsync({ id: entry.id, data: {
        expectedRevision: entry.workspaceRevision ?? 0,
        expectedFollowUpRevision: entry.followUpRevision ?? 0,
        note: note.trim(), callOutcome: outcome,
        ...(nextAt ? { followUpAt: nextAt, followUpNote: followUpNote.trim() } : {}),
      } });
      await onSaved(updated);
    } catch (cause) { setError(workspaceError(cause)); }
    finally { busy.current = false; }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy.current) onClose(); }}>
    <DialogContent className="portal-action-dialog enquiry-action-dialog enquiry-conversation-dialog">
      <DialogHeader><DialogTitle>Log another conversation</DialogTitle><DialogDescription>{entry.customerName} · {entry.reference}</DialogDescription></DialogHeader>
      <p className="text-sm">{entry.vehicleTitle || 'General showroom enquiry'}{entry.vehicleRegistration ? ` · ${entry.vehicleRegistration}` : ''}</p>
      <form onSubmit={event => void save(event)} className="grid gap-4">
        <fieldset disabled={mutation.isPending} className="grid min-w-0 gap-4">
          <label className="grid gap-1.5 text-sm font-medium">Conversation note<Textarea autoFocus required rows={4} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="What was discussed and agreed?" /></label>
          <label className="grid gap-1.5 text-sm font-medium">Conversation outcome<NativeSelect value={outcome} onChange={event => setOutcome(event.target.value as CallOutcome)}>{Object.entries(callOutcomes).map(([value, label]) => <option key={value} value={value} disabled={value === 'test_drive_booked' && (!entry.appointmentAt || Boolean(entry.appointmentCancelledAt))}>{label}</option>)}</NativeSelect></label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={schedule} onChange={event => setSchedule(event.target.checked)} />Schedule the next follow-up</label>
          {schedule && <FollowUpFields time={time} note={followUpNote} onTime={setTime} onNote={setFollowUpNote} noteMaxLength={500} />}
          {!schedule && outstanding && <p className="text-xs text-muted-foreground">Current follow-up remains due {appointmentLabel(entry.followUpAt!)}. Use Manage follow-up to mark it done.</p>}
        </fieldset>
        <p className="text-xs text-muted-foreground">Saved with today’s date, time and your staff name. Earlier notes stay in the conversation history.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save conversation'}</Button><Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>Cancel</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

type ConversationPage = { events: Enquiry['events']; total: number; nextCursor: string | null };
function LoadedConversationHistory({ entry }: { entry: Enquiry }) {
  const history = useInfiniteQuery({
    queryKey: [...getGetEnquiriesQueryKey(), 'conversations', entry.id, entry.workspaceRevision ?? 0],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => customFetch<ConversationPage>(`/api/staff/enquiries/${encodeURIComponent(entry.id)}/conversations${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal, responseType: 'json' }),
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: false,
  });
  const events = [...new Map((history.data?.pages.flatMap(page => page.events) ?? []).map(event => [event.id, event])).values()];
  const total = history.data?.pages[0]?.total;
  return <ConversationHistoryView entry={{ ...entry, events }} total={total} status={history.isPending ? <p role="status">Loading conversation notes…</p> : history.isError ? <div role="alert"><p>Conversation notes could not be loaded. The original enquiry and internal note are still shown.</p><Button size="sm" variant="outline" onClick={() => void history.refetch()}>Retry conversation notes</Button></div> : undefined} footer={history.hasNextPage ? <div className="mt-3 grid gap-2"><p className="text-xs text-muted-foreground">Showing {events.length} of {total} conversation notes.</p><Button size="sm" variant="outline" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? 'Loading older notes…' : 'Load older conversation notes'}</Button></div> : undefined} />;
}

export function ConversationHistory({ entry, loadOnDemand = false }: { entry: Enquiry; loadOnDemand?: boolean }) {
  return loadOnDemand ? <LoadedConversationHistory entry={entry} /> : <ConversationHistoryView entry={entry} />;
}

function ConversationHistoryView({ entry, total, status, footer }: { entry: Enquiry; total?: number; status?: ReactNode; footer?: ReactNode }) {
  const conversations = (entry.events ?? []).filter(event => event.kind === 'conversation_logged').sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return <section className="enquiry-conversation-history" aria-label="Conversation history">
    <h4>Conversation history{(total ?? conversations.length) ? ` · ${total ?? conversations.length}` : ''}</h4>
    {entry.message && <article><p className="enquiry-conversation-meta">Original {entry.source === 'website_callback' ? 'website callback request' : entry.source === 'phone' ? 'call' : 'enquiry'}{entry.createdAt ? ` · ${appointmentLabel(entry.createdAt)}` : ''}</p><p className="whitespace-pre-wrap break-words">{entry.message}</p></article>}
    {entry.staffNote && <article><p className="enquiry-conversation-meta">Internal note</p><p className="whitespace-pre-wrap break-words">{entry.staffNote}</p></article>}
    {conversations.map(event => <article key={event.id} data-testid={`conversation-${event.id}`}><p className="enquiry-conversation-meta"><time dateTime={event.occurredAt}>{appointmentLabel(event.occurredAt)}</time> · {event.staffName || 'Staff member'}</p><p className="font-medium">{event.callOutcome ? callOutcomes[event.callOutcome as CallOutcome] || event.callOutcome : event.summary}</p><p className="whitespace-pre-wrap break-words">{event.note || event.summary}</p>{event.followUpAt && <p className="text-xs text-muted-foreground">Next follow-up: {appointmentLabel(event.followUpAt)}</p>}</article>)}
    {status}
    {!status && !conversations.length && !entry.message && !entry.staffNote && <p className="text-sm text-muted-foreground">No conversation notes recorded yet.</p>}
    {footer}
  </section>;
}
