import { useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { SiWhatsapp } from 'react-icons/si';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ReserveCar } from '@/components/reserve-car';
import { VehicleDialogVehicle, useVehicleDialogTheme } from '@/components/vehicle-dialog-vehicle';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { showroomHours } from '@/lib/showroom-hours';
import { getWhatsAppHref, recordContactIntent } from '@/lib/cta-helpers';
import { vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import type { Car } from '@/lib/stock-context';

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
  const dialogTheme = useVehicleDialogTheme();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [hours, setHours] = useState(() => showroomHours(settings.hours ?? []));
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogTitle = useRef<HTMLHeadingElement>(null);
  if (!getWhatsAppHref(undefined, settings)) return null;
  const label = vehicleDisplayTitle(car);
  const options = settings.onlineReservation;
  const canReserve =
    options?.enabled &&
    options.terms?.trim() &&
    (!car.inventoryStatus || car.inventoryStatus === 'available') &&
    (car.price ?? 0) > 0 &&
    (car.price ?? 0) * 100 >= options.depositPence &&
    (!car.currency || car.currency.toUpperCase() === 'GBP');

  function show() {
    const current = showroomHours(settings.hours ?? []);
    setHours(current);
    setMessage(
      `Hi ${settings.identity.name}, ${walkaround ? 'could you send me a walkaround video of' : 'is this car still available:'} ${label}${vehicleRegistration(car) ? ' (' + vehicleRegistration(car) + ')' : ''}?${current.state === 'closed' ? ' Please reply when you reopen.' : ''}`,
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
        aria-label={walkaround ? 'Request a walkaround video' : `WhatsApp about ${label}`}
        className={walkaround ? 'text-link mt-2 min-h-11 text-sm' : `vehicle-contact-action vehicle-contact-action-whatsapp ${compact ? 'h-12 w-12 shrink-0 p-0' : ''}`}
      >
        <SiWhatsapp aria-hidden="true" className="h-4 w-4" />
        {!compact && (walkaround ? 'Request a walkaround video' : 'WhatsApp us')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          style={dialogTheme}
          className="vehicle-action-dialog vehicle-whatsapp-dialog"
          onOpenAutoFocus={event => {
            event.preventDefault();
            dialogTitle.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            trigger.current?.focus({ preventScroll: true });
          }}
        >
          <div className="vehicle-action-heading">
            <p className="vehicle-action-eyebrow"><SiWhatsapp aria-hidden="true" />WhatsApp the showroom</p>
            <DialogTitle ref={dialogTitle} tabIndex={-1}>Review your WhatsApp message</DialogTitle>
            <DialogDescription>Check or edit your message. WhatsApp opens next; you choose when to send it.</DialogDescription>
          </div>

          <VehicleDialogVehicle car={car} />

          <div className="vehicle-message-recipient">
            <SiWhatsapp aria-hidden="true" />
            <div><p className="vehicle-message-recipient-name">To {settings.identity.name}</p><p className="vehicle-action-note">{settings.contact.whatsapp}</p></div>
          </div>

          <div className="vehicle-action-status" data-status={hours.state}>
            <Clock3 size={18} aria-hidden="true" />
            <div>
              <p className="vehicle-action-status-title">{hours.state === 'closed' ? 'The showroom is closed' : hours.state === 'open' ? 'The showroom is open' : 'Reply during opening hours'}</p>
              <p>{hours.state === 'closed'
                ? `${hours.next ? 'We next open ' + hours.next + '. ' : ''}The team will aim to reply after reopening.`
                : hours.state === 'open' ? 'The team will reply as soon as they can.' : 'You can leave a message any time. The team will reply during opening hours.'}</p>
            </div>
          </div>

          <div className="vehicle-message-field">
            <label className="vehicle-action-field">Your message<Textarea rows={5} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} /></label>
            <div className="vehicle-message-hint"><p>Add a question or your preferred viewing time.</p><span aria-hidden="true">{message.length}/2000</span></div>
          </div>

          <div className="vehicle-action-footer">
            {message.trim() ? <a
              className="vehicle-action-primary"
              href={getWhatsAppHref(message.trim(), settings)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => recordContactIntent({ channel: 'whatsapp', car, source: walkaround ? 'vehicle_walkaround' : 'vehicle_whatsapp_confirmed' })}
            ><SiWhatsapp aria-hidden="true" />Continue to WhatsApp</a> : <>
              <Button className="vehicle-action-primary" disabled><SiWhatsapp aria-hidden="true" />Continue to WhatsApp</Button>
              <p role="status" className="vehicle-action-note">Enter a message to continue.</p>
            </>}
            <p className="vehicle-action-note">Your message is sent only when you confirm in WhatsApp.</p>
          </div>

          {hours.state === 'closed' && <div className="vehicle-action-alternative">
            <p>{canReserve ? 'You can also reserve this car online.' : 'You can also ask questions online.'}</p>
            {canReserve
              ? <ReserveCar car={car} className="vehicle-action-secondary" />
              : <a className="vehicle-action-secondary" href={`/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}`}>Ask about this car</a>}
          </div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
