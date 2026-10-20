import { useDealerFeatures } from '@/lib/dealer-features';
import { useEnquirySummaries as useGetEnquiries, enquirySummaryKey } from "@/lib/enquiry-summary-query";
import { AppointmentExceptionLabels, EnquiryCalendar } from "./enquiry-calendar";
import { EnquiryPhotoPeek } from "./enquiry-photo-peek";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnquiryStockDesk } from "./enquiry-stock-desk";
import { EnquiryVehicleInformation } from "./enquiry-vehicle-information";
import { Link, useSearch, useLocation } from 'wouter';
import {
  FollowUpEditor,
  FollowUpFields,
  followUpIso,
  followUpLocal,
} from "./enquiry-follow-up";
import { bookingPressure, validStaffAppointmentDateTime, withinBookingHours } from "../../../../api-server/src/lib/booking-slots";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetStaffDirectory,
  useListReservations,
  getListReservationsQueryKey,
  type StaffOnlineReservation,
  useCreateStaffEnquiry,
  useChangeStaffAppointment,
  getGetEnquiriesQueryKey,
  getGetTestDriveBookingsQueryKey,
  type Enquiry,
} from "@workspace/api-client-react";
import {
  Search,
  Phone,
  RefreshCw,
  CheckCircle2,
  CalendarDays,
  Clock3,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useStock, type Car } from "@/lib/stock-context";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import {
  bookingDateLabel,
  appointmentLabel,
  defaultBookingSettings,
  londonDate,
} from "@/lib/test-drive-dates";
import { formatPrice, vehicleDisplayTitle, vehicleRegistrationLabel } from "@/lib/utils";
import { Panel, PanelHeader } from "./portal-ui";

import { callOutcomes, readCallDraft, saveCallDraft, removeCallDraft, type CallOutcome, type CallDraft } from "@/lib/enquiry-desk-model";
import { OwnerSelect, WorkspaceEditor, TodayDesk, CustomerHistory, type Contact } from "./enquiry-workspace-tools";
import { RecentCustomerFields } from "./recent-customer-fields";
import { VehicleDeskContext, DeskSearchResults } from "./enquiry-desk-context";
import { ConversationEditor } from "./enquiry-conversation";
import { EnquiryEmailComposer } from "./enquiry-email-composer";
import { EnquiryMergeDialog } from "./enquiry-merge";
import { enquiryGroup, enquiryGroupSearchText, enquiryRootRecords, primaryEnquiry } from "@/lib/enquiry-groups";
import { EnquiryRecordBrowser, type EnquiryRecordActions } from "./enquiry-record-browser";
import { CallbacksDesk } from "./enquiry-callbacks";
import { isOutstandingCallback } from "./enquiry-callback-model";
import { useStaffAppointmentDiary } from "@/lib/staff-appointment-diary";
import { appointmentFollowUpEmail } from "@/lib/appointment-follow-up-email";
import { enquiryPresentation } from "@/lib/enquiry-presentation";
import "./enquiries-workspace.css";
import "./staff-appointment-picker.css";
import { AppointmentSlots as Slots } from "./appointment-slots";

const field = "enquiry-field grid gap-1.5 text-sm font-medium";
type BookingAccess = { enabled: boolean; message: string; retry?: () => void };
function BookingAccessNotice({ access }: { access: BookingAccess }) {
  if (access.enabled) return null;
  return <div role="status" className="space-y-2 rounded border border-border bg-muted/50 p-3 text-sm"><p>{access.message}</p>{access.retry && <Button type="button" variant="outline" size="sm" onClick={access.retry}>Retry booking availability</Button>}</div>;
}

function errorMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "error" in error.data &&
    typeof error.data.error === "string"
  )
    return error.data.error;
  return "We could not save this. Please try again; your details are still here.";
}
function status(booking: Enquiry) {
  return booking.appointmentCancelledAt
    ? "Cancelled"
    : booking.appointmentAt
      ? booking.appointmentStatus === "pending"
        ? "Awaiting approval"
        : "Confirmed"
      : "Enquiry";
}
function available(car: Car) {
  return car.inventoryStatus === "available";
}
function stockStatus(car: Car) {
  return available(car)
    ? "Available"
    : car.inventoryStatus === "reserved"
      ? "Reserved"
      : "Availability unconfirmed";
}
function contains(value: string, search: string) {
  const normal = (text: string) =>
    text.toLocaleLowerCase().replace(/[\s()+.-]/g, "");
  return normal(value).includes(normal(search));
}


export function StaffAppointmentPicker({ bookingId, initialDate, time, onTime, manual, onManual, allowOutsideHours, onOutsideHours, allowDoubleBooking, onDoubleBooking }: {
  bookingId?: string;
  initialDate?: string;
  time: string; onTime: (value: string) => void;
  manual: boolean; onManual: (value: boolean) => void;
  allowOutsideHours: boolean; onOutsideHours: (value: boolean) => void;
  allowDoubleBooking: boolean; onDoubleBooking: (value: boolean) => void;
}) {
  const savedLocal = time && Number.isFinite(Date.parse(time)) ? followUpLocal(time) : "";
  const [date, setDate] = useState(savedLocal.split('T')[0] || initialDate || "");
  const [clock, setClock] = useState(savedLocal.split('T')[1] || "");
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const hintId = useId();
  const { settings } = useDealerSettings();
  const policy = settings.testDriveBooking ?? defaultBookingSettings;
  const query = useStaffAppointmentDiary(date, manual);
  const appointment = time ? new Date(time) : null;
  const valid = Boolean(appointment && validStaffAppointmentDateTime(appointment));
  const checking = query.data === undefined && !query.isError;
  const occupied = (query.data?.appointments ?? []).map(item => ({ id: item.id, appointmentAt: new Date(item.appointmentAt), appointmentDurationMinutes: item.appointmentDurationMinutes, appointmentBufferMinutes: item.appointmentBufferMinutes }));
  const outside = Boolean(valid && appointment && !withinBookingHours(appointment, policy));
  const pressure = valid && appointment && !checking && !query.isError ? bookingPressure(appointment, policy, occupied, bookingId) : null;
  const needsException = outside || Boolean(pressure?.overlapping || pressure?.overCapacity);
  const showExceptions = valid && (needsException || exceptionsOpen || allowOutsideHours || allowDoubleBooking || query.isError);
  function clearExceptions() { onOutsideHours(false); onDoubleBooking(false); setExceptionsOpen(false); }
  function chooseMode(next: boolean) {
    if (next === manual) return;
    if (time) setDate(followUpLocal(time).split('T')[0]);
    setClock(''); onManual(next); onTime(''); clearExceptions();
  }
  function chooseTime(nextDate: string, nextClock: string) {
    setDate(nextDate); setClock(nextClock); clearExceptions();
    const iso = nextDate && nextClock ? followUpIso(`${nextDate}T${nextClock}`) : null;
    onTime(iso && validStaffAppointmentDateTime(new Date(iso)) ? iso : '');
  }
  return <div className="enquiry-appointment-picker staff-appointment-picker">
    <div className="staff-appointment-modes" role="group" aria-label="Choose appointment time">
      <button type="button" aria-pressed={!manual} onClick={() => chooseMode(false)}><CalendarDays size={16} aria-hidden="true" />Available slots</button>
      <button type="button" aria-pressed={manual} onClick={() => chooseMode(true)}><Clock3 size={16} aria-hidden="true" />Choose date &amp; time</button>
    </div>
    {manual ? <>
      <div className="staff-appointment-date-fields">
        <label className={field}>Appointment date (UK)<Input type="date" required min={londonDate()} max={londonDate(new Date(Date.now() + 366 * 86400000))} value={date} aria-describedby={hintId} onChange={event => chooseTime(event.target.value, clock)} /></label>
        <label className={field}>Appointment time (UK)<Input type="time" required step={900} value={clock} aria-describedby={hintId} onChange={event => chooseTime(date, event.target.value)} /></label>
      </div>
      <p id={hintId} className="staff-appointment-hint">UK time · choose a time in 15-minute steps.</p>
      {date && clock && !valid && <p role="alert" className="staff-appointment-error">Choose a valid future UK time in 15-minute steps, within the next year.</p>}
      {valid && checking && <p role="status" className="staff-appointment-hint">Checking other appointments…</p>}
      {valid && query.isError && <p role="status" className="staff-appointment-hint">Other bookings could not be checked. Availability will be checked again when you save.</p>}
      {valid && !needsException && !query.isError && <button className="staff-appointment-exceptions-toggle" type="button" aria-expanded={showExceptions} aria-controls={`${hintId}-exceptions`} onClick={() => setExceptionsOpen(!exceptionsOpen)}>Booking exceptions</button>}
      {showExceptions && <fieldset id={`${hintId}-exceptions`} className="enquiry-booking-exceptions staff-appointment-exceptions">
        <legend>Staff booking exceptions</legend>
        <p className="staff-appointment-exception-intro">Only approve an exception when you intend to make one. You’ll review it before saving.</p>
        {outside && <p className="staff-appointment-conflict">This time is outside booking hours or on a closed date.</p>}
        {pressure?.overlapping && <p className="staff-appointment-conflict">Another appointment overlaps this time.</p>}
        {pressure?.overCapacity && <p className="staff-appointment-conflict">This day has reached its booking capacity.</p>}
        <label><input type="checkbox" checked={allowOutsideHours} onChange={event => onOutsideHours(event.target.checked)} /><span>Allow outside normal booking hours or a closed date</span></label>
        <label><input type="checkbox" checked={allowDoubleBooking} onChange={event => onDoubleBooking(event.target.checked)} /><span>Allow overlapping appointments or a full day</span></label>
      </fieldset>}
    </> : <Slots bookingId={bookingId} initialDate={date || initialDate} value={time} onChange={value => { clearExceptions(); onTime(value); }} />}
  </div>;
}

function AppointmentConflicts({ time, bookingId }: { time: string; bookingId?: string }) {
  const query = useStaffAppointmentDiary(time && Number.isFinite(Date.parse(time)) ? londonDate(new Date(time)) : "");
  const { settings } = useDealerSettings();
  const at = new Date(time);
  if (!validStaffAppointmentDateTime(at)) return null;
  const clashes = (query.data?.appointments ?? []).filter(entry => bookingPressure(at, settings.testDriveBooking ?? defaultBookingSettings, [{ ...entry, appointmentAt: new Date(entry.appointmentAt) }], bookingId).overlapping);
  return <div className="text-sm">{query.data === undefined && !query.isError ? <p>Checking the diary…</p> : query.isError ? <p role="alert">The diary could not be loaded. Refresh before overriding a booking.</p> : clashes.length ? <><p className="font-semibold">Appointments already at this time</p><ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">{clashes.map(entry => <li key={entry.id} className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-950"><p className="font-semibold">{entry.vehicleTitle}</p><p>{appointmentLabel(entry.appointmentAt)} · {entry.appointmentDurationMinutes ?? 30} minutes</p><p>Staff: {entry.assignedToName || 'Unassigned'} · {entry.customerName}</p></li>)}</ul></> : <p>No overlapping appointments currently shown. Capacity is checked again when saving.</p>}</div>;
}

function StaffExceptionReview({ time, bookingId, outside, double, onConfirm, onClose }: { time: string; bookingId?: string; outside: boolean; double: boolean; onConfirm: () => void; onClose: () => void }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="portal-action-dialog enquiry-action-dialog"><DialogHeader><DialogTitle>Review staff booking exception</DialogTitle><DialogDescription>{appointmentLabel(time)}</DialogDescription></DialogHeader>
    <p className="text-sm">This appointment will be saved even if the selected time is outside the normal diary or another booking is already there. Check the customer, car and time before continuing.</p>
    <ul className="list-inside list-disc text-sm">{outside && <li>Outside normal booking hours or a closed date</li>}{double && <li>Possible double booking or exceeded daily capacity</li>}</ul>
    {double && <AppointmentConflicts time={time} bookingId={bookingId} />}
    <p className="text-sm text-muted-foreground">The diary will label the actual exception. If an email address is provided, the usual booking notification may be sent.</p>
    <div className="flex flex-wrap gap-2"><Button type="button" onClick={onConfirm}>Confirm staff exception</Button><Button type="button" variant="outline" onClick={onClose}>Go back</Button></div>
  </DialogContent></Dialog>;
}

function CarSummary({ car }: { car: Car }) {
  return (
    <div className="enquiry-car-summary flex items-center gap-3">
      <EnquiryPhotoPeek key={car.id} car={car} className="h-16 w-24 rounded-sm object-cover" />
      <div className="min-w-0">
        <p className="font-semibold leading-5">{vehicleDisplayTitle(car)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {[
            car.year,
            vehicleRegistrationLabel(car),
            car.transmission,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="mt-1 text-sm font-medium">
          {car.price == null ? "Price on request" : formatPrice(car.price)}{" "}
          <span
            className={
              available(car) ? "ml-2 text-emerald-800" : "ml-2 text-amber-800"
            }
          >
            {stockStatus(car)}
          </span>
        </p>
      </div>
    </div>
  );
}

function NewCall({
  initial,
  initialBookingDate,
  selection,
  enquiries, reservations, draftKey, defaultOwnerId, onDiscard,
  onSaved, bookingAccess,
}: {
  bookingAccess: BookingAccess;
  enquiries: Enquiry[]; reservations: StaffOnlineReservation[]; draftKey: string | null; defaultOwnerId: string; onDiscard: () => void;
  initial?: Enquiry;
  initialBookingDate?: string;
  selection?: { id: string; booking: boolean };
  onSaved: (booking: Enquiry) => void;
}) {
  const { stock, isLoading, error } = useStock();
  const [restored] = useState(() => draftKey && !initial ? readCallDraft(draftKey) : null);
  const [draftStatus, setDraftStatus] = useState(restored ? "Draft restored" : "");
  const draftSaved = useRef(false);
  const [assignedToId, setAssignedToId] = useState(restored?.assignedToId ?? defaultOwnerId);
  const [outcome, setOutcome] = useState(restored?.outcome ?? "information_given");
  const [vehicleMode, setVehicleMode] = useState<"stock" | "adhoc" | "none">(
    restored?.vehicleMode ?? "stock",
  );
  const [adHocTitle, setAdHocTitle] = useState(restored?.adHocTitle ?? "");
  const [adHocRegistration, setAdHocRegistration] = useState(restored?.adHocRegistration ?? "");
  const [adHocPrice, setAdHocPrice] = useState(restored?.adHocPrice ?? "");
  const [information, setInformation] = useState<Car | null>(null);
  const [followUp, setFollowUp] = useState(restored?.followUp ?? false);
  const [followUpTime, setFollowUpTime] = useState(restored?.followUpTime ?? "");
  const [followUpNote, setFollowUpNote] = useState(restored?.followUpNote ?? "");
  const [search, setSearch] = useState("");
  const [carId, setCarId] = useState(initial?.vehicleId ?? restored?.carId ?? "");
  const [name, setName] = useState(initial?.customerName ?? restored?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? restored?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? restored?.email ?? "");
  const [message, setMessage] = useState(restored?.message ?? "");
  const [booking, setBooking] = useState(initial || initialBookingDate ? true : restored?.booking ?? false);
  const [time, setTime] = useState(initialBookingDate ? "" : restored?.time ?? "");
  const [manualTime, setManualTime] = useState(initialBookingDate ? false : restored?.manualTime ?? false);
  const [allowOutsideHours, setAllowOutsideHours] = useState(false);
  const [allowDoubleBooking, setAllowDoubleBooking] = useState(false);
  const [reviewException, setReviewException] = useState(false);
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    if (!selection) return;
    setVehicleMode("stock"); setCarId(selection.id); setBooking(selection.booking); setTime(""); setManualTime(false); setAllowOutsideHours(false); setAllowDoubleBooking(false);
  }, [selection]);
  useEffect(() => {
    if (!initial) return;
    setName(initial.customerName); setPhone(initial.phone ?? ""); setEmail(initial.email ?? ""); setCarId(initial.vehicleId ?? ""); setVehicleMode("stock"); setBooking(true); setTime("");
  }, [initial]);
  const draft: CallDraft = { vehicleMode, carId, adHocTitle, adHocRegistration, adHocPrice, name, phone, email, message, booking, time, followUp, followUpTime, followUpNote, manualTime, assignedToId, outcome };
  const serialDraft = JSON.stringify(draft);
  useEffect(() => {
    if (!draftKey || draftSaved.current) return;
    if (![name,phone,email,message,carId,adHocTitle,followUpNote].some(Boolean)) { removeCallDraft(draftKey); setDraftStatus(""); return; }
    setDraftStatus(saveCallDraft(draftKey, JSON.parse(serialDraft)) ? "Draft saved" : "Draft could not be saved on this browser — keep this page open");
  }, [draftKey, serialDraft]);
  const mutation = useCreateStaffEnquiry();
  const submitting = useRef(false);
  const cars = stock?.cars ?? [];
  const car =
    vehicleMode === "stock"
      ? cars.find((entry) => entry.id === carId)
      : undefined;
  const matches = cars.filter((entry) =>
    contains(
      [
        entry.title,
        entry.make,
        entry.model,
        entry.plate,
        entry.vrm,
        entry.registration,
        vehicleRegistrationLabel(entry),
        entry.advertId,
      ].join(" "),
      search,
    ),
  );
  async function submit(event?: FormEvent, confirmed = false) {
    event?.preventDefault();
    if (submitting.current) return;
    if (booking && !bookingAccess.enabled) { setLocalError(bookingAccess.message); return; }
    setLocalError("");
    if (!/^\+?[0-9]{7,15}$/.test(phone.replace(/[\s().\-/]/g, ""))) {
      setLocalError("Enter a valid contact number.");
      return;
    }
    if (booking && (!car || !available(car) || !time)) {
      setLocalError("Select an available car and appointment time.");
      return;
    }
    if (booking && !validStaffAppointmentDateTime(new Date(time))) {
      setLocalError("Choose a future UK appointment time in 15-minute steps.");
      return;
    }
    if (booking && manualTime && (allowOutsideHours || allowDoubleBooking) && !confirmed) {
      setReviewException(true);
      return;
    }
    const followUpAt = followUp ? followUpIso(followUpTime) : null;
    if (
      followUp &&
      (!followUpAt || new Date(followUpAt).getTime() <= Date.now())
    ) {
      setLocalError("Choose a valid future UK follow-up time.");
      return;
    }
    if (vehicleMode === "adhoc" && adHocTitle.trim().length < 2) {
      setLocalError("Enter the ad hoc vehicle’s make and model.");
      return;
    }
    submitting.current = true;
    try {
      const result = await mutation.mutateAsync({
        data: {
          assignedToId: assignedToId || null,
          callOutcome: booking ? "test_drive_booked" : followUp && outcome === "information_given" ? "callback_requested" : outcome as CallOutcome,
          vehicleId: car?.id ?? null,
          adHocVehicle:
            vehicleMode === "adhoc"
              ? {
                  title: adHocTitle.trim(),
                  registration: adHocRegistration.trim() || null,
                  price: adHocPrice === "" ? null : Number(adHocPrice),
                }
              : null,
          followUpAt,
          followUpNote: followUp ? followUpNote.trim() || null : null,
          type: booking ? "viewing" : "general",
          customerName: name.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          preferredContact: "phone",
          message:
            message.trim() ||
            (booking
              ? "Test drive arranged by phone with the showroom."
              : "Customer called the showroom."),
          appointmentAt: booking ? time : null,
          allowOutsideHours: booking && manualTime && allowOutsideHours,
          allowDoubleBooking: booking && manualTime && allowDoubleBooking,
        },
      });
      draftSaved.current = true;
      if (draftKey) removeCallDraft(draftKey);
      onSaved(result);
    } catch {
      /* Keep caller details for retry. */
    } finally {
      submitting.current = false;
    }
  }
  return (
    <form onSubmit={submit} className="enquiry-new-call grid gap-6">
      <fieldset disabled={mutation.isPending} className="enquiry-form-section enquiry-caller-section min-w-0 space-y-4">
        <legend className="mb-4 font-semibold">1. Customer</legend>
        <RecentCustomerFields
          value={{ customerName: name, phone, email }}
          onChange={contact => { setName(contact.customerName); setPhone(contact.phone ?? ""); setEmail(contact.email ?? ""); }}
          nameRequired
          phoneRequired
          customers={[
            ...enquiries.map(entry => ({ id: `enquiry-${entry.id}`, customerName: entry.customerName, phone: entry.phone, email: entry.email, lastUsedAt: entry.updatedAt || entry.createdAt, detail: entry.vehicleTitle || "General enquiry" })),
            ...reservations.map(entry => ({ id: `reservation-${entry.id}`, customerName: entry.customerName, phone: entry.phone, email: entry.email, lastUsedAt: entry.createdAt, detail: entry.vehicleTitle })),
          ]}
        />
        <label className={field}>
          Call notes (optional)
          <Textarea
            rows={2}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Questions, requests or anything to prepare"
          />
        </label>
        <details className="enquiry-desk-more"><summary>Assignment and call outcome</summary><OwnerSelect value={assignedToId} onChange={setAssignedToId} />{!booking && <label className={field}>Call outcome<NativeSelect value={outcome} onChange={e => setOutcome(e.target.value)}>{Object.entries(callOutcomes).filter(([value]) => value !== "test_drive_booked").map(([value,label]) => <option key={value} value={value} disabled={value === "callback_requested" && !followUp}>{label}</option>)}</NativeSelect></label>}</details>
        <CustomerHistory contact={{ customerName: name, phone, email }} enquiries={enquiries} reservations={reservations} compact onReuse={contact => { setName(contact.customerName); setPhone(contact.phone ?? ""); setEmail(contact.email ?? ""); }} />
      </fieldset>
      <fieldset disabled={mutation.isPending} className="enquiry-form-section enquiry-vehicle-section min-w-0 space-y-4">
        <legend className="mb-4 font-semibold">2. Vehicle</legend>
        <label className={field}>
          Vehicle source
          <NativeSelect
            aria-label="Vehicle source"
            value={vehicleMode}
            onChange={(e) => {
              setVehicleMode(e.target.value as "stock" | "adhoc" | "none");
              setBooking(false);
              setTime("");
            }}
          >
            <option value="stock">Showroom stock</option>
            <option value="adhoc">Ad hoc vehicle — not in stock</option>
            <option value="none">No specific vehicle</option>
          </NativeSelect>
        </label>
        {vehicleMode === "adhoc" && (
          <div className="enquiry-ad-hoc-vehicle space-y-4 border border-border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">
              Attach a vehicle to this enquiry. This does not add it to stock or
              confirm availability.
            </p>
            <label className={field}>
              Vehicle make and model
              <Input
                required
                minLength={2}
                maxLength={200}
                value={adHocTitle}
                onChange={(e) => setAdHocTitle(e.target.value)}
                placeholder="For example: 2018 Volkswagen Golf 1.4 TSI"
              />
            </label>
            <label className={field}>
              Vehicle registration (optional)
              <Input
                maxLength={16}
                value={adHocRegistration}
                onChange={(e) =>
                  setAdHocRegistration(e.target.value.toUpperCase())
                }
              />
            </label>
            <label className={field}>
              Quoted vehicle price (£, optional)
              <Input
                type="number"
                min={0}
                max={10000000}
                step={1}
                value={adHocPrice}
                onChange={(e) => setAdHocPrice(e.target.value)}
              />
            </label>
          </div>
        )}
        {vehicleMode === "none" && (
          <p className="text-sm text-muted-foreground">
            Log the call and any follow-up without selecting a car.
          </p>
        )}
        {vehicleMode === "stock" && (
          <>
            <label className={`${field} ${car ? "hidden lg:grid" : ""}`}>
              Search showroom stock
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Make, model or registration"
                />
              </div>
            </label>
            {isLoading && <p role="status">Loading stock…</p>}
            {error && (
              <p role="alert">
                Stock is unavailable. Refresh before confirming a car.
              </p>
            )}
            {car && (
              <div className="enquiry-selected-car border border-primary/25 bg-primary/5 p-3">
                <CarSummary car={car} />
                <div className="enquiry-selected-car-actions flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setInformation(car)}
                >
                  View full vehicle information
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCarId("");
                    setTime("");
                  }}
                >
                  Change selected car
                </Button>
                </div>
                <details className="enquiry-desk-more"><summary>Vehicle history and preparation</summary><VehicleDeskContext car={car} /></details>
              </div>
            )}
            <div
              className={`enquiry-stock-picker max-h-96 divide-y divide-border overflow-y-auto rounded-sm border border-border ${car ? "hidden" : ""}`}
              aria-label="Showroom cars"
            >
              {matches.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-label={`Select ${vehicleDisplayTitle(entry)}, ${entry.year ?? ""}, ${stockStatus(entry)}`}
                  aria-pressed={entry.id === carId}
                  onClick={() => {
                    setCarId(entry.id);
                    setTime("");
                    setAllowOutsideHours(false);
                    setAllowDoubleBooking(false);
                  }}
                  className={`block w-full p-3 text-left transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 ${entry.id === carId ? "bg-primary/5" : "bg-card"}`}
                >
                  <CarSummary car={entry} />
                </button>
              ))}
              {!isLoading && !error && !matches.length && (
                <p className="p-4 text-sm">
                  No matching cars. Try a model or registration.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Only current showroom stock is listed. Reserved cars can receive
              enquiries but cannot be booked here.
            </p>
          </>
        )}
      </fieldset>
      <fieldset disabled={mutation.isPending} className="enquiry-form-section enquiry-action-section min-w-0 space-y-4">
        <legend className="mb-4 font-semibold">Next step</legend>
        <fieldset className="enquiry-next-step space-y-2 border-t border-border pt-4">
          <legend className="sr-only">Call action</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="radio"
              name="call-action"
              checked={!booking}
              onChange={() => {
                setBooking(false);
                setTime("");
              }}
              className="h-5 w-5 accent-primary"
            />
            Log call / enquiry only
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="radio"
              name="call-action"
              checked={booking}
              disabled={vehicleMode !== "stock" || !bookingAccess.enabled}
              onChange={() => setBooking(true)}
              className="h-5 w-5 accent-primary"
            />
            Book a Test Drive
          </label>
          {vehicleMode !== "stock" && (
            <p className="text-xs text-muted-foreground">
              A test drive needs an available showroom stock car. You can
              request a follow-up for any enquiry.
            </p>
          )}
        </fieldset>
        <BookingAccessNotice access={bookingAccess} />
        {booking && bookingAccess.enabled &&
          (car && available(car) ? (
            <StaffAppointmentPicker initialDate={initialBookingDate} time={time} onTime={setTime} manual={manualTime} onManual={setManualTime} allowOutsideHours={allowOutsideHours} onOutsideHours={setAllowOutsideHours} allowDoubleBooking={allowDoubleBooking} onDoubleBooking={setAllowDoubleBooking} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose an available car first.
            </p>
          ))}
        {time && booking && (
          <p className="border-l-2 border-primary pl-3 text-sm">
            {appointmentLabel(time)}
          </p>
        )}

        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={followUp}
            onChange={(e) => setFollowUp(e.target.checked)}
            className="h-5 w-5 accent-primary"
          />
          Request a follow-up
        </label>
        {followUp && (
          <FollowUpFields
            time={followUpTime}
            note={followUpNote}
            onTime={setFollowUpTime}
            onNote={setFollowUpNote}
          />
        )}
      </fieldset>
      <div className="enquiry-call-footer">
        <div className="enquiry-call-feedback min-w-0 space-y-1">
        <div className="enquiry-draft-bar flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span aria-live="polite">{draftStatus || (draftKey ? "Drafts save automatically on this browser for 7 days" : "Draft storage unavailable until staff identity loads")}</span>{draftStatus && <Button type="button" size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => { draftSaved.current = true; if (draftKey) removeCallDraft(draftKey); onDiscard(); }}>Discard draft</Button>}</div>
        <p className="text-xs leading-5 text-muted-foreground">
          {email.trim()
            ? "Customer email saved. Sending follows your dealership’s email settings."
            : booking ? "No email supplied — confirm this appointment by phone." : "Add an email to send vehicle details to the customer later."}
        </p>
        {(localError || mutation.isError) && (
          <p role="alert" className="text-sm text-destructive">
            {localError || errorMessage(mutation.error)}
          </p>
        )}
        </div>
        <Button
          type="submit"
          className="enquiry-save-action w-full"
          disabled={
            mutation.isPending ||
            (booking && (!bookingAccess.enabled || isLoading || Boolean(error))) ||
            (booking && (!car || !available(car) || !time))
          }
        >
          {mutation.isPending
            ? "Saving…"
            : booking
              ? manualTime && (allowOutsideHours || allowDoubleBooking) ? "Review staff exception" : "Save test-drive booking"
              : "Save phone enquiry"}
        </Button>
      </div>
      {information && (
        <EnquiryVehicleInformation
          car={information}
          onClose={() => setInformation(null)}
        />
      )}
      {reviewException && time && bookingAccess.enabled && <StaffExceptionReview time={time} outside={allowOutsideHours} double={allowDoubleBooking} onClose={() => setReviewException(false)} onConfirm={() => { setReviewException(false); void submit(undefined, true); }} />}
    </form>
  );
}

function AppointmentEditor({
  booking,
  onClose,
  onSaved, bookingAccess,
}: {
  bookingAccess: BookingAccess;
  booking: Enquiry;
  onClose: () => void;
  onSaved: (entry: Enquiry) => void;
}) {
  const [time, setTime] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [manualTime, setManualTime] = useState(false);
  const [allowOutsideHours, setAllowOutsideHours] = useState(false);
  const [allowDoubleBooking, setAllowDoubleBooking] = useState(false);
  const [reviewException, setReviewException] = useState(false);
  const mutation = useChangeStaffAppointment();
  const { settings } = useDealerSettings();
  async function save(confirmed = false) {
    if (mutation.isPending) return;
    if (!cancelling && (!bookingAccess.enabled || !time)) return;
    if (!cancelling && (allowOutsideHours || allowDoubleBooking) && !confirmed) { setReviewException(true); return; }
    try {
      onSaved(
        await mutation.mutateAsync({
          id: booking.id,
          data: {
            action: cancelling ? "cancel" : "reschedule",
            appointmentAt: cancelling ? null : time,
            expectedRevision: booking.appointmentRevision ?? 0,
            ...(allowOutsideHours && !cancelling ? { allowOutsideHours: true } : {}),
            ...(allowDoubleBooking && !cancelling ? { allowDoubleBooking: true } : {}),
          },
        }),
      );
    } catch {
      /* Keep edit open with the error. */
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="portal-action-dialog enquiry-action-dialog">
        <DialogHeader>
          <DialogTitle className="pr-10">
            {cancelling ? "Cancel this appointment?" : "Change appointment"}
          </DialogTitle>
          <DialogDescription>
            {booking.customerName}
          </DialogDescription>
        </DialogHeader>
        <div className="enquiry-appointment-summary border-y border-border py-3 text-sm">
          <p className="font-semibold">{booking.vehicleTitle}</p>
          <p className="mt-1">
            {booking.appointmentAt && appointmentLabel(booking.appointmentAt)}
          </p>
          <p className="mt-1">{booking.phone}</p>
        </div>
        {cancelling ? (
          <p className="text-sm">
            This will release the appointment time. The customer’s enquiry will
            remain in the call history.
          </p>
        ) : !bookingAccess.enabled ? <BookingAccessNotice access={bookingAccess} /> : (
          <StaffAppointmentPicker bookingId={booking.id} initialDate={booking.appointmentAt ? londonDate(new Date(booking.appointmentAt)) : undefined} time={time} onTime={setTime} manual={manualTime} onManual={setManualTime} allowOutsideHours={allowOutsideHours} onOutsideHours={setAllowOutsideHours} allowDoubleBooking={allowDoubleBooking} onDoubleBooking={setAllowDoubleBooking} />
        )}
        {!cancelling && time && (
          <p className="text-sm font-medium">
            New time: {appointmentLabel(time)}
            {settings.testDriveBooking?.confirmationMode === "approval"
              ? " — awaiting staff approval"
              : ""}
          </p>
        )}
        {mutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(mutation.error)} Close this window and refresh if the
            booking has changed.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={mutation.isPending || (!cancelling && (!bookingAccess.enabled || !time))}
            variant={cancelling ? "destructive" : "default"}
            onClick={() => void save()}
          >
            {mutation.isPending
              ? "Saving…"
              : cancelling
                ? "Confirm cancellation"
                : allowOutsideHours || allowDoubleBooking ? "Review staff exception" : "Save new appointment"}
          </Button>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            Keep existing appointment
          </Button>
        </div>
        {!cancelling && (
          <Button
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => setCancelling(true)}
          >
            Cancel appointment instead
          </Button>
        )}
        {reviewException && time && bookingAccess.enabled && <StaffExceptionReview time={time} bookingId={booking.id} outside={allowOutsideHours} double={allowDoubleBooking} onClose={() => setReviewException(false)} onConfirm={() => { setReviewException(false); void save(true); }} />}
      </DialogContent>
    </Dialog>
  );
}

export function EnquiriesPanel({ canEmail = false, embedded = false, initialView = 'today', onOpenCustomer }: { canEmail?: boolean; embedded?: boolean; initialView?: 'today' | 'history' | 'calendar'; onOpenCustomer?: (id: string) => void } = {}) {
  const features = useDealerFeatures();
  const bookingAccess: BookingAccess = {
    enabled: features.enabled('testDriveBookings'),
    message: features.isLoading ? 'Checking test-drive availability…' : features.isError ? 'Booking availability could not be checked. New test drives and rescheduling are paused until this is checked. Existing appointments can still be viewed or cancelled.' : 'New test drives and rescheduling are paused by the platform. Existing appointments can still be viewed or cancelled, and phone enquiries can still be recorded.',
    ...(features.isError ? { retry: () => { void features.refetch(); } } : {}),
  };
  const routeSearch = useSearch();
  const [,navigate] = useLocation();
  const requestedEnquiry = new URLSearchParams(routeSearch).get('enquiryId');
  const requestedDeskView = new URLSearchParams(routeSearch).get('deskView');
  const openedEnquiry = useRef<string | null>(null);
  const [mode, setMode] = useState<"new" | "history" | "stock" | "calendar" | "today" | "callbacks">(initialView);
  useEffect(() => { if (requestedDeskView && ['calendar','history','new','today','callbacks','stock'].includes(requestedDeskView)) setMode(requestedDeskView as typeof mode); }, [requestedDeskView]);
  const [globalSearch, setGlobalSearch] = useState("");
  const [ownerScope, setOwnerScope] = useState("all");
  const [workspaceEntry, setWorkspaceEntry] = useState<Enquiry | null>(null);
  const [conversationEntry, setConversationEntry] = useState<Enquiry | null>(null);
  const [emailEntry, setEmailEntry] = useState<Enquiry | null>(null);
  const [appointmentEmail, setAppointmentEmail] = useState(false);
  const [mergeEntry, setMergeEntry] = useState<Enquiry | null>(null);
  const [selectedEnquiryId, setSelectedEnquiryId] = useState<string | null>(null);
  const [callbackFilter, setCallbackFilter] = useState("all");
  const [callbackSearch, setCallbackSearch] = useState("");
  const [historyContact, setHistoryContact] = useState<Contact | null>(null);
  const directory = useGetStaffDirectory();
  const reservations = useListReservations({ query: { queryKey: getListReservationsQueryKey(), refetchInterval: 30_000 } });
  const { settings: deskSettings } = useDealerSettings();
  const draftKey = directory.data ? `luxxy.staff-call-draft.v1:${deskSettings.identity.name}:${directory.data.currentUserId}` : null;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [information, setInformation] = useState<Car | null>(null);
  const [followUpEntry, setFollowUpEntry] = useState<Enquiry | null>(null);
  const [notice, setNotice] = useState("");
  const [initial, setInitial] = useState<Enquiry>();
  const [initialBookingDate, setInitialBookingDate] = useState<string>();
  const [selection, setSelection] = useState<{ id: string; booking: boolean }>();
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<Enquiry | null>(null);
  const client = useQueryClient();
  const query = useGetEnquiries(undefined, {
    query: {
      queryKey: getGetEnquiriesQueryKey(),
      // Keep the initial customer history for matching, but don't repeatedly
      // reload every timeline while staff fill in a form. The date diary above
      // checks current appointment conflicts, and saving rechecks under a lock.
      refetchInterval: mode === "new" || editing ? false : 30_000,
      refetchOnWindowFocus: mode !== "new" && !editing,
    },
  });
  const { stock } = useStock();
  useEffect(() => {
    if (requestedDeskView === 'calendar' || initialView === 'calendar') return;
    if (!requestedEnquiry) { openedEnquiry.current = null; return; }
    if (!query.data || openedEnquiry.current === requestedEnquiry) return;
    const requested = query.data.find(item => item.id === requestedEnquiry);
    const entry = requested ? primaryEnquiry(requested, query.data) : undefined;
    if (entry) openedEnquiry.current = requestedEnquiry;
    setMode(requestedDeskView === 'callbacks' ? 'callbacks' : 'history'); setOwnerScope('all'); setFilter('all'); setGlobalSearch('');
    if (entry) { setSearch(entry.customerName); setSelectedEnquiryId(entry.id); setNotice(''); }
    else { setSelectedEnquiryId(null); setSearch(''); setNotice('This enquiry could not be found. Refresh or search by customer details.'); }
  }, [requestedEnquiry, requestedDeskView, initialView, query.data]);
  async function saved(entry: Enquiry) {
    client.setQueryData<Enquiry[]>(enquirySummaryKey(), current => {
      const entries = current ?? [];
      return entries.some(item => item.id === entry.id)
        ? entries.map(item => item.id === entry.id ? entry : item)
        : [entry, ...entries];
    });
    setEditing(null);
    setInitial(undefined);
    setInitialBookingDate(undefined);
    setSelection(undefined);
    setFormKey((key) => key + 1);
    setNotice(
      `${entry.customerName}: ${entry.appointmentCancelledAt ? "appointment cancelled" : entry.appointmentAt ? `${status(entry)}: ${appointmentLabel(entry.appointmentAt)}` : "phone enquiry recorded"}.${entry.customerNotificationStatus === "failed" ? " Customer email failed; confirm by phone." : ""}`,
    );
    setMode("history");
    setGlobalSearch("");
    setOwnerScope("all");
    const primary = primaryEnquiry(entry, query.data ?? []);
    setSearch(primary.customerName);
    setSelectedEnquiryId(primary.id);
    if (embedded) navigate(`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(primary.id)}`);
    setFilter("all");
    await Promise.all([
      client.invalidateQueries({ queryKey: ['staff-notifications'] }),
      client.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }),
      client.invalidateQueries({ queryKey: getGetTestDriveBookingsQueryKey() }),
      client.invalidateQueries({
        predicate: (query) =>
          String(query.queryKey[0]).endsWith("/availability"),
      }),
    ]);
  }
  const scoped = (query.data ?? []).filter(entry => ownerScope === "all" || (ownerScope === "mine" ? entry.assignedToId === directory.data?.currentUserId : !entry.assignedToId));
  const callbackEntries = (query.data ?? []).filter(entry => ownerScope === "all" || (ownerScope === "mine" ? entry.assignedToId === directory.data?.currentUserId || !entry.assignedToId : !entry.assignedToId));
  const dueCount = (mode === "callbacks" ? callbackEntries.filter(isOutstandingCallback) : scoped).filter(
    (entry) =>
      entry.followUpAt &&
      !entry.followUpCompletedAt &&
      Date.parse(entry.followUpAt) <= Date.now(),
  ).length;
  const allEntries = query.data ?? [];
  const missingRequested = Boolean(requestedEnquiry && query.data && !query.data.some(entry => entry.id === requestedEnquiry));
  const roots = enquiryRootRecords(allEntries)
    .filter(entry => enquiryGroup(entry, allEntries).some(original => scoped.some(item => item.id === original.id)));
  const matchesQueue = (original: Enquiry, value: string) => {
    const summary = enquiryPresentation(original);
    if (value === 'all') return true;
    if (value === 'reply') return summary.action === 'respond';
    if (value === 'done') return summary.action === 'none';
    if (value === 'followups') return Boolean(original.followUpAt && !original.followUpCompletedAt) || summary.action === 'follow_up';
    if (value === 'due') return Boolean(original.followUpAt && !original.followUpCompletedAt && Date.parse(original.followUpAt) <= Date.now());
    if (value === 'visits') return Boolean(original.appointmentAt && !original.appointmentCancelledAt && original.attendance !== 'completed' && original.attendance !== 'no_show');
    if (value === 'upcoming') return Boolean(original.appointmentAt && !original.appointmentCancelledAt && Date.parse(original.appointmentAt) > Date.now());
    return Boolean(original.appointmentAt && !original.appointmentCancelledAt && londonDate(new Date(original.appointmentAt)) === londonDate());
  };
  const queues = [
    { value: 'all', label: 'All enquiries', tone: 'muted' },
    { value: 'reply', label: 'Needs reply', tone: 'info' },
    { value: 'followups', label: 'Follow-ups', tone: 'warning' },
    { value: 'visits', label: 'Test drives', tone: 'info' },
    { value: 'done', label: 'No task scheduled', tone: 'success' },
  ];
  const groupPriority = (entry: Enquiry) => Math.min(...enquiryGroup(entry, allEntries).map(original => enquiryPresentation(original).priority));
  const entries = roots.filter(entry => contains(enquiryGroupSearchText(entry, allEntries), search)
    && (filter === 'done' ? enquiryGroup(entry, allEntries).every(original => matchesQueue(original, filter)) : enquiryGroup(entry, allEntries).some(original => matchesQueue(original, filter))))
    .sort((a, b) => groupPriority(a) - groupPriority(b)
      || (enquiryGroup(a, allEntries).filter(item => item.followUpAt && !item.followUpCompletedAt).map(item => item.followUpAt!).sort()[0] ?? '9999').localeCompare(enquiryGroup(b, allEntries).filter(item => item.followUpAt && !item.followUpCompletedAt).map(item => item.followUpAt!).sort()[0] ?? '9999'));
  function clearSelectedRecord() {
    setSelectedEnquiryId(null);
    const requested = query.data?.find(entry => entry.id === requestedEnquiry);
    if (requested && search === primaryEnquiry(requested, allEntries).customerName) setSearch('');
    if (embedded && requestedEnquiry) navigate(`/portal?section=notifications&workView=customers${mode === 'callbacks' ? '&deskView=callbacks' : ''}`);
  }
  function selectRecord(id: string) {
    setSelectedEnquiryId(id);
    // In-place selection keeps the queue/search; an external deep link still resolves below.
    openedEnquiry.current = id;
    if (embedded) {
      const params = new URLSearchParams({ section: 'notifications', workView: 'customers', enquiryId: id });
      if (mode === 'callbacks') params.set('deskView', 'callbacks');
      navigate(`/portal?${params}`);
    }
  }
  function openEntry(entry: Enquiry) { const primary = primaryEnquiry(entry, allEntries); if (onOpenCustomer) { onOpenCustomer(primary.id); return; } setGlobalSearch(""); setMode("history"); setSearch(primary.customerName); setFilter("all"); selectRecord(primary.id); }
  const callbackCount = callbackEntries.filter(isOutstandingCallback).length;
  const recordActions: EnquiryRecordActions = {
    canBook: bookingAccess.enabled,
    onUpdate: setWorkspaceEntry, onConversation: setConversationEntry, onMerge: entry => setMergeEntry(primaryEnquiry(entry, allEntries)), onFollowUp: entry => setFollowUpEntry({ ...entry }),
    onEmail: canEmail ? entry => { setAppointmentEmail(false); setEmailEntry(entry); } : undefined,
    onAppointmentFollowUp: canEmail ? entry => { setAppointmentEmail(true); setEmailEntry(entry); } : undefined,
    onCustomerHistory: setHistoryContact,
    onAppointment: entry => setEditing({ ...entry }), onVehicle: setInformation,
    onBook: entry => { if (!bookingAccess.enabled) return; setInitialBookingDate(undefined); setSelection(undefined); setInitial(entry); setMode("new"); setNotice("Customer details copied. Saving creates a new test-drive booking."); },
  };
  return (
    <Panel className={`enquiries-premium-workspace${mode === "history" ? " enquiry-case-mode" : ""}`}>
      {!embedded && <div className="enquiry-workspace-heading bg-[#213e61] px-5 py-4 text-white">
        <div>
        <h2 className="text-xl font-semibold">Enquiry workspace</h2>
        <p className="mt-1 text-sm text-white/75">Find a customer. Record the conversation. Arrange the next step.</p>
        </div>
        <span className="enquiry-stock-count text-xs">{stock?.cars.length ?? 0} {stock?.cars.length === 1 ? "car" : "cars"} in current stock</span>
      </div>}
      {!embedded && <Tabs value={mode === "callbacks" ? "today" : mode === "new" || mode === "stock" ? "history" : mode} onValueChange={(value) => { setMode(value as typeof mode); setGlobalSearch(""); }}>
        <TabsList aria-label="Enquiry workspace" className="enquiry-workspace-tabs flex h-auto w-full justify-start gap-1 rounded-none border-b bg-[#e8eef5] p-2">
          <TabsTrigger value="today" onClick={() => { setMode("today"); setGlobalSearch(""); }} id="desk-tab-today" aria-controls="desk-panel-today" className="min-h-11 rounded-sm px-5">Today</TabsTrigger>
          <TabsTrigger value="history" onClick={() => { setMode("history"); setGlobalSearch(""); }} id="desk-tab-history" aria-controls="desk-panel-history" className="min-h-11 rounded-sm px-5">Enquiries</TabsTrigger>
          <TabsTrigger value="calendar" onClick={() => { setMode("calendar"); setGlobalSearch(""); }} id="desk-tab-calendar" aria-controls="desk-panel-calendar" className="min-h-11 rounded-sm px-5">Calendar</TabsTrigger>
        </TabsList>
      </Tabs>}
      {mode === "history" ? <div className="enquiry-simple-toolbar" aria-label="Workspace actions">
        <label><span className="sr-only">Find a customer or car</span><Input value={search} onChange={event => { clearSelectedRecord(); setSearch(event.target.value); }} placeholder="Search name, phone, email or car" /></label>
        <Button variant="ghost" size="icon" aria-label="Refresh enquiries and stock" disabled={query.isFetching} onClick={() => { query.refetch(); directory.refetch(); reservations.refetch(); client.invalidateQueries({ queryKey: ["/api/stock"] }); }}><RefreshCw className={`h-4 w-4${query.isFetching ? " animate-spin" : ""}`} aria-hidden /></Button>
        <details className="enquiry-simple-filters"><summary>Filters &amp; tools{ownerScope !== "all" || !queues.some(queue => queue.value === filter) ? " · active" : ""}</summary><div>
          <label className={field}>Enquiry ownership<NativeSelect value={ownerScope} onChange={e => setOwnerScope(e.target.value)}><option value="all">All owners</option><option value="mine" disabled={!directory.data}>My enquiries</option><option value="unassigned">Unassigned</option></NativeSelect></label>
          <label className={field}>Show<NativeSelect value={filter} onChange={e => { setFilter(e.target.value); clearSelectedRecord(); }}><option value="all">All enquiries</option><option value="reply">Needs reply</option><option value="followups">Follow-ups</option><option value="due">Overdue follow-ups</option><option value="visits">Active test drives</option><option value="upcoming">Upcoming test drives</option><option value="today">Today’s test drives</option><option value="done">No task scheduled</option></NativeSelect></label>
          <Button variant="outline" size="sm" onClick={() => { setMode("callbacks"); setGlobalSearch(""); }}>Callbacks ({callbackCount})</Button>
          <Button variant="outline" size="sm" onClick={() => { setMode("stock"); setGlobalSearch(""); }}>Browse showroom stock</Button>
        </div></details>
      </div> : <>
      {mode !== "calendar" && <div aria-label="Workspace actions" data-record-mode={mode === "callbacks" ? "true" : "false"} className="enquiry-workspace-ribbon flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
        {!embedded && <Button id="desk-tab-new" size="sm" onClick={() => { setMode("new"); setGlobalSearch(""); if (embedded) navigate("/portal?section=notifications&workView=customers&deskView=new"); }}>New enquiry</Button>}
        <Button variant="outline" size="sm" onClick={() => { setMode("callbacks"); setGlobalSearch(""); }}>Callbacks ({callbackCount})</Button><details className="enquiry-desk-more"><summary>More tools</summary><div><Button variant="ghost" size="sm" onClick={() => { setMode("stock"); setGlobalSearch(""); }}>Browse showroom stock</Button></div></details>
        <Button className="enquiry-ribbon-refresh" variant="ghost" size="icon" aria-label="Refresh enquiries and stock" title="Refresh enquiries and stock" disabled={query.isFetching} onClick={() => { query.refetch(); directory.refetch(); reservations.refetch(); client.invalidateQueries({ queryKey: ["/api/stock"] }); }}><RefreshCw className={`h-4 w-4${query.isFetching ? " animate-spin" : ""}`} aria-hidden /></Button>
        <Button className="enquiry-ribbon-overdue" variant={dueCount ? "outline" : "ghost"} size="sm" onClick={() => { if (mode === "callbacks") { setCallbackFilter("overdue"); setCallbackSearch(""); } else { setMode("history"); setFilter("due"); setSearch(""); } setGlobalSearch(""); clearSelectedRecord(); }}>Overdue now ({dueCount})</Button>
        {mode === "callbacks" ? <>
          <label className="enquiry-ribbon-search grid min-w-0 basis-full gap-1 text-xs font-medium sm:min-w-56 sm:flex-1 sm:basis-auto"><span className="enquiry-ribbon-label">Find a callback</span><Input value={callbackSearch} onChange={event => { setCallbackSearch(event.target.value); clearSelectedRecord(); }} placeholder="Customer, contact or registration" /></label>
          <label className="enquiry-record-ribbon-filter grid min-w-0 gap-1 text-xs font-medium"><span className="enquiry-ribbon-label">Show callbacks</span><NativeSelect value={callbackFilter} onChange={event => { setCallbackFilter(event.target.value); clearSelectedRecord(); }}>
            <option value="all">All callbacks</option><option value="overdue">Overdue now</option><option value="upcoming">Upcoming</option><option value="unscheduled">Needs a time</option><option value="website">Website requests</option><option value="unassigned">Unassigned</option>
          </NativeSelect></label>
        </> : <label className="enquiry-ribbon-search grid min-w-0 basis-full gap-1 text-xs font-medium sm:min-w-56 sm:flex-1 sm:basis-auto"><span className="enquiry-ribbon-label">Search the workspace</span><Input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search customer, phone, registration or car" /></label>}
        {mode !== "new" && <label className="enquiry-ribbon-owner grid gap-1 text-xs font-medium"><span className="enquiry-ribbon-label">Enquiry ownership</span><NativeSelect value={ownerScope} onChange={e => setOwnerScope(e.target.value)}><option value="all">{mode === "callbacks" ? "All owners" : "All enquiries"}</option><option value="mine" disabled={!directory.data}>My enquiries</option><option value="unassigned">Unassigned</option></NativeSelect></label>}
      </div>}
      </>}
      <div className="enquiry-workspace-canvas space-y-5 bg-slate-100/70 p-3 sm:p-6">
        {mode !== "new" && !editing && <BookingAccessNotice access={bookingAccess} />}
        {notice && (
          <div
            role="status"
            className="enquiry-saved-notice flex gap-2 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            {notice}
          </div>
        )}
        {missingRequested && <Button variant="outline" onClick={clearSelectedRecord}>Show all enquiries</Button>}
        {globalSearch.trim() && <><Button size="sm" variant="outline" onClick={() => setGlobalSearch("")}>Clear workspace search</Button>{(query.isError || reservations.isError) && <p role="alert" className="text-sm">Some records could not be loaded. Refresh to retry.</p>}<DeskSearchResults search={globalSearch} entries={scoped} allEntries={allEntries} reservations={reservations.data?.reservations ?? []} cars={stock?.cars ?? []} onEntry={openEntry} onCar={setInformation} onContact={setHistoryContact} /></>}
        <div hidden={Boolean(globalSearch.trim())} className="enquiry-workspace-views space-y-5">
        {mode === "today" && <div role="tabpanel" id="desk-panel-today" aria-labelledby={embedded ? undefined : "desk-tab-today"} aria-label={embedded ? "Today’s customer actions" : undefined}>{query.isLoading ? <p role="status">Loading today’s work…</p> : query.isError ? <p role="alert">Today’s work could not be loaded. Refresh to retry.</p> : <><TodayDesk entries={scoped} onOpen={openEntry} /><Button variant="outline" onClick={() => setMode("callbacks")}>View callbacks ({callbackCount})</Button></>}</div>}
        <div hidden={mode !== "new"} role="tabpanel" id="desk-panel-new" aria-labelledby={embedded ? undefined : "desk-tab-new"} aria-label={embedded ? "New customer enquiry" : undefined} className="enquiry-ledger-sheet border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="enquiry-form-intro"><h3>{initialBookingDate ? "New appointment" : "New enquiry"}</h3><p>{initialBookingDate ? "Choose the car, add the customer and pick an available time." : "Record the conversation, choose a vehicle and arrange the next step."}</p>{initialBookingDate && <Button type="button" variant="outline" size="sm" onClick={() => setMode("calendar")}>Back to calendar</Button>}</div>
          {directory.isLoading ? <p role="status">Loading your workspace…</p> : <NewCall bookingAccess={bookingAccess} key={`${formKey}:${directory.data?.currentUserId ?? "unknown"}`} initial={initial} initialBookingDate={initialBookingDate} selection={selection} enquiries={query.data ?? []} reservations={reservations.data?.reservations ?? []} draftKey={draftKey} defaultOwnerId={directory.data?.currentUserId ?? ""} onDiscard={() => { setInitial(undefined); setInitialBookingDate(undefined); setSelection(undefined); setFormKey(key => key + 1); }} onSaved={saved} />}
          {(query.isError || reservations.isError) && <p className="mt-3 text-sm text-amber-900">Some customer history is unavailable. Use Refresh before assuming this is a new customer.</p>}
        </div>
        <div hidden={mode !== "stock"} role="tabpanel" id="desk-panel-stock" aria-label="Showroom stock">
          <EnquiryStockDesk onDetails={setInformation} onChoose={(car, booking) => { if (booking && !bookingAccess.enabled) return; setSelection({ id: car.id, booking }); setMode("new"); }} />
        </div>
        <div hidden={mode !== "calendar"} role="tabpanel" id="desk-panel-calendar" aria-labelledby={embedded ? undefined : "desk-tab-calendar"} aria-label={embedded ? "Test-drive calendar" : undefined}>
          {query.isLoading ? <p role="status">Loading appointments…</p> : query.isError ? <div role="alert"><p>Appointments could not be loaded.</p><Button type="button" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>Retry appointments</Button></div> : <EnquiryCalendar entries={scoped} allEntries={allEntries} cars={stock?.cars ?? []} ownerScope={ownerScope} onOwnerScopeChange={setOwnerScope} canChooseMine={Boolean(directory.data)} onAdd={bookingAccess.enabled ? date => { setInitial(undefined); setInitialBookingDate(date); setSelection(undefined); setFormKey(key => key + 1); setMode("new"); setGlobalSearch(""); setNotice(`New appointment for ${bookingDateLabel(date)}. Choose an available time before saving.`); } : undefined} onRefresh={() => { query.refetch(); directory.refetch(); }} refreshing={query.isFetching} onOpen={openEntry} onEdit={setEditing} onVehicle={id => { const car = stock?.cars.find(car => car.id === id); if (car) setInformation(car); else setNotice("This car is no longer in current stock. Its appointment details are retained in the calendar."); }} />}
        </div>
        {mode === "callbacks" && <div role="tabpanel" id="desk-panel-callbacks" aria-label="Callbacks">{query.isLoading ? <p role="status">Loading callbacks…</p> : query.isError ? <p role="alert">Callbacks could not be loaded. Refresh to retry.</p> : missingRequested ? null : <CallbacksDesk search={callbackSearch} filter={callbackFilter} entries={callbackEntries} allEntries={allEntries} cars={stock?.cars ?? []} selectedId={selectedEnquiryId} onSelect={selectRecord} onBack={clearSelectedRecord} actions={recordActions} includeUnassigned={ownerScope === "mine"} />}</div>}
        {mode === "history" && (
          <div role="tabpanel" id="desk-panel-history" aria-labelledby={embedded ? undefined : "desk-tab-history"} aria-label={embedded ? "Customer enquiries" : undefined} className="enquiry-ledger-sheet enquiry-record-sheet enquiry-history-sheet border border-slate-200 bg-white">
            <div className="enquiry-queue-nav" role="group" aria-label="Filter enquiries by next step">{queues.map(queue => <button type="button" key={queue.value} data-tone={queue.tone} aria-pressed={filter === queue.value} onClick={() => { setFilter(queue.value); clearSelectedRecord(); }}>{queue.label}<span>{roots.filter(entry => queue.value === "done" ? enquiryGroup(entry, allEntries).every(original => matchesQueue(original, queue.value)) : enquiryGroup(entry, allEntries).some(original => matchesQueue(original, queue.value))).length}</span></button>)}</div>

            {query.isLoading && <p role="status">Loading enquiries…</p>}
            {query.isError && <p role="alert">Enquiries could not be loaded. Use Refresh to try again.</p>}
            {!query.isLoading && !query.isError && !missingRequested && <EnquiryRecordBrowser entries={entries} allEntries={allEntries} cars={stock?.cars ?? []} selectedId={selectedEnquiryId} onSelect={selectRecord} onBack={clearSelectedRecord} actions={recordActions} />}
          </div>
        )}
      </div>
      </div>
      {mergeEntry && <EnquiryMergeDialog entry={mergeEntry} entries={allEntries} onClose={() => setMergeEntry(null)} onRefresh={async () => { const fresh = await query.refetch(); if (fresh.error || !fresh.data) throw fresh.error ?? new Error("Enquiries unavailable"); return fresh.data; }} onSaved={async result => {
        setMergeEntry(null); setMode("history"); setOwnerScope("all"); setFilter("all"); setGlobalSearch(""); setSearch(""); selectRecord(result.primaryId);
        setNotice(`${result.recordIds.length} records merged into one case. ${result.cancelledAppointmentIds.length ? `${result.cancelledAppointmentIds.length} appointments cancelled.` : "All active appointments retained."}`);
        await Promise.all([client.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }), client.invalidateQueries({ queryKey: getGetTestDriveBookingsQueryKey() }), client.invalidateQueries({ predicate: item => String(item.queryKey[0]).endsWith("/availability") })]);
      }} />}
      {conversationEntry && <ConversationEditor entry={conversationEntry} onClose={() => setConversationEntry(null)} onSaved={async entry => { client.setQueryData(enquirySummaryKey(), (current: Enquiry[] | undefined) => current?.map(item => item.id === entry.id ? entry : item)); setConversationEntry(null); setSelectedEnquiryId(mode === "callbacks" ? entry.id : primaryEnquiry(entry, allEntries).id); setNotice(`${entry.customerName}: conversation saved.`); await Promise.all([query.refetch(), client.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }), client.invalidateQueries({ queryKey: getGetTestDriveBookingsQueryKey() })]); }} />}
      {emailEntry && <EnquiryEmailComposer entry={emailEntry} suggestedContent={appointmentEmail ? appointmentFollowUpEmail(emailEntry, stock?.cars.find(car => car.id === emailEntry.vehicleId), deskSettings.identity.name) : undefined} onClose={() => { setEmailEntry(null); setAppointmentEmail(false); }} />}
      {workspaceEntry && <WorkspaceEditor entry={workspaceEntry} onClose={() => setWorkspaceEntry(null)} />}
      {historyContact && <Dialog open onOpenChange={open => { if (!open) setHistoryContact(null); }}><DialogContent className="portal-action-dialog portal-action-dialog-wide enquiry-action-dialog max-w-2xl"><DialogHeader><DialogTitle>{historyContact.customerName} — customer history</DialogTitle><DialogDescription>Enquiries, appointments and reservations matched by contact details.</DialogDescription></DialogHeader><CustomerHistory contact={historyContact} enquiries={query.data ?? []} reservations={reservations.data?.reservations ?? []} />{(query.isError || reservations.isError) && <p role="alert">Some records could not be loaded. Refresh to retry.</p>}</DialogContent></Dialog>}
      {information && (
        <EnquiryVehicleInformation
          car={information}
          onClose={() => setInformation(null)}
        />
      )}
      {followUpEntry && (
        <FollowUpEditor
          entry={followUpEntry}
          onClose={() => setFollowUpEntry(null)}
          onSaved={async (entry) => {
            setFollowUpEntry(null);
            setNotice(
              `${entry.customerName}: ${entry.followUpCompletedAt ? "follow-up completed" : entry.followUpAt ? "follow-up scheduled" : "follow-up removed"}.`,
            );
            await query.refetch();
          }}
        />
      )}
      {editing && (
        <AppointmentEditor
          booking={editing}
          bookingAccess={bookingAccess}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </Panel>
  );
}
