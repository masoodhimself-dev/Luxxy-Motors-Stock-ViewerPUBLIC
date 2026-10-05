import { useStock } from '@/lib/stock-context';
import { ShowroomPhoto } from '@/components/showroom-photo';
import { getThumbnailUrl } from '@/lib/utils';
import { dealershipLocation } from '@/lib/dealership-location';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import {
  getGetEnquiryAvailabilityQueryKey,
  getGetViewingBookingQueryKey,
  useCancelViewing,
  useGetEnquiryAvailability,
  useGetViewingBooking,
  useRescheduleViewing,
} from '@workspace/api-client-react';
import { ArrowLeft, CalendarDays, CalendarPlus, Check, CircleAlert, Clock3, LoaderCircle, MapPin, Phone, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getPhoneHref, getWhatsAppHref } from '@/lib/cta-helpers';
import { appointmentLabel, availableBookingDates, bookingDateLabel, bookingTimezone, defaultBookingSettings, londonDate, nextDate } from '@/lib/test-drive-dates';

function apiMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return fallback;
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const today = londonDate();
  return {
    day: value === today ? 'Today' : value === nextDate(today, 1) ? 'Tomorrow' : new Intl.DateTimeFormat('en-GB', { timeZone: bookingTimezone, weekday: 'short' }).format(date),
    date: new Intl.DateTimeFormat('en-GB', { timeZone: bookingTimezone, day: 'numeric', month: 'short' }).format(date),
  };
}

export default function Viewing() {
  const queryClient = useQueryClient();
  const { token = '' } = useParams<{ token: string }>();
  const { settings: dealerConfig, isLoading: settingsLoading } = useDealerSettings();
  const bookingSettings = useMemo(() => dealerConfig.testDriveBooking ?? defaultBookingSettings, [dealerConfig.testDriveBooking]);
  const dates = useMemo(() => bookingSettings.enabled ? availableBookingDates(bookingSettings) : [], [bookingSettings]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'reschedule' | 'confirm-cancel'>('idle');
  const resultRef = useRef<HTMLParagraphElement>(null);
  const changeHeadingRef = useRef<HTMLHeadingElement>(null);
  const query = useGetViewingBooking(token, { query: { queryKey: getGetViewingBookingQueryKey(token), retry: false, staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 30_000 } });
  const reschedule = useRescheduleViewing();
  const cancel = useCancelViewing();
  const booking = query.data;
  const { stock } = useStock();
  const bookedCar = stock?.cars.find(car => booking?.vehicleUrl === `/vehicle/${car.id}`);
  const location = dealershipLocation(dealerConfig.address);
  const availabilityQuery = useGetEnquiryAvailability({ date: selectedDate }, {
    query: {
      queryKey: getGetEnquiryAvailabilityQueryKey({ date: selectedDate }),
      enabled: mode === 'reschedule' && !settingsLoading && bookingSettings.enabled && dates.includes(selectedDate),
      staleTime: 0,
    },
  });

  useEffect(() => {
    if (!dates.includes(selectedDate)) setSelectedDate(dates[0] ?? '');
  }, [dates, selectedDate]);
  useEffect(() => { setSelectedSlot(null); }, [selectedDate, bookingSettings]);
  useEffect(() => {
    if (selectedSlot && availabilityQuery.data && !availabilityQuery.data.slots.some(slot => slot.startAt === selectedSlot && slot.available)) setSelectedSlot(null);
  }, [availabilityQuery.data, selectedSlot]);
  useEffect(() => {
    if (mode !== 'idle') changeHeadingRef.current?.focus();
    else if (cancel.isSuccess || reschedule.isSuccess) resultRef.current?.focus();
  }, [mode, cancel.isSuccess, reschedule.isSuccess, booking?.status]);

  const phoneHref = getPhoneHref(dealerConfig);
  const whatsAppHref = getWhatsAppHref(undefined, dealerConfig);
  const shell = (children: ReactNode) => (
    <div className="luxxy-shell min-h-[60vh] bg-background">
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <Link href="/" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-primary" data-testid="link-back-to-showroom"><ArrowLeft className="h-4 w-4" /> Back to showroom</Link>
        <div className="overflow-hidden rounded-xl border border-border bg-card">{children}</div>
      </div>
    </div>
  );

  if (query.isLoading) return shell(
    <div className="flex h-64 flex-col items-center justify-center gap-4 p-8" data-testid="loading-viewing-session"><LoaderCircle className="h-7 w-7 animate-spin text-accent" /><span className="text-sm">Finding your booking…</span></div>,
  );
  if (query.isError || !booking) {
    const unavailable = ![404, 410].includes(query.error?.status ?? 0);
    return shell(
      <div className="p-6 sm:p-10">
        <CircleAlert className="mb-5 h-8 w-8 text-accent" />
        <h1 className="font-display text-2xl font-semibold text-primary">{unavailable ? 'Booking temporarily unavailable' : 'Cannot find booking'}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground" data-testid="status-viewing-error">{apiMessage(query.error, unavailable ? 'Your booking could not be loaded just now. Please try again.' : 'We could not find your booking. The link may have expired.')}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {unavailable && <Button onClick={() => void query.refetch()} disabled={query.isFetching} className="min-h-12">Try again</Button>}
          <Button asChild variant="outline" className="min-h-12"><Link href="/">Back to showroom</Link></Button>
          {phoneHref && <Button asChild variant="outline" className="min-h-12"><a href={phoneHref}><Phone className="mr-2 h-4 w-4" /> Call us</a></Button>}
        </div>
      </div>,
    );
  }

  const busy = reschedule.isPending || cancel.isPending;
  const isCancelled = booking.status === 'cancelled';
  const isPending = booking.status === 'pending';
  const canReschedule = bookingSettings.enabled && dates.length > 0 && !settingsLoading;
  const availableSlots = availabilityQuery.data?.slots.filter(slot => slot.available) ?? [];
  const address = [dealerConfig.address?.street, dealerConfig.address?.city, dealerConfig.address?.region, dealerConfig.address?.postcode].filter(Boolean).join(', ');

  return shell(<>
    <div className="p-6 sm:p-10">
      <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">Reference {booking.reference}</p>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-primary sm:text-3xl">{isCancelled ? 'Test drive cancelled' : isPending ? 'Your test-drive request' : 'Your test drive'}</h1>
      <p className="mt-3 text-sm text-muted-foreground" data-testid="text-viewing-customer">Hello, {booking.customerName}.</p>
      {isPending && !isCancelled && <p className="mt-4 rounded-lg bg-secondary p-4 text-sm leading-6 text-primary" data-testid="status-viewing-pending">Awaiting showroom confirmation. We will email you when your requested time is confirmed.</p>}
      <div className="mt-5 inline-flex rounded-full border border-border bg-secondary px-3 py-1.5 text-sm font-semibold" role="status">{isCancelled ? 'Cancelled' : isPending ? 'Requested · awaiting confirmation' : 'Confirmed'}</div>
      {bookedCar && getThumbnailUrl(bookedCar) && <ShowroomPhoto src={getThumbnailUrl(bookedCar)!} alt={booking.vehicleTitle || 'Your selected car'} fit="contain" className="mt-5 aspect-[16/9] max-h-64 w-full overflow-hidden rounded-lg bg-secondary" />}
      <div className="mt-6 space-y-4 text-sm text-primary">
        {booking.vehicleTitle && <p className="font-medium">{booking.vehicleUrl ? <Link href={booking.vehicleUrl} className="underline decoration-border underline-offset-4 hover:decoration-primary">{booking.vehicleTitle}</Link> : booking.vehicleTitle}</p>}
        <p className="flex items-start gap-3"><CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /><span>{booking.appointmentAt ? appointmentLabel(booking.appointmentAt) : 'Not scheduled'}<span className="mt-1 block text-xs text-muted-foreground">{booking.durationMinutes ?? 30} minutes · UK time</span></span></p>
        {address && <p className="flex items-start gap-3"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /><span>{address}</span></p>}
      </div>
      {!isCancelled && mode === 'idle' && <div className="mt-6 flex flex-wrap gap-3">
        {!isPending && booking.calendarIcs && <Button asChild variant="outline" className="min-h-12 text-sm"><a href={`data:text/calendar;charset=utf8,${encodeURIComponent(booking.calendarIcs)}`} download="test-drive.ics" data-testid="link-viewing-calendar"><CalendarPlus className="mr-2 h-4 w-4" /> Add to calendar</a></Button>}
        {booking.canChange && <>
          <Button variant="outline" disabled={!canReschedule} onClick={() => { reschedule.reset(); setMode('reschedule'); }} className="min-h-12 text-sm" data-testid="button-viewing-reschedule">Reschedule</Button>
          <Button variant="ghost" onClick={() => { cancel.reset(); setMode('confirm-cancel'); }} className="min-h-12 text-sm text-muted-foreground" data-testid="button-viewing-cancel">Cancel</Button>
        </>}
      </div>}
      {!isCancelled && booking.canChange && !settingsLoading && !canReschedule && <p className="mt-4 text-sm leading-6 text-muted-foreground" data-testid="status-reschedule-unavailable">Online rescheduling is currently unavailable. Your existing {isPending ? 'request' : 'booking'} is unchanged. {phoneHref ? <a className="underline underline-offset-4" href={phoneHref}>Call us to arrange another time.</a> : <Link href="/contact" className="underline underline-offset-4">Contact the showroom to arrange another time.</Link>}</p>}
      {!isCancelled && !booking.canChange && <p className="mt-4 text-sm text-muted-foreground">This appointment has already started. Contact the showroom if you need help.</p>}
    </div>

    {isCancelled ? <div className="border-t border-border bg-secondary/40 p-6 sm:p-10">
      <p ref={resultRef} tabIndex={-1} role="status" className="flex items-start gap-3 text-sm font-medium outline-none" data-testid="status-viewing-cancelled"><XCircle className="h-5 w-5 shrink-0 text-muted-foreground" /> This test drive will not go ahead.</p>
      <div className="mt-5 flex flex-wrap items-center gap-4"><Button asChild className="min-h-12"><Link href="/stock">Browse stock</Link></Button>{phoneHref && <a className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={phoneHref}>Call us</a>}{whatsAppHref && <a className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={whatsAppHref}>WhatsApp</a>}</div>
    </div> : mode === 'confirm-cancel' ? <div className="border-t border-border p-6 sm:p-10">
      <h2 ref={changeHeadingRef} tabIndex={-1} className="text-xl font-semibold outline-none">Cancel your {isPending ? 'request' : 'test drive'}?</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">This will release your appointment time.</p>
      {cancel.isError && <p role="alert" className="mt-5 text-sm text-destructive" data-testid="status-cancel-error">{apiMessage(cancel.error, 'We could not cancel your test drive. Please try again or call us.')}</p>}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button variant="destructive" disabled={busy} onClick={() => cancel.mutate({ token, data: {} }, { onSuccess: updated => { queryClient.setQueryData(getGetViewingBookingQueryKey(token), updated); setMode('idle'); } })} className="min-h-12 sm:flex-1" data-testid="button-confirm-cancel">{cancel.isPending ? 'Cancelling…' : 'Yes, cancel it'}</Button>
        <Button variant="outline" disabled={busy} onClick={() => setMode('idle')} className="min-h-12 sm:flex-1" data-testid="button-abort-cancel">No, keep it</Button>
      </div>
    </div> : mode === 'reschedule' ? <div className="border-t border-border p-6 sm:p-10">
      <h2 ref={changeHeadingRef} tabIndex={-1} className="text-xl font-semibold outline-none">Choose a new time</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{bookingSettings.durationMinutes} minutes at the showroom. {bookingSettings.confirmationMode === 'approval' ? 'The team will confirm your new requested time.' : 'Your current time stays booked until you confirm a new one.'}</p>
      {canReschedule ? <>
        <div className="-mx-1 mt-5 flex snap-x gap-2 overflow-x-auto px-1 pb-3" role="group" aria-label="Choose a new date" data-testid="group-viewing-dates">
          {dates.map(date => { const label = shortDate(date); return <button key={date} type="button" disabled={busy} onClick={() => setSelectedDate(date)} aria-pressed={selectedDate === date} aria-label={bookingDateLabel(date)} className={`flex min-h-20 min-w-24 shrink-0 snap-start flex-col items-center justify-center rounded-lg border px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selectedDate === date ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-primary hover:bg-secondary'}`} data-testid={`button-viewing-date-${date}`}><span className="font-medium">{label.day}</span><span className="mt-1 text-xs opacity-80">{label.date}</span></button>; })}
        </div>
        <p className="mt-5 text-sm font-medium">{selectedDate ? bookingDateLabel(selectedDate) : 'Choose a date'}</p>
        <div className="mt-3">
          {availabilityQuery.isLoading || availabilityQuery.isFetching ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Loading available times" data-testid="loading-availability">{[1, 2, 3, 4].map(item => <div key={item} className="h-12 animate-pulse rounded-lg bg-secondary" />)}</div> : availabilityQuery.isError ? <div role="alert" className="rounded-lg border border-border p-4 text-sm" data-testid="status-availability-error"><p>Could not load available times. Please try again or choose another date.</p><Button variant="outline" className="mt-3 min-h-11" onClick={() => void availabilityQuery.refetch()}>Try again</Button></div> : availableSlots.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="Choose a new time" data-testid="group-viewing-slots">{availabilityQuery.data?.slots.map(slot => <button key={slot.startAt} type="button" disabled={busy || !slot.available} onClick={() => setSelectedSlot(slot.startAt)} aria-pressed={selectedSlot === slot.startAt} className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border px-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selectedSlot === slot.startAt ? 'border-primary bg-primary text-primary-foreground' : slot.available ? 'border-border bg-card text-primary hover:bg-secondary' : 'cursor-not-allowed border-border text-muted-foreground opacity-50 line-through'}`} data-testid={`button-viewing-slot-${slot.startAt}`}>{selectedSlot === slot.startAt && <Check className="h-4 w-4" />}{slot.label}</button>)}</div> : <p className="rounded-lg bg-secondary p-4 text-sm leading-6 text-muted-foreground" data-testid="status-availability-empty">There are no remaining times on this date. Please choose another day.</p>}
        </div>
        {reschedule.isError && <p role="alert" className="mt-5 text-sm text-destructive" data-testid="status-reschedule-error">{apiMessage(reschedule.error, 'We could not move your test drive. Please try again or call us.')}</p>}
      </> : <p className="mt-5 text-sm leading-6 text-muted-foreground">There are no dates available for online rescheduling. Contact the showroom to arrange another time.</p>}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {canReschedule && <Button disabled={busy || !selectedSlot || availabilityQuery.isFetching || availabilityQuery.isError} onClick={() => {
          if (!selectedSlot) return;
          reschedule.mutate({ token, data: { appointmentAt: selectedSlot } }, {
            onSuccess: updated => { queryClient.setQueryData(getGetViewingBookingQueryKey(token), updated); void queryClient.invalidateQueries({ queryKey: getGetEnquiryAvailabilityQueryKey({ date: selectedDate }) }); setMode('idle'); setSelectedSlot(null); },
            onError: () => { setSelectedSlot(null); void availabilityQuery.refetch(); },
          });
        }} className="min-h-12 sm:flex-1" data-testid="button-confirm-reschedule">{reschedule.isPending ? 'Updating test drive…' : bookingSettings.confirmationMode === 'approval' ? 'Request new time' : 'Confirm new time'}</Button>}
        <Button variant="outline" disabled={busy} onClick={() => setMode('idle')} className="min-h-12 sm:flex-1" data-testid="button-cancel-reschedule">Keep current time</Button>
      </div>
    </div> : reschedule.isSuccess ? <div className="border-t border-border p-6 sm:p-10"><p ref={resultRef} tabIndex={-1} role="status" className="flex items-start gap-3 text-sm leading-6 outline-none" data-testid="status-reschedule-success"><Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />{booking.status === 'pending' ? 'Your new time has been requested. Please wait for the showroom to confirm it.' : 'Your test drive has been moved and your new time is confirmed.'}</p></div> : null}

    {!isCancelled && mode === 'idle' && <div className="border-t border-border p-6 sm:p-10"><h2 className="text-sm font-semibold">Before your visit</h2>{bookingSettings.instructions && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{bookingSettings.instructions}</p>}{dealerConfig.presentation?.parkingInstructions && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{dealerConfig.presentation.parkingInstructions}</p>}{location.directions && <a href={location.directions} target="_blank" rel="noopener noreferrer" className="mt-3 mr-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Get directions</a>}{phoneHref && <a href={phoneHref} className="mt-3 mr-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Call the showroom</a>}<Link href="/contact" className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Directions & opening hours</Link></div>}
  </>);
}
