import { showroomHours } from '@/lib/showroom-hours';
import { useCreateEnquiry } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  const callback = useCreateEnquiry();
  const [customer, setCustomer] = useState({name:'',phone:'',email:''});
  const [hours, setHours] = useState(() => showroomHours(settings.hours ?? []));
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
    const currentHours = showroomHours(settings.hours ?? []);
    setHours(currentHours);
    if (!isPhone || currentHours.state === 'closed') event.preventDefault();
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
          className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
        >
          <DialogTitle>
            {hours.state === "closed" ? "The showroom is currently closed" : mobile ? "Did you get through?" : "Call the showroom"}
          </DialogTitle>
          <DialogDescription>
            {hours.state === 'closed' ? (hours.next ? `We next open ${hours.next}. Leave your details and ask the team to call you first thing when we reopen.` : 'Leave your details and the team will arrange a callback during opening hours.') : mobile
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
          {hours.state === 'closed' && (callback.isSuccess ? <p role="status" className="border bg-secondary p-4 text-sm">Callback request received. The team will aim to call you when the showroom next opens.</p> : <form className="grid gap-3" onSubmit={event=>{event.preventDefault();callback.mutate({data:{vehicleId:car.id,type:'general',customerName:customer.name.trim(),email:customer.email.trim(),phone:customer.phone.trim(),preferredContact:'phone',appointmentAt:null,message:`Callback requested at next opening${hours.next ? ': '+hours.next : ''}. Please call first thing about ${label}.`}});}}>
            <label className="grid gap-1 text-sm">Your name<Input required minLength={2} maxLength={120} autoComplete="name" value={customer.name} onChange={e=>setCustomer({...customer,name:e.target.value})}/></label>
            <label className="grid gap-1 text-sm">Telephone<Input required type="tel" minLength={5} maxLength={40} autoComplete="tel" value={customer.phone} onChange={e=>setCustomer({...customer,phone:e.target.value})}/></label>
            <label className="grid gap-1 text-sm">Email<Input required type="email" autoComplete="email" value={customer.email} onChange={e=>setCustomer({...customer,email:e.target.value})}/></label>
            {callback.isError && <p role="alert" className="text-sm text-destructive">Your request could not be sent. Please try again.</p>}
            <p className="text-xs text-muted-foreground">We’ll use these details to respond to your request. <a className="underline" href="/privacy">Privacy policy</a></p>
            <Button disabled={callback.isPending}>{callback.isPending?'Sending…':'Request a callback'}</Button>
          </form>)}
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
