import { useRef, useState } from "react";
import { SiWhatsapp } from "react-icons/si";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ReserveCar } from "@/components/reserve-car";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { showroomHours } from "@/lib/showroom-hours";
import { getWhatsAppHref, recordContactIntent } from "@/lib/cta-helpers";
import {
  vehicleDisplayTitle,
  vehicleRegistration,
  formatPrice,
} from "@/lib/utils";
import type { Car } from "@/lib/stock-context";
export function VehicleWhatsApp({
  car,
  compact = false,
  walkaround = false,
}: {
  car: Car;
  compact?: boolean;
  walkaround?: boolean;
}) {
  const { settings } = useDealerSettings();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [hours, setHours] = useState(() => showroomHours(settings.hours ?? []));
  const trigger = useRef<HTMLButtonElement>(null);
  if (!getWhatsAppHref(undefined, settings)) return null;
  const label = vehicleDisplayTitle(car);
  const options = settings.onlineReservation;
  const canReserve =
    options?.enabled &&
    options.terms?.trim() &&
    (!car.inventoryStatus || car.inventoryStatus === "available") &&
    (car.price ?? 0) > 0 &&
    (car.price ?? 0) * 100 >= options.depositPence &&
    (!car.currency || car.currency.toUpperCase() === "GBP");
  function show() {
    const current = showroomHours(settings.hours ?? []);
    setHours(current);
    setMessage(
      `Hi ${settings.identity.name}, ${walkaround ? "could you send me a walkaround video of" : "is this car still available:"} ${label}${vehicleRegistration(car) ? " (" + vehicleRegistration(car) + ")" : ""}?${current.state === "closed" ? " Please reply when you reopen." : ""}`,
    );
    setOpen(true);
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={show}
        data-vehicle-contact="whatsapp"
        aria-label={
          walkaround ? "Request a walkaround video" : `WhatsApp about ${label}`
        }
        className={
          walkaround
            ? "text-link mt-2 min-h-11 text-sm"
            : `vehicle-contact-action vehicle-contact-action-whatsapp ${compact ? "h-12 w-12 shrink-0 p-0" : ""}`
        }
      >
        <SiWhatsapp aria-hidden="true" className="h-4 w-4" />
        {!compact &&
          (walkaround ? "Request a walkaround video" : "WhatsApp us")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus({ preventScroll: true });
          }}
        >
          <DialogTitle>Review your WhatsApp message</DialogTitle>
          <DialogDescription>
            Check or edit your message. WhatsApp will open next—you still choose
            when to send it.
          </DialogDescription>
          <div className="border-y py-3">
            <p className="font-semibold">{label}</p>
            {car.price != null && (
              <p className="text-sm">{formatPrice(car.price)}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              To {settings.identity.name} · {settings.contact.whatsapp}
            </p>
          </div>
          <p className="text-sm">
            {hours.state === "closed"
              ? `The showroom is closed.${hours.next ? " We next open " + hours.next + "." : ""} You can leave a message now; the team will aim to reply after reopening.`
              : hours.state === "open"
                ? "The showroom is open. The team will reply as soon as they can."
                : "You can leave a message any time. The team will reply during opening hours."}
          </p>
          <label className="grid gap-2 text-sm font-medium">
            Your message
            <Textarea
              rows={5}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          {message.trim() ? (
            <a
              className="vehicle-contact-action vehicle-contact-action-whatsapp"
              href={getWhatsAppHref(message.trim(), settings)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                recordContactIntent({
                  channel: "whatsapp",
                  car,
                  source: walkaround
                    ? "vehicle_walkaround"
                    : "vehicle_whatsapp_confirmed",
                })
              }
            >
              Continue to WhatsApp
            </a>
          ) : (
            <p role="status" className="text-sm">
              Enter a message to continue.
            </p>
          )}
          {hours.state === "closed" && (
            <div className="border-t pt-3">
              <p className="mb-3 text-sm">
                {canReserve
                  ? "You can also reserve this car online."
                  : "You can also ask questions online."}
              </p>
              {canReserve ? (
                <ReserveCar car={car} className="w-full" />
              ) : (
                <a
                  className="text-link"
                  href={`/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}`}
                >
                  Ask about this car
                </a>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
