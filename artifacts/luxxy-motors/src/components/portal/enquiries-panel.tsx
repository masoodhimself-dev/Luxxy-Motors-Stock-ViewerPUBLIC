import { AppointmentExceptionLabels, EnquiryCalendar } from "./enquiry-calendar";
import { EnquiryPhotoPeek } from "./enquiry-photo-peek";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnquiryStockDesk } from "./enquiry-stock-desk";
import { EnquiryVehicleInformation } from "./enquiry-vehicle-information";
import { Link, useSearch } from 'wouter';
import {
  FollowUpEditor,
  FollowUpFields,
  followUpIso,
  followUpLocal,
} from "./enquiry-follow-up";
import { bookingPressure, validStaffAppointmentDateTime, withinBookingHours } from "../../../../api-server/src/lib/booking-slots";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEnquiries,
  useGetStaffDirectory,
  useListReservations,
  getListReservationsQueryKey,
  type StaffOnlineReservation,
  useCreateStaffEnquiry,
  useChangeStaffAppointment,
  useGetEnquiryAvailability,
  useGetStaffAppointmentAvailability,
  getGetStaffAppointmentAvailabilityQueryKey,
  getGetEnquiriesQueryKey,
  getGetTestDriveBookingsQueryKey,
  getGetEnquiryAvailabilityQueryKey,
  type Enquiry,
} from "@workspace/api-client-react";
import {
  Search,
  Phone,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
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
  availableBookingDates,
  bookingDateLabel,
  appointmentLabel,
  defaultBookingSettings,
  londonDate,
} from "@/lib/test-drive-dates";
import { formatPrice, vehicleDisplayTitle, vehicleRegistrationLabel } from "@/lib/utils";
import { Panel, PanelHeader } from "./portal-ui";

import { callOutcomes, readCallDraft, saveCallDraft, removeCallDraft, type CallOutcome, type CallDraft } from "@/lib/enquiry-desk-model";
import { OwnerSelect, WorkspaceEditor, TodayDesk, CustomerHistory, type Contact } from "./enquiry-workspace-tools";
import { VehicleDeskContext, DeskSearchResults } from "./enquiry-desk-context";
import { ConversationEditor } from "./enquiry-conversation";
import { EnquiryMergeDialog } from "./enquiry-merge";
import { enquiryGroup, enquiryGroupSearchText, enquiryRootRecords, primaryEnquiry } from "@/lib/enquiry-groups";
import { EnquiryRecordBrowser, type EnquiryRecordActions } from "./enquiry-record-browser";
import { CallbacksDesk } from "./enquiry-callbacks";
import { isOutstandingCallback } from "./enquiry-callback-model";
import "./enquiries-workspace.css";

const field = "enquiry-field grid gap-1.5 text-sm font-medium";
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

function Slots({
  bookingId,
  value,
  onChange,
}: {
  bookingId?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { settings, isLoading, isError } = useDealerSettings();
  const config = settings.testDriveBooking ?? defaultBookingSettings;
  const dates = availableBookingDates(config);
  const [date, setDate] = useState(dates[0] ?? londonDate());
  const publicQuery = useGetEnquiryAvailability(
    { date },
    {
      query: {
        queryKey: getGetEnquiryAvailabilityQueryKey({ date }),
        enabled:
          !bookingId &&
          !isLoading &&
          !isError &&
          config.enabled &&
          dates.includes(date),
        refetchInterval: 30_000,
        staleTime: 0,
      },
    },
  );
  const staffQuery = useGetStaffAppointmentAvailability(
    bookingId ?? "",
    { date },
    {
      query: {
        queryKey: getGetStaffAppointmentAvailabilityQueryKey(bookingId ?? "", {
          date,
        }),
        enabled:
          Boolean(bookingId) &&
          !isLoading &&
          !isError &&
          config.enabled &&
          dates.includes(date),
        refetchInterval: 30_000,
        staleTime: 0,
      },
    },
  );
  const query = bookingId ? staffQuery : publicQuery;
  useEffect(() => {
    if (
      value &&
      query.data &&
      !query.data.slots.some((slot) => slot.available && slot.startAt === value)
    )
      onChange("");
  }, [query.data, value, onChange]);
  if (isLoading) return <p role="status">Loading booking hours…</p>;
  if (isError)
    return (
      <p role="alert">
        Booking settings could not be loaded. Refresh before booking.
      </p>
    );
  if (!config.enabled)
    return <p>Test-drive scheduling is switched off in Settings.</p>;
  return (
    <div className="enquiry-slots space-y-3">
      <label className={field}>
        Appointment date
        <NativeSelect
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            onChange("");
          }}
        >
          {dates.map((day) => (
            <option key={day} value={day}>
              {bookingDateLabel(day)}
            </option>
          ))}
        </NativeSelect>
      </label>
      <p className="text-xs text-muted-foreground">
        UK time · {config.durationMinutes} minutes
        {config.confirmationMode === "approval"
          ? " · Staff approval required after saving"
          : ""}
      </p>
      {query.isError ? (
        <div role="alert">
          Could not load times.{" "}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
          >
            Retry times
          </Button>
        </div>
      ) : query.isLoading ? (
        <p role="status">Checking available times…</p>
      ) : (
        <div
          className="flex flex-wrap gap-2"
          aria-label="Available appointment times"
        >
          {query.data?.slots
            .filter((slot) => slot.available)
            .map((slot) => (
              <Button
                key={slot.startAt}
                type="button"
                size="sm"
                variant={value === slot.startAt ? "default" : "outline"}
                aria-pressed={value === slot.startAt}
                onClick={() => onChange(slot.startAt)}
              >
                {slot.label}
              </Button>
            ))}
          {!query.data?.slots.some((slot) => slot.available) && (
            <p className="text-sm text-muted-foreground">
              No times available. Choose another date.
            </p>
          )}
        </div>
      )}
      {value &&
        query.data &&
        !query.data.slots.some(
          (slot) => slot.available && slot.startAt === value,
        ) && (
          <p role="alert" className="text-sm text-destructive">
            That time is no longer available. Choose another.
          </p>
        )}
    </div>
  );
}

function StaffAppointmentPicker({ bookingId, time, onTime, manual, onManual, allowOutsideHours, onOutsideHours, allowDoubleBooking, onDoubleBooking }: {
  bookingId?: string;
  time: string; onTime: (value: string) => void;
  manual: boolean; onManual: (value: boolean) => void;
  allowOutsideHours: boolean; onOutsideHours: (value: boolean) => void;
  allowDoubleBooking: boolean; onDoubleBooking: (value: boolean) => void;
}) {
  const [local, setLocal] = useState(time ? followUpLocal(time) : "");
  const { settings } = useDealerSettings();
  const policy = settings.testDriveBooking ?? defaultBookingSettings;
  const query = useGetEnquiries(undefined, { query: { queryKey: getGetEnquiriesQueryKey(), refetchInterval: 30_000 } });
  const appointment = time ? new Date(time) : null;
  const occupied = (query.data ?? []).filter(item => item.appointmentAt && !item.appointmentCancelledAt).map(item => ({ id: item.id, appointmentAt: new Date(item.appointmentAt!), appointmentDurationMinutes: item.appointmentDurationMinutes, appointmentBufferMinutes: item.appointmentBufferMinutes }));
  const outside = appointment && validStaffAppointmentDateTime(appointment) && !withinBookingHours(appointment, policy);
  const pressure = appointment && validStaffAppointmentDateTime(appointment) ? bookingPressure(appointment, policy, occupied, bookingId) : null;
  return <div className="enquiry-appointment-picker space-y-3 border-t border-border pt-4">
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant={!manual ? "default" : "outline"} aria-pressed={!manual} onClick={() => { setLocal(""); onManual(false); onTime(""); onOutsideHours(false); onDoubleBooking(false); }}>Available slots</Button>
      <Button type="button" size="sm" variant={manual ? "default" : "outline"} aria-pressed={manual} onClick={() => { setLocal(""); onManual(true); onTime(""); }}>Choose a specific UK time</Button>
    </div>
    {manual ? <>
      <label className={field}>Staff appointment date and time (UK)
        <Input type="datetime-local" step={900} value={local} onChange={event => { setLocal(event.target.value); onTime(followUpIso(event.target.value) ?? ""); }} />
      </label>
      {local && !time && <p role="alert" className="text-sm text-destructive">Choose a valid UK date and time in 15-minute steps.</p>}
      <fieldset className="enquiry-booking-exceptions space-y-2 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <legend className="px-1 font-semibold">Staff booking exceptions</legend>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={allowOutsideHours} onChange={event => onOutsideHours(event.target.checked)} />Allow outside normal booking hours or a closed date</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={allowDoubleBooking} onChange={event => onDoubleBooking(event.target.checked)} />Allow overlapping appointments or a full day</label>
        {outside && <p>Selected time is outside normal booking hours. The first exception must be checked.</p>}
        {pressure?.overlapping && <p>Another appointment overlaps this time. This will be marked as double booked.</p>}
        {pressure?.overCapacity && <p>Daily capacity has been reached. This will be marked as over capacity.</p>}
        {query.isError && <p>Other bookings could not be checked here. The server will check again before saving.</p>}
      </fieldset>
    </> : <Slots bookingId={bookingId} value={time} onChange={onTime} />}
  </div>;
}

function AppointmentConflicts({ time, bookingId }: { time: string; bookingId?: string }) {
  const query = useGetEnquiries();
  const { settings } = useDealerSettings();
  const at = new Date(time);
  if (!validStaffAppointmentDateTime(at)) return null;
  const clashes = (query.data ?? []).filter(entry => entry.appointmentAt && !entry.appointmentCancelledAt && bookingPressure(at, settings.testDriveBooking ?? defaultBookingSettings, [{ ...entry, appointmentAt: new Date(entry.appointmentAt) }], bookingId).overlapping);
  return <div className="text-sm">{query.isLoading ? <p>Checking the diary…</p> : query.isError ? <p role="alert">The diary could not be loaded. Refresh before overriding a booking.</p> : clashes.length ? <><p className="font-semibold">Appointments already at this time</p><ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">{clashes.map(entry => <li key={entry.id} className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-950"><p className="font-semibold">{entry.vehicleTitle} · {entry.reference}</p><p>{appointmentLabel(entry.appointmentAt!)} · {entry.appointmentDurationMinutes ?? 30} minutes</p><p>Staff: {entry.assignedToName || 'Unassigned'} · {entry.customerName}</p></li>)}</ul></> : <p>No overlapping appointments currently shown. Capacity is checked again when saving.</p>}</div>;
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
  selection,
  enquiries, reservations, draftKey, defaultOwnerId, onDiscard,
  onSaved,
}: {
  enquiries: Enquiry[]; reservations: StaffOnlineReservation[]; draftKey: string | null; defaultOwnerId: string; onDiscard: () => void;
  initial?: Enquiry;
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
  const [booking, setBooking] = useState(initial ? true : restored?.booking ?? false);
  const [time, setTime] = useState(restored?.time ?? "");
  const [manualTime, setManualTime] = useState(restored?.manualTime ?? false);
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
      <fieldset disabled={mutation.isPending} className="enquiry-form-section enquiry-vehicle-section min-w-0 space-y-4">
        <legend className="mb-4 font-semibold">1. Vehicle information</legend>
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
                  placeholder="Make, model, registration or advert reference"
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
                <VehicleDeskContext car={car} />
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
                  No matching cars. Try a model or advert reference.
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
      <fieldset disabled={mutation.isPending} className="enquiry-form-section enquiry-caller-section min-w-0 space-y-4">
        <legend className="mb-4 font-semibold">2. Customer and call notes</legend>
        <label className={field}>
          Customer name
          <Input
            required
            minLength={2}
            maxLength={120}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="enquiry-contact-fields grid gap-4 sm:grid-cols-2">
          <label className={field}>
            Phone number
            <Input
              required
              type="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className={field}>
            Email (optional)
            <Input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>
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
        <OwnerSelect value={assignedToId} onChange={setAssignedToId} />
        <CustomerHistory contact={{ customerName: name, phone, email }} enquiries={enquiries} reservations={reservations} compact onReuse={contact => { setName(contact.customerName); setPhone(contact.phone ?? ""); setEmail(contact.email ?? ""); }} />
      </fieldset>
      <fieldset disabled={mutation.isPending} className="enquiry-form-section enquiry-action-section min-w-0 space-y-4">
        <legend className="mb-4 font-semibold">3. Next step</legend>
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
              disabled={vehicleMode !== "stock"}
              onChange={() => setBooking(true)}
              className="h-5 w-5 accent-primary"
            />
            Book a test drive
          </label>
          {vehicleMode !== "stock" && (
            <p className="text-xs text-muted-foreground">
              A test drive needs an available showroom stock car. You can
              request a follow-up for any enquiry.
            </p>
          )}
        </fieldset>
        {booking &&
          (car && available(car) ? (
            <StaffAppointmentPicker time={time} onTime={setTime} manual={manualTime} onManual={setManualTime} allowOutsideHours={allowOutsideHours} onOutsideHours={setAllowOutsideHours} allowDoubleBooking={allowDoubleBooking} onDoubleBooking={setAllowDoubleBooking} />
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
        {!booking && <label className={field}>Call outcome<NativeSelect value={outcome} onChange={e => setOutcome(e.target.value)}>{Object.entries(callOutcomes).filter(([value]) => value !== "test_drive_booked").map(([value,label]) => <option key={value} value={value} disabled={value === "callback_requested" && !followUp}>{label}</option>)}</NativeSelect></label>}
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
            ? "A confirmation will be emailed using the dealership’s configured email service."
            : "No email supplied: confirm the details with the caller. No customer email or reminder will be sent."}
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
            (booking && (isLoading || Boolean(error))) ||
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
      {reviewException && time && <StaffExceptionReview time={time} outside={allowOutsideHours} double={allowDoubleBooking} onClose={() => setReviewException(false)} onConfirm={() => { setReviewException(false); void submit(undefined, true); }} />}
    </form>
  );
}

function AppointmentEditor({
  booking,
  onClose,
  onSaved,
}: {
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
    if (!cancelling && !time) return;
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
            {booking.customerName} · {booking.reference}
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
        ) : (
          <StaffAppointmentPicker bookingId={booking.id} time={time} onTime={setTime} manual={manualTime} onManual={setManualTime} allowOutsideHours={allowOutsideHours} onOutsideHours={setAllowOutsideHours} allowDoubleBooking={allowDoubleBooking} onDoubleBooking={setAllowDoubleBooking} />
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
            disabled={mutation.isPending || (!cancelling && !time)}
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
        {reviewException && time && <StaffExceptionReview time={time} bookingId={booking.id} outside={allowOutsideHours} double={allowDoubleBooking} onClose={() => setReviewException(false)} onConfirm={() => { setReviewException(false); void save(true); }} />}
      </DialogContent>
    </Dialog>
  );
}

export function EnquiriesPanel() {
  const routeSearch = useSearch();
  const requestedEnquiry = new URLSearchParams(routeSearch).get('enquiryId');
  const openedEnquiry = useRef<string | null>(null);
  const [mode, setMode] = useState<"new" | "history" | "stock" | "calendar" | "today" | "callbacks">("new");
  const [globalSearch, setGlobalSearch] = useState("");
  const [ownerScope, setOwnerScope] = useState("all");
  const [workspaceEntry, setWorkspaceEntry] = useState<Enquiry | null>(null);
  const [conversationEntry, setConversationEntry] = useState<Enquiry | null>(null);
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
  const [selection, setSelection] = useState<{ id: string; booking: boolean }>();
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<Enquiry | null>(null);
  const client = useQueryClient();
  const query = useGetEnquiries(undefined, {
    query: { queryKey: getGetEnquiriesQueryKey(), refetchInterval: 30_000 },
  });
  const { stock } = useStock();
  useEffect(() => {
    if (!requestedEnquiry) { openedEnquiry.current = null; return; }
    if (!query.data || openedEnquiry.current === requestedEnquiry) return;
    const requested = query.data.find(item => item.id === requestedEnquiry);
    const entry = requested ? primaryEnquiry(requested, query.data) : undefined;
    openedEnquiry.current = requestedEnquiry;
    setMode('history'); setOwnerScope('all'); setFilter('all'); setGlobalSearch('');
    if (entry) { setSearch(entry.reference); setSelectedEnquiryId(entry.id); setNotice(''); }
    else { setSearch(''); setNotice('This enquiry could not be found. Refresh or search by customer details.'); }
  }, [requestedEnquiry, query.data]);
  async function saved(entry: Enquiry) {
    setEditing(null);
    setInitial(undefined);
    setSelection(undefined);
    setFormKey((key) => key + 1);
    setNotice(
      `${entry.reference} saved — ${entry.appointmentCancelledAt ? "appointment cancelled" : entry.appointmentAt ? `${status(entry)}: ${appointmentLabel(entry.appointmentAt)}` : "phone enquiry recorded"}.${entry.customerNotificationStatus === "failed" ? " Customer email failed; confirm by phone." : ""}`,
    );
    setMode("history");
    setGlobalSearch("");
    setOwnerScope("all");
    const primary = primaryEnquiry(entry, query.data ?? []);
    setSearch(primary.reference);
    setSelectedEnquiryId(primary.id);
    setFilter("all");
    await Promise.all([
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
  const entries = enquiryRootRecords(allEntries)
    .filter(entry => enquiryGroup(entry, allEntries).some(original => scoped.some(item => item.id === original.id)))
    .filter(entry => contains(enquiryGroupSearchText(entry, allEntries), search) && enquiryGroup(entry, allEntries).some(original =>
      filter === "all" || (filter === "followups" ? Boolean(original.followUpAt && !original.followUpCompletedAt)
        : filter === "due" ? Boolean(original.followUpAt && !original.followUpCompletedAt && Date.parse(original.followUpAt) <= Date.now())
        : filter === "upcoming" ? Boolean(original.appointmentAt && !original.appointmentCancelledAt && Date.parse(original.appointmentAt) > Date.now())
        : Boolean(original.appointmentAt && !original.appointmentCancelledAt && londonDate(new Date(original.appointmentAt)) === londonDate()))))
    .sort((a, b) => ["due", "followups"].includes(filter)
      ? (enquiryGroup(a, allEntries).filter(item => item.followUpAt && !item.followUpCompletedAt).map(item => item.followUpAt!).sort()[0] ?? "").localeCompare(enquiryGroup(b, allEntries).filter(item => item.followUpAt && !item.followUpCompletedAt).map(item => item.followUpAt!).sort()[0] ?? "")
      : 0);
  function openEntry(entry: Enquiry) { const primary = primaryEnquiry(entry, allEntries); setGlobalSearch(""); setMode("history"); setSearch(primary.reference); setFilter("all"); setSelectedEnquiryId(primary.id); }
  const callbackCount = callbackEntries.filter(isOutstandingCallback).length;
  const recordActions: EnquiryRecordActions = {
    onUpdate: setWorkspaceEntry, onConversation: setConversationEntry, onMerge: entry => setMergeEntry(primaryEnquiry(entry, allEntries)), onFollowUp: entry => setFollowUpEntry({ ...entry }),
    onAppointment: entry => setEditing({ ...entry }), onVehicle: setInformation,
    onBook: entry => { setSelection(undefined); setInitial(entry); setMode("new"); setNotice("Customer details copied. Saving creates a new test-drive booking."); },
  };
  return (
    <Panel className="enquiries-premium-workspace">
      <div className="enquiry-workspace-heading bg-[#213e61] px-5 py-4 text-white">
        <div>
        <h2 className="text-xl font-semibold">Enquiry workspace</h2>
        <p className="mt-1 text-sm text-white/75">Calls, cars and appointments · Showroom desk</p>
        </div>
        <span className="enquiry-stock-count text-xs">{stock?.cars.length ?? 0} {stock?.cars.length === 1 ? "car" : "cars"} in current stock</span>
      </div>
      <Tabs value={mode} onValueChange={(value) => { setMode(value as typeof mode); setGlobalSearch(""); }}>
        <TabsList aria-label="Enquiry workspace" className="enquiry-workspace-tabs flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-[#e8eef5] p-2">
          <TabsTrigger value="today" id="desk-tab-today" aria-controls="desk-panel-today" className="min-h-11 rounded-sm px-5">Today</TabsTrigger>
          <TabsTrigger value="new" id="desk-tab-new" aria-controls="desk-panel-new" className="min-h-11 rounded-sm px-5">New call</TabsTrigger>
          <TabsTrigger value="callbacks" id="desk-tab-callbacks" aria-controls="desk-panel-callbacks" className="min-h-11 rounded-sm px-5">Callbacks ({callbackCount})</TabsTrigger>
          <TabsTrigger value="stock" id="desk-tab-stock" aria-controls="desk-panel-stock" className="min-h-11 rounded-sm px-5">All cars</TabsTrigger>
          <TabsTrigger value="calendar" id="desk-tab-calendar" aria-controls="desk-panel-calendar" className="min-h-11 rounded-sm px-5">Calendar</TabsTrigger>
          <TabsTrigger value="history" id="desk-tab-history" aria-controls="desk-panel-history" className="min-h-11 rounded-sm px-5">Find enquiry or appointment</TabsTrigger>
        </TabsList>
      </Tabs>
      <div aria-label="Workspace actions" data-record-mode={mode === "history" || mode === "callbacks" ? "true" : "false"} className="enquiry-workspace-ribbon flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
        <Button variant="outline" size="sm" aria-label="Refresh enquiries and stock" disabled={query.isFetching} onClick={() => { query.refetch(); directory.refetch(); reservations.refetch(); client.invalidateQueries({ queryKey: ["/api/stock"] }); }}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        <Button variant="outline" size="sm" onClick={() => { if (mode === "callbacks") { setCallbackFilter("overdue"); setCallbackSearch(""); } else { setMode("history"); setFilter("due"); setSearch(""); } setGlobalSearch(""); setSelectedEnquiryId(null); }}>Overdue now ({dueCount})</Button>
        {mode === "history" ? <>
          <label className="grid min-w-0 basis-full gap-1 text-xs font-medium sm:min-w-56 sm:flex-1 sm:basis-auto"><span className="enquiry-ribbon-label">Find a customer or car</span><Input value={search} onChange={event => { setSearch(event.target.value); setSelectedEnquiryId(null); }} placeholder="Name, phone, email, reference or car" /></label>
          <label className="enquiry-record-ribbon-filter grid min-w-0 gap-1 text-xs font-medium"><span className="enquiry-ribbon-label">Show</span><NativeSelect value={filter} onChange={event => { setFilter(event.target.value); setSelectedEnquiryId(null); }}>
            <option value="all">All enquiries</option><option value="upcoming">Upcoming test drives</option><option value="today">Today’s test drives</option><option value="followups">Follow-ups</option><option value="due">Overdue follow-ups</option>
          </NativeSelect></label>
        </> : mode === "callbacks" ? <>
          <label className="grid min-w-0 basis-full gap-1 text-xs font-medium sm:min-w-56 sm:flex-1 sm:basis-auto"><span className="enquiry-ribbon-label">Find a callback</span><Input value={callbackSearch} onChange={event => { setCallbackSearch(event.target.value); setSelectedEnquiryId(null); }} placeholder="Customer, contact, registration or reference" /></label>
          <label className="enquiry-record-ribbon-filter grid min-w-0 gap-1 text-xs font-medium"><span className="enquiry-ribbon-label">Show callbacks</span><NativeSelect value={callbackFilter} onChange={event => { setCallbackFilter(event.target.value); setSelectedEnquiryId(null); }}>
            <option value="all">All callbacks</option><option value="overdue">Overdue now</option><option value="upcoming">Upcoming</option><option value="unscheduled">Needs a time</option><option value="website">Website requests</option><option value="unassigned">Unassigned</option>
          </NativeSelect></label>
        </> : <label className="grid min-w-0 basis-full gap-1 text-xs font-medium sm:min-w-56 sm:flex-1 sm:basis-auto"><span className="enquiry-ribbon-label">Search the workspace</span><Input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search customer, phone, registration, car or reference" /></label>}
        <label className="grid gap-1 text-xs font-medium"><span className="enquiry-ribbon-label">Enquiry ownership</span><NativeSelect value={ownerScope} onChange={e => setOwnerScope(e.target.value)}><option value="all">{mode === "history" || mode === "callbacks" ? "All owners" : "All enquiries"}</option><option value="mine" disabled={!directory.data}>My enquiries</option><option value="unassigned">Unassigned</option></NativeSelect></label>
      </div>
      <div className="enquiry-workspace-canvas space-y-5 bg-slate-100/70 p-3 sm:p-6">
        {notice && (
          <div
            role="status"
            className="enquiry-saved-notice flex gap-2 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            {notice}
          </div>
        )}
        {globalSearch.trim() && <><Button size="sm" variant="outline" onClick={() => setGlobalSearch("")}>Clear workspace search</Button>{(query.isError || reservations.isError) && <p role="alert" className="text-sm">Some records could not be loaded. Refresh to retry.</p>}<DeskSearchResults search={globalSearch} entries={scoped} allEntries={allEntries} reservations={reservations.data?.reservations ?? []} cars={stock?.cars ?? []} onEntry={openEntry} onCar={setInformation} onContact={setHistoryContact} /></>}
        <div hidden={Boolean(globalSearch.trim())} className="enquiry-workspace-views space-y-5">
        {mode === "today" && <div role="tabpanel" id="desk-panel-today" aria-labelledby="desk-tab-today">{query.isLoading ? <p role="status">Loading today’s work…</p> : query.isError ? <p role="alert">Today’s work could not be loaded. Refresh to retry.</p> : <TodayDesk entries={scoped} onOpen={openEntry} />}</div>}
        <div hidden={mode !== "new"} role="tabpanel" id="desk-panel-new" aria-labelledby="desk-tab-new" className="enquiry-ledger-sheet border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {directory.isLoading ? <p role="status">Loading your workspace…</p> : <NewCall key={`${formKey}:${directory.data?.currentUserId ?? "unknown"}`} initial={initial} selection={selection} enquiries={query.data ?? []} reservations={reservations.data?.reservations ?? []} draftKey={draftKey} defaultOwnerId={directory.data?.currentUserId ?? ""} onDiscard={() => { setInitial(undefined); setSelection(undefined); setFormKey(key => key + 1); }} onSaved={saved} />}
          {(query.isError || reservations.isError) && <p className="mt-3 text-sm text-amber-900">Some customer history is unavailable. Use Refresh before assuming this is a new customer.</p>}
        </div>
        <div hidden={mode !== "stock"} role="tabpanel" id="desk-panel-stock" aria-labelledby="desk-tab-stock">
          <EnquiryStockDesk onDetails={setInformation} onChoose={(car, booking) => { setSelection({ id: car.id, booking }); setMode("new"); }} />
        </div>
        <div hidden={mode !== "calendar"} role="tabpanel" id="desk-panel-calendar" aria-labelledby="desk-tab-calendar">
          {query.isLoading ? <p role="status">Loading appointments…</p> : query.isError ? <p role="alert">Appointments could not be loaded. Use Refresh to try again.</p> : <EnquiryCalendar entries={scoped} allEntries={allEntries} onOpen={openEntry} onEdit={setEditing} onVehicle={id => { const car = stock?.cars.find(car => car.id === id); if (car) setInformation(car); else setNotice("This car is no longer in current stock. Its appointment details are retained in the calendar."); }} />}
        </div>
        {mode === "callbacks" && <div role="tabpanel" id="desk-panel-callbacks" aria-labelledby="desk-tab-callbacks">{query.isLoading ? <p role="status">Loading callbacks…</p> : query.isError ? <p role="alert">Callbacks could not be loaded. Refresh to retry.</p> : <CallbacksDesk search={callbackSearch} filter={callbackFilter} entries={callbackEntries} allEntries={allEntries} cars={stock?.cars ?? []} selectedId={selectedEnquiryId} onSelect={setSelectedEnquiryId} onBack={() => setSelectedEnquiryId(null)} actions={recordActions} includeUnassigned={ownerScope === "mine"} />}</div>}
        {mode === "history" && (
          <div role="tabpanel" id="desk-panel-history" aria-labelledby="desk-tab-history" className="enquiry-ledger-sheet enquiry-record-sheet enquiry-history-sheet border border-slate-200 bg-white">

            {query.isLoading && <p role="status">Loading enquiries…</p>}
            {query.isError && <p role="alert">Enquiries could not be loaded. Use Refresh to try again.</p>}
            {!query.isLoading && !query.isError && <EnquiryRecordBrowser entries={entries} allEntries={allEntries} cars={stock?.cars ?? []} selectedId={selectedEnquiryId} onSelect={setSelectedEnquiryId} onBack={() => setSelectedEnquiryId(null)} actions={recordActions} />}
          </div>
        )}
      </div>
      </div>
      {mergeEntry && <EnquiryMergeDialog entry={mergeEntry} entries={allEntries} onClose={() => setMergeEntry(null)} onRefresh={async () => { const fresh = await query.refetch(); if (fresh.error || !fresh.data) throw fresh.error ?? new Error("Enquiries unavailable"); return fresh.data; }} onSaved={async result => {
        setMergeEntry(null); setMode("history"); setOwnerScope("all"); setFilter("all"); setGlobalSearch(""); setSearch(""); setSelectedEnquiryId(result.primaryId);
        setNotice(`${result.recordIds.length} records merged into one case. ${result.cancelledAppointmentIds.length ? `${result.cancelledAppointmentIds.length} appointments cancelled.` : "All active appointments retained."}`);
        await Promise.all([client.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }), client.invalidateQueries({ queryKey: getGetTestDriveBookingsQueryKey() }), client.invalidateQueries({ predicate: item => String(item.queryKey[0]).endsWith("/availability") })]);
      }} />}
      {conversationEntry && <ConversationEditor entry={conversationEntry} onClose={() => setConversationEntry(null)} onSaved={async entry => { client.setQueryData(getGetEnquiriesQueryKey(), (current: Enquiry[] | undefined) => current?.map(item => item.id === entry.id ? entry : item)); setConversationEntry(null); setSelectedEnquiryId(mode === "callbacks" ? entry.id : primaryEnquiry(entry, allEntries).id); setNotice(`${entry.reference}: conversation saved.`); await Promise.all([query.refetch(), client.invalidateQueries({ queryKey: getGetTestDriveBookingsQueryKey() })]); }} />}
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
              `${entry.reference}: ${entry.followUpCompletedAt ? "follow-up completed" : entry.followUpAt ? "follow-up scheduled" : "follow-up removed"}.`,
            );
            await query.refetch();
          }}
        />
      )}
      {editing && (
        <AppointmentEditor
          booking={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </Panel>
  );
}
