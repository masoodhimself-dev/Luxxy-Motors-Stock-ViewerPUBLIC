import type { Lead } from '@workspace/api-client-react';
import { CalendarClock, Car, Mail, Phone, PoundSterling } from 'lucide-react';
import {
  Chip,
  SourceChip,
  StageChip,
  formatDateTime,
  formatPence,
  isOverdue,
  relativeTime,
  vehicleLine,
} from './portal-ui';

/**
 * One row in the work queue or lead list. It has to answer three questions at a
 * glance: who is this, what car, and what am I supposed to do next.
 */
export function LeadCard({
  lead,
  onOpen,
  highlight,
}: {
  lead: Lead;
  onOpen: (id: string) => void;
  /** Overrides the trailing line when a queue has its own idea of urgency. */
  highlight?: React.ReactNode;
}) {
  const vehicle = vehicleLine(lead);
  const overdue = isOverdue(lead.nextActionDueAt);

  return (
    <button
      type="button"
      onClick={() => onOpen(lead.id)}
      data-testid={`lead-card-${lead.id}`}
      className="group block w-full border border-border bg-card px-5 py-4 text-left transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold tracking-[-.01em] text-primary transition-colors group-hover:text-accent">
            {lead.customerName}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {lead.phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-accent" />
                <span className="font-mono">{lead.phone}</span>
              </span>
            )}
            {lead.email && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-accent" />
                <span className="truncate">{lead.email}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SourceChip source={lead.source} />
          <StageChip stage={lead.stage} />
        </div>
      </div>

      {vehicle && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-foreground/80">
          <Car className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono">{vehicle}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3">
        {highlight ?? (
          <>
            {lead.nextAction ? (
              <span
                className={`inline-flex items-center gap-1.5 text-[13px] ${overdue ? 'font-semibold text-destructive' : 'text-foreground/80'}`}
              >
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{lead.nextAction}</span>
                {lead.nextActionDueAt && (
                  <span className="whitespace-nowrap text-muted-foreground">
                    · {relativeTime(lead.nextActionDueAt)}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-[13px] italic text-muted-foreground">
                No next action set
              </span>
            )}
          </>
        )}
        {lead.depositPence > 0 && (
          <Chip tone="accent">
            <PoundSterling className="h-3 w-3" />
            {formatPence(lead.depositPence)} held
          </Chip>
        )}
        {lead.appointmentAt && (
          <span className="ml-auto whitespace-nowrap font-mono text-[12px] text-muted-foreground">
            {formatDateTime(lead.appointmentAt)}
          </span>
        )}
      </div>
    </button>
  );
}
