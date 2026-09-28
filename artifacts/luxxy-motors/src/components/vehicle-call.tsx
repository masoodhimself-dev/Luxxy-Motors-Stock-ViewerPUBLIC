import { useState, useRef, type MouseEvent } from "react";
import { Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ReserveCar } from "@/components/reserve-car";
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { getPhoneHref, recordContactIntent } from "@/lib/cta-helpers";
import {
  formatPrice,
  vehicleDisplayTitle,
  vehicleRegistration,
} from "@/lib/utils";
import type { Car } from "@/lib/stock-context";

export function VehicleCall({
  car,
  compact = false,
}: {
  car: Car;
  compact?: boolean;
}) {
  const { settings } = useDealerSettings();
  const trigger = useRef<HTMLAnchorElement>(null);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const href = getPhoneHref(settings);
  if (!href) return null;
  const options = settings.onlineReservation;
  const canReserve =
    options?.enabled &&
    options.terms?.trim() &&
    (!car.inventoryStatus || car.inventoryStatus === "available") &&
    (car.price ?? 0) * 100 >= options.depositPence &&
    (car.price ?? 0) > 0 &&
    (!car.currency || car.currency.toUpperCase() === "GBP");
  const label = vehicleDisplayTitle(car);
  function call(event: MouseEvent<HTMLAnchorElement>) {
    const isPhone =
      /iPhone|Android.*Mobile|Windows Phone/i.test(navigator.userAgent) ||
      window.matchMedia("(max-width: 767px) and (pointer: coarse)").matches;
    if (!isPhone) event.preventDefault();
    setMobile(isPhone);
    setOpen(true);
    recordContactIntent({
      channel: "call",
      car,
      source: compact ? "car-detail-mobile" : "car-detail",
    });
  }
  return (
    <>
      <a
        ref={trigger}
        href={href}
        onClick={call}
        className={
          compact
            ? "vehicle-contact-action h-12 w-12 shrink-0 p-0"
            : "vehicle-contact-action"
        }
        aria-label={compact ? "Call about this vehicle" : `Call about ${label}`}
        data-vehicle-contact="call"
      >
        <Phone className="h-4 w-4" />
        {!compact && "Call showroom"}
      </a>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus({ preventScroll: true });
          }}
          className="sm:max-w-md"
        >
          <DialogTitle>
            {mobile ? "Did you get through?" : "Call the showroom"}
          </DialogTitle>
          <DialogDescription>
            {mobile
              ? "If you couldn’t reach us, you can continue online."
              : "Speak to the team about this vehicle."}
          </DialogDescription>
          <div className="border-y py-4">
            <p className="font-semibold">{label}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {[car.year, vehicleRegistration(car), car.transmission]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {car.price != null && (
              <p className="mt-2 text-lg font-semibold">
                {formatPrice(car.price)}
              </p>
            )}
          </div>
          <a
            href={href}
            className="flex min-h-12 items-center gap-3 text-xl font-semibold"
          >
            <Phone size={20} />
            {settings.contact.phone}
          </a>
          {mobile && (
            <div className="border-t pt-4">
              <p className="mb-3 text-sm">
                {canReserve
                  ? "You can also reserve this car online."
                  : "You can also ask questions online."}
              </p>
              {canReserve ? (
                <ReserveCar car={car} className="w-full" />
              ) : (
                <a
                  className="vehicle-enquiry-action"
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
