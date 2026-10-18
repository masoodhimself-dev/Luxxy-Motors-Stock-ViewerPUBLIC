import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { CalendarDays, LoaderCircle, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStock } from "@/lib/stock-context";
import { vehicleDisplayTitle, vehicleRegistrationLabel } from "@/lib/utils";
import { useStaffAccess } from "./dealer-administration";
import { useEnquirySummaries } from "@/lib/enquiry-summary-query";
import { RecentCustomerFields } from "./recent-customer-fields";
import { AppointmentSlots } from "./appointment-slots";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { useDealerFeatures } from "@/lib/dealer-features";
import { defaultBookingSettings, appointmentLabel } from "@/lib/test-drive-dates";
import { validStaffAppointmentDateTime } from "../../../../api-server/src/lib/booking-slots";
import "./quick-enquiry.css";

export type QuickEnquiryResult = { id: string; reference: string; appointmentAt?: string | null; appointmentStatus?: string | null; customerNotificationStatus?: string | null };
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (result: QuickEnquiryResult) => void;
  initialVehicleId?: string | null;
};
const emptyForm = { name: "", phone: "", email: "", vehicleId: "", notes: "" };
function saveError(error: unknown) {
  const value = error as { status?: number; data?: { error?: unknown } } | null;
  return value?.status && value.status >= 400 && value.status < 500 && typeof value.data?.error === "string"
    ? value.data.error
    : "We could not confirm whether this was saved. Check Enquiries or Test drives before retrying; your details are still here.";
}

/** Enquiry-only capture stays silent; optional test drives use the booking policy. */
export function QuickEnquiryDialog({ open, onOpenChange, onCreated, initialVehicleId }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState(false);
  const [appointmentTime, setAppointmentTime] = useState("");
  const [slotValid, setSlotValid] = useState(false);
  const submitting = useRef(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setForm({ ...emptyForm, vehicleId: initialVehicleId || "" });
      setError("");
      setBooking(false);
      setAppointmentTime("");
      setSlotValid(false);
    }
    wasOpen.current = open;
  }, [open, initialVehicleId]);
  const cache = useQueryClient();
  const access = useStaffAccess(open);
  const allowed = Boolean(access.data?.permissions.includes("sales.manage"));
  const recentCustomers = useEnquirySummaries(undefined, {
    query: { queryKey: getGetEnquiriesQueryKey(), enabled: open && allowed, retry: false },
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
  const { settings, isLoading: settingsLoading, isError: settingsError } = useDealerSettings();
  const policy = settings.testDriveBooking ?? defaultBookingSettings;
  const bookingEnabled = !features.isLoading && !features.isError && features.enabled("testDriveBookings") && !settingsLoading && !settingsError && policy.enabled;
  const selectedCar = stock?.cars.find(car => car.id === form.vehicleId);
  const carAvailable = Boolean(selectedCar && selectedCar.inventoryStatus === "available" && !stockLoading && !stockError);
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
  const dirty = booking || [form.name, form.phone, form.email, form.notes].some((value) => value.trim()) || form.vehicleId !== (initialVehicleId || "");
  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  function dismiss(next: boolean) {
    if (submitting.current || pending) return;
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || pending) return;
    setError("");
    if (!allowed || access.isError) {
      setError("Your staff role does not allow creating enquiries.");
      return;
    }
    if (!directory.data || directory.isError) {
      setError("Load your staff details before saving.");
      return;
    }
    if (form.name.trim().length < 2 || form.name.trim().length > 120) {
      setError("Enter the customer’s name (2–120 characters).");
      return;
    }
    if (
      form.phone.trim().length > 40 ||
      !/^\+?\d{7,15}$/.test(form.phone.trim().replace(/[\s().\-/]/g, ""))
    ) {
      setError("Enter a valid contact number.");
      return;
    }
    if (booking) {
      if (!bookingEnabled) { setError("Test-drive bookings are unavailable. Turn off Book a test drive to save an enquiry only."); return; }
      if (!carAvailable) { setError("Choose an available stock car for the test drive."); return; }
      if (!slotValid || !appointmentTime || !validStaffAppointmentDateTime(new Date(appointmentTime))) { setError("Choose an available future test-drive time."); return; }
    }
    if (
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    ) {
      setError("Enter a valid email address, or leave it blank.");
      return;
    }
    if (form.notes.length > 2000) {
      setError("Keep the notes within 2,000 characters.");
      return;
    }
    if (
      form.vehicleId &&
      !stock?.cars.some((car) => car.id === form.vehicleId)
    ) {
      setError("Choose a current stock car, or select No specific car.");
      return;
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
            form.notes.trim() || (booking ? "Test drive arranged with the showroom." : "Customer enquiry recorded by our showroom."),
          appointmentAt: booking ? appointmentTime : null,
          ...(booking ? { callOutcome: "test_drive_booked" as const, allowOutsideHours: false, allowDoubleBooking: false } : {}),
        },
      });
    } catch (cause) {
      setError(saveError(cause));
      if (booking && (cause as { status?: number })?.status === 409) {
        setAppointmentTime(""); setSlotValid(false);
        void cache.invalidateQueries({ predicate: query => String(query.queryKey[0]).endsWith("/availability") });
        void cache.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() });
        void cache.invalidateQueries({ queryKey: getGetStockQueryKey() });
      }
      return;
    } finally {
      submitting.current = false;
      setSaving(false);
    }
    setForm(emptyForm);
    setError("");
    setBooking(false);
    setAppointmentTime("");
    setSlotValid(false);
    void Promise.allSettled([
      cache.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }),
      ...(created.appointmentAt ? [cache.invalidateQueries({ queryKey: getGetTestDriveBookingsQueryKey() }), cache.invalidateQueries({ predicate: query => String(query.queryKey[0]).endsWith("/availability") })] : []),
      ...[
        "staff-notifications",
        "dealer-operations",
        "staff-relationships",
        "inventory-customers",
      ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
    ]);
    onOpenChange(false);
    onCreated?.({ id: created.id, reference: created.reference, ...(created.appointmentAt ? { appointmentAt: created.appointmentAt, appointmentStatus: created.appointmentStatus, customerNotificationStatus: created.customerNotificationStatus } : {}) });
  }
  return (
    <Dialog open={open} onOpenChange={dismiss}>
      <DialogContent
        className="portal-action-dialog quick-enquiry-dialog"
        aria-busy={pending}
        data-saving={pending}
        data-booking={booking}
        onEscapeKeyDown={(event) => {
          if (submitting.current || pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (submitting.current || pending) event.preventDefault();
        }}
      >
        <DialogHeader className="quick-enquiry-heading">
          <DialogTitle>
            <MessageSquarePlus aria-hidden size={21} />
            Quick enquiry
          </DialogTitle>
          <DialogDescription>
            {booking ? "Save the enquiry and test drive together." : "Save the details now, or add a test drive below."}
          </DialogDescription>
        </DialogHeader>
        {access.isLoading && !access.data ? (
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
                  value={{ customerName: form.name, phone: form.phone, email: form.email }}
                  onChange={contact => setForm(current => ({ ...current, name: contact.customerName, phone: contact.phone ?? "", email: contact.email ?? "" }))}
                  customers={(recentCustomers.data ?? []).map(entry => ({ id: entry.id, customerName: entry.customerName, phone: entry.phone, email: entry.email, lastUsedAt: entry.updatedAt || entry.createdAt, detail: `${entry.reference} · ${entry.vehicleTitle || "General enquiry"}` }))}
                  nameRequired
                  phoneRequired
                  disabled={pending}
                />
                {recentCustomers.isError && <p className="quick-enquiry-hint">Recent customers could not load. You can still enter their details.</p>}
                <label>
                  {booking ? "Car for the test drive" : "Car (optional)"}
                  <NativeSelect
                    value={form.vehicleId}
                    onChange={(event) => { update("vehicleId", event.target.value); setAppointmentTime(""); setSlotValid(false); setError(""); }}
                  >
                    <option value="">No specific car</option>
                    {(stock?.cars ?? []).filter(car => !booking || car.inventoryStatus === "available" || car.id === form.vehicleId).map((car) => (
                      <option key={car.id} value={car.id} disabled={booking && car.inventoryStatus !== "available"}>
                        {[
                          vehicleDisplayTitle(car),
                          car.year,
                          vehicleRegistrationLabel(car),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {booking && car.inventoryStatus !== "available" ? " · Unavailable for a test drive" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                {(stockLoading || stockError) && (
                  <p className="quick-enquiry-hint">
                    {stockLoading
                      ? "Stock is loading. You can save without choosing a car."
                      : "Stock could not load. You can still save without choosing a car."}
                  </p>
                )}
                <section className="quick-enquiry-booking" aria-label="Optional test-drive booking">
                  <label className="quick-booking-toggle">
                    <input type="checkbox" aria-label="Book a test drive" checked={booking} disabled={pending || (!booking && !bookingEnabled)} onChange={event => { setBooking(event.target.checked); setAppointmentTime(""); setSlotValid(false); setError(""); }} />
                    <span><strong>Book a test drive</strong><small>Add the appointment to this enquiry.</small></span>
                    <CalendarDays size={20} aria-hidden="true" />
                  </label>
                  {!bookingEnabled && <div className="quick-booking-unavailable"><p>{features.isLoading || settingsLoading ? "Checking test-drive availability…" : features.isError || settingsError ? "Booking availability could not load. You can still save an enquiry." : !features.enabled("testDriveBookings") ? "Test-drive bookings are paused by the platform. You can still save an enquiry." : "Test-drive bookings are switched off in Settings. You can still save an enquiry."}</p>{(features.isError || settingsError) && <Button type="button" variant="outline" size="sm" onClick={() => { void features.refetch(); void cache.invalidateQueries({ queryKey: getGetDealerSettingsQueryKey() }); }}>Retry booking availability</Button>}</div>}
                  {booking && bookingEnabled && (carAvailable ? <div className="quick-booking-picker">
                    <AppointmentSlots key={form.vehicleId} value={appointmentTime} onChange={setAppointmentTime} onValidityChange={setSlotValid} />
                    {appointmentTime && slotValid && <p className="quick-booking-summary"><CalendarDays size={16} aria-hidden="true" />{appointmentLabel(appointmentTime)} · UK time</p>}
                    {policy.confirmationMode === "approval" && <p className="quick-booking-note">This creates a request awaiting staff approval.</p>}
                  </div> : <p className="quick-booking-note">Choose an available car above to see test-drive times.</p>)}
                </section>
                <label>
                  Notes (optional)
                  <Textarea
                    rows={3}
                    maxLength={2000}
                    value={form.notes}
                    onChange={(event) => update("notes", event.target.value)}
                    placeholder="What would the customer like to know?"
                  />
                </label>
              </fieldset>
              {directory.isLoading && !directory.data && (
                <p className="quick-enquiry-hint" role="status">
                  Loading your staff details…
                </p>
              )}
              {directory.isError && (
                <div className="quick-enquiry-directory-error">
                  <p role="alert">
                    Your staff details could not load. Your enquiry details are
                    still here.
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
              {error && (
                <p className="quick-enquiry-error" role="alert">
                  {error}
                </p>
              )}
              <p className="quick-enquiry-delivery-note">{!booking ? "Enquiry only: no email is sent." : form.email.trim() ? "Booking emails follow your dealership’s email settings." : "No email supplied — confirm this appointment by phone."}</p>
            </div>
            <footer className="quick-enquiry-footer">
              <Button
                type="button"
                variant="outline"
                onClick={() => dismiss(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || !directory.data || directory.isError || (booking && (!bookingEnabled || !carAvailable || !appointmentTime || !slotValid))}
              >
                {pending && (
                  <LoaderCircle
                    size={16}
                    className="animate-spin"
                    aria-hidden
                  />
                )}
                {pending ? booking ? "Saving booking…" : "Saving enquiry…" : booking ? "Save enquiry & book test drive" : "Save enquiry"}
              </Button>
            </footer>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
