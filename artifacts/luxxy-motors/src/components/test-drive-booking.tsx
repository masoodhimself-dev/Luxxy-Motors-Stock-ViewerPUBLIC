import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import {
  useCreateEnquiry,
  useGetEnquiryAvailability,
  getGetEnquiryAvailabilityQueryKey,
  type EnquiryInput,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock3,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { UKNumberPlate } from "@/components/uk-number-plate";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { type Car } from "@/lib/stock-context";
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle, vehicleRegistrationLabel } from "@/lib/utils";
import { customerRegistrationDetails } from "@/lib/customer-vehicle-meta";
import { dealershipLocation } from "@/lib/dealership-location";
import { getVisitorId } from "@/lib/visitor";
import { trackEvent } from "@/lib/analytics";
import {
  enquiryDraftKey,
  readEnquiryDraft,
  saveEnquiryDraft,
  discardEnquiryDraft,
  type EnquiryDraft,
} from "@/lib/enquiry-draft";
import { readVehicleExchange } from "@/lib/vehicle-exchange-draft";
import {
  availableBookingDates,
  appointmentLabel,
  bookingDateLabel,
  defaultBookingSettings,
  londonDate,
  nextDate,
} from "@/lib/test-drive-dates";
import { websiteText } from "@/lib/website-content";

function initialDetails(vehicle?: Car): EnquiryDraft {
  const draft = readEnquiryDraft(enquiryDraftKey(vehicle?.id, "viewing"));
  if (draft) return draft;
  const contact =
    readEnquiryDraft(enquiryDraftKey(vehicle?.id, "general")) ??
    readEnquiryDraft(enquiryDraftKey(undefined, "general"));
  const exchange = readVehicleExchange(vehicle?.id);
  return {
    customerName: contact?.customerName ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    preferredContact: "email",
    message: "",
    hasPartExchange: Boolean(exchange),
    exchange: exchange ?? { registration: "", mileage: "", notes: "" },
  };
}
function messageFromError(error: unknown) {
  const response = error as { data?: { error?: string } } | null;
  return (
    response?.data?.error ||
    "We could not confirm your test drive. Your details are still here. Please try again."
  );
}
function VehiclePhoto({
  car,
  className = "",
}: {
  car: Car;
  className?: string;
}) {
  const src = getThumbnailUrl(car);
  const [failed, setFailed] = useState("");
  if (!src || failed === src) return null;
  return (
    <img
      src={src}
      alt=""
      width={160}
      height={120}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={`aspect-[4/3] shrink-0 rounded-sm bg-secondary object-contain ${className}`}
    />
  );
}

export function TestDriveBooking({
  vehicle,
  stockCars,
  isLoading = false,
  error,
  missingVehicle = false,
}: {
  vehicle?: Car;
  stockCars: Car[];
  isLoading?: boolean;
  error?: unknown;
  missingVehicle?: boolean;
}) {
  const {
    settings,
    isLoading: settingsLoading,
    isError: settingsError,
  } = useDealerSettings();
  const config = settings.testDriveBooking ?? defaultBookingSettings;
  const [, setLocation] = useLocation();
  const cars = stockCars.filter(
    (car) =>
      (!car.inventoryStatus || car.inventoryStatus === "available"),
  );
  const currentCar =
    vehicle && cars.some((car) => car.id === vehicle.id) ? vehicle : undefined;
  const [choosingCar, setChoosingCar] = useState(false);
  const [choiceId, setChoiceId] = useState(vehicle?.id ?? "");
  const [carSearch, setCarSearch] = useState("");
  const searchTerm = carSearch.toLowerCase().replace(/\s+/g, "");
  const matchingCars = cars.filter((car) =>
    `${vehicleDisplayTitle(car)} ${car.year ?? ""} ${vehicleRegistrationLabel(car)}`
      .toLowerCase()
      .replace(/\s+/g, "")
      .includes(searchTerm),
  );
  const choice = cars.find((car) => car.id === choiceId);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [details, setDetails] = useState(() => initialDetails(vehicle));
  const [draftSaved, setDraftSaved] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const dates = useMemo(() => availableBookingDates(config), [config]);
  const [selectedDate, setSelectedDate] = useState(
    () => dates[0] ?? londonDate(),
  );
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const errorMessage = useRef<HTMLDivElement>(null);
  const mutation = useCreateEnquiry();
  const busy = mutation.isPending;
  const key = enquiryDraftKey(currentCar?.id, "viewing");
  const keysUsed = useRef(new Set<string>());
  const initialRender = useRef(true);
  const restoredCar = useRef(vehicle?.id ?? "");
  const restoringDraft = useRef(false);
  const submitting = useRef(false);
  const pickingCar = choosingCar || !currentCar;
  const availability = useGetEnquiryAvailability(
    { date: selectedDate },
    {
      query: {
        queryKey: getGetEnquiryAvailabilityQueryKey({ date: selectedDate }),
        enabled:
          !pickingCar &&
          !isLoading &&
          !error &&
          !settingsLoading &&
          !settingsError &&
          config.enabled &&
          dates.includes(selectedDate) &&
          !mutation.isSuccess,
        staleTime: 15_000,
        refetchOnWindowFocus: true,
      },
    },
  );
  const slots = availability.data?.slots.filter((slot) => slot.available) ?? [];
  const selectedTime = slots.find((slot) => slot.startAt === selectedSlot);
  const location = dealershipLocation(settings.address);
  const approval = config.confirmationMode === "approval";
  const formDisabled =
    busy || settingsLoading || settingsError || isLoading || Boolean(error);
  const exchangeMessage = details.hasPartExchange
    ? [
        "Part exchange",
        `Registration: ${details.exchange.registration.trim().toUpperCase()}`,
        `Approximate mileage: ${details.exchange.mileage} miles`,
        details.exchange.notes.trim() &&
          `Notes: ${details.exchange.notes.trim()}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  useEffect(() => {
    if (!dates.includes(selectedDate)) {
      setSelectedDate(dates[0] ?? londonDate());
      setSelectedSlot(null);
    }
  }, [dates, selectedDate]);
  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDate, currentCar?.id]);
  useEffect(() => {
    if (
      availability.data &&
      selectedSlot &&
      !availability.data.slots.some(
        (slot) => slot.startAt === selectedSlot && slot.available,
      )
    )
      setSelectedSlot(null);
  }, [availability.data, selectedSlot]);
  useEffect(() => {
    if (!currentCar || restoredCar.current) return;
    restoredCar.current = currentCar.id;
    restoringDraft.current = true;
    setDetails(initialDetails(currentCar));
  }, [currentCar?.id]);
  useEffect(() => {
    if (restoringDraft.current) {
      restoringDraft.current = false;
      return;
    }
    if (mutation.isSuccess || !currentCar) return;
    if (
      details.customerName ||
      details.email ||
      details.phone ||
      details.message ||
      details.exchange.registration
    ) {
      keysUsed.current.add(key);
      setDraftSaved(saveEnquiryDraft(key, details));
    }
  }, [details, key, mutation.isSuccess, currentCar?.id]);
  useEffect(() => {
    if (isLoading || settingsLoading) return;
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    if (step === 2 && !pickingCar && !mutation.isSuccess)
      nameInput.current?.focus();
    else {
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
      heading.current?.focus({ preventScroll: true });
    }
  }, [step, pickingCar, mutation.isSuccess, isLoading, settingsLoading]);
  useEffect(() => {
    if (mutation.isError) errorMessage.current?.focus();
  }, [mutation.isError]);

  function changeTime() {
    mutation.reset();
    setStep(1);
    void availability.refetch();
  }
  function update(
    field: "customerName" | "email" | "phone" | "message",
    value: string,
  ) {
    setDetails((old) => ({ ...old, [field]: value }));
    if (field === "phone") setPhoneError("");
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phone = details.phone.trim().replace(/[\s().\-/]/g, "");
    if (!/^\+?\d{7,15}$/.test(phone)) {
      setPhoneError(
        "Enter a phone number with 7–15 digits, including the country code if outside the UK.",
      );
      document.getElementById("booking-phone")?.focus();
      return;
    }
    if (!details.customerName.trim() || !details.email.trim()) return;
    setStep(3);
  }
  function confirm() {
    if (
      submitting.current ||
      busy ||
      !currentCar ||
      !selectedSlot ||
      !selectedTime ||
      formDisabled
    )
      return;
    const data: EnquiryInput = {
      vehicleId: currentCar.id,
      type: "viewing",
      customerName: details.customerName.trim(),
      email: details.email.trim(),
      phone: details.phone.trim().replace(/[\s().\-/]/g, ""),
      preferredContact: "email",
      message: [
        details.message.trim() ||
          `Test drive for ${appointmentLabel(selectedSlot)}.`,
        exchangeMessage,
      ]
        .filter(Boolean)
        .join("\n\n"),
      appointmentAt: selectedSlot,
      visitorId: getVisitorId(),
      partExchange: details.hasPartExchange
        ? {
            registration: details.exchange.registration.trim().toUpperCase(),
            mileage: Number(details.exchange.mileage),
            condition: null,
          }
        : null,
    };
    submitting.current = true;
    trackEvent("enquiry_submitted", {
      enquiry_type: "viewing",
      vehicle_context: true,
      preferred_contact: "email",
    });
    mutation.mutate(
      { data },
      {
        onSuccess: () => {
          keysUsed.current.forEach(discardEnquiryDraft);
          discardEnquiryDraft(key);
          setDraftSaved(false);
          trackEvent("enquiry_completed", {
            enquiry_type: "viewing",
            vehicle_context: true,
            preferred_contact: "email",
          });
        },
        onError: () => {
          void availability.refetch();
        },
        onSettled: () => {
          submitting.current = false;
        },
      },
    );
  }

  const selectedCarCard = currentCar && (
    <div
      className="booking-car flex items-center gap-3 border-b border-border pb-5 sm:gap-5"
      data-testid="card-enquiry-vehicle"
    >
      <VehiclePhoto car={currentCar} className="w-24 sm:w-32" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">Your selected car</p>
        <p className="mt-1 text-base font-semibold leading-snug sm:text-lg">
          {vehicleDisplayTitle(currentCar)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {[customerRegistrationDetails(currentCar), currentCar.transmission]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
          <p className="font-semibold tabular-nums">
            {currentCar.price != null
              ? formatPrice(currentCar.price, currentCar.currency)
              : "Price on application"}
          </p>
          {!mutation.isSuccess && (
            <button
              type="button"
              disabled={busy}
              className="min-h-11 text-sm underline underline-offset-4"
              onClick={() => {
                setChoiceId(currentCar.id);
                setChoosingCar(true);
              }}
            >
              Change car
            </button>
          )}
        </div>
      </div>
    </div>
  );
  const visitDetails = (
    <div className="space-y-3 text-sm leading-6">
      <p className="flex items-center gap-2 font-semibold">
        <MapPin className="h-4 w-4" aria-hidden="true" />
        {settings.identity.name}
      </p>
      {location.isSample ? (
        <p className="text-muted-foreground">
          Sample showroom address. Confirm the location with the team before
          travelling.
        </p>
      ) : (
        <p>
          {location.lines.join(", ") ||
            "Contact the team to confirm the showroom address."}
        </p>
      )}
      {settings.presentation?.visitInstructions && (
        <p className="text-muted-foreground">
          {settings.presentation.visitInstructions}
        </p>
      )}
      {settings.presentation?.parkingInstructions && (
        <p className="text-muted-foreground">
          {settings.presentation.parkingInstructions}
        </p>
      )}
      {config.instructions.trim() && (
        <div>
          <p className="font-semibold">Before your visit</p>
          <p className="whitespace-pre-line text-muted-foreground">
            {config.instructions}
          </p>
        </div>
      )}
    </div>
  );
  const timeHelpHref = `/enquire?type=general${currentCar ? `&vehicleId=${encodeURIComponent(currentCar.id)}` : ""}&searchRequest=${encodeURIComponent("Please help me arrange a test drive at another time.")}`;

  return (
    <div className="booking-page bg-background px-4 pb-14 pt-5 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-[760px]">
        <Link
          href={currentCar ? `/vehicle/${currentCar.id}` : "/stock"}
          className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {currentCar ? "Back to the car" : "Browse Stock"}
        </Link>
        <header className="mb-6 mt-3 sm:mb-8">
          <p className="luxxy-kicker">Visit {settings.identity.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {websiteText(settings, "viewingTitle")}
          </h1>
          <p className="mt-3 max-w-lg text-base leading-7 text-muted-foreground">
            {websiteText(settings, "viewingDescription")}
          </p>
        </header>
        <div className="rounded-sm border border-border bg-card p-5 sm:p-8">
          {isLoading || settingsLoading ? (
            <div role="status" className="space-y-4 py-8">
              <p>Loading your booking options…</p>
              <div className="h-24 animate-pulse bg-secondary" />
            </div>
          ) : error || settingsError ? (
            <div role="alert">
              <h2 className="text-xl font-semibold">
                We couldn’t load the booking options
              </h2>
              <p className="mt-3 text-muted-foreground">
                Please try again before choosing your appointment.
              </p>
              <Button className="mt-5" onClick={() => window.location.reload()}>
                Try again
              </Button>
            </div>
          ) : !config.enabled ? (
            <div>
              <h2 className="text-xl font-semibold">
                Arrange a test drive with the team
              </h2>
              <p className="mt-3 text-muted-foreground">
                Online appointment booking is currently unavailable. Contact us
                and we’ll help you choose a time.
              </p>
              <Button asChild className="mt-5">
                <Link href={timeHelpHref}>Ask about a test drive</Link>
              </Button>
            </div>
          ) : mutation.isSuccess ? (
            <section data-testid="status-enquiry-success">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
                {mutation.data.appointmentStatus !== "confirmed" ? (
                  <Clock3 />
                ) : (
                  <CheckCircle2 />
                )}
              </div>
              <h2
                ref={heading}
                tabIndex={-1}
                className="booking-step-heading text-2xl font-semibold outline-none sm:text-3xl"
              >
                {mutation.data.appointmentStatus !== "confirmed"
                  ? "Your test-drive request is received"
                  : "Your test drive is booked"}
              </h2>
              <p className="mt-3 text-muted-foreground">
                {mutation.data.appointmentStatus !== "confirmed"
                  ? "The team will check your requested time and contact you to confirm. Please wait for confirmation before travelling."
                  : "We look forward to meeting you. Your appointment details are below."}
              </p>
              <div className="mt-6">{selectedCarCard}</div>
              <p className="mt-5 flex items-start gap-3 font-semibold">
                <CalendarDays className="mt-0.5 h-5 w-5 shrink-0" />
                {appointmentLabel(mutation.data.appointmentAt || selectedSlot!)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {mutation.data.appointmentDurationMinutes ??
                  config.durationMinutes}{" "}
                minutes · London time
              </p>
              <p className="mt-4 text-sm">
                Booking reference{" "}
                <strong data-testid="text-enquiry-reference">
                  {mutation.data.reference}
                </strong>
              </p>
              <div className="mt-5 border-y border-border py-5 text-sm leading-6">
                <p className="font-semibold">
                  {mutation.data.customerNotificationStatus === "sent"
                    ? mutation.data.appointmentStatus === "confirmed"
                      ? "Confirmation email sent"
                      : "Request email sent"
                    : "Your booking details are saved here"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {mutation.data.customerNotificationStatus === "sent"
                    ? `We sent the details to ${details.email.trim()}.`
                    : "The email hasn’t been sent. Keep your reference and the booking link below, or contact the showroom for help."}
                </p>
              </div>
              <div className="my-5 flex flex-wrap gap-3">
                {mutation.data.appointmentStatus === "confirmed" &&
                  mutation.data.calendarIcs && (
                    <Button asChild variant="outline">
                      <a
                        data-testid="link-download-calendar"
                        href={`data:text/calendar;charset=utf-8,${encodeURIComponent(mutation.data.calendarIcs)}`}
                        download={`test-drive-${mutation.data.reference}.ics`}
                      >
                        <CalendarPlus size={17} />
                        Add to calendar
                      </a>
                    </Button>
                  )}
                {mutation.data.managePath && (
                  <Button asChild variant="outline">
                    <Link href={mutation.data.managePath}>
                      Manage test drive
                    </Link>
                  </Button>
                )}
                <Button asChild variant="outline">
                  {location.directions ? (
                    <a
                      href={location.directions}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Get directions
                    </a>
                  ) : (
                    <Link href="/contact">Directions & opening hours</Link>
                  )}
                </Button>
              </div>
              {visitDetails}
            </section>
          ) : pickingCar ? (
            <section data-testid="viewing-vehicle-required">
              <h2
                ref={heading}
                tabIndex={-1}
                className="booking-step-heading text-2xl font-semibold outline-none"
              >
                Which car would you like to try?
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Choose a car so we can prepare it for your visit.
              </p>
              {missingVehicle && (
                <p
                  className="mt-4 border-l-2 border-primary pl-3 text-sm"
                  role="status"
                >
                  That car isn’t in our current stock. Please choose another
                  one.
                </p>
              )}
              {cars.length > 6 && (
                <label className="mt-5 block">
                  <span className="field-label">Find a car</span>
                  <Input
                    type="search"
                    placeholder="Search make, model or registration"
                    value={carSearch}
                    onChange={(event) => setCarSearch(event.target.value)}
                  />
                </label>
              )}
              <fieldset className="mt-5">
                <legend className="sr-only">Choose your car</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {matchingCars.map((car) => (
                      <label
                        key={car.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-sm border p-3 focus-within:ring-2 focus-within:ring-ring ${choiceId === car.id ? "border-primary bg-secondary/60" : "border-border hover:border-primary/50"}`}
                      >
                        <input
                          type="radio"
                          name="viewing-vehicle"
                          value={car.id}
                          checked={choiceId === car.id}
                          onChange={() => setChoiceId(car.id)}
                          aria-label={`Select ${vehicleDisplayTitle(car)}`}
                          className="h-4 w-4 shrink-0 accent-primary"
                        />
                        <VehiclePhoto car={car} className="w-20" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold leading-snug">
                            {vehicleDisplayTitle(car)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[customerRegistrationDetails(car), car.transmission]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <p className="mt-2 text-sm font-semibold">
                            {car.price != null
                              ? formatPrice(car.price, car.currency)
                              : "Price on application"}
                          </p>
                        </div>
                      </label>
                    ))}
                </div>
              </fieldset>
              {cars.length > 0 && matchingCars.length === 0 && (
                  <p className="my-5 text-sm text-muted-foreground">
                    No cars match that search. Try a different make, model or registration.
                  </p>
                )}
              {!cars.length && (
                <p className="my-6 text-muted-foreground">
                  No cars are currently available. Contact the team about
                  upcoming stock.
                </p>
              )}
              {choice ? (
                <Button asChild className="mt-6 min-h-12 w-full">
                  <Link
                    href={`/enquire?type=viewing&vehicleId=${encodeURIComponent(choice.id)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      setLocation(
                        `/enquire?type=viewing&vehicleId=${encodeURIComponent(choice.id)}`,
                      );
                      setChoosingCar(false);
                      setStep(1);
                      setSelectedSlot(null);
                      mutation.reset();
                    }}
                  >
                    Choose date and time
                    <ArrowRight size={17} />
                  </Link>
                </Button>
              ) : (
                <Button disabled className="mt-6 min-h-12 w-full">
                  Select a car to continue
                </Button>
              )}
              {choosingCar && currentCar && (
                <button
                  type="button"
                  className="mt-3 min-h-11 w-full text-sm underline"
                  onClick={() => setChoosingCar(false)}
                >
                  Keep {vehicleDisplayTitle(currentCar)}
                </button>
              )}
            </section>
          ) : (
            <>
              {selectedCarCard}
              <ol
                aria-label="Booking progress"
                className="my-6 grid grid-cols-3 gap-3 border-b border-border pb-5 text-xs sm:text-sm"
              >
                {["Choose a time", "Your details", "Confirm"].map(
                  (label, index) => (
                    <li
                      key={label}
                      aria-current={step === index + 1 ? "step" : undefined}
                      className={`flex items-center gap-2 ${step >= index + 1 ? "font-semibold text-primary" : "text-muted-foreground"}`}
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs ${step >= index + 1 ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                      >
                        {step > index + 1 ? <Check size={13} /> : index + 1}
                      </span>
                      {label}
                    </li>
                  ),
                )}
              </ol>
              <h2
                ref={heading}
                tabIndex={-1}
                className="booking-step-heading scroll-mt-24 text-2xl font-semibold outline-none"
              >
                {step === 1
                  ? "When would you like to come?"
                  : step === 2
                    ? "How can we reach you?"
                    : "Everything look right?"}
              </h2>
              {step !== 1 && (
                <div
                  className="mt-5 flex items-center justify-between gap-3 border-b border-border pb-5"
                  data-testid="card-selected-viewing"
                >
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {approval ? "Requested time" : "Your test drive"}
                    </p>
                    <p className="mt-1 text-sm font-semibold">
                      {selectedSlot
                        ? appointmentLabel(selectedSlot)
                        : "Please choose another available time"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={changeTime}
                    className="min-h-11 shrink-0 text-sm underline underline-offset-4"
                  >
                    Change time
                  </button>
                </div>
              )}
              {step === 1 && (
                <section
                  className="mt-3 min-w-0"
                  data-testid="section-viewing-availability"
                >
                  <p className="text-sm leading-6 text-muted-foreground">
                    {config.durationMinutes}-minute appointments · London time
                    {approval ? " · Confirmed by the team" : ""}
                  </p>
                  <div
                    role="group"
                    aria-label="Choose a test-drive date"
                    className="mt-5 flex gap-2 overflow-x-auto overscroll-x-contain pb-3"
                    data-testid="group-viewing-dates"
                  >
                    {dates.map((date) => (
                      <button
                        key={date}
                        type="button"
                        aria-pressed={date === selectedDate}
                        aria-label={`Select ${bookingDateLabel(date)}`}
                        data-testid={`button-viewing-date-${date}`}
                        onClick={() => setSelectedDate(date)}
                        className={`min-h-20 min-w-[100px] shrink-0 rounded-sm border px-3 py-3 text-left ${selectedDate === date ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"}`}
                      >
                        <span className="block text-sm font-semibold">
                          {date === londonDate()
                            ? "Today"
                            : date === nextDate(londonDate(), 1)
                              ? "Tomorrow"
                              : new Intl.DateTimeFormat("en-GB", {
                                  weekday: "short",
                                }).format(new Date(`${date}T12:00:00Z`))}
                        </span>
                        <span className="mt-1 block text-xs">
                          {new Intl.DateTimeFormat("en-GB", {
                            day: "numeric",
                            month: "short",
                          }).format(new Date(`${date}T12:00:00Z`))}
                        </span>
                      </button>
                    ))}
                  </div>
                  {dates.length > 7 && (
                    <details className="mb-5">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">
                        Choose another date
                      </summary>
                      <label>
                        <span className="sr-only">
                          Choose a test-drive date
                        </span>
                        <NativeSelect
                          data-testid="select-viewing-date"
                          value={selectedDate}
                          onChange={(event) =>
                            setSelectedDate(event.target.value)
                          }
                        >
                          {dates.map((date) => (
                            <option key={date} value={date}>
                              {bookingDateLabel(date)}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                    </details>
                  )}
                  <p className="mb-3 text-sm font-semibold">Available times</p>
                  {availability.isLoading || availability.isFetching ? (
                    <div
                      role="status"
                      data-testid="loading-availability"
                      className="py-5 text-sm text-muted-foreground"
                    >
                      Checking available times…
                    </div>
                  ) : availability.isError ? (
                    <div
                      role="alert"
                      data-testid="status-availability-error"
                      className="border-l-2 border-destructive pl-3 text-sm"
                    >
                      <p>We couldn’t load the times for this day.</p>
                      <button
                        type="button"
                        className="min-h-11 underline"
                        onClick={() => void availability.refetch()}
                      >
                        Try again
                      </button>
                    </div>
                  ) : slots.length ? (
                    <div
                      className="grid grid-cols-3 gap-2 sm:grid-cols-4"
                      data-testid="group-viewing-slots"
                    >
                      {slots.map((slot) => (
                        <button
                          key={slot.startAt}
                          type="button"
                          aria-pressed={selectedSlot === slot.startAt}
                          onClick={() => setSelectedSlot(slot.startAt)}
                          data-testid={`button-viewing-slot-${slot.startAt}`}
                          className={`min-h-12 rounded-sm border text-base font-medium tabular-nums ${selectedSlot === slot.startAt ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"}`}
                        >
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p
                      data-testid="status-availability-empty"
                      className="rounded-sm bg-secondary p-4 text-sm leading-6"
                    >
                      No appointments are available on this date. Choose another
                      day, or ask the team to help.
                    </p>
                  )}
                  <Link
                    href={timeHelpHref}
                    className="mt-3 inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4"
                  >
                    Can’t find a suitable time?
                  </Link>
                  <Button
                    type="button"
                    disabled={
                      !selectedTime || availability.isFetching || !dates.length
                    }
                    className="mt-5 min-h-12 w-full"
                    data-testid="button-continue-to-details"
                    onClick={() => setStep(2)}
                  >
                    Continue to your details
                    <ArrowRight size={17} />
                  </Button>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    {approval
                      ? "We’ll confirm your requested time after checking it with the team."
                      : "Your time is confirmed only after you complete the booking."}
                  </p>
                </section>
              )}
              {step === 2 && (
                <form onSubmit={review} className="mt-5 space-y-5">
                  <p className="text-sm text-muted-foreground">
                    Just the details we need to arrange your visit.
                  </p>
                  <label className="block">
                    <span className="field-label">Your name</span>
                    <Input
                      ref={nameInput}
                      autoComplete="name"
                      required
                      minLength={2}
                      pattern={".*\\S.*"}
                      maxLength={120}
                      value={details.customerName}
                      onChange={(event) =>
                        update("customerName", event.target.value)
                      }
                      data-testid="input-customer-name"
                    />
                  </label>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block">
                      <span className="field-label">Mobile number</span>
                      <Input
                        id="booking-phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        required
                        value={details.phone}
                        onChange={(event) =>
                          update("phone", event.target.value)
                        }
                        aria-invalid={Boolean(phoneError)}
                        aria-describedby="booking-phone-help"
                        data-testid="input-customer-phone"
                      />
                      <span
                        id="booking-phone-help"
                        className={`mt-2 block text-xs leading-5 ${phoneError ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {phoneError ||
                          "So we can contact you about your appointment."}
                      </span>
                    </label>
                    <label className="block">
                      <span className="field-label">Email address</span>
                      <Input
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                        value={details.email}
                        onChange={(event) =>
                          update("email", event.target.value)
                        }
                        data-testid="input-customer-email"
                      />
                      <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                        For your confirmation and booking link.
                      </span>
                    </label>
                  </div>
                  <details
                    className="border-t border-border"
                    open={details.hasPartExchange || undefined}
                  >
                    <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">
                      Have a car to part-exchange?{" "}
                      <span className="font-normal text-muted-foreground">
                        Optional
                      </span>
                    </summary>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={details.hasPartExchange}
                        onChange={(event) =>
                          setDetails((old) => ({
                            ...old,
                            hasPartExchange: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      Yes, I have a car to part-exchange
                    </label>
                    {details.hasPartExchange && (
                      <div
                        className="mt-4 grid gap-4 sm:grid-cols-2"
                        data-testid="enquiry-part-exchange-details"
                      >
                        <label>
                          <span className="field-label">Registration</span>
                          <UKNumberPlate
                            value={details.exchange.registration}
                            editable
                            testId="enquiry-part-exchange-plate"
                            onChange={(registration) =>
                              setDetails((old) => ({
                                ...old,
                                exchange: { ...old.exchange, registration },
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span className="field-label">
                            Approximate mileage
                          </span>
                          <Input
                            required
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={1000000}
                            step={1}
                            value={details.exchange.mileage}
                            onChange={(event) =>
                              setDetails((old) => ({
                                ...old,
                                exchange: {
                                  ...old.exchange,
                                  mileage: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}
                  </details>
                  <details
                    className="border-t border-border"
                    open={Boolean(details.message) || undefined}
                  >
                    <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">
                      Anything you’d like us to know?{" "}
                      <span className="font-normal text-muted-foreground">
                        Optional
                      </span>
                    </summary>
                    <label>
                      <span className="sr-only">Your message</span>
                      <Textarea
                        maxLength={1200}
                        rows={3}
                        value={details.message}
                        onChange={(event) =>
                          update("message", event.target.value)
                        }
                        data-testid="textarea-enquiry-message"
                      />
                    </label>
                  </details>
                  {draftSaved && (
                    <p className="text-xs text-muted-foreground">
                      Your details are saved temporarily on this device.
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="min-h-12 w-full"
                    data-testid="button-review-booking"
                  >
                    Review your booking
                    <ArrowRight size={17} />
                  </Button>
                  <button
                    type="button"
                    onClick={changeTime}
                    className="min-h-11 w-full text-sm underline underline-offset-4"
                  >
                    Back to date and time
                  </button>
                </form>
              )}
              {step === 3 && (
                <section
                  className="mt-5 space-y-5"
                  data-testid="booking-review"
                >
                  <div className="border-b border-border pb-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">
                        Your contact details
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          mutation.reset();
                          setStep(2);
                        }}
                        className="min-h-11 text-sm underline underline-offset-4"
                      >
                        Change details
                      </button>
                    </div>
                    <p className="mt-1 font-medium">{details.customerName}</p>
                    <p className="mt-1 break-words text-sm text-muted-foreground">
                      {details.phone}
                      <br />
                      {details.email}
                    </p>
                  </div>
                  {details.hasPartExchange && (
                    <div className="text-sm">
                      <p className="font-semibold">Your part-exchange</p>
                      <p className="mt-1">
                        {details.exchange.registration.toUpperCase()} ·{" "}
                        {Number(details.exchange.mileage).toLocaleString(
                          "en-GB",
                        )}{" "}
                        miles
                      </p>
                    </div>
                  )}
                  {details.message.trim() && (
                    <div className="text-sm">
                      <p className="font-semibold">Your message</p>
                      <p className="mt-1 whitespace-pre-line break-words text-muted-foreground">
                        {details.message}
                      </p>
                    </div>
                  )}
                  {visitDetails}
                  {approval && (
                    <p className="rounded-sm bg-secondary p-4 text-sm leading-6">
                      This is a request for your preferred time. The team will
                      contact you to confirm before your visit.
                    </p>
                  )}
                  {mutation.isError && (
                    <div
                      ref={errorMessage}
                      tabIndex={-1}
                      role="alert"
                      data-testid="status-enquiry-error"
                      className="border-l-2 border-destructive pl-3 text-sm leading-6 text-destructive outline-none"
                    >
                      {messageFromError(mutation.error)}
                    </div>
                  )}
                  {!selectedTime && (
                    <p role="alert" className="text-sm text-destructive">
                      That time is no longer available. Choose another time
                      above; your contact details will be kept.
                    </p>
                  )}
                  <Button
                    type="button"
                    disabled={
                      formDisabled || !selectedTime || availability.isFetching
                    }
                    onClick={confirm}
                    className="min-h-12 w-full"
                    data-testid="button-submit-enquiry"
                  >
                    {busy
                      ? "Sending your booking…"
                      : approval
                        ? "Request test drive"
                        : "Confirm test drive"}
                    {!busy && <ArrowRight size={17} />}
                  </Button>
                  <p className="text-xs leading-5 text-muted-foreground">
                    We’ll use your details to arrange this test drive and send
                    booking updates.
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
