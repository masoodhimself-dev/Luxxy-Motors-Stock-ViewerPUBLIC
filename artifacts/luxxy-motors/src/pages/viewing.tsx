import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import {
  getGetEnquiryAvailabilityQueryKey,
  getGetViewingBookingQueryKey,
  useCancelViewing,
  useGetEnquiryAvailability,
  useGetViewingBooking,
  useRescheduleViewing,
} from '@workspace/api-client-react';
import { ArrowLeft, CalendarDays, CalendarPlus, Check, CircleAlert, Clock3, LoaderCircle, Phone, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getPhoneHref, getWhatsAppHref } from '@/lib/cta-helpers';

const bookingTimezone = 'Europe/London';

function dateString(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: bookingTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function bookingDates() {
  const dates: string[] = [];
  const today = dateString(new Date());
  for (let offset = 0; offset <= 30 && dates.length < 14; offset += 1) {
    const candidate = addDays(today, offset);
    if (new Date(`${candidate}T00:00:00.000Z`).getUTCDay() !== 0) dates.push(candidate);
  }
  return dates;
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: bookingTimezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatAppointment(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: bookingTimezone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(value));
}

function apiMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return fallback;
}

export default function Viewing() {
  const { token = '' } = useParams<{ token: string }>();
  const { settings: dealerConfig } = useDealerSettings();
  const [selectedDate, setSelectedDate] = useState(() => bookingDates()[0] ?? dateString(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'reschedule' | 'confirm-cancel'>('idle');
  const dates = useMemo(() => bookingDates(), []);

  const query = useGetViewingBooking(token, {
    query: { queryKey: getGetViewingBookingQueryKey(token), retry: false },
  });
  const reschedule = useRescheduleViewing();
  const cancel = useCancelViewing();

  const booking = reschedule.data ?? cancel.data ?? query.data;
  const availabilityQuery = useGetEnquiryAvailability(
    { date: selectedDate },
    {
      query: {
        queryKey: getGetEnquiryAvailabilityQueryKey({ date: selectedDate }),
        enabled: mode === 'reschedule' && Boolean(selectedDate),
        staleTime: 30_000,
      },
    },
  );

  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDate]);

  const phoneHref = getPhoneHref(dealerConfig);
  const whatsAppHref = getWhatsAppHref(undefined, dealerConfig);

  const shell = (children: React.ReactNode) => (
    <div className="luxxy-shell min-h-[calc(100dvh-5.5rem)] bg-background">
      <div className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
        <Link href="/" className="inline-flex items-center gap-3 font-display text-[12px] font-bold uppercase tracking-[0.2em] text-primary transition-colors hover:text-accent group mb-8" data-testid="link-back-to-showroom">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" /> Back to showroom
        </Link>
        <div className="border-4 border-primary bg-background shadow-[8px_8px_0px_hsl(var(--primary))]">
          {children}
        </div>
      </div>
    </div>
  );

  if (query.isLoading) {
    return shell(
      <div className="flex h-64 flex-col items-center justify-center gap-4 p-8 text-primary" data-testid="loading-viewing-session">
        <LoaderCircle className="h-8 w-8 animate-spin text-accent" />
        <span className="font-display text-[14px] font-black uppercase tracking-widest">Finding your booking...</span>
      </div>,
    );
  }

  if (query.isError || !booking) {
    const errorMsg = apiMessage(query.error, 'We could not find your booking. The link may have expired.');
    return shell(
      <div className="p-8 text-center sm:p-12">
        <span className="mx-auto grid h-16 w-16 place-items-center bg-accent/10 border-4 border-accent text-accent shadow-[4px_4px_0px_hsl(var(--primary))] mb-6">
          <CircleAlert className="h-8 w-8" />
        </span>
        <h1 className="font-display text-2xl sm:text-3xl font-black uppercase tracking-tighter text-primary">Cannot find booking</h1>
        <p className="mx-auto mt-4 max-w-md text-[13px] font-bold uppercase tracking-widest leading-relaxed text-primary/70" data-testid="status-viewing-error">{errorMsg}</p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button asChild size="lg" className="w-full sm:w-auto h-14 rounded-none bg-primary font-display text-[12px] font-bold uppercase tracking-widest text-primary-foreground shadow-[4px_4px_0px_hsl(var(--accent))] transition-all hover:bg-accent hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_hsl(var(--accent))] active:shadow-none">
            <Link href="/">Back to Showroom</Link>
          </Button>
          {phoneHref && (
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto h-14 rounded-none border-2 border-primary bg-background font-display text-[12px] font-bold uppercase tracking-widest text-primary shadow-[4px_4px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_hsl(var(--primary))]">
              <a href={phoneHref}><Phone className="mr-2 h-4 w-4" /> Call us</a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  const busy = reschedule.isPending || cancel.isPending;
  const isCancelled = booking.status === 'cancelled';
  const availableSlots = availabilityQuery.data?.slots.filter((s) => s.available) ?? [];

  return shell(
    <>
      <div className="flex flex-col gap-6 border-b-4 border-primary p-6 sm:flex-row sm:items-start sm:justify-between sm:p-10">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-black uppercase tracking-tighter text-primary">
            {isCancelled ? 'Viewing Cancelled' : 'Your Viewing'}
          </h1>
          <p className="mt-4 font-bold text-sm uppercase tracking-widest leading-relaxed text-primary/70" data-testid="text-viewing-customer">
            Hello, {booking.customerName}.
          </p>
          <div className="mt-6 space-y-4 text-sm font-bold uppercase tracking-wider text-primary">
            <p className="flex items-center gap-3">
              <CalendarDays className="h-5 w-5 text-accent" />
              {booking.appointmentAt ? formatAppointment(booking.appointmentAt) : 'Not scheduled'}
            </p>
            {booking.vehicleTitle && (
              <p className="flex items-center gap-3">
                <span className="grid h-5 w-5 place-items-center bg-primary text-primary-foreground font-display text-[10px] font-black">V</span>
                {booking.vehicleUrl ? (
                  <a href={booking.vehicleUrl} className="underline-offset-4 hover:text-accent hover:underline">{booking.vehicleTitle}</a>
                ) : (
                  booking.vehicleTitle
                )}
              </p>
            )}
          </div>
        </div>
        {!isCancelled && mode === 'idle' && booking.canChange && (
          <div className="flex shrink-0 flex-col gap-3">
            {booking.calendarIcs && (
              <Button asChild variant="outline" className="w-full h-12 rounded-none border-2 border-primary bg-background font-display text-[11px] font-bold uppercase tracking-widest text-primary shadow-[2px_2px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[0px_0px_0px_hsl(var(--primary))]">
                <a href={`data:text/calendar;charset=utf8,${encodeURIComponent(booking.calendarIcs)}`} download="viewing.ics" data-testid="link-viewing-calendar">
                  <CalendarPlus className="mr-2 h-4 w-4" /> Add to calendar
                </a>
              </Button>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setMode('reschedule')} className="flex-1 h-12 rounded-none border-2 border-primary bg-background font-display text-[11px] font-bold uppercase tracking-widest text-primary shadow-[2px_2px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[0px_0px_0px_hsl(var(--primary))]" data-testid="button-viewing-reschedule">
                Reschedule
              </Button>
              <Button variant="outline" onClick={() => setMode('confirm-cancel')} className="flex-1 h-12 rounded-none border-2 border-destructive text-destructive bg-background font-display text-[11px] font-bold uppercase tracking-widest shadow-[2px_2px_0px_hsl(var(--accent))] transition-all hover:bg-destructive hover:text-destructive-foreground hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[0px_0px_0px_hsl(var(--accent))]" data-testid="button-viewing-cancel">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {isCancelled ? (
        <div className="bg-primary/5 p-6 sm:p-10 border-t-2 border-primary/10">
          <p className="flex items-center gap-3 font-display text-[12px] font-black uppercase tracking-[0.2em] text-primary" data-testid="status-viewing-cancelled">
            <XCircle className="h-5 w-5 text-accent" /> This viewing will not go ahead.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button asChild className="h-12 rounded-none bg-primary font-display text-[11px] font-bold uppercase tracking-widest text-primary-foreground shadow-[3px_3px_0px_hsl(var(--accent))] transition-all hover:bg-accent hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[1px_1px_0px_hsl(var(--accent))]">
              <Link href="/">Back to Stock</Link>
            </Button>
            {(phoneHref || whatsAppHref) && (
              <p className="flex items-center gap-4 font-bold text-[11px] uppercase tracking-widest text-primary/70 border-l-2 border-primary/20 pl-4">
                Questions?
                {phoneHref && <a href={phoneHref} className="text-primary hover:text-accent hover:underline">Call us</a>}
                {whatsAppHref && <a href={whatsAppHref} className="text-primary hover:text-accent hover:underline">WhatsApp</a>}
              </p>
            )}
          </div>
        </div>
      ) : mode === 'confirm-cancel' ? (
        <div className="bg-destructive/10 p-6 sm:p-10 border-t-4 border-destructive">
          <p className="font-display text-[15px] font-black uppercase tracking-widest text-destructive">Cancel your viewing</p>
          <p className="mt-2 text-sm font-bold uppercase tracking-widest text-destructive/80">Are you sure? We will open the diary back up for someone else.</p>

          {cancel.isError && (
            <p role="alert" className="mt-6 border-4 border-destructive/50 bg-background p-4 text-sm font-bold text-destructive" data-testid="status-cancel-error">{apiMessage(cancel.error, 'We could not cancel your viewing. Please try again or call us.')}</p>
          )}

          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <Button type="button" variant="destructive" disabled={busy} onClick={() => cancel.mutate({ token, data: {} })} className="h-14 flex-1 rounded-none font-display text-[12px] font-bold uppercase tracking-[0.1em] shadow-[4px_4px_0px_hsl(var(--primary))] hover:-translate-y-1 hover:shadow-[6px_6px_0px_hsl(var(--primary))] transition-all" data-testid="button-confirm-cancel">
              {cancel.isPending ? 'Cancelling…' : 'Yes, cancel it'}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setMode('idle')} className="h-14 flex-1 rounded-none border-2 border-primary font-display text-[12px] font-bold uppercase tracking-[0.1em] text-primary shadow-[4px_4px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground hover:-translate-y-1 hover:shadow-[6px_6px_0px_hsl(var(--primary))]" data-testid="button-abort-cancel">
              No, keep it
            </Button>
          </div>
        </div>
      ) : mode === 'reschedule' ? (
        <div className="bg-primary/5 p-6 sm:p-10 border-t-2 border-primary/10">
          <p className="font-display text-[15px] font-black uppercase tracking-widest text-primary mb-6">Choose a new time</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" data-testid="group-viewing-dates">
            {dates.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                aria-pressed={selectedDate === date}
                className={`flex h-12 flex-col items-center justify-center border-2 border-primary bg-background px-2 transition-all duration-200 shadow-[2px_2px_0px_hsl(var(--primary))] hover:-translate-y-1 hover:shadow-[4px_4px_0px_hsl(var(--primary))] ${selectedDate === date ? 'border-accent shadow-[2px_2px_0px_hsl(var(--accent))] translate-y-[-2px]' : ''}`}
                data-testid={`button-viewing-date-${date}`}
              >
                <span className={`font-display text-[11px] font-black uppercase tracking-widest ${selectedDate === date ? 'text-accent' : 'text-primary'}`}>
                  {formatDateLabel(date).split(' ')[0]}
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-widest ${selectedDate === date ? 'text-primary' : 'text-primary/60'}`}>
                  {formatDateLabel(date).split(' ').slice(1).join(' ')}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-8 border-t-2 border-primary/10 pt-8">
            {availabilityQuery.isLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="loading-availability">
                {[1, 2, 3, 4].map((item) => <div key={item} className="h-12 animate-pulse bg-primary/10 border-2 border-primary/20" />)}
              </div>
            ) : availabilityQuery.isError ? (
              <p role="alert" className="border-4 border-destructive/50 bg-background p-4 text-[13px] font-bold uppercase tracking-widest text-destructive" data-testid="status-availability-error">Could not load available times. Please choose another date.</p>
            ) : availableSlots.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="group-viewing-slots">
                {availabilityQuery.data?.slots.map((slot) => (
                  <button
                    key={slot.startAt}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => setSelectedSlot(slot.startAt)}
                    aria-pressed={selectedSlot === slot.startAt}
                    className={`flex h-12 items-center justify-center gap-2 border-2 text-[12px] font-bold uppercase tracking-widest transition-all duration-200 ${selectedSlot === slot.startAt ? 'border-primary bg-primary text-primary-foreground shadow-[3px_3px_0px_hsl(var(--accent))]' : slot.available ? 'border-primary bg-background shadow-[2px_2px_0px_hsl(var(--primary))] hover:-translate-y-1 hover:shadow-[4px_4px_0px_hsl(var(--primary))]' : 'cursor-not-allowed border-primary/20 bg-background text-primary/30 line-through shadow-none'}`}
                    data-testid={`button-viewing-slot-${slot.startAt}`}
                  >
                    {selectedSlot === slot.startAt && <Check className="h-4 w-4" />}
                    {slot.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="border-4 border-accent/50 bg-background p-4 text-[13px] font-bold uppercase tracking-widest text-accent" data-testid="status-availability-empty">There are no remaining times on this date. Please choose another day.</p>
            )}
          </div>

          {reschedule.isError && (
            <p role="alert" className="mt-8 border-4 border-destructive/50 bg-background p-4 text-[13px] font-bold uppercase tracking-widest text-destructive" data-testid="status-reschedule-error">{apiMessage(reschedule.error, 'We could not move your viewing. Please try again or call us.')}</p>
          )}

          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Button
              type="button"
              disabled={busy || !selectedSlot}
              onClick={() => {
                if (!selectedSlot) return;
                reschedule.mutate(
                  { token, data: { appointmentAt: selectedSlot } },
                  { onSuccess: () => setMode('idle') },
                );
              }}
              className="h-14 flex-1 rounded-none font-display text-[12px] font-bold uppercase tracking-[0.1em] shadow-[4px_4px_0px_hsl(var(--accent))] hover:-translate-y-1 hover:shadow-[6px_6px_0px_hsl(var(--accent))] transition-all"
              data-testid="button-confirm-reschedule"
            >
              {reschedule.isPending ? 'MOVING VIEWING…' : 'CONFIRM NEW TIME'}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setMode('idle')} className="h-14 flex-1 rounded-none border-2 border-primary font-display text-[12px] font-bold uppercase tracking-[0.1em] text-primary shadow-[4px_4px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground hover:-translate-y-1 hover:shadow-[6px_6px_0px_hsl(var(--primary))]" data-testid="button-cancel-reschedule">
              Keep current time
            </Button>
          </div>
        </div>
      ) : reschedule.isSuccess && mode === 'idle' ? (
        <div className="bg-background p-6 sm:p-10 border-t-4 border-accent">
          <p className="flex items-center gap-3 font-display text-[13px] font-black uppercase tracking-widest text-primary" data-testid="status-reschedule-success">
            <Clock3 className="h-5 w-5 text-accent" /> Your viewing has been moved. We have updated the showroom diary.
          </p>
        </div>
      ) : null}
    </>,
  );
}