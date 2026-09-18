import { useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
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
    kicker: 'Today’s diary',
    title: 'Viewings today',
    blurb: 'Prepare these vehicles for their appointments.',
    empty: 'Nothing booked in today.',
    icon: CalendarClock,
  },
  {
    key: 'overdueFollowUps',
    kicker: 'Needs attention',
    title: 'Overdue follow-ups',
    blurb: 'Follow-ups past their due date.',
    empty: 'No follow-up has been missed.',
    icon: CircleAlert,
  },
  {
    key: 'unansweredEnquiries',
    kicker: 'New enquiries',
    title: 'Awaiting a reply',
    blurb: 'Enquiries with no reply logged against them yet.',
    empty: 'Every enquiry has had a first response.',
    icon: Inbox,
  },
  {
    key: 'depositsWithoutDeal',
    kicker: 'Paperwork',
    title: 'Deposits without a deal',
    blurb: 'Deposits received without a linked deal.',
    empty: 'Every deposit has a deal behind it.',
    icon: PoundSterling,
  },
];

function highlightFor(key: QueueKey, lead: Lead) {
  if (key === 'viewingsToday' && lead.appointmentAt) {
    return (
      <span className="inline-flex items-center gap-2 text-[12px] font-medium text-primary">
        <CalendarClock className="h-4 w-4 text-accent" />
        <span>{formatTime(lead.appointmentAt)}</span>
        <span className="text-muted-foreground">
          · {relativeTime(lead.appointmentAt)}
        </span>
      </span>
    );
  }
  if (key === 'overdueFollowUps' && lead.nextActionDueAt) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2 text-[12px] font-medium text-destructive">
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
      <span className="inline-flex items-center gap-2 text-[12px] font-medium text-primary/80">
        <Inbox className="h-4 w-4 shrink-0 text-accent" />
        Arrived {relativeTime(lead.createdAt)}
      </span>
    );
  }
  if (key === 'depositsWithoutDeal') {
    return (
      <span className="inline-flex items-center gap-2 text-[12px] font-medium text-primary">
        <PoundSterling className="h-4 w-4 text-accent" />
        {formatPence(lead.depositPence)} taken
        {lead.depositTakenAt && (
          <span className="text-muted-foreground">
            · {relativeTime(lead.depositTakenAt)}
          </span>
        )}
      </span>
    );
  }
  return undefined;
}

export function WorkQueue({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const [selectedQueue, setSelectedQueue] = useState<QueueKey | "all">("all");
  const worklistQuery = useGetPortalWorklist({
    query: {
      queryKey: getGetPortalWorklistQueryKey(),
      refetchInterval: 60_000,
    },
  });

  if (worklistQuery.isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center border border-border bg-card shadow-none text-primary">
        <LoaderCircle className="mr-3 h-6 w-6 animate-spin text-accent" />
        <span className="font-display text-[14px] font-semibold tracking-normal">Building worklist…</span>
      </div>
    );
  }

  if (worklistQuery.isError || !worklistQuery.data) {
    return (
      <div className="border border-destructive bg-destructive/5 p-8 text-destructive shadow-none">
        <p className="font-display text-2xl font-semibold tracking-tight">
          Could not build today&apos;s work list
        </p>
        <p className="mt-2 text-[13px] font-medium">Refresh the page, or check the API server is running.</p>
      </div>
    );
  }

  const worklist = worklistQuery.data;
  const total = queues.reduce((sum, queue) => sum + worklist[queue.key].length, 0);

  return (
    <div className="space-y-5" data-testid="work-queue">
      <div className="flex flex-wrap items-center justify-between gap-4 border-l-2 border-accent bg-secondary/60 px-4 py-3">
         <p className="flex items-center gap-3 font-display text-[15px] font-semibold tracking-normal text-primary">
          <Sun className="h-5 w-5 text-accent" />
          {total === 0
            ? 'Nothing is waiting on you.'
            : `${total} ${total === 1 ? 'item needs' : 'items need'} attention.`}
        </p>
         <p className="font-display text-[11px] font-semibold tracking-normal text-muted-foreground">
          As at {formatTime(worklist.generatedAt)}
        </p>
      </div>

      <NativeSelect
        aria-label="Focus worklist"
        value={selectedQueue}
        onChange={(event) => setSelectedQueue(event.target.value as QueueKey | "all")}
        className="sm:hidden"
      >
        <option value="all">All work ({total})</option>
        {queues.map((queue) => (
          <option key={queue.key} value={queue.key}>
            {queue.title} ({worklist[queue.key].length})
          </option>
        ))}
      </NativeSelect>
      <div
        className="hidden sm:flex flex-wrap gap-1 border-b border-border"
        aria-label="Focus worklist"
      >
        {([{ key: "all", title: "All work" }, ...queues] as const).map(
          (queue) => (
            <button
              key={queue.key}
              type="button"
              aria-pressed={selectedQueue === queue.key}
              aria-label={`${queue.title}, ${queue.key === "all" ? total : worklist[queue.key].length} items`}
              data-testid={`queue-filter-${queue.key}`}
              onClick={() => setSelectedQueue(queue.key)}
              className={`min-h-11 border-b-2 px-3 text-xs ${selectedQueue === queue.key ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground hover:text-primary"}`}
            >
              {queue.title}
              <span className="ml-2 tabular-nums text-muted-foreground">
                {queue.key === "all" ? total : worklist[queue.key].length}
              </span>
            </button>
          ),
        )}
      </div>
      <div
        className={`grid gap-5 ${selectedQueue === "all" ? "lg:grid-cols-2" : ""}`}
      >
        {queues
          .filter(
            (queue) => selectedQueue === "all" || queue.key === selectedQueue,
          )
          .map(({ key, kicker, title, blurb, empty, icon: Icon }) => {
            const leads = worklist[key];
            return (
              <Panel key={key} className="flex flex-col">
                <PanelHeader
                  title={
                    <span className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-accent" />
                      {title}
                    </span>
                  }
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
                <div className="flex-1">
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
