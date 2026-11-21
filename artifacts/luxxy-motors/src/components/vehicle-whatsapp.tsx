import { useRef, useState } from 'react';
import { Clock3 } from '@/components/icons';
import { SiWhatsapp } from '@/components/icons';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { VehicleDialogVehicle, useVehicleDialogTheme } from '@/components/vehicle-dialog-vehicle';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { showroomHours } from '@/lib/showroom-hours';
import { getWhatsAppHref, getVehicleContactMessage, recordContactIntent } from '@/lib/cta-helpers';
import { vehicleDisplayTitle } from '@/lib/utils';
import type { Car } from '@/lib/stock-context';
import './public-dialogs.css';

type VehicleWhatsAppProps = {
  car: Car;
  compact?: boolean;
};

export function VehicleWhatsApp(props: VehicleWhatsAppProps) {
  // Keep a draft when the sheet is dismissed, but never reuse it for another car.
  return <VehicleWhatsAppSheet key={props.car.id} {...props} />;
}

function VehicleWhatsAppSheet({
  car,
  compact = false,
}: VehicleWhatsAppProps) {
  const { settings } = useDealerSettings();
  const dialogTheme = useVehicleDialogTheme();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const preparedMessage = useRef<string | null>(null);
  const [hours, setHours] = useState(() => showroomHours(settings.hours ?? []));
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogTitle = useRef<HTMLHeadingElement>(null);
  if (!getWhatsAppHref(undefined, settings)) return null;
  const label = vehicleDisplayTitle(car);

  function show() {
    const current = showroomHours(settings.hours ?? []);
    setHours(current);
    if (preparedMessage.current === null) {
      preparedMessage.current = `${getVehicleContactMessage(car, 'get more information about this vehicle', settings)}${current.state === 'closed' ? '\n\nPlease reply when you reopen.' : ''}`;
      setMessage(preparedMessage.current);
    }
    setOpen(true);
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={show}
        data-vehicle-contact="whatsapp"
        aria-label={`WhatsApp about ${label}`}
        className={`vehicle-contact-action vehicle-contact-action-whatsapp ${compact ? 'h-12 w-12 shrink-0 p-0' : ''}`}
      >
        <SiWhatsapp aria-hidden="true" className="h-4 w-4" />
        {!compact && 'WhatsApp'}
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
            <DialogTitle ref={dialogTitle} tabIndex={-1}>Message on WhatsApp</DialogTitle>
            <DialogDescription>To {settings.identity.name}</DialogDescription>
          </div>

          <div className="public-dialog-scroll">
          <VehicleDialogVehicle car={car} showRegistrationPlate />
          <p className="vehicle-whatsapp-hours">
            <Clock3 size={16} aria-hidden="true" />
            {hours.state === 'closed'
              ? hours.next ? `We’ll reply after we reopen ${hours.next}.` : 'We’ll reply when we reopen.'
              : 'We’ll reply during opening hours.'}
          </p>

          <div className="vehicle-message-field">
            <label className="vehicle-action-field">Your message<Textarea rows={6} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} /></label>
            {message.length > 1800 && <p className="vehicle-action-note">{2000 - message.length} characters left</p>}
            {preparedMessage.current !== message && <button type="button" className="public-dialog-reset" onClick={() => setMessage(preparedMessage.current ?? '')}>Reset message</button>}
          </div>
          </div>

          <div className="vehicle-action-footer">
            {message.trim() ? <a
              className="vehicle-action-primary"
              href={getWhatsAppHref(message.trim(), settings)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => recordContactIntent({ channel: 'whatsapp', car, source: 'vehicle_whatsapp_confirmed' })}
            ><SiWhatsapp aria-hidden="true" />Continue to WhatsApp</a> : <>
              <Button className="vehicle-action-primary" disabled><SiWhatsapp aria-hidden="true" />Continue to WhatsApp</Button>
              <p role="status" className="vehicle-action-note">Enter a message to continue.</p>
            </>}
            <p className="vehicle-action-note">Your message is sent only when you confirm in WhatsApp.</p>
          </div>


        </DialogContent>
      </Dialog>
    </>
  );
}
