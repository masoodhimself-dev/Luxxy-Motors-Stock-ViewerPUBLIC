import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getGetEnquiriesQueryKey,
  getGetTestDriveBookingsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { customerWhatsAppUrl } from "@/lib/customer-whatsapp";

type Props = {
  saleId?: string;
  enquiryId?: string;
  customerName?: string;
  customerPhone?: string;
  confirmedPhone?: string;
  vehicleId?: string;
  message: string;
  label?: string;
  disabled?: boolean;
  beforeOpen?: () => Promise<void>;
  onEmailFallback?: (message: string) => void;
};

/** Direct handoff only. A staff confirmation journals the message; it never sends it. */
export function DirectWhatsApp({
  saleId,
  enquiryId,
  customerName = "",
  customerPhone = "",
  confirmedPhone,
  vehicleId,
  message,
  label = "WhatsApp",
  disabled,
  beforeOpen,
  onEmailFallback,
}: Props) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false),
    [phone, setPhone] = useState(customerPhone),
    [text, setText] = useState(message);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [opened, setOpened] = useState(false),
    [saved, setSaved] = useState(false);
  const [saleChecked, setSaleChecked] = useState(false);
  const [resolved, setResolved] = useState<{
    id: string;
    customerName: string;
    phone?: string;
  } | null>(null);
  const attempt = useRef<{
    requestId: string;
    phone: string;
    message: string;
  } | null>(null);
  useEffect(() => {
    if (!open) return;
    setPhone(confirmedPhone || customerPhone);
    setText(message);
    setOpened(false);
    setSaved(false);
    setError("");
    setResolved(null);
    setSaleChecked(false);
    attempt.current = null;
    if (!enquiryId && !saleId) return;
    let active = true;
    setBusy(true);
    void customFetch<{
      enquiries: {
        id: string;
        requestedEnquiryId?: string;
        customerName: string;
        phone?: string;
      }[];
      saleCustomer?: { customerName: string; phone?: string };
    }>(
      `/api/staff/whatsapp/enquiries?${saleId ? `saleId=${encodeURIComponent(saleId)}` : `id=${encodeURIComponent(enquiryId!)}`}`,
    )
      .then((result) => {
        if (!active) return;
        const row = saleId
          ? result.enquiries[0]
          : result.enquiries.find(
              (item) =>
                item.id === enquiryId || item.requestedEnquiryId === enquiryId,
            );
        if (!row && !result.saleCustomer)
          throw new Error("Reopen the current customer enquiry.");
        setResolved(row || null);
        setSaleChecked(Boolean(saleId && result.saleCustomer));
        const checkedPhone = result.saleCustomer?.phone || row?.phone;
        if (!confirmedPhone && checkedPhone) setPhone(checkedPhone);
      })
      .catch(() => {
        if (active)
          setError(
            "Customer details could not be checked. Close and reopen the enquiry before sharing.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [
    open,
    saleId,
    enquiryId,
    customerName,
    customerPhone,
    confirmedPhone,
    message,
  ]);
  const url = customerWhatsAppUrl(phone, text);
  const ready = Boolean(
    url &&
    text.trim() &&
    (saleId
      ? saleChecked
      : enquiryId
        ? resolved
        : customerName.trim().length >= 2),
  );
  async function begin() {
    setError("");
    setBusy(true);
    try {
      await beforeOpen?.();
      setOpen(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Reopen the current record.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!ready || busy || saved || !opened) return;
    setBusy(true);
    setError("");
    attempt.current ??= {
      requestId: crypto.randomUUID(),
      phone,
      message: text,
    };
    try {
      await beforeOpen?.();
      await customFetch("/api/staff/whatsapp/confirm-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...attempt.current,
          ...(saleId
            ? { saleId }
            : resolved
              ? { enquiryId: resolved.id }
              : { newCustomer: { name: customerName } }),
          ...(!saleId && vehicleId ? { vehicleId } : {}),
          confirmed: true,
        }),
      });
      setSaved(true);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["staff-notifications"] }),
        cache.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }),
        cache.invalidateQueries({
          queryKey: getGetTestDriveBookingsQueryKey(),
        }),
        cache.invalidateQueries({ queryKey: ["staff-relationships"] }),
        cache.invalidateQueries({ queryKey: ["enquiry-timeline"] }),
      ]);
    } catch (cause) {
      setError(
        (cause as { data?: { error?: string } })?.data?.error ||
          "Confirmation was not confirmed. Retry here with the same message; check history before starting a new message.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy}
        onClick={() => void begin()}
      >
        {label}
      </Button>
      {error && !open && <p role="alert">{error}</p>}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send on WhatsApp</DialogTitle>
            <DialogDescription>
              Open WhatsApp, send the message, then confirm here to save a copy
              in the customer’s enquiry. Nothing sends automatically.
            </DialogDescription>
          </DialogHeader>
          <p>{resolved?.customerName || customerName}</p>
          <label>
            Customer number
            <Input
              type="tel"
              value={phone}
              disabled={busy || saved || Boolean(attempt.current)}
              onChange={(event) => {
                setPhone(event.target.value);
                setOpened(false);
              }}
            />
          </label>
          <label>
            Message
            <Textarea
              rows={7}
              value={text}
              maxLength={8000}
              disabled={busy || saved || Boolean(attempt.current)}
              onChange={(event) => {
                setText(event.target.value);
                setOpened(false);
              }}
            />
          </label>
          {phone && !url && (
            <p role="alert">
              Enter a valid number, including the country code for numbers
              outside the UK.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {saved ? (
            <p role="status">
              Saved as staff-confirmed WhatsApp in the customer’s enquiry.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {ready && !busy && (
                <a
                  className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-primary-foreground"
                  href={url!}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpened(true)}
                >
                  Open WhatsApp
                </a>
              )}
              <Button
                type="button"
                disabled={!ready || !opened || busy}
                onClick={() => void confirm()}
              >
                {busy ? "Saving confirmation…" : "I’ve sent it"}
              </Button>
              {onEmailFallback && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    onEmailFallback(text);
                    setOpen(false);
                  }}
                >
                  Use email instead
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
