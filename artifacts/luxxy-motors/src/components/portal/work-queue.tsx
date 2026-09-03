import {
  getGetPortalWorklistQueryKey,
  useGetPortalWorklist,
} from '@workspace/api-client-react';
import type { Lead, PortalWorklist } from '@workspace/api-client-react';
import {
  CalendarClock,
  CircleAlert,
  Inbox,
  LoaderCircle,
  PoundSterling,
  Sun,
} from 'lucide-react';
import { LeadCard } from './lead-card';
import {
  Chip,
  EmptyState,
  Panel,
  formatPence,
  formatTime,
  relativeTime,
} from './portal-ui';

type QueueKey = keyof Pick<
  PortalWorklist,
  'viewingsToday' | 'overdueFollowUps' | 'unansweredEnquiries' | 'depositsWithoutDeal'
>;

const queues: Array<{
  key: QueueKey;
  kicker: string;
  title: string;
  blurb: string;
  empty: string;
  icon: typeof Sun;
}> = [
  {
    key: 'viewingsToday',
    kicker: 'Diary',
    title: 'Viewings today',
    blurb: 'Booked in for today. Confirm the car is clean, fuelled and out front.',
    empty: 'Nothing booked in today.',
    icon: CalendarClock,
  },
  {
    key: 'overdueFollowUps',
    kicker: 'Slipping',
    title: 'Overdue follow-ups',
    blurb: 'You said you would come back to these and the date has passed.',
    empty: 'No follow-up has been missed.',
    icon: CircleAlert,
  },
  {
    key: 'unansweredEnquiries',
    kicker: 'Waiting',
    title: 'Nobody has answered',
    blurb: 'Enquiries with no reply logged against them yet.',
    empty: 'Every enquiry has had a first response.',
    icon: Inbox,
  },
  {
    key: 'depositsWithoutDeal',
    kicker: 'Money held',
    title: 'Deposits with no deal started',
    blurb: 'Cash is on the counter but no paperwork has been raised.',
    empty: 'Every deposit has a deal behind it.',
    icon: PoundSterling,
  },
];

/** Per-queue trailing line — each queue cares about a different clock. */
function highlightFor(key: QueueKey, lead: Lead) {
  if (key === 'viewingsToday' && lead.appointmentAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
        <CalendarClock className="h-3.5 w-3.5" />
        <span className="font-mono">{formatTime(lead.appointmentAt)}</span>
        <span className="font-normal text-muted-foreground">
          · {relativeTime(lead.appointmentAt)}
        </span>
      </span>
    );
  }
  if (key === 'overdueFollowUps' && lead.nextActionDueAt) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-destructive">
        <CircleAlert className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{lead.nextAction ?? 'Follow up'}</span>
        <span className="whitespace-nowrap font-normal">
          · {relativeTime(lead.nextActionDueAt)}
        </span>
      </span>
    );
  }
  if (key === 'unansweredEnquiries') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-foreground/80">
        <Inbox className="h-3.5 w-3.5 shrink-0 text-accent" />
        Arrived {relativeTime(lead.createdAt)}
      </span>
    );
  }
  if (key === 'depositsWithoutDeal') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
        <PoundSterling className="h-3.5 w-3.5" />
        {formatPence(lead.depositPence)} taken
        {lead.depositTakenAt && (
          <span className="font-normal text-muted-foreground">
            · {relativeTime(lead.depositTakenAt)}
          </span>
        )}
      </span>
    );
  }
  return undefined;
}

export function WorkQueue({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const worklistQuery = useGetPortalWorklist({
    query: {
      queryKey: getGetPortalWorklistQueryKey(),
      refetchInterval: 60_000,
    },
  });

  if (worklistQuery.isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center border border-border bg-card text-muted-foreground">
        <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-accent" />
        Working out what needs chasing…
      </div>
    );
  }

  if (worklistQuery.isError || !worklistQuery.data) {
    return (
      <div className="border border-destructive/40 bg-destructive/10 p-6 text-[13px] text-destructive">
        <p className="font-display text-base font-semibold">
          Could not build today&apos;s work list
        </p>
        <p className="mt-1">Refresh the page, or check the API server is running.</p>
      </div>
    );
  }

  const worklist = worklistQuery.data;
  const total = queues.reduce((sum, queue) => sum + worklist[queue.key].length, 0);

  return (
    <div className="space-y-6" data-testid="work-queue">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-secondary/60 px-5 py-4">
        <p className="flex items-center gap-2 font-display text-base font-semibold text-primary">
          <Sun className="h-4 w-4 text-accent" />
          {total === 0
            ? 'Nothing is waiting on you.'
            : `${total} ${total === 1 ? 'thing needs' : 'things need'} chasing.`}
        </p>
        <p className="font-mono text-[12px] text-muted-foreground">
          As at {formatTime(worklist.generatedAt)}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {queues.map(({ key, kicker, title, blurb, empty, icon: Icon }) => {
          const leads = worklist[key];
          return (
            <Panel key={key} className="flex flex-col">
              <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                <div>
                  <p className="luxxy-kicker text-accent">{kicker}</p>
                  <h2 className="mt-2 flex items-center gap-2 font-display text-xl font-semibold tracking-[-.01em] text-primary">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {title}
                  </h2>
                  <p className="mt-1 max-w-md text-[13px] text-muted-foreground">
                    {blurb}
                  </p>
                </div>
                <Chip
                  tone={leads.length === 0 ? 'muted' : key === 'overdueFollowUps' ? 'urgent' : 'accent'}
                  className="shrink-0 tabular-nums"
                >
                  {leads.length}
                </Chip>
              </header>
              <div className="flex-1 space-y-3 p-4">
                {leads.length === 0 ? (
                  <EmptyState icon={Icon} title="All clear" body={empty} />
                ) : (
                  leads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onOpen={onOpenLead}
                      highlight={highlightFor(key, lead)}
                    />
                  ))
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
