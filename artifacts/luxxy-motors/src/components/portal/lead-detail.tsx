import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetLeadChannelSummaryQueryKey,
  getGetLeadQueryKey,
  getGetLeadsQueryKey,
  getGetPortalWorklistQueryKey,
  useGetLead,
  useUpdateLead,
  type Lead,
  type LeadActivity,
  type LeadDeal,
  type LeadUpdate,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import {
  ArrowLeft,
  CalendarClock,
  Car,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileText,
  LoaderCircle,
  Mail,
  MessageSquareQuote,
  Phone,
  PoundSterling,
  Save,
  UserRound,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ActivityComposer } from './activity-composer';
import {
  Chip,
  Panel,
  SourceChip,
  StageChip,
  activityIcons,
  activityLabels,
  formatDate,
  formatDateTime,
  formatPence,
  isOverdue,
  relativeTime,
} from './portal-ui';
import { Field, fromLocalInput, orNull, toLocalInput } from './lead-form-fields';

function DetailRow({
  icon: Icon,
  label,
  value,
  mono,
  href,
}: {
  icon: typeof Phone;
  label: string;
  value: string | null;
  mono?: boolean;
  href?: string;
}) {
  if (!value) return null;
  const body = (
    <span className={`text-[14px] text-foreground ${mono ? 'font-mono' : ''}`}>
      {value}
    </span>
  );
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <div className="min-w-0">
        <span className="font-display text-xs font-semibold text-primary block text-primary/70 font-medium">
          {label}
        </span>
        {href ? (
          <a href={href} className="underline-offset-4 hover:underline">
            {body}
          </a>
        ) : (
          body
        )}
      </div>
    </div>
  );
}

/** The banner that answers "what am I meant to do about this one". */
function NextActionBand({
  lead,
  onSave,
  saving,
}: {
  lead: Lead;
  onSave: (update: LeadUpdate) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState(lead.nextAction ?? '');
  const [due, setDue] = useState(toLocalInput(lead.nextActionDueAt));

  useEffect(() => {
    setAction(lead.nextAction ?? '');
    setDue(toLocalInput(lead.nextActionDueAt));
  }, [lead.nextAction, lead.nextActionDueAt]);

  const overdue = isOverdue(lead.nextActionDueAt);
  const closed = lead.stage === 'won' || lead.stage === 'lost';

  if (editing) {
    return (
      <div className="rounded-md border border-accent/30 bg-accent/10 px-5 py-4" data-testid="next-action-edit">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Next action">
            <Input
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="Ring back with a part-ex figure"
              className="rounded-md"
              maxLength={300}
              data-testid="input-edit-next-action"
            />
          </Field>
          <Field label="Due">
            <Input
              type="datetime-local"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              className="rounded-md font-mono"
              data-testid="input-edit-next-due"
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            className="rounded-md"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-md text-[12px] font-medium"
            disabled={saving}
            onClick={() => {
              onSave({
                nextAction: orNull(action),
                nextActionDueAt: fromLocalInput(due),
              });
              setEditing(false);
            }}
            data-testid="button-save-next-action"
          >
            {saving ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-4 rounded-md border px-5 py-4 ${
        closed
          ? 'border-border bg-muted'
          : overdue
            ? 'border-destructive/40 bg-destructive/10'
            : 'border-accent/50 bg-accent/10'
      }`}
      data-testid="next-action-band"
    >
      <div className="min-w-0">
        <p className="luxxy-kicker text-[11px] text-primary/70">Next action</p>
        {closed ? (
          <p className="mt-1 font-display text-lg font-semibold text-primary">
            Closed as {lead.stage === 'won' ? 'won' : 'lost'}
            {lead.closedAt && (
              <span className="ml-2 font-sans text-[13px] font-normal text-primary/70 font-medium">
                {formatDate(lead.closedAt)}
              </span>
            )}
          </p>
        ) : lead.nextAction ? (
          <p
             className={`mt-1 font-display text-lg font-medium tracking-[-.02em] ${overdue ? 'text-destructive' : 'text-primary'}`}
          >
            {lead.nextAction}
            {lead.nextActionDueAt && (
              <span className="ml-2 font-sans text-[13px] font-normal text-primary/70 font-medium">
                due {formatDateTime(lead.nextActionDueAt)} ·{" "}
                {relativeTime(lead.nextActionDueAt)}
              </span>
            )}
          </p>
        ) : (
          <p className="mt-1 font-display text-lg font-semibold italic text-primary/70 font-medium">
            Nothing decided yet
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        className="shrink-0 rounded-md text-[12px] font-medium"
        onClick={() => setEditing(true)}
        data-testid="button-edit-next-action"
      >
        <CalendarClock className="mr-2 h-4 w-4" />
        {lead.nextAction ? 'Change' : 'Set one'}
      </Button>
    </div>
  );
}

function Timeline({ activities }: { activities: LeadActivity[] }) {
  if (activities.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-[13px] text-primary/70 font-medium">
        Nothing logged yet. The first call or note will show up here.
      </p>
    );
  }

  return (
     <ol className="divide-y divide-primary/10" data-testid="lead-timeline">
      {activities.map((activity) => {
        const Icon = activityIcons[activity.kind];
        const quiet = activity.kind === 'system' || activity.kind === 'stage_change';
        return (
         <li key={activity.id} className="flex gap-4 px-5 py-4">
            <span
               className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                quiet
                  ? 'border-border bg-muted text-primary/70 font-medium'
                  : 'border-accent/50 bg-accent/12 text-accent'
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                 <span className="font-display text-[11px] font-semibold tracking-normal text-primary/70">
                  {activityLabels[activity.kind]}
                  {activity.actor && ` · ${activity.actor}`}
                </span>
                 <span className="font-mono text-[12px] text-muted-foreground">
                  {formatDateTime(activity.occurredAt)}
                </span>
              </div>
              <p
                className={`mt-1 whitespace-pre-wrap text-[14px] leading-relaxed ${quiet ? 'text-primary/70 font-medium' : 'text-foreground'}`}
              >
                {activity.body}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function DealPanel({ deal }: { deal: LeadDeal | null }) {
  if (!deal) {
    return (
      <Panel>
        <header className="border-b border-primary px-5 py-4">
          <p className="flex items-center gap-2 font-display text-xs font-semibold text-accent">Paperwork</p>
          <h2 className="mt-2 font-display text-xl font-semibold text-primary">Deal</h2>
        </header>
        <p className="px-5 py-6 text-[13px] text-primary/70 font-medium">
          No deal raised against this lead yet. Start one from the Deals tab when the
          customer commits.
        </p>
      </Panel>
    );
  }

  return (
    <Panel data-testid="lead-deal">
      <header className="flex items-start justify-between gap-3 border-b border-primary px-5 py-4">
        <div>
          <p className="flex items-center gap-2 font-display text-xs font-semibold text-accent">Paperwork</p>
          <h2 className="mt-2 font-display text-xl font-semibold text-primary">Deal</h2>
        </div>
        <Chip tone="primary">{deal.status.replace(/_/g, ' ')}</Chip>
      </header>
      <dl className="divide-y divide-border px-5">
        {[
          ['Agreed price', deal.agreedPricePence],
          ['Deposit', deal.depositPence],
          ['Balance', deal.balancePence],
        ].map(([label, value]) => (
          <div key={label as string} className="flex items-center justify-between py-3">
            <dt className="font-display text-xs font-semibold text-primary text-primary/70 font-medium">
              {label}
            </dt>
            <dd className="luxxy-price-inline text-[15px] text-primary">
              {formatPence(value as number)}
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between py-3">
          <dt className="font-display text-xs font-semibold text-primary text-primary/70 font-medium">Raised</dt>
          <dd className="font-mono text-[13px] text-primary/70 font-medium">
            {formatDate(deal.createdAt)}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

/** Won/lost always demands a reason — that is the whole point of the record. */
function OutcomePanel({
  lead,
  onSave,
  saving,
}: {
  lead: Lead;
  onSave: (update: LeadUpdate) => void;
  saving: boolean;
}) {
  const [pending, setPending] = useState<'won' | 'lost' | null>(null);
  const [reason, setReason] = useState('');
  const closed = lead.stage === 'won' || lead.stage === 'lost';

  if (closed) {
    return (
      <Panel className="p-5">
        <p className="font-display text-xs font-semibold text-primary text-primary/70 font-medium">Outcome</p>
        <p className="mt-2 flex items-center gap-2 font-display text-lg font-semibold text-primary">
          {lead.stage === 'won' ? (
            <CheckCircle2 className="h-5 w-5 text-accent" />
          ) : (
            <XCircle className="h-5 w-5 text-primary/70 font-medium" />
          )}
          {lead.stage === 'won' ? 'Won' : 'Lost'}
        </p>
        {lead.outcomeReason && (
          <p className="mt-2 text-[14px] text-foreground">
            {lead.outcomeReason}
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          className="mt-4 rounded-md px-0 text-[12px] font-medium text-primary/70 hover:bg-transparent hover:text-accent"
          disabled={saving}
          onClick={() => onSave({ stage: 'offer', outcomeReason: null })}
          data-testid="button-reopen-lead"
        >
          Reopen this lead
        </Button>
      </Panel>
    );
  }

  return (
    <Panel className="p-5" data-testid="outcome-panel">
      <p className="font-display text-xs font-semibold text-primary text-primary/70 font-medium">Close this lead</p>
      {pending ? (
        <div className="mt-3 space-y-3">
          <Field label={pending === 'won' ? 'How was it won?' : 'Why was it lost?'}>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                pending === 'won'
                  ? 'Bought the Octavia at £13,250 with a 12-month warranty.'
                  : 'Bought elsewhere — found the same car £600 cheaper in Watford.'
              }
              className="min-h-20 rounded-md"
              maxLength={300}
              data-testid="input-outcome-reason"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="rounded-md"
              onClick={() => {
                setPending(null);
                setReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-md text-[12px] font-medium"
              disabled={saving || reason.trim() === ''}
              onClick={() => {
                onSave({ stage: pending, outcomeReason: reason.trim() });
                setPending(null);
                setReason('');
              }}
              data-testid="button-confirm-outcome"
            >
              {saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              Mark {pending}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            type="button"
            className="rounded-md bg-primary text-[12px] font-medium"
            onClick={() => setPending('won')}
            data-testid="button-close-won"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Won
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-md text-[12px] font-medium"
            onClick={() => setPending('lost')}
            data-testid="button-close-lost"
          >
            <XCircle className="mr-2 h-4 w-4" />
            Lost
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function LeadDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const cache = useQueryClient();
  const leadQuery = useGetLead(id);
  const updateLead = useUpdateLead();

  const save = async (data: LeadUpdate) => {
    await updateLead.mutateAsync({ id, data });
    await Promise.all([
      cache.invalidateQueries({ queryKey: getGetLeadQueryKey(id) }),
      cache.invalidateQueries({ queryKey: getGetLeadsQueryKey() }),
      cache.invalidateQueries({ queryKey: getGetPortalWorklistQueryKey() }),
      cache.invalidateQueries({ queryKey: getGetLeadChannelSummaryQueryKey() }),
    ]);
  };

  if (leadQuery.isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center border border-border bg-card text-primary/70 font-medium">
        <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-accent" />
        Opening the file…
      </div>
    );
  }

  if (leadQuery.isError || !leadQuery.data) {
    return (
      <div className="border border-destructive/40 bg-destructive/10 p-6 text-[13px] text-destructive">
        <p className="flex items-center gap-2 font-display text-base font-semibold">
          <CircleAlert className="h-4 w-4" /> That lead could not be opened
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4 rounded-md"
          onClick={onBack}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  const { lead, activities, deal, enquiryMessage } = leadQuery.data;
  const saving = updateLead.isPending;

  return (
    <div className="space-y-6" data-testid="lead-detail">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="text-link text-muted-foreground hover:text-accent"
          data-testid="button-back-to-list"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the desk
        </button>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-primary sm:text-3xl">
              {lead.customerName}
            </h2>
            <p className="mt-2 text-[13px] text-primary/70 font-medium">
              First seen {formatDate(lead.createdAt)} · last activity{' '}
              {relativeTime(lead.lastActivityAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SourceChip source={lead.source} />
            <StageChip stage={lead.stage} />
            {lead.depositPence > 0 && (
              <Chip tone="accent">
                <PoundSterling className="h-3 w-3" />
                {formatPence(lead.depositPence)} held
              </Chip>
            )}
          </div>
        </div>
      </div>

      <div
        className="sticky top-[var(--site-header-height)] z-20 border-y border-border bg-background px-3 py-2"
        data-testid="lead-context-bar"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm">
          <span className="font-semibold">{lead.customerName}</span>
          <span className="text-xs text-muted-foreground">
            {lead.vehicleTitle || lead.vehicleRegistration ||
              "Vehicle to be confirmed"}
          </span>
        </div>
        <p className="mt-1 truncate text-xs">
          <span className="text-muted-foreground">Next: </span>
          {lead.nextAction || "Set a follow-up action"}
          {lead.nextActionDueAt
            ? ` · ${formatDateTime(lead.nextActionDueAt)}`
            : ""}
        </p>
      </div>
      <NextActionBand lead={lead} onSave={save} saving={saving} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <ActivityComposer leadId={lead.id} currentStage={lead.stage} />

          <Panel>
             <header className="border-b border-border bg-background/45 px-5 py-4">
               <p className="luxxy-kicker text-[11px]">Activity</p>
               <h2 className="mt-2 font-display text-xl font-medium tracking-[-.02em] text-primary">
                Timeline
              </h2>
            </header>
            <Timeline activities={activities} />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel className="px-5 py-4">
            <p className="flex items-center gap-2 font-display text-xs font-semibold text-accent">
              <UserRound className="h-3.5 w-3.5" /> Customer
            </p>
            <div className="mt-2 divide-y divide-border">
              <DetailRow
                icon={Phone}
                label="Phone"
                value={lead.phone}
                mono
                href={lead.phone ? `tel:${lead.phone.replace(/\s/g, '')}` : undefined}
              />
              <DetailRow
                icon={Mail}
                label="Email"
                value={lead.email}
                href={lead.email ? `mailto:${lead.email}` : undefined}
              />
              <DetailRow icon={UserRound} label="Handled by" value={lead.owner} />
              <DetailRow
                icon={CalendarClock}
                label="Viewing"
                value={lead.appointmentAt ? formatDateTime(lead.appointmentAt) : null}
                mono
              />
            </div>
          </Panel>

          {(lead.vehicleTitle || lead.vehicleRegistration) && (
            <Panel className="px-5 py-4">
              <p className="flex items-center gap-2 font-display text-xs font-semibold text-accent">
                <Car className="h-3.5 w-3.5" /> Vehicle
              </p>
              <p className="mt-3 font-display text-lg font-semibold text-primary">
                {lead.vehicleTitle ?? 'Unnamed vehicle'}
              </p>
              {lead.vehicleRegistration && (
                <p className="mt-1 font-mono text-[13px] text-primary/70 font-medium">
                  {lead.vehicleRegistration}
                </p>
              )}
              {lead.vehicleId && (
                <Link
                  href={`/vehicle/${lead.vehicleId}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary underline-offset-4 hover:text-accent hover:underline"
                  data-testid="link-vehicle"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open the listing
                </Link>
              )}
            </Panel>
          )}

          {(lead.summary || enquiryMessage) && (
            <Panel className="px-5 py-4">
              <p className="flex items-center gap-2 font-display text-xs font-semibold text-accent">
                <MessageSquareQuote className="h-3.5 w-3.5" /> In their words
              </p>
              <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
                {enquiryMessage ?? lead.summary}
              </p>
              {enquiryMessage && lead.summary && enquiryMessage.trim() !== lead.summary.trim() && (
                <p className="mt-3 whitespace-pre-wrap border-t border-primary pt-3 text-[13px] leading-relaxed text-primary/70 font-medium">
                  {lead.summary}
                </p>
              )}
            </Panel>
          )}

          <DealPanel deal={deal} />
          <OutcomePanel lead={lead} onSave={save} saving={saving} />

          {lead.enquiryId && (
            <p className="flex items-center gap-2 px-1 font-mono text-[12px] text-primary/70 font-medium">
              <FileText className="h-3.5 w-3.5" />
              From website enquiry {lead.enquiryId.slice(0, 8)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
