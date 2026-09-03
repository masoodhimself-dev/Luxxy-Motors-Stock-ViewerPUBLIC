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
    <div className="min-h-[calc(100dvh-4.5rem)] bg-background">
      <div className="mx-auto max-w-2xl px-4 pb-20 pt-6 sm:px-6 sm:pt-10">
        <Link href="/" className="appointment-rise inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition-colors hover:text-primary" data-testid="link-back-to-showroom">
          <ArrowLeft className="h-4 w-4" /> Back to showroom
        </Link>
        {children}
      </div>
    </div>
  );

  if (query.isLoading) {
    return shell(
      <div className="mt-10 flex items-center gap-3 text-sm font-semibold text-muted-foreground" data-testid="loading-viewing">
        <LoaderCircle className="h-5 w-5 animate-spin text-primary" /> Loading your viewing…
      </div>,
    );
  }

  if (!booking) {
    return shell(
      <div className="appointment-rise mt-10 border border-[#e2cf9d] bg-[#fff8e6] p-7 sm:p-10" data-testid="status-viewing-not-found">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#80611f]"><CircleAlert className="h-4 w-4" /> Link unavailable</p>
        <h1 className="font-display mt-3 text-4xl text-foreground">We could not open this viewing.</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">{apiMessage(query.error, 'This link is no longer valid. Please contact the showroom to change your viewing.')}</p>
        {(phoneHref || whatsAppHref) && (
          <div className="mt-6 flex flex-wrap gap-3">
            {phoneHref && <a href={phoneHref} className="inline-flex h-11 items-center gap-2 bg-primary px-5 text-sm font-bold text-primary-foreground" data-testid="link-call-showroom"><Phone className="h-4 w-4" /> Call {dealerConfig.contact.phone}</a>}
            {whatsAppHref && <a href={whatsAppHref} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 border border-[#d9d0c1] px-5 text-sm font-bold text-foreground" data-testid="link-whatsapp-showroom">WhatsApp us</a>}
          </div>
        )}
      </div>,
    );
  }

  const cancelled = booking.status === 'cancelled';
  const calendarHref = booking.calendarIcs
    ? `data:text/calendar;charset=utf-8,${encodeURIComponent(booking.calendarIcs)}`
    : null;
  const availableSlots = availabilityQuery.data?.slots.filter((slot) => slot.available) ?? [];
  const busy = reschedule.isPending || cancel.isPending;

  return shell(
    <>
      <div className={`appointment-rise mt-8 overflow-hidden border p-7 sm:p-10 ${cancelled ? 'border-[#d9d0c1] bg-[#f5f1e8]' : 'border-[#b5cbbd] bg-[#edf5ef]'}`} data-testid="card-viewing-booking">
        <p className={`text-xs font-bold uppercase tracking-[0.2em] ${cancelled ? 'text-muted-foreground' : 'text-[#47725a]'}`}>
          {cancelled ? 'Viewing cancelled' : 'Your viewing'}
        </p>
        <h1 className={`font-display mt-2 text-4xl sm:text-5xl ${cancelled ? 'text-foreground' : 'text-[#173a2a]'}`} data-testid="text-viewing-heading">
          {cancelled ? 'This viewing is cancelled.' : 'You are booked in.'}
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          {cancelled
            ? `We have let the ${dealerConfig.identity.name} team know. You are welcome to book again whenever suits you.`
            : `Hello ${booking.customerName}. Here are the details we are holding for you.`}
        </p>

        <dl className="mt-7 space-y-3 border-t border-black/5 pt-6 text-sm">
          <div className="flex items-start justify-between gap-4">
            <dt className="font-semibold text-muted-foreground">Reference</dt>
            <dd className="font-mono font-bold tracking-[0.14em] text-foreground" data-testid="text-viewing-reference">{booking.reference}</dd>
          </div>
          {booking.appointmentAt && (
            <div className="flex items-start justify-between gap-4">
              <dt className="font-semibold text-muted-foreground">{cancelled ? 'Was booked for' : 'When'}</dt>
              <dd className={`text-right font-bold ${cancelled ? 'text-muted-foreground line-through' : 'text-foreground'}`} data-testid="text-viewing-appointment">{formatAppointment(booking.appointmentAt)}</dd>
            </div>
          )}
          {booking.vehicleTitle && (
            <div className="flex items-start justify-between gap-4">
              <dt className="font-semibold text-muted-foreground">Car</dt>
              <dd className="text-right font-bold text-foreground" data-testid="text-viewing-vehicle">
                {booking.vehicleUrl ? <Link href={booking.vehicleUrl} className="underline underline-offset-4">{booking.vehicleTitle}</Link> : booking.vehicleTitle}
              </dd>
            </div>
          )}
        </dl>

        {!cancelled && calendarHref && (
          <a href={calendarHref} download="viewing.ics" className="mt-6 inline-flex h-11 items-center gap-2 border border-[#9fbea9] px-4 text-sm font-bold text-[#2e6245] transition-colors hover:bg-[#dcecdf]" data-testid="link-add-to-calendar">
            <CalendarPlus className="h-4 w-4" /> Add to calendar
          </a>
        )}

        {cancelled && (
          <Link href="/enquire?type=viewing" className="mt-6 inline-flex h-11 items-center gap-2 bg-primary px-5 text-sm font-bold text-primary-foreground" data-testid="link-book-again">
            <CalendarDays className="h-4 w-4" /> Book another viewing
          </Link>
        )}
      </div>

      {!cancelled && !booking.canChange && (
        <div className="mt-6 border border-[#e2cf9d] bg-[#fff8e6] p-5 text-sm leading-6 text-[#80611f]" data-testid="status-viewing-locked">
          This viewing has already started or passed, so it cannot be changed here. Please call the showroom and we will sort it out.
          {phoneHref && <> <a href={phoneHref} className="font-bold underline underline-offset-4" data-testid="link-call-showroom">Call {dealerConfig.contact.phone}</a>.</>}
        </div>
      )}

      {!cancelled && booking.canChange && (
        <div className="appointment-rise appointment-rise-delay-1 mt-6 border border-[#d8cfbe] bg-[#f8f5ee] p-5 sm:p-7" data-testid="section-manage-viewing">
          {mode === 'idle' && (
            <>
              <h2 className="font-display text-2xl text-foreground">Something changed?</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Move it to a better time or cancel it — no phone call needed. Letting us know frees the car up for someone else.</p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button type="button" onClick={() => setMode('reschedule')} className="h-11 flex-1 font-bold" data-testid="button-start-reschedule">
                  <CalendarDays className="mr-2 h-4 w-4" /> Change the time
                </Button>
                <Button type="button" variant="outline" onClick={() => setMode('confirm-cancel')} className="h-11 flex-1 border-[#d9d0c1] bg-background font-bold" data-testid="button-start-cancel">
                  <XCircle className="mr-2 h-4 w-4" /> Cancel viewing
                </Button>
              </div>
            </>
          )}

          {mode === 'confirm-cancel' && (
            <>
              <h2 className="font-display text-2xl text-foreground">Cancel this viewing?</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">We will release your {booking.appointmentAt ? formatAppointment(booking.appointmentAt) : 'booked'} slot. You can always book again later.</p>
              {cancel.isError && (
                <p role="alert" className="mt-4 border border-[#e8c6c0] bg-[#fff2ef] p-3 text-sm text-[#8d3e34]" data-testid="status-cancel-error">{apiMessage(cancel.error, 'We could not cancel your viewing. Please try again or call us.')}</p>
              )}
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => cancel.mutate({ token, data: { reason: null } })}
                  className="h-11 flex-1 bg-[#8d3e34] font-bold text-white hover:bg-[#7a352c]"
                  data-testid="button-confirm-cancel"
                >
                  {cancel.isPending ? 'Cancelling…' : 'Yes, cancel it'}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setMode('idle')} className="h-11 flex-1 border-[#d9d0c1] bg-background font-bold" data-testid="button-keep-viewing">
                  Keep my viewing
                </Button>
              </div>
            </>
          )}

          {mode === 'reschedule' && (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl text-foreground">Pick a new time</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">30 minutes · Monday to Saturday · 10:00–18:00</p>
                </div>
                <span className="hidden border border-[#d8cfbe] bg-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:block">London time</span>
              </div>

              <label className="mt-5 block sm:hidden">
                <span className="sr-only">Choose a viewing date</span>
                <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} aria-label="Choose a viewing date" className="h-12 w-full border border-[#d9d0c1] bg-background px-4 text-sm font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="select-viewing-date">
                  {dates.map((date) => <option key={date} value={date}>{formatDateLabel(date)}</option>)}
                </select>
              </label>
              <div role="group" aria-label="Choose a viewing date" className="no-scrollbar mt-5 hidden gap-2 overflow-x-auto px-1 pb-1 sm:flex" data-testid="group-viewing-dates">
                {dates.map((date) => (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setSelectedDate(date)}
                    aria-pressed={selectedDate === date}
                    className={`min-w-[92px] border px-3 py-2.5 text-center text-xs font-bold transition-all duration-200 ${selectedDate === date ? 'border-primary bg-primary text-primary-foreground' : 'border-[#ddd4c4] bg-background text-muted-foreground hover:-translate-y-0.5 hover:border-primary/50'}`}
                    data-testid={`button-viewing-date-${date}`}
                  >
                    {formatDateLabel(date)}
                  </button>
                ))}
              </div>

              <div className="mt-5 border-t border-[#e3ddcf] pt-5">
                {availabilityQuery.isLoading ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="loading-availability">
                    {[1, 2, 3, 4].map((item) => <div key={item} className="h-11 animate-pulse bg-[#e7e1d6]" />)}
                  </div>
                ) : availabilityQuery.isError ? (
                  <p role="alert" className="border border-[#e8c6c0] bg-[#fff2ef] p-3 text-sm text-[#8d3e34]" data-testid="status-availability-error">Could not load available times. Please choose another date.</p>
                ) : availableSlots.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="group-viewing-slots">
                    {availabilityQuery.data?.slots.map((slot) => (
                      <button
                        key={slot.startAt}
                        type="button"
                        disabled={!slot.available}
                        onClick={() => setSelectedSlot(slot.startAt)}
                        aria-pressed={selectedSlot === slot.startAt}
                    className={`flex h-11 items-center justify-center gap-2 border px-3 text-sm font-bold transition-all duration-200 ${selectedSlot === slot.startAt ? 'border-primary bg-primary text-primary-foreground' : slot.available ? 'border-[#d9d0c1] bg-background hover:-translate-y-0.5 hover:border-primary/60' : 'cursor-not-allowed border-transparent bg-[#e9e5dc] text-muted-foreground/40 line-through'}`}
                        data-testid={`button-viewing-slot-${slot.startAt}`}
                      >
                        {selectedSlot === slot.startAt && <Check className="h-4 w-4" />}
                        {slot.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="border border-[#e2cf9d] bg-[#fff8e6] p-3 text-sm text-[#80611f]" data-testid="status-availability-empty">There are no remaining times on this date. Please choose another day.</p>
                )}
              </div>

              {reschedule.isError && (
                <p role="alert" className="mt-4 border border-[#e8c6c0] bg-[#fff2ef] p-3 text-sm text-[#8d3e34]" data-testid="status-reschedule-error">{apiMessage(reschedule.error, 'We could not move your viewing. Please try again or call us.')}</p>
              )}

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
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
                  className="h-11 flex-1 font-bold"
                  data-testid="button-confirm-reschedule"
                >
                  {reschedule.isPending ? 'Moving your viewing…' : 'Confirm new time'}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setMode('idle')} className="h-11 flex-1 border-[#d9d0c1] bg-background font-bold" data-testid="button-cancel-reschedule">
                  Keep my current time
                </Button>
              </div>
            </>
          )}

          {reschedule.isSuccess && mode === 'idle' && (
            <p className="mt-5 flex items-center gap-2 border border-[#b5cbbd] bg-[#edf5ef] p-3 text-sm font-semibold text-[#2e6245]" data-testid="status-reschedule-success">
              <Clock3 className="h-4 w-4" /> Your viewing has been moved. We have updated the showroom diary.
            </p>
          )}
        </div>
      )}
    </>,
  );
}
