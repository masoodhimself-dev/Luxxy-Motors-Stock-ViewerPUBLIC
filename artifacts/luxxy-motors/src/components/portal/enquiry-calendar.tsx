import { useState } from "react";
import type { Enquiry } from "@workspace/api-client-react";
import { londonDate, nextDate, bookingDateLabel } from "@/lib/test-drive-dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EnquiryMergeLabel } from './enquiry-merge-label';
import './enquiry-desk-layout.css';

export function AppointmentExceptionLabels({ booking }: { booking: Enquiry }) {
  if (!booking.appointmentOutsideHours && !booking.appointmentDoubleBooked && !booking.appointmentOverCapacity) return null;
  return <div className="enquiry-exception-labels flex flex-wrap gap-1.5" aria-label="Staff booking exceptions">
    {booking.appointmentOutsideHours && <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-950">Out of hours</span>}
    {booking.appointmentDoubleBooked && <span className="rounded-full border border-rose-400 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-950">Double booked</span>}
    {booking.appointmentOverCapacity && <span className="rounded-full border border-orange-400 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-950">Over capacity</span>}
  </div>;
}

export function EnquiryCalendar({ entries, allEntries = entries, onOpen, onEdit, onVehicle }: { entries: Enquiry[]; allEntries?: Enquiry[]; onOpen?: (entry: Enquiry) => void; onEdit: (entry: Enquiry) => void; onVehicle: (id: string) => void }) {
  const [selected, setSelected] = useState(londonDate());
  const [month, setMonth] = useState(londonDate().slice(0, 7));
  const [cancelled, setCancelled] = useState(false);
  const bookings = entries.filter(e => e.appointmentAt && Number.isFinite(Date.parse(e.appointmentAt)) && (cancelled || !e.appointmentCancelledAt)).sort((a, b) => a.appointmentAt!.localeCompare(b.appointmentAt!));
  const first = `${month}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => nextDate(first, i - offset));
  const onDay = (date: string) => bookings.filter(e => londonDate(new Date(e.appointmentAt!)) === date);
  function move(step: number) {
    const date = new Date(`${first}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + step);
    const next = date.toISOString().slice(0, 7);
    setMonth(next); setSelected(`${next}-01`);
  }
  const time = (date: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
  return <section className="enquiry-calendar space-y-5">
    <div className="enquiry-calendar-toolbar flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm font-medium">Calendar month<Input type="month" value={month} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { setMonth(e.target.value); setSelected(`${e.target.value}-01`); } }} /></label>
      <Button variant="outline" aria-label="Previous month" onClick={() => move(-1)}>←</Button>
      <Button variant="outline" aria-label="Next month" onClick={() => move(1)}>→</Button>
      <Button variant="outline" onClick={() => { setMonth(londonDate().slice(0, 7)); setSelected(londonDate()); }}>Today</Button>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={cancelled} onChange={e => setCancelled(e.target.checked)} />Show cancelled</label>
    </div>
    <p className="enquiry-calendar-description text-sm text-muted-foreground">Website and staff appointments together · All times UK · Select a day to see details. Pending bookings are awaiting approval.</p>
    <div className="enquiry-calendar-layout grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <div className="enquiry-calendar-month overflow-hidden border border-slate-200 bg-white">
        <div className="enquiry-calendar-weekdays grid grid-cols-7 bg-slate-50 text-center text-xs font-semibold">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <span key={day} className="py-3">{day}</span>)}</div>
        <div className="enquiry-calendar-dates grid grid-cols-7">{days.map(date => { const items = onDay(date); return <button key={date} type="button" aria-pressed={selected === date} aria-label={`${bookingDateLabel(date)} ${date.slice(0,4)}, ${items.length} appointments`} onClick={() => { setSelected(date); setMonth(date.slice(0,7)); }} data-outside-month={!date.startsWith(month)} className={`enquiry-calendar-day min-h-16 min-w-0 border-t border-r p-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] sm:min-h-24 sm:p-2 ${selected === date ? 'bg-blue-100 ring-2 ring-inset ring-blue-700' : date.startsWith(month) ? 'bg-white hover:bg-slate-50' : 'bg-slate-100 text-slate-500'}`}>
          <span className={`enquiry-calendar-date text-sm ${date === londonDate() ? 'font-bold underline underline-offset-4' : ''}`}>{Number(date.slice(-2))}</span>
          {items.length > 0 && <><span className="enquiry-calendar-count mt-1 block text-xs font-semibold sm:hidden">{items.length}{items.some(e => e.appointmentOutsideHours || e.appointmentDoubleBooked || e.appointmentOverCapacity) ? ' ⚠' : ''}</span><span className="enquiry-calendar-previews mt-1 hidden space-y-1 sm:block">{items.slice(0,2).map(e => <span key={e.id} className="enquiry-calendar-preview block truncate text-[11px]">{e.appointmentOutsideHours || e.appointmentDoubleBooked || e.appointmentOverCapacity ? '⚠ ' : ''}{time(e.appointmentAt!)} {e.appointmentCancelledAt ? 'Cancelled' : e.customerName}</span>)}{items.length > 2 && <span className="enquiry-calendar-more block text-xs"><span className="enquiry-calendar-more-label">+{items.length - 2} more</span><span className="enquiry-calendar-more-count hidden" aria-hidden="true">+{items.length - 2}</span></span>}</span></>}
        </button>; })}</div>
      </div>
      <div className="enquiry-calendar-agenda min-w-0 border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">{bookingDateLabel(selected)} {selected.slice(0,4)}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{onDay(selected).length} appointments</p>
        <ul className="enquiry-calendar-appointments mt-4 divide-y">{onDay(selected).map(e => <li key={e.id} className="enquiry-agenda-record space-y-2 py-4 first:pt-0">
          <p className="font-semibold">{time(e.appointmentAt!)}{e.appointmentDurationMinutes ? ` · ${e.appointmentDurationMinutes} minutes` : ''} — {e.customerName}</p>
          <AppointmentExceptionLabels booking={e} /><p className="text-xs text-muted-foreground">{e.assignedToName || "Unassigned"} · Attendance: {e.attendance?.replace("_", " ") || "scheduled"}</p>
          <EnquiryMergeLabel entry={e} entries={allEntries} />
          <div className="enquiry-agenda-details space-y-2">
            <p className="enquiry-agenda-vehicle text-sm">{e.vehicleTitle || 'Vehicle not supplied'}</p>
            {e.vehicleRegistration && <p className="enquiry-agenda-registration text-sm text-muted-foreground">{e.vehicleRegistration}</p>}
            <p className="enquiry-agenda-phone text-sm text-muted-foreground">{e.phone || 'No phone supplied'}</p>
            <p className="enquiry-agenda-status text-xs">{e.appointmentCancelledAt ? 'Cancelled' : e.appointmentStatus === 'pending' ? 'Awaiting approval' : 'Confirmed'} · {e.source === 'phone' || e.source === 'phone_ad_hoc' ? 'Staff booking' : e.source === 'website' ? 'Website booking' : 'Booking'} · {e.reference}</p>
          </div>
          {e.message && <details className="text-sm"><summary className="cursor-pointer">Appointment notes</summary><p className="mt-2 whitespace-pre-wrap break-words">{e.message}</p></details>}
          <div className="enquiry-agenda-actions flex flex-wrap gap-2">{onOpen && <Button size="sm" variant="outline" onClick={() => onOpen(e)}>Open enquiry & attendance</Button>}{e.vehicleId && <Button size="sm" variant="outline" onClick={() => onVehicle(e.vehicleId!)}>Vehicle information</Button>}{!e.appointmentCancelledAt && Date.parse(e.appointmentAt!) > Date.now() && <Button size="sm" variant="outline" onClick={() => onEdit(e)}>Change appointment</Button>}</div>
        </li>)}</ul>
        {!onDay(selected).length && <p className="py-8 text-sm text-muted-foreground">No appointments on this day.</p>}
      </div>
    </div>
  </section>;
}
