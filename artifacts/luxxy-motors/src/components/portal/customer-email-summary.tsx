import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { ChevronDown, Mail } from '@/components/icons';
import { Button } from '@/components/ui/button';

type CustomerEmail = {
  key: string;
  enquiry_id: string | null;
  subject: string;
  status: string;
  last_event: string | null;
  created_at: string;
};
type CustomerDraft = {
  enquiryId: string;
  status: string;
  subject: string;
  updatedAt: string;
};
const statusLabels: Record<string, string> = {
  sent: 'Submitted to Resend', delivered: 'Delivered', sending: 'Sending',
  unknown: 'Acceptance unconfirmed', prepared: 'Prepared · not sent', failed: 'Failed',
  delivery_delayed: 'Delivery delayed', bounced: 'Bounced', complained: 'Reported as spam',
  opened: 'Opened', clicked: 'Link clicked', suppressed: 'Suppressed', scheduled: 'Scheduled',
  queued: 'Queued', canceled: 'Cancelled',
};
const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB', {
  timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short',
});

/** Read-only, opened on demand. Opening a customer never checks a provider or sends mail. */
export function CustomerEmailSummary({ enquiryId, onPrepare }: {
  enquiryId: string;
  reference: string;
  onPrepare: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const history = useQuery({
    queryKey: ['staff-email', '', 0, enquiryId],
    queryFn: () => customFetch<{ messages: CustomerEmail[]; hasMore: boolean }>(`/api/staff/email?enquiryId=${encodeURIComponent(enquiryId)}&offset=0`),
    enabled: expanded,
    staleTime: 30_000,
    retry: false,
  });
  const drafts = useQuery({
    queryKey: ['staff-email-drafts', enquiryId],
    queryFn: () => customFetch<{ drafts: CustomerDraft[]; hasMore: boolean }>(`/api/staff/email-drafts?enquiryId=${encodeURIComponent(enquiryId)}`),
    enabled: expanded,
    staleTime: 30_000,
    retry: false,
  });
  const draft = drafts.data?.drafts.find(row => row.enquiryId === enquiryId) ?? drafts.data?.drafts[0];
  // Both endpoints scope records to this dealer's explicitly merged case before paging.
  const messages = history.data?.messages ?? [];
  const hasReadSignal = messages.some(row => ['opened', 'clicked'].includes(row.last_event ?? row.status));
  const emailHref = `/portal?section=notifications&workView=email&enquiryId=${encodeURIComponent(enquiryId)}&view=sent`;
  return <section className="min-w-0 rounded-lg border border-border bg-secondary/20 p-4" aria-label="Customer email and drafts">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h4 className="flex items-center gap-2 text-sm font-semibold"><Mail aria-hidden="true" className="h-4 w-4" />Email & drafts</h4><p className="mt-1 text-xs text-muted-foreground">Replies stay linked to this enquiry and car.</p></div>
      <Button type="button" size="sm" variant="outline" onClick={onPrepare}>Prepare reply</Button>
    </div>
    <button type="button" className="mt-2 flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm font-medium" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Hide email history' : 'Show email history'}<ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
    {expanded && <div className="grid min-w-0 gap-3 border-t border-border pt-3">
      {(history.isLoading || drafts.isLoading) && <p role="status" className="text-sm text-muted-foreground">Loading email and drafts…</p>}
      {(history.isError || drafts.isError) && <div role="alert" className="text-sm"><p>Email or drafts could not be loaded. Saved customer details are unchanged.</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { void history.refetch(); void drafts.refetch(); }}>Retry email history</Button></div>}
      {draft && <div className="min-w-0 rounded-md border border-border bg-background p-3">
        <p className="text-xs font-semibold">{draft.status === 'draft' ? 'Saved draft · not sent' : draft.status === 'sending' ? 'Sending · check history before retrying' : 'Acceptance unconfirmed · check before resending'}</p>
        <p className="mt-1 break-words text-sm">{draft.subject || 'Untitled reply'}</p>
        <p className="mt-1 text-xs text-muted-foreground">Saved {dateLabel(draft.updatedAt)}</p>
        {draft.enquiryId === enquiryId ? <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onPrepare}>{draft.status === 'draft' ? 'Continue draft' : 'Check draft'}</Button> : <Button variant="outline" size="sm" className="mt-2" asChild><Link href={`/portal?section=notifications&workView=email&enquiryId=${encodeURIComponent(draft.enquiryId)}&draft=${encodeURIComponent(draft.enquiryId)}`}>{draft.status === 'draft' ? 'Continue draft' : 'Check draft'}</Link></Button>}
      </div>}
      {history.data && messages.length > 0 && <ul className="grid gap-3" aria-label="Recent emails for this enquiry">{messages.slice(0, 3).map(message => <li key={message.key} className="min-w-0 text-sm"><p className="break-words font-medium">{message.subject || 'Customer email'}</p><p className="mt-1 text-xs text-muted-foreground">{statusLabels[message.last_event ?? message.status] ?? 'Status unavailable'} · {dateLabel(message.created_at)}</p></li>)}</ul>}
      {history.data && drafts.data && !messages.length && !draft && <p className="text-sm text-muted-foreground">No recent email or draft recorded for this enquiry.</p>}
      {hasReadSignal && <p className="text-xs text-muted-foreground">Open and click tracking does not prove the customer read the email.</p>}
      {drafts.data?.hasMore && !draft && <p className="text-xs text-muted-foreground">Older drafts may not appear here. Open the conversation to review this case’s saved drafts.</p>}
      <Button variant="outline" size="sm" className="justify-self-start" asChild><Link href={emailHref}>Open conversation</Link></Button>
    </div>}
  </section>;
}
