import { OptionalJourneyPostcode } from "@/components/postcode-field";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEnquiriesQueryKey,
  getGetStaffDirectoryQueryKey,
  getGetTestDriveBookingsQueryKey,
  getGetDealerSettingsQueryKey,
  getGetStockQueryKey,
  useCreateStaffEnquiry,
  useGetStaffDirectory,
} from "@workspace/api-client-react";
import {
  CalendarDays,
  LoaderCircle,
  MessageSquarePlus,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { QuickEnquiryCars } from "./quick-enquiry-cars";
import { EnquiryEmailComposer } from "./enquiry-email-composer";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStock } from "@/lib/stock-context";
import { useStaffAccess } from "./dealer-administration";
import { useEnquirySummaries } from "@/lib/enquiry-summary-query";
import { RecentCustomerFields } from "./recent-customer-fields";
import { findContinuingEnquiries } from "./quick-enquiry-continuation";
import { AppointmentSlots } from "./appointment-slots";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { useDealerFeatures } from "@/lib/dealer-features";
import {
  defaultBookingSettings,
  appointmentLabel,
} from "@/lib/test-drive-dates";
import { validStaffAppointmentDateTime } from "../../../../api-server/src/lib/booking-slots";
import "./quick-enquiry.css";

export type QuickEnquiryResult = {
  id: string;
  reference: string;
  appointmentAt?: string | null;
  appointmentStatus?: string | null;
  customerNotificationStatus?: string | null;
};
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (result: QuickEnquiryResult) => void;
  onContinueEnquiry?: (id: string) => void;
  initialVehicleId?: string | null;
  initialBookTestDrive?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
};
const emptyForm = { name: "", phone: "", email: "", vehicleId: "", notes: "" };
type ValidationField =
  "customerName" | "phone" | "email" | "vehicle" | "notes" | "appointment";
function saveError(error: unknown) {
  const value = error as { status?: number; data?: { error?: unknown } } | null;
  return value?.status &&
    value.status >= 400 &&
    value.status < 500 &&
    typeof value.data?.error === "string"
    ? value.data.error
    : "We could not confirm whether this was saved. Check Enquiries or Test drives before retrying; your details are still here.";
}

/** Enquiry-only capture stays silent; optional test drives use the booking policy. */
export function QuickEnquiryDialog({
  open,
  onOpenChange,
  onCreated,
  onContinueEnquiry,
  initialVehicleId,
  initialBookTestDrive = false,
  returnFocusRef,
}: Props) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<ValidationField, string>>
  >({});
  const [focusRequest, setFocusRequest] = useState<{
    field: ValidationField;
    revision: number;
  } | null>(null);
  const formId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const carRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const bookingRef = useRef<HTMLElement>(null);
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState(false);
  const [appointmentTime, setAppointmentTime] = useState("");
  const [slotValid, setSlotValid] = useState(false);
  const [saved, setSaved] = useState<{
    result: QuickEnquiryResult;
    name: string;
    car: string;
  } | null>(null);
  const [messaging, setMessaging] = useState(false);
  const [createAnotherKey, setCreateAnotherKey] = useState("");
  const submitting = useRef(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || messaging || !viewport) return;
    let frame: number | undefined;
    const updateViewport = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      dialog.style.setProperty(
        "--quick-viewport-height",
        `${viewport.height}px`,
      );
      dialog.style.setProperty(
        "--quick-viewport-bottom",
        `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`,
      );
    };
    const resize = () => {
      updateViewport();
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (
          window.innerWidth < 640 &&
          active instanceof HTMLElement &&
          dialogRef.current?.contains(active)
        )
          active.scrollIntoView?.({ block: "nearest" });
      });
    };
    updateViewport();
    // Radix can attach its portal after this first effect has run.
    frame = requestAnimationFrame(updateViewport);
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", resize);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [open, messaging]);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setForm({ ...emptyForm, vehicleId: initialVehicleId || "" });
      setError("");
      setFieldErrors({});
      setFocusRequest(null);
      setBooking(initialBookTestDrive);
      setAppointmentTime("");
      setSlotValid(false);
      setSaved(null);
      setMessaging(false);
      setCreateAnotherKey("");
    }
    wasOpen.current = open;
  }, [open, initialVehicleId, initialBookTestDrive]);
  const cache = useQueryClient();
  const access = useStaffAccess(open);
  const allowed = Boolean(access.data?.permissions.includes("sales.manage"));
  const recentCustomers = useEnquirySummaries(undefined, {
    query: {
      queryKey: getGetEnquiriesQueryKey(),
      enabled: open && allowed,
      retry: false,
    },
  });
  const directory = useGetStaffDirectory({
    query: {
      queryKey: getGetStaffDirectoryQueryKey(),
      enabled: open && allowed,
      retry: false,
    },
  });
  const { stock, isLoading: stockLoading, error: stockError } = useStock();
  const features = useDealerFeatures();
  const {
    settings,
    isLoading: settingsLoading,
    isError: settingsError,
  } = useDealerSettings();
  const policy = settings.testDriveBooking ?? defaultBookingSettings;
  const bookingEnabled =
    !features.isLoading &&
    !features.isError &&
    features.enabled("testDriveBookings") &&
    !settingsLoading &&
    !settingsError &&
    policy.enabled;
  const selectedCar = stock?.cars.find((car) => car.id === form.vehicleId);
  const carAvailable = Boolean(
    selectedCar &&
    selectedCar.inventoryStatus === "available" &&
    !stockLoading &&
    !stockError,
  );
  useEffect(() => {
    if (!open || !booking || !bookingEnabled || !carAvailable) {
      setAppointmentTime("");
      setSlotValid(false);
    }
  }, [open, booking, bookingEnabled, carAvailable]);
  const mutation = useCreateStaffEnquiry({
    request: { headers: { "X-Enquiry-Capture": "quick" } },
    mutation: { retry: false },
  });
  // Appointments use the normal booking workflow, including its notification
  // policy. The silent quick-capture header remains enquiry-only.
  const bookingMutation = useCreateStaffEnquiry({ mutation: { retry: false } });
  const pending = saving || mutation.isPending || bookingMutation.isPending;
  const continuing = useMemo(
    () =>
      onContinueEnquiry && allowed && !recentCustomers.isError
        ? findContinuingEnquiries(recentCustomers.data ?? [], form)
        : [],
    [
      onContinueEnquiry,
      allowed,
      recentCustomers.data,
      recentCustomers.isError,
      form.phone,
      form.email,
      form.vehicleId,
    ],
  );
  const continuationKey = JSON.stringify([
    form.phone,
    form.email,
    form.vehicleId,
    continuing.map((choice) => choice.primary.id),
  ]);
  const showContinuing =
    continuing.length > 0 && createAnotherKey !== continuationKey;
  const dirty =
    booking !== initialBookTestDrive ||
    form.vehicleId !== (initialVehicleId || "") ||
    Boolean(appointmentTime) ||
    [form.name, form.phone, form.email, form.notes].some((value) =>
      value.trim(),
    );
  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    clearFieldErrors();
  };
  function clearFieldErrors() {
    setFieldErrors({});
    // An uncertain server result must remain visible while staff edit details.
    if (Object.keys(fieldErrors).length) setError("");
  }
  function invalid(field: ValidationField, message: string) {
    setError(message);
    setFieldErrors({ [field]: message });
    setFocusRequest((current) => ({
      field,
      revision: (current?.revision ?? 0) + 1,
    }));
  }
  useEffect(() => {
    if (!focusRequest) return;
    const refs = {
      customerName: nameRef,
      phone: phoneRef,
      email: emailRef,
      vehicle: carRef,
      notes: notesRef,
    };
    const target =
      focusRequest.field === "appointment"
        ? (bookingRef.current?.querySelector<HTMLElement>(
            ".quick-booking-picker select:not(:disabled), .quick-booking-picker button:not(:disabled)",
          ) ?? bookingRef.current)
        : refs[focusRequest.field].current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "nearest" });
  }, [focusRequest]);
  function dismiss(next: boolean) {
    if (submitting.current || pending) return;
    if (!next && saved) {
      finishSaved();
      return;
    }
    if (
      !next &&
      dirty &&
      !window.confirm(
        "Discard this enquiry? These customer details have not been saved.",
      )
    )
      return;
    if (!next) {
      setForm(emptyForm);
      setError("");
      setBooking(false);
      setAppointmentTime("");
      setSlotValid(false);
    }
    onOpenChange(next);
  }
  function finishSaved() {
    if (!saved) return;
    const result = saved.result;
    setSaved(null);
    setMessaging(false);
    onOpenChange(false);
    onCreated?.(result);
  }
  function continueEnquiry(id: string) {
    if (
      !onContinueEnquiry ||
      !allowed ||
      pending ||
      submitting.current ||
      !continuing.some((choice) => choice.primary.id === id)
    )
      return;
    if (
      (form.notes.trim() || booking || appointmentTime) &&
      !window.confirm(
        "Open the existing enquiry? Notes and test-drive choices on this form have not been saved and will be discarded. Nothing will be added to the existing enquiry.",
      )
    )
      return;
    setForm(emptyForm);
    setError("");
    setFieldErrors({});
    setBooking(false);
    setAppointmentTime("");
    setSlotValid(false);
    setCreateAnotherKey("");
    onOpenChange(false);
    onContinueEnquiry(id);
  }
  async function submit(event: FormEvent, messageAfter = false) {
    event.preventDefault();
    if (submitting.current || pending) return;
    setError("");
    setFieldErrors({});
    if (!allowed || access.isError) {
      setError("Your staff role does not allow creating enquiries.");
      return;
    }
    if (!directory.data || directory.isError) {
      setError("Load your staff details before saving.");
      return;
    }
    if (form.name.trim().length < 2 || form.name.trim().length > 120) {
      invalid("customerName", "Enter the customer’s name (2–120 characters).");
      return;
    }
    if (
      form.phone.trim().length > 40 ||
      !/^\+?\d{7,15}$/.test(form.phone.trim().replace(/[\s().\-/]/g, ""))
    ) {
      invalid("phone", "Enter a valid contact number.");
      return;
    }
    if (
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    ) {
      invalid("email", "Enter a valid email address, or leave it blank.");
      return;
    }
    if (form.notes.length > 2000) {
      invalid("notes", "Keep the notes within 2,000 characters.");
      return;
    }
    if (
      form.vehicleId &&
      !stock?.cars.some((car) => car.id === form.vehicleId)
    ) {
      invalid(
        "vehicle",
        "Choose a current stock car, or select No specific car.",
      );
      return;
    }
    if (booking) {
      if (!bookingEnabled) {
        invalid(
          "appointment",
          "Test-drive bookings are unavailable. Turn off Book a Test Drive to save an enquiry only.",
        );
        return;
      }
      if (!carAvailable) {
        invalid("vehicle", "Choose an available stock car for the test drive.");
        return;
      }
      if (
        !slotValid ||
        !appointmentTime ||
        !validStaffAppointmentDateTime(new Date(appointmentTime))
      ) {
        invalid("appointment", "Choose an available future test-drive time.");
        return;
      }
    }
    submitting.current = true;
    setSaving(true);
    let created: QuickEnquiryResult;
    try {
      created = await (booking ? bookingMutation : mutation).mutateAsync({
        data: {
          assignedToId: directory.data.currentUserId || null,
          type: booking ? "viewing" : "general",
          customerName: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          preferredContact: "phone",
          vehicleId: form.vehicleId || null,
          message:
            form.notes.trim() ||
            (booking
              ? "Test drive arranged with the showroom."
              : "Customer enquiry recorded by our showroom."),
          appointmentAt: booking ? appointmentTime : null,
          ...(booking
            ? {
                callOutcome: "test_drive_booked" as const,
                allowOutsideHours: false,
                allowDoubleBooking: false,
              }
            : {}),
        },
      });
    } catch (cause) {
      setError(saveError(cause));
      if (booking && (cause as { status?: number })?.status === 409) {
        setAppointmentTime("");
        setSlotValid(false);
        void cache.invalidateQueries({
          predicate: (query) =>
            String(query.queryKey[0]).endsWith("/availability"),
        });
        void cache.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() });
        void cache.invalidateQueries({ queryKey: getGetStockQueryKey() });
      }
      return;
    } finally {
      submitting.current = false;
      setSaving(false);
    }
    const result = {
      id: created.id,
      reference: created.reference,
      ...(created.appointmentAt
        ? {
            appointmentAt: created.appointmentAt,
            appointmentStatus: created.appointmentStatus,
            customerNotificationStatus: created.customerNotificationStatus,
          }
        : {}),
    };
    if (messageAfter)
      setSaved({
        result,
        name: form.name.trim(),
        car: selectedCar?.title || "General enquiry",
      });
    setForm(emptyForm);
    setError("");
    setBooking(false);
    setAppointmentTime("");
    setSlotValid(false);
    void Promise.allSettled([
      cache.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }),
      ...(created.appointmentAt
        ? [
            cache.invalidateQueries({
              queryKey: getGetTestDriveBookingsQueryKey(),
            }),
            cache.invalidateQueries({
              predicate: (query) =>
                String(query.queryKey[0]).endsWith("/availability"),
            }),
          ]
        : []),
      ...[
        "staff-notifications",
        "dealer-operations",
        "staff-relationships",
        "inventory-customers",
      ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
    ]);
    if (!messageAfter) {
      onOpenChange(false);
      onCreated?.(result);
    }
  }
  return (
    <>
      <Dialog open={open && !messaging} onOpenChange={dismiss}>
        <DialogContent
          ref={dialogRef}
          className="portal-action-dialog quick-enquiry-dialog"
          aria-busy={pending}
          data-saving={pending}
          data-booking={booking}
          onOpenAutoFocus={(event) => {
            // Keep the phone keyboard closed until staff choose a field.
            if (window.matchMedia?.("(max-width: 639px)").matches) {
              event.preventDefault();
              headingRef.current?.focus({ preventScroll: true });
            }
          }}
          onCloseAutoFocus={(event) => {
            // Opening the message composer keeps focus in that customer workflow.
            if (messaging) {
              event.preventDefault();
              return;
            }
            if (returnFocusRef?.current?.isConnected) {
              event.preventDefault();
              returnFocusRef.current.focus({ preventScroll: true });
            }
          }}
          onEscapeKeyDown={(event) => {
            if (submitting.current || pending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (submitting.current || pending) event.preventDefault();
          }}
        >
          <DialogHeader className="quick-enquiry-heading">
            <DialogTitle ref={headingRef} tabIndex={-1}>
              <MessageSquarePlus aria-hidden size={20} />
              {booking ? "Book test drive" : "New enquiry"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {booking
                ? "Save the customer’s details and test drive together."
                : "Record the customer’s details, with an optional car and notes."}
            </DialogDescription>
          </DialogHeader>
          {saved ? (
            <div className="quick-enquiry-saved">
              <p className="quick-enquiry-saved-status" role="status">
                Enquiry saved
                {saved.result.appointmentAt
                  ? saved.result.appointmentStatus === "pending"
                    ? " · test drive awaiting approval"
                    : " and test drive booked"
                  : ""}
              </p>
              <h3>{saved.name}</h3>
              <p>{saved.car}</p>
              <p>
                Review a message for this customer. You can include existing car
                photos or booking details.
              </p>
              <Button type="button" onClick={() => setMessaging(true)}>
                Write a message
              </Button>
              <Button type="button" variant="outline" onClick={finishSaved}>
                Done
              </Button>
              <small>No message is sent until you approve it.</small>
            </div>
          ) : access.isLoading && !access.data ? (
            <div className="quick-enquiry-state" role="status">
              Checking your staff access…
            </div>
          ) : access.isError ? (
            <div className="quick-enquiry-state">
              <p role="alert">Your staff access could not be checked.</p>
              <Button variant="outline" onClick={() => void access.refetch()}>
                Try again
              </Button>
            </div>
          ) : !allowed ? (
            <div className="quick-enquiry-state">
              <p>Your staff role does not allow creating enquiries.</p>
              <Button variant="outline" onClick={() => dismiss(false)}>
                Close
              </Button>
            </div>
          ) : (
            <form className="quick-enquiry-form" onSubmit={submit} noValidate>
              <div className="quick-enquiry-body">
                <fieldset disabled={pending}>
                  <RecentCustomerFields
                    compact
                    value={{
                      customerName: form.name,
                      phone: form.phone,
                      email: form.email,
                    }}
                    onChange={(contact) => {
                      setForm((current) => ({
                        ...current,
                        name: contact.customerName,
                        phone: contact.phone ?? "",
                        email: contact.email ?? "",
                      }));
                      clearFieldErrors();
                    }}
                    customers={(recentCustomers.data ?? []).map((entry) => ({
                      id: entry.id,
                      customerName: entry.customerName,
                      phone: entry.phone,
                      email: entry.email,
                      lastUsedAt: entry.updatedAt || entry.createdAt,
                      detail: entry.vehicleTitle || "General enquiry",
                    }))}
                    inputRefs={{
                      customerName: nameRef,
                      phone: phoneRef,
                      email: emailRef,
                    }}
                    errors={fieldErrors}
                    nameRequired
                    phoneRequired
                    disabled={pending}
                  />
                  {showContinuing && (
                    <section
                      className="grid min-w-0 gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-slate-800"
                      aria-label="Existing enquiries for this contact"
                    >
                      <div>
                        <h3 className="font-semibold">
                          {continuing.length === 1
                            ? "There is already an open enquiry"
                            : `${continuing.length} open enquiries match this contact`}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          Check the customer and car before continuing. Opening
                          an existing enquiry does not copy this form’s details,
                          notes or booking choices.
                        </p>
                      </div>
                      <ul className="grid min-w-0 gap-3">
                        {continuing.map((choice) => (
                          <li
                            key={choice.primary.id}
                            className="grid min-w-0 gap-2 border-t border-emerald-200 pt-3"
                          >
                            <div className="min-w-0 break-words">
                              <strong>{choice.primary.customerName}</strong>
                              <p className="text-xs">
                                {choice.primary.reference} ·{" "}
                                {choice.matchingRecord.vehicleTitle ||
                                  "General enquiry"}
                              </p>
                              <p className="text-xs text-slate-600">
                                {[
                                  choice.matchingRecord.phone,
                                  choice.matchingRecord.email,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                              <p className="text-xs text-emerald-800">
                                Exact {choice.matchedBy.join(" and ")} match
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-auto min-h-11 whitespace-normal text-left"
                              disabled={pending}
                              onClick={() => continueEnquiry(choice.primary.id)}
                            >
                              Continue {choice.primary.customerName} enquiry
                              {continuing.length > 1
                                ? ` · ${choice.primary.reference}`
                                : ""}
                            </Button>
                          </li>
                        ))}
                      </ul>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-h-11 justify-self-start whitespace-normal px-2"
                        disabled={pending}
                        onClick={() => setCreateAnotherKey(continuationKey)}
                      >
                        Create another enquiry
                      </Button>
                      <p className="text-xs text-slate-600">
                        Creating another keeps the records separate. Nothing is
                        merged automatically.
                      </p>
                    </section>
                  )}
                  {recentCustomers.isError && (
                    <p className="quick-enquiry-hint">
                      Recent customers could not load. You can still enter their
                      details.
                    </p>
                  )}
                  <QuickEnquiryCars
                    cars={stock?.cars ?? []}
                    value={form.vehicleId}
                    inputRef={carRef}
                    error={fieldErrors.vehicle}
                    disabled={pending}
                    loading={stockLoading}
                    failed={Boolean(stockError)}
                    onChange={(id) => {
                      update("vehicleId", id);
                      setAppointmentTime("");
                      setSlotValid(false);
                    }}
                  />
                  <div className="quick-enquiry-notes">
                    <label htmlFor={`${formId}-notes`}>Notes (optional)</label>
                    <Textarea
                      id={`${formId}-notes`}
                      ref={notesRef}
                      rows={2}
                      maxLength={2000}
                      value={form.notes}
                      aria-invalid={fieldErrors.notes ? true : undefined}
                      aria-describedby={
                        fieldErrors.notes ? `${formId}-notes-error` : undefined
                      }
                      onChange={(event) => update("notes", event.target.value)}
                      placeholder="What would they like to know?"
                    />
                    {fieldErrors.notes && (
                      <p
                        id={`${formId}-notes-error`}
                        className="quick-enquiry-field-error"
                        role="alert"
                      >
                        {fieldErrors.notes}
                      </p>
                    )}
                  </div>
                  <section
                    ref={bookingRef}
                    tabIndex={-1}
                    className="quick-enquiry-booking"
                    aria-label="Optional test-drive booking"
                    aria-describedby={
                      fieldErrors.appointment
                        ? `${formId}-booking-error`
                        : undefined
                    }
                  >
                    <label className="quick-booking-toggle">
                      <input
                        type="checkbox"
                        aria-label="Book a Test Drive"
                        checked={booking}
                        disabled={pending || (!booking && !bookingEnabled)}
                        onChange={(event) => {
                          setBooking(event.target.checked);
                          setAppointmentTime("");
                          setSlotValid(false);
                          clearFieldErrors();
                        }}
                      />
                      <CalendarDays size={18} aria-hidden="true" />
                      <span>{booking ? "Test drive" : "Add test drive"}</span>
                    </label>
                    {!bookingEnabled && (
                      <div className="quick-booking-unavailable">
                        <p>
                          {features.isLoading || settingsLoading
                            ? "Checking test-drive availability…"
                            : features.isError || settingsError
                              ? "Booking availability could not load. You can still save an enquiry."
                              : !features.enabled("testDriveBookings")
                                ? "Test-drive bookings are paused by the platform. You can still save an enquiry."
                                : "Test-drive bookings are switched off in Settings. You can still save an enquiry."}
                        </p>
                        {(features.isError || settingsError) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              void features.refetch();
                              void cache.invalidateQueries({
                                queryKey: getGetDealerSettingsQueryKey(),
                              });
                            }}
                          >
                            Retry booking availability
                          </Button>
                        )}
                      </div>
                    )}
                    {booking &&
                      bookingEnabled &&
                      (carAvailable ? (
                        <div className="quick-booking-picker">
                          <AppointmentSlots
                            key={form.vehicleId}
                            value={appointmentTime}
                            onChange={(value) => {
                              setAppointmentTime(value);
                              clearFieldErrors();
                            }}
                            onValidityChange={setSlotValid}
                          />
                          {appointmentTime && slotValid && (
                            <p className="quick-booking-summary">
                              <CalendarDays size={16} aria-hidden="true" />
                              {appointmentLabel(appointmentTime)}
                            </p>
                          )}
                          {policy.confirmationMode === "approval" && (
                            <p className="quick-booking-note">
                              This creates a request awaiting staff approval.
                            </p>
                          )}
                          <OptionalJourneyPostcode />
                        </div>
                      ) : (
                        <p className="quick-booking-note">
                          Choose an available car above to see test-drive times.
                        </p>
                      ))}
                    {fieldErrors.appointment && (
                      <p
                        id={`${formId}-booking-error`}
                        className="quick-enquiry-field-error"
                        role="alert"
                      >
                        {fieldErrors.appointment}
                      </p>
                    )}
                  </section>
                </fieldset>
                {directory.isLoading && !directory.data && (
                  <p className="quick-enquiry-hint" role="status">
                    Loading your staff details…
                  </p>
                )}
                {directory.isError && (
                  <div className="quick-enquiry-directory-error">
                    <p role="alert">
                      Your staff details could not load. Your enquiry details
                      are still here.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void directory.refetch()}
                    >
                      Retry staff details
                    </Button>
                  </div>
                )}
                {error && !Object.keys(fieldErrors).length && (
                  <p className="quick-enquiry-error" role="alert">
                    {error}
                  </p>
                )}
                <p className="quick-enquiry-delivery-note">
                  {!booking
                    ? "Enquiry only: no email is sent."
                    : form.email.trim()
                      ? "Booking emails follow your dealership’s email settings."
                      : "No email supplied — confirm this appointment by phone."}
                </p>
              </div>
              <footer className="quick-enquiry-footer">
                <Button
                  type="button"
                  variant="ghost"
                  className="quick-enquiry-cancel"
                  onClick={() => dismiss(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    pending ||
                    !directory.data ||
                    directory.isError ||
                    (booking &&
                      (!bookingEnabled ||
                        !carAvailable ||
                        !appointmentTime ||
                        !slotValid))
                  }
                >
                  {pending && (
                    <LoaderCircle
                      size={16}
                      className="animate-spin"
                      aria-hidden
                    />
                  )}
                  {pending
                    ? booking
                      ? "Saving booking…"
                      : "Saving enquiry…"
                    : booking
                      ? "Save booking"
                      : "Save enquiry"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    pending ||
                    !directory.data ||
                    directory.isError ||
                    (booking &&
                      (!bookingEnabled ||
                        !carAvailable ||
                        !appointmentTime ||
                        !slotValid))
                  }
                  onClick={(event) => void submit(event, true)}
                >
                  Save & message
                </Button>
              </footer>
            </form>
          )}
        </DialogContent>
      </Dialog>
      {open && saved && messaging && (
        <EnquiryEmailComposer
          messageMode
          entry={{
            id: saved.result.id,
            reference: saved.result.reference,
            customerName: saved.name,
          }}
          onClose={() => setMessaging(false)}
        />
      )}
    </>
  );
}
