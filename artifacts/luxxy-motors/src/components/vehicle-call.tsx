import { useDealerFeatures } from '@/lib/dealer-features';
import { showroomHours, showroomOpeningLabel } from '@/lib/showroom-hours';
import { useCreateEnquiry } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useEffect, useState, useRef, type MouseEvent } from 'react';
import { CheckCircle2, CircleAlert, Clock3, Copy, Phone, MapPin, ArrowUpRight } from '@/components/icons';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { dealershipLocation } from '@/lib/dealership-location';
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
  const { settings, isLoading: settingsLoading, isError: settingsError } = useDealerSettings();
  const features = useDealerFeatures();
  const dialogTheme = useVehicleDialogTheme();
  const trigger = useRef<HTMLAnchorElement>(null);
  const dialogTitle = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [callbackForm, setCallbackForm] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const callback = useCreateEnquiry();
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  useEffect(() => {
    setOpen(false); setCallbackForm(false); setCopyStatus(''); setPhoneError('');
    setCustomer({ name: '', phone: '', email: '' });
    callback.reset?.();
  }, [car.id]);
  const [hours, setHours] = useState(() => showroomHours(settings.hours ?? []));
  useEffect(() => {
    if (!open) return;
    setHours(showroomHours(settings.hours ?? []));
    const refresh = () => setHours(showroomHours(settings.hours ?? []));
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [open, settings.hours]);
  const privacyUrl = settings.legal?.privacyUrl?.trim();
  const href = getPhoneHref(settings);
  if (!href) return null;
  const location = dealershipLocation(settings.address);
  const detailsReady = !settingsLoading && !settingsError;
  const directions = detailsReady && !location.isSample && location.lines.length
    ? location.directions : null;
  const label = vehicleDisplayTitle(car);
  const showCallback = callbackForm && (features.enabled('publicEnquiries') || callback.isSuccess);
  const receivedCallbackTime = callback.data?.followUpAt ? showroomOpeningLabel(callback.data.followUpAt) : null;

  const showroomInformation = (
    <section className="vehicle-call-showroom" aria-label="Showroom information">
            <div className="vehicle-call-hours" data-status={detailsReady ? hours.state : 'unknown'} role="status" aria-live="polite">
              <span className="vehicle-call-status"><Clock3 size={16} aria-hidden="true" />{settingsLoading ? 'Checking opening hours…' : settingsError ? 'Hours unavailable' : hours.statusLabel}</span>
              {detailsReady && hours.todayText && <strong>{hours.todayText}</strong>}
              {detailsReady && hours.state === 'closed' && hours.next && <p>Opens {hours.next}</p>}
              {detailsReady && hours.state === 'unknown' && <p>Today’s hours aren’t confirmed. Please check before travelling.</p>}
              {detailsReady && hours.state === 'closed' && !hours.next && <p>Contact us to arrange your next visit.</p>}
              {settingsError && <p>Please confirm our hours before travelling.</p>}
              <small>UK time · Regular showroom hours</small>
            </div>
            <div className="vehicle-call-location">
              <h3><MapPin size={16} aria-hidden="true" />Our showroom</h3>
              {detailsReady && location.lines.length > 0 && !location.isSample ? <address>{location.lines.join(', ')}</address> : <p>{settingsLoading ? 'Loading showroom address…' : 'Contact us to confirm our showroom address.'}</p>}
              {directions && <a href={directions} target="_blank" rel="noopener noreferrer">Get directions<ArrowUpRight size={15} aria-hidden="true" /></a>}
            </div>
          </section>
  );

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
    event.preventDefault();
    const currentHours = showroomHours(settings.hours ?? []);
    setHours(currentHours);
    setCallbackForm(false);
    setCopyStatus('');
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
        {!compact && (buttonLabel || 'Call Us')}
      </a>
      <Dialog open={open} onOpenChange={next => { if (!callback.isPending) setOpen(next); }}>
        <DialogContent
          style={dialogTheme}
          className="vehicle-action-dialog vehicle-call-dialog"
          data-callback={showCallback}
          onEscapeKeyDown={event => { if (callback.isPending) event.preventDefault(); }}
          onInteractOutside={event => { if (callback.isPending) event.preventDefault(); }}
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
            <p className="vehicle-action-eyebrow"><Phone size={15} aria-hidden="true" />Speak to us</p>
            <DialogTitle ref={dialogTitle} tabIndex={-1}>
              {showCallback ? 'Request a callback' : 'Let’s talk about this car'}
            </DialogTitle>
            <DialogDescription>
              {showCallback ? 'Just your name and number. We’ll get back to you during opening hours.' : features.enabled('publicEnquiries') ? detailsReady && hours.state === 'closed' ? 'We’re currently closed. Ask us to call you back when we reopen.' : 'Call the showroom, or ask us to call you back.' : 'Call us to ask about this car or arrange a visit.'}
            </DialogDescription>
          </div>

          <div className="vehicle-call-content">
          <VehicleDialogVehicle car={car} />

          {!showCallback && <div className="vehicle-call-contact" data-closed={detailsReady && hours.state === 'closed'}>
            <div className="vehicle-call-contact-actions">
              {detailsReady && hours.state === 'closed' && (features.enabled('publicEnquiries') || callback.isSuccess) && <button type="button" className="vehicle-call-request" onClick={() => setCallbackForm(true)}>{callback.isSuccess ? 'View callback request' : 'Request a callback'}</button>}
              <a href={href} className="vehicle-call-dial"><Phone size={19} aria-hidden="true" /><span><small>Call the showroom</small><strong>{formatPhoneDisplay(settings.contact.phone)}</strong></span></a>
              {!(detailsReady && hours.state === 'closed') && (features.enabled('publicEnquiries') || callback.isSuccess) && <button type="button" className="vehicle-call-request" onClick={() => setCallbackForm(true)}>{callback.isSuccess ? 'View callback request' : 'Request a callback'}</button>}
            </div>
            <div className="vehicle-call-copy"><button type="button" onClick={() => void copyNumber()}><Copy size={14} aria-hidden="true" />Copy number</button>{copyStatus && <p role="status">{copyStatus}</p>}</div>
            {detailsReady && hours.state === 'closed' && <p className="vehicle-call-closed-note">{features.enabled('publicEnquiries') ? 'We’re away from the showroom. Request a callback for when we’re back.' : 'Please call during our opening hours.'}</p>}
          </div>}

          {!showCallback && showroomInformation}

          {showCallback && (callback.isSuccess ? (
            <div className="vehicle-call-result">
            <div role="status" className="vehicle-action-feedback vehicle-action-feedback-success">
              <CheckCircle2 size={21} aria-hidden="true" />
              <div><p className="vehicle-action-feedback-title">We’ve received your callback request</p><p>{receivedCallbackTime && hours.state === 'closed' ? `We’ll aim to call you ${receivedCallbackTime}.` : 'We’ll aim to call you during opening hours.'}</p></div>
            </div>
            <Button type="button" className="vehicle-action-primary" onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <form className="vehicle-action-form vehicle-callback-form" aria-label="Request a callback" onSubmit={event => {
              event.preventDefault();
              if (callback.isPending || !features.enabled('publicEnquiries')) return;
              const normalizedPhone = customer.phone.trim().replace(/[\s().\-/]/g, '');
              if (!/^\+?\d{7,15}$/.test(normalizedPhone)) {
                setPhoneError('Enter a valid phone number so we can call you.');
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
                <label className="vehicle-action-field">Your name<Input disabled={callback.isPending} required minLength={2} maxLength={120} autoComplete="name" value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} /></label>
                <label className="vehicle-action-field">Telephone<Input disabled={callback.isPending} required type="tel" inputMode="tel" minLength={7} maxLength={40} autoComplete="tel" aria-invalid={Boolean(phoneError)} aria-describedby={phoneError ? 'callback-phone-error' : undefined} value={customer.phone} onChange={event => { setCustomer({ ...customer, phone: event.target.value }); setPhoneError(''); }} /></label>
              </div>
              <details className="vehicle-call-optional-email"><summary>Add an email for confirmation (optional)</summary><label className="vehicle-action-field">Email<Input disabled={callback.isPending} type="email" autoComplete="email" value={customer.email} onChange={event => setCustomer({ ...customer, email: event.target.value })} /></label></details>
              {phoneError && <p id="callback-phone-error" role="alert" className="vehicle-action-feedback vehicle-action-feedback-error">{phoneError}</p>}
              {callback.isError && <p role="alert" className="vehicle-action-feedback vehicle-action-feedback-error"><CircleAlert size={18} aria-hidden="true" /><span>We couldn’t send your request. Please try again.</span></p>}
              <p className="vehicle-action-privacy">We’ll use these details to respond to your request.{privacyUrl && <> <a className="underline underline-offset-4" href={privacyUrl}>Privacy policy</a></>}</p>
              <Button type="submit" className="vehicle-action-primary" disabled={callback.isPending}>{callback.isPending ? 'Sending…' : 'Request a callback'}</Button>
            </form>
          ))}

          {showCallback && <details className="vehicle-call-showroom-disclosure"><summary>Showroom details and opening hours</summary>{showroomInformation}</details>}

          {showCallback && <div className="vehicle-phone-panel vehicle-phone-panel-secondary vehicle-call-telephone-footer">
            <p className="vehicle-action-label">Our phone number</p>
            <a href={href} className="vehicle-phone-number"><Phone size={18} aria-hidden="true" /><span>{formatPhoneDisplay(settings.contact.phone)}</span></a>
          </div>}
          {showCallback && !callback.isSuccess && <button type="button" className="vehicle-call-callback-link" onClick={() => setCallbackForm(false)}>Back to contact details</button>}

          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
