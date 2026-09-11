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
      className="group block w-full border-4 border-primary bg-background p-5 text-left transition-all hover:border-accent hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[6px_6px_0px_hsl(var(--primary))] focus-visible:border-accent focus-visible:outline-none shadow-[2px_2px_0px_hsl(var(--primary))]"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-2xl font-black uppercase tracking-tighter text-primary transition-colors group-hover:text-accent">
            {lead.customerName}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] font-bold uppercase tracking-widest text-primary/70">
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
        <p className="mt-4 flex items-center gap-3 text-[13px] font-bold uppercase tracking-widest text-primary/80 bg-primary/5 p-3 border-2 border-primary/10">
          <Car className="h-4 w-4 shrink-0 text-primary/40" />
          <span className="truncate">{vehicle}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t-2 border-primary/10 pt-4">
        {highlight ?? (
          <>
            {lead.nextAction ? (
              <span
                className={`inline-flex items-center gap-2 text-[12px] uppercase tracking-widest font-bold ${overdue ? 'text-destructive' : 'text-primary'}`}
              >
                <CalendarClock className={`h-4 w-4 shrink-0 ${overdue ? 'text-destructive' : 'text-primary/40'}`} />
                <span className="truncate">{lead.nextAction}</span>
                {lead.nextActionDueAt && (
                  <span className="whitespace-nowrap text-primary/50">
                    · {relativeTime(lead.nextActionDueAt)}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-primary/40">
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
          <span className="ml-auto whitespace-nowrap text-[11px] font-black uppercase tracking-[0.2em] text-primary/60 bg-primary/5 px-2 py-1">
            {formatDateTime(lead.appointmentAt)}
          </span>
        )}
      </div>
    </button>
  );
}