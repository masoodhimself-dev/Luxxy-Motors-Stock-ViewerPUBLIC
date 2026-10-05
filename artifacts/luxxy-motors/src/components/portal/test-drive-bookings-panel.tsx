import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetTestDriveBookingsQueryKey,
  getGetEnquiriesQueryKey,
  useDecideTestDriveBooking,
  useGetEnquiries,
  useGetTestDriveBookings,
  type Enquiry,
} from '@workspace/api-client-react';
import { CalendarClock, Check, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Chip, EmptyState, Panel, PanelHeader, formatDateTime } from './portal-ui';
import { AppointmentExceptionLabels } from './enquiry-calendar';
import { AttendanceControls } from './enquiry-workspace-tools';
import { HistoryLinks } from './history-links';
import { EnquiryMergeDialog } from './enquiry-merge';

type Decision = 'confirm' | 'decline';
const bookingStatus = (booking: Enquiry) => booking.appointmentCancelledAt ? 'cancelled' : booking.appointmentStatus === 'pending' ? 'pending' : 'confirmed';
const isFutureAppointment = (booking: Enquiry, now = Date.now()) => Boolean(booking.appointmentAt && new Date(booking.appointmentAt).getTime() > now);
const statusLabels = { pending: 'Awaiting approval', confirmed: 'Confirmed', cancelled: 'Cancelled' };

function decisionError(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
  }
  return 'The appointment could not be updated. Please try again.';
}

function BookingRow({ booking, now, onDecision, onMerge }: { booking: Enquiry; now: number; onDecision: (message: string) => void; onMerge: (entry: Enquiry) => void }) {
  const [review, setReview] = useState<{ decision: Decision; booking: Enquiry } | null>(null);
  const decision = review?.decision ?? null;
  const reviewedBooking = review?.booking ?? booking;
  const queryClient = useQueryClient();
  const mutation = useDecideTestDriveBooking({ mutation: {
    onSuccess: async (_, variables) => {
      setReview(null);
      onDecision(`${booking.customerName}’s test drive has been ${variables.data.decision === 'confirm' ? 'confirmed' : 'declined'}.`);
      await queryClient.invalidateQueries({ queryKey: getGetTestDriveBookingsQueryKey() });
    },
  } });
  const status = bookingStatus(booking);
  const upcoming = isFutureAppointment(booking, now);
  const timePassed = Boolean(booking.appointmentAt) && !upcoming;
  const openDecision = (next: Decision) => { mutation.reset(); setReview({ decision: next, booking: { ...booking } }); };

  return (
    <li className="portal-record-row p-4 sm:p-5" data-testid={`staff-test-drive-${booking.id}`}>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr]">
        <div className="min-w-0">
          <p className="font-semibold text-primary">{booking.vehicleTitle || 'Vehicle to be arranged'}</p>
          <p className="mt-1 text-sm font-medium">{booking.appointmentAt ? formatDateTime(booking.appointmentAt) : 'Time to be arranged'} <span className="font-normal text-muted-foreground">(UK time)</span></p>
          <AppointmentExceptionLabels booking={booking} />
          <div className="mt-2"><AttendanceControls entry={booking} /></div>
          <p className="mt-1 text-xs text-muted-foreground">{booking.appointmentDurationMinutes ?? 30} minutes · {booking.reference}</p>
        </div>
        <div className="min-w-0 text-sm">
          <p className="font-medium text-primary">{booking.customerName}</p>
          {booking.phone && <a href={`tel:${booking.phone}`} className="mt-1 block w-fit text-muted-foreground underline underline-offset-4">{booking.phone}</a>}
          {booking.email && <a href={`mailto:${booking.email}`} className="mt-1 block break-all text-muted-foreground underline underline-offset-4">{booking.email}</a>}
        </div>
        <div>
          <Chip tone={status === 'confirmed' ? 'primary' : 'muted'}>{status === 'pending' && timePassed ? 'Time passed' : statusLabels[status]}</Chip>
          {status === 'pending' && upcoming && <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={mutation.isPending} onClick={() => openDecision('confirm')}>Confirm appointment</Button>
            <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={() => openDecision('decline')}>Decline</Button>
          </div>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><Button type="button" variant="outline" size="sm" onClick={() => onMerge(booking)}>Merge records</Button><HistoryLinks vehicleId={booking.vehicleId} recordType="enquiry" recordId={booking.id} vehicle={Boolean(booking.vehicleId || booking.vehicleTitle)} /></div>
      {(booking.message || booking.partExchangeRegistration) && <details className="mt-4 border-t border-border pt-2 text-sm">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">Visit details</summary>
        {booking.message && <p className="whitespace-pre-wrap break-words leading-6 text-muted-foreground">{booking.message}</p>}
        {booking.partExchangeRegistration && <p className="mt-2 text-muted-foreground">Part exchange: <span className="font-medium text-primary">{booking.partExchangeRegistration}</span>{booking.partExchangeMileage != null ? ` · ${booking.partExchangeMileage.toLocaleString('en-GB')} miles` : ''}</p>}
      </details>}
      <AlertDialog open={decision !== null} onOpenChange={open => { if (!open && !mutation.isPending) setReview(null); }}>
        <AlertDialogContent className="portal-action-dialog w-[calc(100%-2rem)] rounded-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{decision === 'confirm' ? 'Confirm this test drive?' : 'Decline this request?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {decision === 'confirm'
                ? `Confirm ${reviewedBooking.customerName}’s appointment for ${reviewedBooking.vehicleTitle || 'their chosen vehicle'}${reviewedBooking.appointmentAt ? ` on ${formatDateTime(reviewedBooking.appointmentAt)} (UK time)` : ''}.`
                : `Decline ${reviewedBooking.customerName}’s test-drive request and release this appointment time. Contact the customer if you would like to offer an alternative.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {mutation.isError && <p role="alert" className="text-sm text-destructive">{decisionError(mutation.error)}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Keep request</AlertDialogCancel>
            <AlertDialogAction disabled={mutation.isPending || !isFutureAppointment(reviewedBooking, now)} className={decision === 'decline' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''} onClick={event => {
              event.preventDefault();
              if (decision && isFutureAppointment(reviewedBooking)) mutation.mutate({ id: reviewedBooking.id, data: { decision, expectedRevision: reviewedBooking.appointmentRevision ?? 0 } });
            }}>
              {mutation.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Updating…</> : decision === 'confirm' ? 'Confirm test drive' : 'Decline and release time'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export function TestDriveBookingsPanel() {
  const [status, setStatus] = useState('active');
  const [notice, setNotice] = useState('');
  const [mergeEntry, setMergeEntry] = useState<Enquiry | null>(null);
  const client = useQueryClient();
  const enquiries = useGetEnquiries(undefined, { query: { queryKey: getGetEnquiriesQueryKey(), enabled: Boolean(mergeEntry), staleTime: 0 } });
  const query = useGetTestDriveBookings({ query: { queryKey: getGetTestDriveBookingsQueryKey(), refetchInterval: 60_000 } });
  const now = Date.now();
  const bookings = (query.data ?? []).filter(booking => status === 'all' || (status === 'active' ? bookingStatus(booking) !== 'cancelled' && isFutureAppointment(booking, now) : bookingStatus(booking) === status))
    .sort((a, b) => (a.appointmentAt ?? '').localeCompare(b.appointmentAt ?? ''));

  return (
    <Panel>
      <PanelHeader title="Test-drive appointments" meta="Review requests and prepare for customer visits. Times are shown in UK time." action={
        <Button type="button" variant="outline" size="icon" aria-label="Refresh test drives" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />
        </Button>
      } />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <label className="flex items-center gap-3 text-sm font-medium">Show
          <NativeSelect value={status} onChange={event => setStatus(event.target.value)} className="w-52" aria-label="Test-drive status">
            <option value="active">Active appointments</option>
            <option value="pending">Awaiting approval</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All appointments</option>
          </NativeSelect>
        </label>
        {!query.isLoading && !query.isError && <p className="text-sm text-muted-foreground">{bookings.length} {bookings.length === 1 ? 'appointment' : 'appointments'}</p>}
      </div>
      {notice && <p role="status" className="flex items-start gap-2 border-b border-border bg-secondary/30 p-4 text-sm"><Check className="h-4 w-4 shrink-0" />{notice}</p>}
      {query.isLoading ? <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading appointments…</p>
        : query.isError ? <div role="alert" className="p-6 text-sm"><p className="mb-3 text-destructive">Test-drive appointments could not be loaded.</p><Button type="button" variant="outline" onClick={() => query.refetch()}>Try again</Button></div>
        : bookings.length ? <ul className="divide-y divide-border">{bookings.map(booking => <BookingRow key={booking.id} booking={booking} now={now} onDecision={setNotice} onMerge={setMergeEntry} />)}</ul>
        : <div className="p-4"><EmptyState icon={CalendarClock} title={status === 'pending' ? 'No requests awaiting approval' : 'No appointments to show'} body={status === 'active' ? 'New test-drive bookings will appear here with the car, time and customer details.' : 'Choose another status to see other appointments.'} /></div>}
      {mergeEntry && enquiries.isLoading && <p role="status" className="p-4 text-sm">Loading records to merge…</p>}
      {mergeEntry && enquiries.isError && !enquiries.data && <div role="alert" className="p-4 text-sm"><p>Records could not be loaded for merging.</p><Button variant="outline" onClick={() => enquiries.refetch()}>Retry records</Button><Button variant="ghost" onClick={() => setMergeEntry(null)}>Cancel</Button></div>}
      {mergeEntry && enquiries.data && <EnquiryMergeDialog entry={enquiries.data.find(item => item.id === mergeEntry.id) ?? mergeEntry} entries={enquiries.data} onClose={() => setMergeEntry(null)} onRefresh={async () => { const fresh = await enquiries.refetch(); if (fresh.error || !fresh.data) throw fresh.error ?? new Error('Enquiries unavailable'); return fresh.data; }} onSaved={async result => { setMergeEntry(null); setNotice(`${result.recordIds.length} records merged into one case. ${result.cancelledAppointmentIds.length} appointments cancelled.`); await Promise.all([client.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }), client.invalidateQueries({ queryKey: getGetTestDriveBookingsQueryKey() }), client.invalidateQueries({ predicate: item => String(item.queryKey[0]).endsWith('/availability') })]); }} />}
    </Panel>
  );
}
