import { showroomHours, showroomOpeningLabel } from '@/lib/showroom-hours';
import { useCreateEnquiry } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useEffect, useState, useRef, type MouseEvent } from 'react';
import { CheckCircle2, CircleAlert, Clock3, Copy, Phone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ReserveCar } from '@/components/reserve-car';
import { VehicleDialogVehicle, useVehicleDialogTheme } from '@/components/vehicle-dialog-vehicle';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getPhoneHref, recordContactIntent } from '@/lib/cta-helpers';
import { formatPhoneDisplay, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import type { Car } from '@/lib/stock-context';
import './vehicle-call.css';

export function VehicleCall({
  car,
  compact = false,
  buttonLabel,
  className,
}: {
  car: Car;
  compact?: boolean;
  buttonLabel?: string;
  className?: string;
}) {
  const { settings } = useDealerSettings();
  const dialogTheme = useVehicleDialogTheme();
  const trigger = useRef<HTMLAnchorElement>(null);
  const dialogTitle = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [callbackForm, setCallbackForm] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const callback = useCreateEnquiry();
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  const [hours, setHours] = useState(() => showroomHours(settings.hours ?? []));
  useEffect(() => {
    if (!open) return;
    setHours(showroomHours(settings.hours ?? []));
    const timer = window.setInterval(() => setHours(showroomHours(settings.hours ?? [])), 60_000);
    return () => window.clearInterval(timer);
  }, [open, settings.hours]);
  const privacyUrl = settings.legal?.privacyUrl?.trim();
  const href = getPhoneHref(settings);
  if (!href) return null;
  const options = settings.onlineReservation;
  const canReserve =
    options?.enabled &&
    options.terms?.trim() &&
    (!car.inventoryStatus || car.inventoryStatus === 'available') &&
    (car.price ?? 0) * 100 >= options.depositPence &&
    (car.price ?? 0) > 0 &&
    (!car.currency || car.currency.toUpperCase() === 'GBP');
  const label = vehicleDisplayTitle(car);
  const showCallback = callbackForm || hours.state === 'closed';
  const receivedCallbackTime = callback.data?.followUpAt ? showroomOpeningLabel(callback.data.followUpAt) : null;

  async function copyNumber() {
    try {
      const number = formatPhoneDisplay(settings.contact.phone);
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(number); copied = true; } catch { /* Try the local-network fallback below. */ }
      }
      if (!copied) {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const selection = document.createElement('textarea');
        selection.value = number;
        selection.readOnly = true;
        selection.tabIndex = -1;
        selection.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
        (dialogTitle.current?.closest('[role="dialog"]') ?? document.body).append(selection);
        try { selection.select(); copied = document.execCommand('copy'); }
        finally { selection.remove(); previousFocus?.focus({ preventScroll: true }); }
      }
      if (!copied) throw new Error('Copy unavailable');
      setCopyStatus('Phone number copied');
    } catch {
      setCopyStatus('Select the phone number to copy it.');
    }
  }

  function call(event: MouseEvent<HTMLAnchorElement>) {
    const isPhone =
      /iPhone|Android.*Mobile|Windows Phone/i.test(navigator.userAgent) ||
      window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches;
    const currentHours = showroomHours(settings.hours ?? []);
    setHours(currentHours);
    setCallbackForm(currentHours.state === 'closed');
    setCopyStatus('');
    if (!isPhone || currentHours.state === 'closed') event.preventDefault();
    setMobile(isPhone);
    setOpen(true);
    recordContactIntent({
      channel: 'call',
      car,
      source: compact ? 'car-detail-mobile' : 'car-detail',
    });
  }

  return (
    <>
      <a
        ref={trigger}
        href={href}
        onClick={call}
        className={className ?? (compact ? 'vehicle-contact-action h-12 w-12 shrink-0 p-0' : 'vehicle-contact-action')}
        aria-label={buttonLabel ? `${buttonLabel} for ${label}` : compact ? 'Call about this vehicle' : `Call about ${label}`}
        data-vehicle-contact="call"
      >
        <Phone className="h-4 w-4" aria-hidden="true" />
        {!compact && (buttonLabel || 'Call showroom')}
      </a>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          style={dialogTheme}
          className="vehicle-action-dialog vehicle-call-dialog"
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
            <p className="vehicle-action-eyebrow"><Phone size={15} aria-hidden="true" />Speak to the showroom</p>
            <DialogTitle ref={dialogTitle} tabIndex={-1}>
              {hours.state === 'closed' ? 'The showroom is currently closed' : showCallback ? 'Request a callback' : mobile ? 'Did you get through?' : 'Call the showroom'}
            </DialogTitle>
            <DialogDescription>
              {hours.state === 'closed'
                ? 'Leave your details for a callback when we reopen.'
                : showCallback
                  ? 'Leave your name and number and the team will get back to you.'
                : mobile
                  ? 'If you couldn’t reach us, you can continue online.'
                  : 'Speak to the team about this vehicle.'}
            </DialogDescription>
          </div>

          {hours.state === 'closed' && <div className="vehicle-call-availability vehicle-call-next-opening" data-status="closed">
            <Clock3 size={16} aria-hidden="true" />
            <p>{hours.next ? `We next open ${hours.next}.` : 'The team will arrange your callback during opening hours.'}</p>
          </div>}

          <VehicleDialogVehicle car={car} />

          {!showCallback && <div className="vehicle-phone-panel vehicle-call-telephone">
            <p className="vehicle-action-label">Showroom telephone</p>
            <a href={href} className="vehicle-phone-number"><span className="vehicle-call-phone-icon"><Phone size={20} aria-hidden="true" /></span><span>{formatPhoneDisplay(settings.contact.phone)}</span></a>
            <div className="vehicle-call-availability" data-status={hours.state}>
              <span className="vehicle-call-availability-dot" aria-hidden="true" />
              <p>{hours.state === 'open' ? hours.closingTime ? `Open until ${hours.closingTime} (UK time)` : 'The showroom is open' : 'Please call to confirm availability.'}</p>
            </div>
            {!mobile && <div className="vehicle-call-copy"><button type="button" onClick={() => void copyNumber()}><Copy size={14} aria-hidden="true" />Copy number</button>{copyStatus && <p role="status">{copyStatus}</p>}</div>}
            <button type="button" className="vehicle-call-callback-link" onClick={() => setCallbackForm(true)}>{callback.isSuccess ? 'View callback request' : 'Request a callback'}</button>
          </div>}

          {showCallback && (callback.isSuccess ? (
            <div className="vehicle-call-result">
            <div role="status" className="vehicle-action-feedback vehicle-action-feedback-success">
              <CheckCircle2 size={21} aria-hidden="true" />
              <div><p className="vehicle-action-feedback-title">Callback request received</p><p>{receivedCallbackTime && hours.state === 'closed' ? `The team will aim to call you ${receivedCallbackTime}.` : 'The team will aim to call you during opening hours.'}</p>{callback.data?.reference && <p className="vehicle-call-reference">Your reference: {callback.data.reference}</p>}</div>
            </div>
            <Button type="button" className="vehicle-action-primary" onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <form className="vehicle-action-form vehicle-callback-form" aria-label="Request a callback" onSubmit={event => {
              event.preventDefault();
              const normalizedPhone = customer.phone.trim().replace(/[\s().\-/]/g, '');
              if (!/^\+?\d{7,15}$/.test(normalizedPhone)) {
                setPhoneError('Enter a valid phone number so the team can call you.');
                return;
              }
              setPhoneError('');
              callback.mutate({ data: {
                vehicleId: car.id,
                type: 'general',
                requestCallback: true,
                customerName: customer.name.trim(),
                email: customer.email.trim() || null,
                phone: normalizedPhone,
                preferredContact: 'phone',
                appointmentAt: null,
                message: `${hours.state === 'closed' ? 'Callback requested at next opening' : 'Callback requested during opening hours'}. Please call about ${label}${vehicleRegistration(car) ? ' (' + vehicleRegistration(car) + ')' : ''}.`,
              } });
            }}>
              <div className="vehicle-action-form-grid">
                <label className="vehicle-action-field">Your name<Input required minLength={2} maxLength={120} autoComplete="name" value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} /></label>
                <label className="vehicle-action-field">Telephone<Input required type="tel" inputMode="tel" minLength={7} maxLength={40} autoComplete="tel" aria-invalid={Boolean(phoneError)} aria-describedby={phoneError ? 'callback-phone-error' : undefined} value={customer.phone} onChange={event => { setCustomer({ ...customer, phone: event.target.value }); setPhoneError(''); }} /></label>
              </div>
              <details className="vehicle-call-optional-email"><summary>Add an email for confirmation (optional)</summary><label className="vehicle-action-field">Email<Input type="email" autoComplete="email" value={customer.email} onChange={event => setCustomer({ ...customer, email: event.target.value })} /></label></details>
              {phoneError && <p id="callback-phone-error" role="alert" className="vehicle-action-feedback vehicle-action-feedback-error">{phoneError}</p>}
              {callback.isError && <p role="alert" className="vehicle-action-feedback vehicle-action-feedback-error"><CircleAlert size={18} aria-hidden="true" /><span>Your request could not be sent. Please try again.</span></p>}
              <p className="vehicle-action-privacy">We’ll use these details to respond to your request.{privacyUrl && <> <a className="underline underline-offset-4" href={privacyUrl}>Privacy policy</a></>}</p>
              <Button type="submit" className="vehicle-action-primary" disabled={callback.isPending}>{callback.isPending ? 'Sending…' : 'Request a callback'}</Button>
            </form>
          ))}

          {showCallback && <div className="vehicle-phone-panel vehicle-phone-panel-secondary vehicle-call-telephone-footer">
            <p className="vehicle-action-label">Showroom telephone</p>
            <a href={href} className="vehicle-phone-number"><Phone size={18} aria-hidden="true" /><span>{formatPhoneDisplay(settings.contact.phone)}</span></a>
          </div>}
          {showCallback && hours.state !== 'closed' && !callback.isSuccess && <button type="button" className="vehicle-call-callback-link" onClick={() => setCallbackForm(false)}>Back to the phone number</button>}

          {mobile && !showCallback && <div className="vehicle-action-alternative">
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
