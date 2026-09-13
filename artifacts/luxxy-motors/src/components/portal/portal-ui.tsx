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

export function vehicleLine(lead: Pick<Lead, 'vehicleTitle' | 'vehicleRegistration'>) {
  if (!lead.vehicleTitle && !lead.vehicleRegistration) return null;
  return [lead.vehicleTitle, lead.vehicleRegistration].filter(Boolean).join(' · ');
}

type Tone = 'neutral' | 'accent' | 'primary' | 'urgent' | 'muted';

const toneClasses: Record<Tone, string> = {
  neutral: 'border-primary/15 bg-background text-primary',
  accent: 'border-accent/30 bg-accent/10 text-accent',
  primary: 'border-primary bg-primary text-primary-foreground',
  urgent: 'border-destructive/30 bg-destructive/10 text-destructive',
  muted: 'border-primary/15 bg-primary/5 text-primary/60',
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
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-display text-[10px] font-semibold tracking-[0.08em] shadow-none ${toneClasses[tone]} ${className}`}
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

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`portal-panel luxxy-surface rounded-[1rem] border border-primary/10 ${className}`}>{children}</section>
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
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-primary/10 bg-background/45 px-6 py-5">
      <div className="min-w-0">
        {kicker && <p className="luxxy-kicker mb-2 text-[11px]">{kicker}</p>}
        <h2 className="font-display text-2xl font-semibold tracking-[-.03em] text-primary">
          {title}
        </h2>
        {meta && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{meta}</p>}
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
    <div className="my-4 flex flex-col items-center gap-4 rounded-[.85rem] border border-dashed border-primary/15 bg-background/55 px-8 py-12 text-center">
      <Icon className="mb-2 h-10 w-10 text-primary/25" />
      <p className="font-display text-xl font-semibold tracking-[-.02em] text-primary/60">{title}</p>
      <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
    return <span className="mb-2 block font-display text-[11px] font-semibold tracking-[0.08em] text-primary/75">{children}</span>;
}

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
      className={`h-12 w-full appearance-none rounded-none border-2 border-primary bg-background px-4 font-bold uppercase tracking-wider text-[12px] text-primary shadow-[2px_2px_0px_hsl(var(--primary))] outline-none transition-all focus-visible:border-accent focus-visible:ring-0 focus-visible:shadow-[4px_4px_0px_hsl(var(--accent))] ${className}`}
    >
      {children}
    </select>
  );
}