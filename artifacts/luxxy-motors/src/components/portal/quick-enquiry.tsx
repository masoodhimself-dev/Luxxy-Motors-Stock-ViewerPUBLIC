import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEnquiriesQueryKey,
  getGetStaffDirectoryQueryKey,
  useCreateStaffEnquiry,
  useGetStaffDirectory,
} from "@workspace/api-client-react";
import { LoaderCircle, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import "./quick-enquiry.css";

export type QuickEnquiryResult = { id: string; reference: string };
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (result: QuickEnquiryResult) => void;
};
const emptyForm = { name: "", phone: "", email: "", vehicleId: "", notes: "" };
function saveError(error: unknown) {
  const value = error as { data?: { error?: unknown } } | null;
  return typeof value?.data?.error === "string"
    ? value.data.error
    : "We could not confirm whether this was saved. Check Enquiries before retrying; your details are still here.";
}

/** A staff capture only: the server's quick mode suppresses all automatic emails. */
export function QuickEnquiryDialog({ open, onOpenChange, onCreated }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const cache = useQueryClient();
  const access = useStaffAccess(open);
  const allowed = Boolean(access.data?.permissions.includes("sales.manage"));
  const directory = useGetStaffDirectory({
    query: {
      queryKey: getGetStaffDirectoryQueryKey(),
      enabled: open && allowed,
      retry: false,
    },
  });
  const { stock, isLoading: stockLoading, error: stockError } = useStock();
  const mutation = useCreateStaffEnquiry({
    request: { headers: { "X-Enquiry-Capture": "quick" } },
    mutation: { retry: false },
  });
  const pending = saving || mutation.isPending;
  const dirty = Object.values(form).some((value) => value.trim());
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
      created = await mutation.mutateAsync({
        data: {
          assignedToId: directory.data.currentUserId || null,
          type: "general",
          customerName: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          preferredContact: "phone",
          vehicleId: form.vehicleId || null,
          message:
            form.notes.trim() || "Customer enquiry recorded by our showroom.",
          appointmentAt: null,
        },
      });
    } catch (cause) {
      setError(saveError(cause));
      return;
    } finally {
      submitting.current = false;
      setSaving(false);
    }
    setForm(emptyForm);
    setError("");
    void Promise.allSettled([
      cache.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }),
      ...[
        "staff-notifications",
        "dealer-operations",
        "staff-relationships",
        "inventory-customers",
      ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
    ]);
    onOpenChange(false);
    onCreated?.({ id: created.id, reference: created.reference });
  }
  return (
    <Dialog open={open} onOpenChange={dismiss}>
      <DialogContent
        className="portal-action-dialog quick-enquiry-dialog"
        aria-busy={pending}
        data-saving={pending}
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
            Save the details now. No email is sent.
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
                <label>
                  Customer name
                  <Input
                    autoComplete="off"
                    value={form.name}
                    onChange={(event) => update("name", event.target.value)}
                    required
                    minLength={2}
                    maxLength={120}
                  />
                </label>
                <div className="quick-enquiry-contact">
                  <label>
                    Phone number
                    <Input
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      value={form.phone}
                      onChange={(event) => update("phone", event.target.value)}
                      required
                      maxLength={40}
                    />
                  </label>
                  <label>
                    Email (optional)
                    <Input
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      value={form.email}
                      onChange={(event) => update("email", event.target.value)}
                      maxLength={320}
                    />
                  </label>
                </div>
                <label>
                  Car (optional)
                  <NativeSelect
                    value={form.vehicleId}
                    onChange={(event) =>
                      update("vehicleId", event.target.value)
                    }
                  >
                    <option value="">No specific car</option>
                    {(stock?.cars ?? []).map((car) => (
                      <option key={car.id} value={car.id}>
                        {[
                          vehicleDisplayTitle(car),
                          car.year,
                          vehicleRegistrationLabel(car),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
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
                disabled={pending || !directory.data || directory.isError}
              >
                {pending && (
                  <LoaderCircle
                    size={16}
                    className="animate-spin"
                    aria-hidden
                  />
                )}
                {pending ? "Saving enquiry…" : "Save enquiry"}
              </Button>
            </footer>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
