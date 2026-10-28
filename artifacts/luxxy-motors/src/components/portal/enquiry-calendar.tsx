import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { Enquiry } from '@workspace/api-client-react';
import { CalendarDays, CarFront, ChevronLeft, ChevronRight, Clock3, ListFilter, Phone, Plus, RefreshCw, Search, UserRound } from '@/components/icons';
import { londonDate, nextDate, bookingDateLabel } from '@/lib/test-drive-dates';
import { calendarBookings, calendarBookingDate, calendarDates, calendarDateLabel, calendarRangeLabel, calendarTime, diaryStatus, diaryStatusLabels, moveCalendarDate, type DiaryView } from '@/lib/staff-calendar';
import type { Car } from '@/lib/stock-context';
import { vehicleRegistration } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { EnquiryMergeLabel } from './enquiry-merge-label';
import { BookingReadiness, bookingNeedsPreparation } from './booking-readiness';
import { useStaffAccess } from './dealer-administration';
import './enquiry-calendar.css';

export function AppointmentExceptionLabels({ booking }: { booking: Enquiry }) {
  if (!booking.appointmentOutsideHours && !booking.appointmentDoubleBooked && !booking.appointmentOverCapacity) return null;
  return <div className="enquiry-exception-labels flex flex-wrap gap-1.5" aria-label="Staff booking exceptions">
    {booking.appointmentOutsideHours && <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-950">Out of hours</span>}
    {booking.appointmentDoubleBooked && <span className="rounded-full border border-rose-400 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-950">Double booked</span>}
    {booking.appointmentOverCapacity && <span className="rounded-full border border-orange-400 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-950">Over capacity</span>}
  </div>;
}

type CalendarProps = {
  entries: Enquiry[];
  allEntries?: Enquiry[];
  cars?: readonly Car[];
  onOpen?: (entry: Enquiry) => void;
  onEdit: (entry: Enquiry) => void;
  onVehicle: (id: string) => void;
  onAdd?: (date: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  ownerScope?: string;
  onOwnerScopeChange?: (scope: string) => void;
  canChooseMine?: boolean;
};
function defaultView(): DiaryView {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches ? 'day' : 'week';
}
function BookingPhoto({ car }: { car?: Car }) {
  const [failed, setFailed] = useState(false);
  const image = car?.heroImage || (typeof car?.images?.[0] === 'string' ? car.images[0] : car?.images?.[0]?.url);
  return <span className="staff-diary-photo" aria-hidden="true">{image && !failed ? <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} /> : <CarFront />}</span>;
}

export function EnquiryCalendar({ entries, allEntries = entries, cars = [], onOpen, onEdit, onVehicle, onAdd, onRefresh, refreshing = false, ownerScope = 'all', onOwnerScopeChange, canChooseMine = false }: CalendarProps) {
  const access = useStaffAccess();
  const canDeclare = !access.isError && !access.isLoading && access.data?.permissions.includes('sales.manage') === true;
  const [selected, setSelected] = useState(londonDate);
  const [view, setView] = useState<DiaryView>(defaultView);
  const [showFilters, setShowFilters] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const today = londonDate();
  const validBookings = useMemo(() => calendarBookings(entries), [entries]);
  const invalidCount = entries.filter(entry => entry.appointmentAt && !Number.isFinite(Date.parse(entry.appointmentAt))).length;
  const bookings = useMemo(() => validBookings.filter(entry => {
    const state = diaryStatus(entry);
    const query = search.trim().toLocaleLowerCase();
    return (cancelled || state !== 'cancelled') && (status === 'all' || status === state) && (!query || [entry.customerName, entry.phone, entry.email, entry.vehicleTitle, entry.vehicleRegistration, entry.reference, entry.assignedToName, vehicleRegistration(cars.find(car => car.id === entry.vehicleId) ?? {} as Car)].filter(Boolean).join(' ').toLocaleLowerCase().includes(query));
  }), [validBookings, cancelled, search, status, cars]);
  const grouped = useMemo(() => {
    const dates = new Map<string, Enquiry[]>();
    bookings.forEach(entry => { const date = calendarBookingDate(entry); dates.set(date, [...(dates.get(date) ?? []), entry]); });
    return dates;
  }, [bookings]);
  const dates = calendarDates(selected, view);
  const selectedBookings = grouped.get(selected) ?? [];
  const periodDates = view === 'month' ? dates.filter(date => date.startsWith(selected.slice(0, 7))) : dates;
  const periodCount = periodDates.reduce((count, date) => count + (grouped.get(date)?.length ?? 0), 0);
  const pendingCount = periodDates.reduce((count, date) => count + (grouped.get(date)?.filter(entry => diaryStatus(entry) === 'pending').length ?? 0), 0);
  const filtersActive = Boolean(search.trim() || status !== 'all' || cancelled || ownerScope !== 'all');
  // Keep the detail tied to refreshed data: never show a stale record after an update/removal.
  const detail = detailId ? validBookings.find(entry => entry.id === detailId) : undefined;
  const carFor = (entry: Enquiry) => cars.find(car => car.id === entry.vehicleId);
  const registrationFor = (entry: Enquiry) => entry.vehicleRegistration || (carFor(entry) ? vehicleRegistration(carFor(entry)!) : '');
  const openDetail = (entry: Enquiry) => { setDetailId(entry.id); };
  function resetFilters() { setSearch(''); setStatus('all'); setCancelled(false); onOwnerScopeChange?.('all'); }
  function bookingCard(entry: Enquiry, compact = false) {
    const state = diaryStatus(entry);
    return <button type="button" className={`staff-diary-booking${compact ? ' staff-diary-booking-compact' : ''}`} data-status={state} onClick={() => openDetail(entry)} aria-label={`${calendarTime(entry.appointmentAt!)}, ${entry.customerName}, ${entry.vehicleTitle || 'Vehicle not supplied'}, ${diaryStatusLabels[state]}`}>
      {(!compact || carFor(entry)?.heroImage || carFor(entry)?.images?.length) && <BookingPhoto key={`${entry.id}:${carFor(entry)?.heroImage ?? ''}`} car={carFor(entry)} />}
      <span className="staff-diary-booking-body">
        <span className="staff-diary-booking-top"><span className="staff-diary-time">{calendarTime(entry.appointmentAt!)}</span><span className="staff-diary-duration">{entry.appointmentDurationMinutes ? `${entry.appointmentDurationMinutes} min` : ''}</span></span>
        <strong className="staff-diary-customer">{entry.customerName}</strong>
        <span className="staff-diary-vehicle">{entry.vehicleTitle || 'Vehicle not supplied'}</span>
        {registrationFor(entry) && <span className="staff-diary-registration">{registrationFor(entry)}</span>}
        <span className="staff-diary-owner"><UserRound aria-hidden="true" />{entry.assignedToName || 'Unassigned'}</span>
        <span className="staff-diary-booking-bottom"><span className="staff-diary-status" data-status={state}>{diaryStatusLabels[state]}</span>{(entry.appointmentOutsideHours || entry.appointmentDoubleBooked || entry.appointmentOverCapacity) && <span className="staff-diary-exception-indicator">Check exception</span>}</span>
      </span>
    </button>;
  }
  return <section className="staff-diary" aria-label="Appointment calendar">
    <header className="staff-diary-heading"><div><p className="staff-diary-eyebrow">Your showroom diary</p><h2>Appointments</h2><p>Bookings and test drives, together.</p></div>{canDeclare && onAdd && <Button type="button" onClick={() => onAdd(selected)} className="staff-diary-add"><Plus aria-hidden="true" />Add appointment</Button>}</header>
    <div className="staff-diary-toolbar">
      <div className="staff-diary-navigation"><Button type="button" variant="outline" onClick={() => setSelected(today)}>Today</Button><div className="staff-diary-arrows"><Button type="button" variant="ghost" size="icon" aria-label={`Previous ${view}`} onClick={() => setSelected(moveCalendarDate(selected, view, -1))}><ChevronLeft aria-hidden="true" /></Button><Button type="button" variant="ghost" size="icon" aria-label={`Next ${view}`} onClick={() => setSelected(moveCalendarDate(selected, view, 1))}><ChevronRight aria-hidden="true" /></Button></div><h3 aria-live="polite">{calendarRangeLabel(selected, view)}</h3></div>
      <div className="staff-diary-tools"><div className="staff-diary-view-switch" role="group" aria-label="Calendar view">{(['day', 'week', 'month'] as const).map(option => <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)}>{option[0].toUpperCase() + option.slice(1)}</button>)}</div><Button type="button" variant="outline" aria-expanded={showFilters} aria-controls="staff-diary-filters" onClick={() => setShowFilters(!showFilters)}><ListFilter aria-hidden="true" />Filters{filtersActive && <span className="staff-diary-active-dot" aria-label="Active filters" />}</Button>{onRefresh && <Button type="button" variant="ghost" size="icon" aria-label="Refresh appointments" disabled={refreshing} onClick={onRefresh}><RefreshCw className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" /></Button>}</div>
    </div>
    {showFilters && <div className="staff-diary-filters" id="staff-diary-filters">
      <label className="staff-diary-search">Find an appointment<span><Search aria-hidden="true" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Customer, car or plate" /></span></label>
      <label>Booking status<NativeSelect value={status} onChange={event => { setStatus(event.target.value); if (event.target.value === 'cancelled') setCancelled(true); }}><option value="all">All statuses</option>{Object.entries(diaryStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
      {onOwnerScopeChange && <label>Staff<NativeSelect value={ownerScope} onChange={event => onOwnerScopeChange(event.target.value)}><option value="all">All staff</option><option value="mine" disabled={!canChooseMine}>Assigned to me</option><option value="unassigned">Unassigned</option></NativeSelect></label>}
      <label className="staff-diary-cancelled"><input type="checkbox" checked={cancelled} onChange={event => { setCancelled(event.target.checked); if (!event.target.checked && status === 'cancelled') setStatus('all'); }} />Show cancelled</label>{filtersActive && <Button type="button" variant="ghost" onClick={resetFilters}>Clear filters</Button>}
    </div>}
    <div className="staff-diary-summary" aria-live="polite"><p>{periodCount} {periodCount === 1 ? 'appointment' : 'appointments'}{pendingCount > 0 && <span> · {pendingCount} awaiting approval</span>}</p><span>UK time · adjusts for BST</span></div>
    {invalidCount > 0 && <p className="staff-diary-warning" role="alert">{invalidCount} {invalidCount === 1 ? 'appointment has an unreadable date' : 'appointments have unreadable dates'}. Open the customer records to check {invalidCount === 1 ? 'it' : 'them'}.</p>}
    {view === 'day' && <div className="staff-diary-day-layout">
      <nav className="staff-diary-day-strip" aria-label="Choose appointment day">{Array.from({ length: 7 }, (_, index) => nextDate(selected, index - 3)).map(date => <button type="button" key={date} aria-pressed={date === selected} aria-label={bookingDateLabel(date)} onClick={() => setSelected(date)}><span>{calendarDateLabel(date, { weekday: 'short' })}</span><strong>{Number(date.slice(-2))}</strong><span className="staff-diary-day-dot" data-has-bookings={Boolean(grouped.get(date)?.length)} /></button>)}</nav>
      <div className="staff-diary-agenda"><h3>{bookingDateLabel(selected)}</h3>{selectedBookings.length ? <ul>{selectedBookings.map(entry => <li key={entry.id}>{bookingCard(entry)}</li>)}</ul> : <div className="staff-diary-empty"><CalendarDays aria-hidden="true" /><h4>{filtersActive ? 'No matching appointments' : 'A clear diary for this day'}</h4><p>{filtersActive ? 'Try another day or clear your filters.' : 'New bookings will appear here.'}</p>{filtersActive ? <Button type="button" variant="outline" onClick={resetFilters}>Clear filters</Button> : canDeclare && onAdd && <Button type="button" variant="outline" onClick={() => onAdd(selected)}>Add appointment</Button>}</div>}</div>
    </div>}
    {view === 'week' && <div className="staff-diary-week" aria-label="Week appointments">{dates.map(date => <section key={date} className="staff-diary-week-day" data-today={date === today}><button type="button" className="staff-diary-column-heading" onClick={() => { setSelected(date); setView('day'); }} aria-label={`View ${bookingDateLabel(date)}`}><span>{calendarDateLabel(date, { weekday: 'short' })}</span><strong>{Number(date.slice(-2))}</strong><small>{(grouped.get(date)?.length ?? 0) > 0 ? `${grouped.get(date)!.length} booked` : 'No bookings'}</small></button><ul>{(grouped.get(date) ?? []).map(entry => <li key={entry.id}>{bookingCard(entry, true)}</li>)}</ul></section>)}</div>}
    {view === 'month' && <div className="staff-diary-month-layout"><div className="staff-diary-month"><div className="staff-diary-weekday-labels" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div><div className="staff-diary-month-dates">{dates.map(date => {
      const dayBookings = grouped.get(date) ?? [];
      return <button type="button" key={date} className="staff-diary-month-day" data-selected={date === selected} data-outside={!date.startsWith(selected.slice(0, 7))} data-today={date === today} aria-pressed={date === selected} aria-label={`${bookingDateLabel(date)} ${date.slice(0, 4)}, ${dayBookings.length} appointments`} onClick={() => setSelected(date)}><span className="staff-diary-month-date">{Number(date.slice(-2))}</span>{dayBookings.slice(0, 2).map(entry => <span className="staff-diary-month-preview" data-status={diaryStatus(entry)} key={entry.id}>{calendarTime(entry.appointmentAt!)} {entry.customerName}</span>)}{dayBookings.length > 0 && <span className="staff-diary-month-count">{dayBookings.length} booked</span>}{dayBookings.length > 2 && <span className="staff-diary-month-more">+{dayBookings.length - 2} more</span>}</button>;
    })}</div></div><div className="staff-diary-agenda"><h3>{bookingDateLabel(selected)}</h3>{selectedBookings.length ? <ul>{selectedBookings.map(entry => <li key={entry.id}>{bookingCard(entry)}</li>)}</ul> : <p className="staff-diary-month-empty">No {filtersActive ? 'matching ' : ''}appointments on this day.</p>}</div></div>}
    <Sheet open={Boolean(detailId)} onOpenChange={open => { if (!open) setDetailId(null); }}><SheetContent className="staff-diary-detail" aria-describedby="staff-diary-detail-description"><SheetHeader className="staff-diary-detail-heading"><p className="staff-diary-eyebrow">Appointment details</p><SheetTitle>{detail?.customerName || 'Appointment unavailable'}</SheetTitle><SheetDescription id="staff-diary-detail-description">{detail ? `${bookingDateLabel(calendarBookingDate(detail))} at ${calendarTime(detail.appointmentAt!)} · UK time` : 'This record is no longer in the current diary. Refresh appointments to check.'}</SheetDescription></SheetHeader>{detail && <>
      <span className="staff-diary-status" data-status={diaryStatus(detail)}>{diaryStatusLabels[diaryStatus(detail)]}</span><AppointmentExceptionLabels booking={detail} />
      <div className="staff-diary-detail-car"><BookingPhoto key={`${detail.id}:${carFor(detail)?.heroImage ?? ''}`} car={carFor(detail)} /><div><h3>{detail.vehicleTitle || 'Vehicle not supplied'}</h3>{registrationFor(detail) && <p className="staff-diary-registration">{registrationFor(detail)}</p>}</div></div>
      <dl className="staff-diary-detail-facts"><div><dt><Clock3 aria-hidden="true" />Duration</dt><dd>{detail.appointmentDurationMinutes ? `${detail.appointmentDurationMinutes} minutes` : 'Not supplied'}</dd></div><div><dt><UserRound aria-hidden="true" />Assigned staff</dt><dd>{detail.assignedToName || 'Unassigned'}</dd></div><div><dt>Source</dt><dd>{['phone', 'phone_ad_hoc'].includes(detail.source) ? 'Staff booking' : detail.source === 'website' ? 'Website booking' : 'Booking'}</dd></div></dl>
      <BookingReadiness key={detail.id} booking={detail} autoLoad />
      {canDeclare && bookingNeedsPreparation(detail) && <Button type="button" variant="outline" asChild><Link href={`/portal?section=notifications&workView=test-drives&enquiryId=${encodeURIComponent(detail.id)}`}>Review declaration & checks</Link></Button>}
      {detail.phone && <a href={`tel:${detail.phone.replace(/[^+\d]/g, '')}`} className="staff-diary-call"><Phone aria-hidden="true" />Call {detail.phone}</a>}{detail.email && <p className="staff-diary-detail-email">{detail.email}</p>}
      {detail.message && <div className="staff-diary-notes"><h3>Appointment notes</h3><p>{detail.message}</p></div>}{detail.staffNote && <div className="staff-diary-notes"><h3>Staff notes</h3><p>{detail.staffNote}</p></div>}<EnquiryMergeLabel entry={detail} entries={allEntries} />
      <div className="staff-diary-detail-actions">{onOpen && <Button type="button" onClick={() => { setDetailId(null); onOpen(detail); }}>{detail.appointmentStatus === 'pending' && !detail.appointmentCancelledAt ? 'Review booking & customer' : 'Open customer & attendance'}</Button>}{detail.vehicleId && <Button type="button" variant="outline" onClick={() => { setDetailId(null); onVehicle(detail.vehicleId!); }}>Vehicle information</Button>}{canDeclare && !detail.appointmentCancelledAt && Date.parse(detail.appointmentAt!) > Date.now() && <Button type="button" variant="outline" onClick={() => { setDetailId(null); onEdit(detail); }}>Change or cancel appointment</Button>}</div>
    </>}</SheetContent></Sheet>
  </section>;
}
