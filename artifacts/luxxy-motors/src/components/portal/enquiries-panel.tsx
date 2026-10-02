import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnquiryStockDesk } from "./enquiry-stock-desk";
import { EnquiryVehicleInformation } from "./enquiry-vehicle-information";
import {
  FollowUpEditor,
  FollowUpFields,
  followUpIso,
} from "./enquiry-follow-up";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEnquiries,
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
  CalendarDays,
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
import { formatPrice, vehicleDisplayTitle } from "@/lib/utils";
import { Panel, PanelHeader, Chip } from "./portal-ui";

const field = "grid gap-1.5 text-sm font-medium";
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
    <div className="space-y-3">
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

function CarSummary({ car }: { car: Car }) {
  return (
    <div className="flex items-center gap-3">
      {car.heroImage && (
        <img
          src={car.heroImage}
          alt=""
          className="h-16 w-24 shrink-0 rounded-sm object-cover"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      )}
      <div className="min-w-0">
        <p className="font-semibold leading-5">{vehicleDisplayTitle(car)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {[
            car.year,
            car.plate || car.vrm || car.registration,
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
  onSaved,
}: {
  initial?: Enquiry;
  selection?: { id: string; booking: boolean };
  onSaved: (booking: Enquiry) => void;
}) {
  const { stock, isLoading, error } = useStock();
  const [vehicleMode, setVehicleMode] = useState<"stock" | "adhoc" | "none">(
    "stock",
  );
  const [adHocTitle, setAdHocTitle] = useState("");
  const [adHocRegistration, setAdHocRegistration] = useState("");
  const [adHocPrice, setAdHocPrice] = useState("");
  const [information, setInformation] = useState<Car | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const [followUpTime, setFollowUpTime] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [search, setSearch] = useState("");
  const [carId, setCarId] = useState(initial?.vehicleId ?? "");
  const [name, setName] = useState(initial?.customerName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [message, setMessage] = useState("");
  const [booking, setBooking] = useState(Boolean(initial));
  const [time, setTime] = useState("");
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    if (!selection) return;
    setVehicleMode("stock"); setCarId(selection.id); setBooking(selection.booking); setTime("");
  }, [selection]);
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
        entry.advertId,
      ].join(" "),
      search,
    ),
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
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
        },
      });
      onSaved(result);
    } catch {
      /* Keep caller details for retry. */
    } finally {
      submitting.current = false;
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <fieldset disabled={mutation.isPending} className="min-w-0 space-y-4">
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
          <div className="space-y-4 border border-border bg-muted/30 p-4">
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
              <div className="border border-primary/25 bg-primary/5 p-3">
                <CarSummary car={car} />
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setInformation(car)}
                >
                  View full vehicle information
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => {
                    setCarId("");
                    setTime("");
                  }}
                >
                  Change selected car
                </Button>
              </div>
            )}
            <div
              className={`max-h-96 divide-y divide-border overflow-y-auto rounded-sm border border-border ${car ? "hidden lg:block" : ""}`}
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
      <fieldset disabled={mutation.isPending} className="min-w-0 space-y-4">
        <legend className="mb-4 font-semibold">2. Caller and next step</legend>
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
        <div className="grid gap-4 sm:grid-cols-2">
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
        <fieldset className="space-y-2 border-t border-border pt-4">
          <legend className="text-sm font-semibold">Next step</legend>
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
        {booking &&
          (car && available(car) ? (
            <Slots value={time} onChange={setTime} />
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
        <Button
          type="submit"
          className="w-full"
          disabled={
            mutation.isPending ||
            (booking && (isLoading || Boolean(error))) ||
            (booking && (!car || !available(car) || !time))
          }
        >
          {mutation.isPending
            ? "Saving…"
            : booking
              ? "Save test-drive booking"
              : "Save phone enquiry"}
        </Button>
      </fieldset>
      {information && (
        <EnquiryVehicleInformation
          car={information}
          onClose={() => setInformation(null)}
        />
      )}
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
  const mutation = useChangeStaffAppointment();
  const { settings } = useDealerSettings();
  async function save() {
    if (mutation.isPending) return;
    try {
      onSaved(
        await mutation.mutateAsync({
          id: booking.id,
          data: {
            action: cancelling ? "cancel" : "reschedule",
            appointmentAt: cancelling ? null : time,
            expectedRevision: booking.appointmentRevision ?? 0,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-10">
            {cancelling ? "Cancel this appointment?" : "Change appointment"}
          </DialogTitle>
          <DialogDescription>
            {booking.customerName} · {booking.reference}
          </DialogDescription>
        </DialogHeader>
        <div className="border-y border-border py-3 text-sm">
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
          <Slots bookingId={booking.id} value={time} onChange={setTime} />
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
            onClick={save}
          >
            {mutation.isPending
              ? "Saving…"
              : cancelling
                ? "Confirm cancellation"
                : "Save new appointment"}
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
      </DialogContent>
    </Dialog>
  );
}

export function EnquiriesPanel() {
  const [mode, setMode] = useState<"new" | "history" | "stock">("new");
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
  async function saved(entry: Enquiry) {
    setEditing(null);
    setInitial(undefined);
    setSelection(undefined);
    setFormKey((key) => key + 1);
    setNotice(
      `${entry.reference} saved — ${entry.appointmentCancelledAt ? "appointment cancelled" : entry.appointmentAt ? `${status(entry)}: ${appointmentLabel(entry.appointmentAt)}` : "phone enquiry recorded"}.${entry.customerNotificationStatus === "failed" ? " Customer email failed; confirm by phone." : ""}`,
    );
    setMode("history");
    setSearch(entry.reference);
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
  const dueCount = (query.data ?? []).filter(
    (entry) =>
      entry.followUpAt &&
      !entry.followUpCompletedAt &&
      londonDate(new Date(entry.followUpAt)) <= londonDate(),
  ).length;
  const entries = (query.data ?? [])
    .filter(
      (entry) =>
        contains(
          [
            entry.customerName,
            entry.phone,
            entry.email,
            entry.reference,
            entry.vehicleTitle,
            entry.vehicleRegistration,
          ].join(" "),
          search,
        ) &&
        (filter === "all" ||
          (filter === "followups"
            ? Boolean(entry.followUpAt && !entry.followUpCompletedAt)
            : filter === "due"
              ? Boolean(
                  entry.followUpAt &&
                  !entry.followUpCompletedAt &&
                  londonDate(new Date(entry.followUpAt)) <= londonDate(),
                )
              : filter === "upcoming"
                ? Boolean(
                    entry.appointmentAt &&
                    !entry.appointmentCancelledAt &&
                    new Date(entry.appointmentAt).getTime() > Date.now(),
                  )
                : entry.appointmentAt &&
                  londonDate(new Date(entry.appointmentAt)) === londonDate())),
    )
    .sort((a, b) =>
      ["due", "followups"].includes(filter)
        ? (a.followUpAt ?? "").localeCompare(b.followUpAt ?? "")
        : 0,
    );
  return (
    <Panel>
      <div className="bg-[#213e61] px-5 py-4 text-white">
        <h2 className="text-xl font-semibold">Enquiry workspace</h2>
        <p className="mt-1 text-sm text-white/75">Calls, cars and appointments · Showroom desk</p>
      </div>
      <Tabs value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
        <TabsList aria-label="Enquiry workspace" className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-[#e8eef5] p-2">
          <TabsTrigger value="new" id="desk-tab-new" aria-controls="desk-panel-new" className="min-h-11 rounded-sm px-5">New call</TabsTrigger>
          <TabsTrigger value="stock" id="desk-tab-stock" aria-controls="desk-panel-stock" className="min-h-11 rounded-sm px-5">All cars</TabsTrigger>
          <TabsTrigger value="history" id="desk-tab-history" aria-controls="desk-panel-history" className="min-h-11 rounded-sm px-5">Find enquiry or appointment</TabsTrigger>
        </TabsList>
      </Tabs>
      <div aria-label="Workspace actions" className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
        <Button variant="outline" size="sm" aria-label="Refresh enquiries and stock" disabled={query.isFetching} onClick={() => { query.refetch(); client.invalidateQueries({ queryKey: ["/api/stock"] }); }}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        <Button variant="outline" size="sm" onClick={() => { setMode("history"); setFilter("due"); setSearch(""); }}>Follow-ups due ({dueCount})</Button>
        <span className="ml-auto text-xs text-muted-foreground">{stock?.cars.length ?? 0} cars in current stock · Draft retained when switching tabs</span>
      </div>
      <div className="space-y-5 bg-slate-100/70 p-3 sm:p-6">
        {notice && (
          <div
            role="status"
            className="flex gap-2 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"
          >
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            {notice}
          </div>
        )}
        <div hidden={mode !== "new"} role="tabpanel" id="desk-panel-new" aria-labelledby="desk-tab-new" className="border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <NewCall key={formKey} initial={initial} selection={selection} onSaved={saved} />
        </div>
        <div hidden={mode !== "stock"} role="tabpanel" id="desk-panel-stock" aria-labelledby="desk-tab-stock">
          <EnquiryStockDesk onDetails={setInformation} onChoose={(car, booking) => { setSelection({ id: car.id, booking }); setMode("new"); }} />
        </div>
        {mode === "history" && (
          <div role="tabpanel" id="desk-panel-history" aria-labelledby="desk-tab-history" className="space-y-4 border border-slate-200 bg-white p-4 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <label className={field}>
                Find a customer or car
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, phone, email, reference or car"
                />
              </label>
              <label className={field}>
                Show
                <NativeSelect
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All enquiries</option>
                  <option value="upcoming">Upcoming appointments</option>
                  <option value="today">Today’s appointments</option>
                  <option value="followups">Outstanding follow-ups</option>
                  <option value="due">Follow-ups: overdue / due today</option>
                </NativeSelect>
              </label>
            </div>
            {query.isLoading && <p role="status">Loading enquiries…</p>}
            {query.isError && (
              <p role="alert">
                Enquiries could not be loaded. Use Refresh to try again.
              </p>
            )}
            <ul className="divide-y divide-border border-y border-border">
              {entries.map((entry) => {
                const car = stock?.cars.find(
                  (car) => car.id === entry.vehicleId,
                );
                const future =
                  entry.appointmentAt &&
                  new Date(entry.appointmentAt).getTime() > Date.now() &&
                  !entry.appointmentCancelledAt;
                return (
                  <li
                    key={entry.id}
                    className="py-4"
                    data-testid={`enquiry-${entry.id}`}
                  >
                    <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                      <div>
                        <p className="font-semibold">{entry.customerName}</p>
                        <p className="mt-1 text-sm">
                          {entry.phone || "No phone supplied"}
                        </p>
                        {entry.email && (
                          <p className="break-all text-sm text-muted-foreground">
                            {entry.email}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.reference}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {entry.vehicleTitle || "General showroom enquiry"}
                        </p>
                        {entry.vehicleId && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {car
                              ? stockStatus(car)
                              : "No longer in current stock"}
                          </p>
                        )}
                        {!entry.vehicleId && entry.vehicleTitle && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Ad hoc vehicle — not showroom stock
                            {entry.vehicleRegistration
                              ? ` · ${entry.vehicleRegistration}`
                              : ""}
                            {entry.vehiclePrice != null
                              ? ` · ${formatPrice(entry.vehiclePrice)}`
                              : ""}
                          </p>
                        )}
                        {entry.followUpAt && (
                          <div className="mt-3 border-l-2 border-primary pl-3 text-sm">
                            <p className="font-medium">
                              {entry.followUpCompletedAt
                                ? "Follow-up completed"
                                : new Date(entry.followUpAt).getTime() <
                                    Date.now()
                                  ? "Follow-up overdue"
                                  : "Follow-up requested"}
                            </p>
                            <p>{appointmentLabel(entry.followUpAt)}</p>
                            {entry.followUpNote && (
                              <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                                {entry.followUpNote}
                              </p>
                            )}
                          </div>
                        )}
                        {entry.appointmentAt && (
                          <p className="mt-2 text-sm">
                            {appointmentLabel(entry.appointmentAt)}
                          </p>
                        )}
                        <div className="mt-2">
                          <Chip>{status(entry)}</Chip>
                        </div>
                      </div>
                      <div className="flex max-w-sm flex-wrap items-start gap-2">
                        {car && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setInformation(car)}
                          >
                            Vehicle information
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setFollowUpEntry({ ...entry })}
                        >
                          {entry.followUpAt && !entry.followUpCompletedAt
                            ? "Manage follow-up"
                            : "Request follow-up"}
                        </Button>
                        {future && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditing({ ...entry })}
                          >
                            <CalendarDays className="mr-1 h-4 w-4" />
                            Change appointment
                          </Button>
                        )}
                        {!entry.appointmentAt && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelection(undefined);
                              setInitial(entry);
                              setFormKey((key) => key + 1);
                              setMode("new");
                              setNotice(
                                "Customer details copied. Saving creates a new test-drive booking.",
                              );
                            }}
                          >
                            Book test drive
                          </Button>
                        )}
                      </div>
                    </div>
                    {entry.message && (
                      <details className="mt-2 text-sm">
                        <summary className="min-h-11 cursor-pointer py-3 font-medium">
                          Call notes
                        </summary>
                        <p className="whitespace-pre-wrap break-words text-muted-foreground">
                          {entry.message}
                        </p>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
            {!query.isLoading && !query.isError && !entries.length && (
              <p className="py-6 text-center text-muted-foreground">
                No matching enquiries. Try another name or phone number.
              </p>
            )}
          </div>
        )}
      </div>
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
