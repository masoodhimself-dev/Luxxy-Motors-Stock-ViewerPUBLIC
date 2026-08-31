import { useState } from 'react';
import {
  getGetEnquiriesQueryKey,
  useGetEnquiries,
  useUpdateEnquiryStatus,
  type Enquiry,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  CalendarDays,
  ExternalLink,
  Inbox,
  LoaderCircle,
  Mail,
  MessageSquare,
  Phone,
  ShieldAlert,
} from 'lucide-react';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStock } from '@/lib/stock-context';
import { formatPrice } from '@/lib/utils';

const statusLabels: Record<Enquiry['status'], string> = {
  new: 'New',
  contacted: 'Contacted',
  closed: 'Closed',
};

const typeLabels: Record<Enquiry['type'], string> = {
  viewing: 'Viewing',
  general: 'General',
  delivery: 'Delivery',
  warranty: 'Warranty',
  part_exchange: 'Part exchange',
};

function statusVariant(status: Enquiry['status']): 'default' | 'secondary' | 'outline' {
  if (status === 'new') return 'default';
  if (status === 'contacted') return 'secondary';
  return 'outline';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function EnquiryCard({ enquiry }: { enquiry: Enquiry }) {
  const queryClient = useQueryClient();
  const updateStatus = useUpdateEnquiryStatus({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }),
    },
  });
  const vehicleLabel = enquiry.vehicleTitle || 'General showroom enquiry';

  return (
    <article className="rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(enquiry.status)}>{statusLabels[enquiry.status]}</Badge>
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{typeLabels[enquiry.type]}</span>
          </div>
          <h2 className="mt-3 text-xl font-black tracking-tight">{enquiry.customerName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatDate(enquiry.createdAt)}</p>
          {enquiry.appointmentAt && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm font-bold text-primary">
              <CalendarDays className="h-4 w-4" /> Viewing: {formatDate(enquiry.appointmentAt)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {enquiry.status !== 'new' && (
            <Button
              size="sm"
              variant="outline"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ id: enquiry.id, data: { status: 'new' } })}
            >
              Mark new
            </Button>
          )}
          {enquiry.status !== 'contacted' && (
            <Button
              size="sm"
              variant="outline"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ id: enquiry.id, data: { status: 'contacted' } })}
            >
              Mark contacted
            </Button>
          )}
          {enquiry.status !== 'closed' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ id: enquiry.id, data: { status: 'closed' } })}
            >
              Close
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-4 border-y py-5 md:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Customer contact</p>
          <div className="mt-3 space-y-2 text-sm">
            {enquiry.phone && <a className="flex items-center gap-2 font-semibold text-foreground hover:text-primary" href={`tel:${enquiry.phone.replace(/[^0-9+]/g, '')}`}><Phone className="h-4 w-4 text-primary" />{enquiry.phone}</a>}
            {enquiry.email && <a className="flex items-center gap-2 font-semibold text-foreground hover:text-primary" href={`mailto:${enquiry.email}`}><Mail className="h-4 w-4 text-primary" />{enquiry.email}</a>}
            <p className="flex items-center gap-2 text-muted-foreground"><MessageSquare className="h-4 w-4" />Prefers {enquiry.preferredContact || 'any contact method'}</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Vehicle context</p>
          <div className="mt-3">
            <p className="font-bold">{vehicleLabel}</p>
            {enquiry.vehicleRegistration && <p className="mt-1 text-sm text-muted-foreground">{enquiry.vehicleRegistration}{enquiry.vehiclePrice != null ? ` · ${formatPrice(enquiry.vehiclePrice, 'GBP')}` : ''}</p>}
            {enquiry.vehicleUrl && (
              <Link href={enquiry.vehicleUrl} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                View vehicle <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Message</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">{enquiry.message}</p>
      </div>
      {updateStatus.isError && <p className="mt-4 text-sm text-destructive">Could not update this enquiry. Please try again.</p>}
    </article>
  );
}

export default function Portal() {
  const { stock, isLoading: stockLoading, error: stockError } = useStock();
  const [filter, setFilter] = useState<'all' | Enquiry['status']>('all');
  const enquiryQuery = useGetEnquiries(filter === 'all' ? undefined : { status: filter });
  const enquiries = enquiryQuery.data ?? [];
  const newCount = enquiries.filter((enquiry) => enquiry.status === 'new').length;

  return (
    <div className="min-h-[70vh] bg-muted/20 px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-primary"><Inbox className="h-4 w-4" /> Dealer portal</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Enquiry inbox</h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">Keep customer requests, viewing bookings, and vehicle conversations in one place.</p>
          </div>
          <Link href="/" className="text-sm font-bold text-primary hover:underline">Back to showroom</Link>
        </div>

        <div className="mb-8 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div><p className="font-bold">Temporary access notice</p><p className="mt-1 text-amber-900/80">This portal is intentionally passwordless during setup. Add authentication before sharing this URL beyond your team.</p></div>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-card p-5 shadow-sm"><p className="text-sm font-semibold text-muted-foreground">Inbox total</p><p className="mt-2 text-3xl font-black">{enquiries.length}</p></div>
          <div className="rounded-2xl border bg-card p-5 shadow-sm"><p className="text-sm font-semibold text-muted-foreground">Needs attention</p><p className="mt-2 text-3xl font-black text-primary">{newCount}</p></div>
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <p className="text-sm font-semibold text-muted-foreground">Showroom stock</p>
            {stockLoading ? <LoaderCircle className="mt-3 h-6 w-6 animate-spin text-primary" /> : stockError ? <p className="mt-2 flex items-center gap-2 text-sm text-destructive"><CircleAlert className="h-4 w-4" />Unavailable</p> : <p className="mt-2 flex items-center gap-2 text-3xl font-black"><CheckCircle2 className="h-6 w-6 text-green-600" />{stock?.cars.length ?? 0}</p>}
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'new', 'contacted', 'closed'] as const).map((value) => (
              <Button key={value} size="sm" variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>
                {value === 'all' ? 'All enquiries' : statusLabels[value]}
              </Button>
            ))}
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" />Newest first</p>
        </div>

        {enquiryQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center rounded-2xl border bg-card text-muted-foreground"><LoaderCircle className="mr-3 h-5 w-5 animate-spin text-primary" />Loading enquiries…</div>
        ) : enquiryQuery.isError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-900"><CircleAlert className="mx-auto mb-3 h-7 w-7" /><p className="font-bold">Could not load the enquiry inbox</p><p className="mt-1 text-sm">Refresh the page and try again.</p></div>
        ) : enquiries.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card p-12 text-center"><Inbox className="mx-auto mb-4 h-9 w-9 text-muted-foreground" /><h2 className="text-xl font-black">No enquiries here yet</h2><p className="mt-2 text-muted-foreground">{filter === 'all' ? 'New customer requests will appear here after they submit the showroom form.' : `There are no ${statusLabels[filter].toLowerCase()} enquiries.`}</p></div>
        ) : (
          <div className="space-y-4">{enquiries.map((enquiry) => <EnquiryCard key={enquiry.id} enquiry={enquiry} />)}</div>
        )}
      </div>
    </div>
  );
}