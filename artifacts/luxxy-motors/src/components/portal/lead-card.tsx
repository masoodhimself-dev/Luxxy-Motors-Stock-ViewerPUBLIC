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

export function LeadCard({
  lead,
  onOpen,
  highlight,
}: {
  lead: Lead;
  onOpen: (id: string) => void;
  highlight?: React.ReactNode;
}) {
  const vehicle = vehicleLine(lead);
  const overdue = isOverdue(lead.nextActionDueAt);

  return (
    <button
      type="button"
      onClick={() => onOpen(lead.id)}
      data-testid={`lead-card-${lead.id}`}
      className="group block w-full border-b border-border bg-card px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-semibold tracking-[-.03em] text-primary transition-colors group-hover:text-accent">
            {lead.customerName}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] font-medium text-primary/70">
            {lead.phone && (
              <span className="inline-flex items-center gap-2">
                <Phone className="h-4 w-4 text-accent" />
                <span>{lead.phone}</span>
              </span>
            )}
            {lead.email && (
              <span className="inline-flex min-w-0 items-center gap-2">
                <Mail className="h-4 w-4 text-accent" />
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
           <p className="mt-3 flex items-center gap-2 text-[13px] text-primary/80">
          <Car className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{vehicle}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {highlight ?? (
          <>
            {lead.nextAction ? (
              <span
                className={`inline-flex items-center gap-2 text-[12px]  tracking-normal font-bold ${overdue ? 'text-destructive' : 'text-primary'}`}
              >
                <CalendarClock className={`h-4 w-4 shrink-0 ${overdue ? 'text-destructive' : 'text-muted-foreground'}`} />
                <span className="truncate">{lead.nextAction}</span>
                {lead.nextActionDueAt && (
                  <span className="whitespace-nowrap text-muted-foreground">
                    · {relativeTime(lead.nextActionDueAt)}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-xs font-semibold text-muted-foreground">
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
          <span className="ml-auto whitespace-nowrap text-xs font-semibold text-muted-foreground bg-primary/5 px-2 py-1">
            {formatDateTime(lead.appointmentAt)}
          </span>
        )}
      </div>
    </button>
  );
}
