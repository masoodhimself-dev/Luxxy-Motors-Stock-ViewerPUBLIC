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
  PanelHeader,
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
    kicker: 'DIARY',
    title: 'VIEWINGS TODAY',
    blurb: 'Booked in for today. Confirm the car is clean, fuelled and out front.',
    empty: 'Nothing booked in today.',
    icon: CalendarClock,
  },
  {
    key: 'overdueFollowUps',
    kicker: 'SLIPPING',
    title: 'OVERDUE FOLLOW-UPS',
    blurb: 'You said you would come back to these and the date has passed.',
    empty: 'No follow-up has been missed.',
    icon: CircleAlert,
  },
  {
    key: 'unansweredEnquiries',
    kicker: 'WAITING',
    title: 'NOBODY HAS ANSWERED',
    blurb: 'Enquiries with no reply logged against them yet.',
    empty: 'Every enquiry has had a first response.',
    icon: Inbox,
  },
  {
    key: 'depositsWithoutDeal',
    kicker: 'MONEY HELD',
    title: 'DEPOSITS WITH NO DEAL',
    blurb: 'Cash is on the counter but no paperwork has been raised.',
    empty: 'Every deposit has a deal behind it.',
    icon: PoundSterling,
  },
];

function highlightFor(key: QueueKey, lead: Lead) {
  if (key === 'viewingsToday' && lead.appointmentAt) {
    return (
      <span className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-primary">
        <CalendarClock className="h-4 w-4 text-accent" />
        <span>{formatTime(lead.appointmentAt)}</span>
        <span className="text-primary/50">
          · {relativeTime(lead.appointmentAt)}
        </span>
      </span>
    );
  }
  if (key === 'overdueFollowUps' && lead.nextActionDueAt) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-destructive">
        <CircleAlert className="h-4 w-4 shrink-0" />
        <span className="truncate">{lead.nextAction ?? 'Follow up'}</span>
        <span className="whitespace-nowrap text-destructive/70">
          · {relativeTime(lead.nextActionDueAt)}
        </span>
      </span>
    );
  }
  if (key === 'unansweredEnquiries') {
    return (
      <span className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-primary/80">
        <Inbox className="h-4 w-4 shrink-0 text-accent" />
        Arrived {relativeTime(lead.createdAt)}
      </span>
    );
  }
  if (key === 'depositsWithoutDeal') {
    return (
      <span className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest text-primary">
        <PoundSterling className="h-4 w-4 text-accent" />
        {formatPence(lead.depositPence)} taken
        {lead.depositTakenAt && (
          <span className="text-primary/50">
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
      <div className="flex min-h-40 items-center justify-center border-4 border-primary bg-background shadow-[8px_8px_0px_hsl(var(--primary))] text-primary">
        <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-accent" />
        <span className="font-display text-[14px] font-black uppercase tracking-widest">Building worklist…</span>
      </div>
    );
  }

  if (worklistQuery.isError || !worklistQuery.data) {
    return (
      <div className="border-4 border-destructive bg-destructive/5 p-8 text-destructive shadow-[8px_8px_0px_hsl(var(--primary))]">
        <p className="font-display text-2xl font-black uppercase tracking-tighter">
          Could not build today&apos;s work list
        </p>
        <p className="mt-2 text-[13px] font-bold uppercase tracking-widest">Refresh the page, or check the API server is running.</p>
      </div>
    );
  }

  const worklist = worklistQuery.data;
  const total = queues.reduce((sum, queue) => sum + worklist[queue.key].length, 0);

  return (
    <div className="space-y-8" data-testid="work-queue">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[1rem] border border-primary bg-primary px-6 py-5 shadow-[0_12px_28px_hsl(var(--primary)/.16)]">
         <p className="flex items-center gap-3 font-display text-[15px] font-semibold tracking-[.04em] text-primary-foreground">
          <Sun className="h-5 w-5 text-accent" />
          {total === 0
            ? 'Nothing is waiting on you.'
            : `${total} ${total === 1 ? 'thing needs' : 'things need'} chasing.`}
        </p>
         <p className="font-display text-[11px] font-semibold tracking-[.08em] text-primary-foreground/70">
          As at {formatTime(worklist.generatedAt)}
        </p>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        {queues.map(({ key, kicker, title, blurb, empty, icon: Icon }) => {
          const leads = worklist[key];
          return (
             <Panel key={key} className="flex flex-col">
              <PanelHeader
                kicker={kicker}
                title={<span className="flex items-center gap-3"><Icon className="h-5 w-5 text-accent" />{title}</span>}
                meta={blurb}
                action={
                  <Chip
                    tone={leads.length === 0 ? 'muted' : key === 'overdueFollowUps' ? 'urgent' : 'accent'}
                    className="shrink-0 tabular-nums shadow-none"
                  >
                    {leads.length}
                  </Chip>
                }
              />
              <div className="flex-1 space-y-4 p-6">
                {leads.length === 0 ? (
                  <EmptyState icon={Icon} title="ALL CLEAR" body={empty} />
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