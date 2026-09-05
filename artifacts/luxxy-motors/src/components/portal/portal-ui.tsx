import type { ReactNode } from 'react';
import type { Lead, LeadActivityKind, LeadSource, LeadStage } from '@workspace/api-client-react';
import {
  CalendarClock,
  Handshake,
  MessageCircle,
  Mail,
  NotebookPen,
  Phone,
  Globe,
  Megaphone,
  Users,
  CircleDashed,
  DoorOpen,
} from 'lucide-react';

/** Channel labels the dealer would actually say out loud. */
export const sourceLabels: Record<LeadSource, string> = {
  website_form: 'Website',
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  walk_in: 'Walk-in',
  marketplace: 'Marketplace',
  social: 'Social',
};

export const stageLabels: Record<LeadStage, string> = {
  new: 'New',
  qualifying: 'Qualifying',
  viewing_booked: 'Viewing booked',
  offer: 'Offer',
  reserved: 'Reserved',
  sale_agreed: 'Sale agreed',
  collected: 'Collected',
  won: 'Won',
  lost: 'Lost',
};

export const activityLabels: Record<LeadActivityKind, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  note: 'Note',
  visit: 'Visit',
  stage_change: 'Stage change',
  system: 'System',
};

const sourceIcons: Record<LeadSource, typeof Globe> = {
  website_form: Globe,
  phone: Phone,
  whatsapp: MessageCircle,
  walk_in: DoorOpen,
  marketplace: Megaphone,
  social: Users,
};

export const activityIcons: Record<LeadActivityKind, typeof Phone> = {
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  note: NotebookPen,
  visit: Handshake,
  stage_change: CircleDashed,
  system: CalendarClock,
};

export function SourceIcon({ source, className }: { source: LeadSource; className?: string }) {
  const Icon = sourceIcons[source];
  return <Icon className={className} />;
}

const londonDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  dateStyle: 'medium',
});
const londonDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  dateStyle: 'medium',
  timeStyle: 'short',
});
const londonTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  timeStyle: 'short',
});

export const formatDate = (value: string) => londonDate.format(new Date(value));
export const formatDateTime = (value: string) => londonDateTime.format(new Date(value));
export const formatTime = (value: string) => londonTime.format(new Date(value));

export function formatPence(value: number | null | undefined) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    currencyDisplay: 'narrowSymbol',
    useGrouping: true,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value / 100);
}

/** "3 days overdue", "in 2 hours", "just now" — the dealer thinks in elapsed time. */
export function relativeTime(value: string, now = Date.now()) {
  const diffMs = new Date(value).getTime() - now;
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const format = (amount: number, unit: string) =>
    `${amount} ${unit}${amount === 1 ? '' : 's'}`;

  let phrase: string;
  if (abs < minute) return diffMs < 0 ? 'just now' : 'now';
  if (abs < hour) phrase = format(Math.round(abs / minute), 'minute');
  else if (abs < day) phrase = format(Math.round(abs / hour), 'hour');
  else phrase = format(Math.round(abs / day), 'day');

  return diffMs < 0 ? `${phrase} ago` : `in ${phrase}`;
}

export function isOverdue(value: string | null, now = Date.now()) {
  return value != null && new Date(value).getTime() < now;
}

/**
 * The one-line description of a lead's vehicle interest. Registrations are
 * shown as plain monospaced text, never as a number-plate band — most stock
 * carries no real VRM.
 */
export function vehicleLine(lead: Pick<Lead, 'vehicleTitle' | 'vehicleRegistration'>) {
  if (!lead.vehicleTitle && !lead.vehicleRegistration) return null;
  return [lead.vehicleTitle, lead.vehicleRegistration].filter(Boolean).join(' · ');
}

type Tone = 'neutral' | 'accent' | 'primary' | 'urgent' | 'muted';

const toneClasses: Record<Tone, string> = {
  neutral: 'border-border bg-card text-foreground',
  accent: 'border-accent/50 bg-accent/12 text-accent-foreground',
  primary: 'border-primary/30 bg-primary text-primary-foreground',
  urgent: 'border-destructive/40 bg-destructive/10 text-destructive',
  muted: 'border-border/70 bg-muted text-muted-foreground',
};

export function Chip({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

const stageTones: Record<LeadStage, Tone> = {
  new: 'accent',
  qualifying: 'neutral',
  viewing_booked: 'primary',
  offer: 'primary',
  reserved: 'primary',
  sale_agreed: 'primary',
  collected: 'neutral',
  won: 'muted',
  lost: 'muted',
};

export function StageChip({ stage }: { stage: LeadStage }) {
  return <Chip tone={stageTones[stage]}>{stageLabels[stage]}</Chip>;
}

export function SourceChip({ source }: { source: LeadSource }) {
  return (
    <Chip tone="muted">
      <SourceIcon source={source} className="h-3 w-3" />
      {sourceLabels[source]}
    </Chip>
  );
}

/** A squared, bordered panel — the portal's only surface primitive. */
export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-border bg-card ${className}`}>{children}</section>
  );
}

export function PanelHeader({
  kicker,
  title,
  meta,
  action,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-5 py-4">
      <div className="min-w-0">
        {kicker && <p className="luxxy-kicker text-accent">{kicker}</p>}
        <h2 className="mt-2 font-display text-xl font-semibold tracking-[-.01em] text-primary">
          {title}
        </h2>
        {meta && <p className="mt-1 text-[13px] text-muted-foreground">{meta}</p>}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Phone;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 border border-dashed border-border px-6 py-10 text-center">
      <Icon className="h-7 w-7 text-muted-foreground" />
      <p className="font-display text-base font-semibold text-primary">{title}</p>
      <p className="max-w-md text-[13px] text-muted-foreground">{body}</p>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="luxxy-label block text-muted-foreground">{children}</span>;
}

/**
 * Squared select that matches the showroom inputs. shadcn's Select is a popover
 * component; the portal's filters are dense enough that a native control is
 * both faster to use and easier to keep on-brand.
 */
export function SelectField({
  value,
  onChange,
  children,
  className = '',
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  value: string;
  onChange: React.ChangeEventHandler<HTMLSelectElement>;
  children: ReactNode;
}) {
  return (
    <select
      {...rest}
      value={value}
      onChange={onChange}
      className={`h-10 w-full appearance-none border border-input bg-card px-3 text-[13px] font-semibold text-foreground outline-none transition-colors focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent ${className}`}
    >
      {children}
    </select>
  );
}
