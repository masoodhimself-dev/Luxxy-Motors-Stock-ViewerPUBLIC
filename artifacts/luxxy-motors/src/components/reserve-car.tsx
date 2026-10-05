import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, CircleAlert, CreditCard } from 'lucide-react';
import { customFetch, getGetStockQueryKey, getGetDealerSettingsQueryKey, useCreateReservation, type OnlineReservationInput } from '@workspace/api-client-react';
import type { Car } from '@/lib/stock-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { VehicleDialogVehicle, useVehicleDialogTheme } from '@/components/vehicle-dialog-vehicle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const pounds = (pence: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(pence / 100).replace(/\.00$/, '');
type Contact = { customerName: string; email: string; phone: string };

function reservationRequestKey() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues also works on HTTP LAN previews, where randomUUID does not.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ReserveCar({ car, className, customer, partExchange }: {
  car: Car;
  className?: string;
  customer?: Contact;
  partExchange?: { registration: string; mileage: number };
}) {
  const { settings } = useDealerSettings();
  const dialogTheme = useVehicleDialogTheme();
  const options = settings.onlineReservation;
  const cache = useQueryClient();
  const mutation = useCreateReservation();
  const readiness = useQuery({ queryKey: ['reservation-payment-readiness'], queryFn: () => customFetch<{ enabled: boolean; mode: 'test' | 'live' | null }>('/api/reservations/payment-readiness'), staleTime: 30000, retry: false });
  const [checkoutPending, setCheckoutPending] = useState(false);
  const paymentEnabled = readiness.data?.enabled === true;
  const pending = mutation.isPending || checkoutPending;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'details' | 'payment'>('details');
  const [contact, setContact] = useState<Contact>({ customerName: '', email: '', phone: '' });
  const [accepted, setAccepted] = useState(false);
  const [formError, setFormError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const attempt = useRef<{ data: string; key: string } | null>(null);
  const result = mutation.data;
  const pricePence = Math.round((car.price ?? 0) * 100);
  const eligible = (!car.inventoryStatus || car.inventoryStatus === 'available') && pricePence > 0 && (!car.currency || car.currency.toUpperCase() === 'GBP');
  const depositPence = options?.depositPence ?? 10000;

  useEffect(() => { setAccepted(false); }, [options?.terms, options?.depositPence, pricePence]);

  useEffect(() => {
    if (step === 'payment' || result) heading.current?.focus();
  }, [step, result]);

  if (!options?.enabled && !result) return null;
  if ((!eligible || !options?.terms.trim() || depositPence > pricePence) && !result && !open) {
    return car.inventoryStatus === 'reserved' && options?.enabled
      ? <p className="py-2 text-center text-sm font-semibold" role="status">This car is reserved</p>
      : null;
  }

  function review(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    const phone = contact.phone.replace(/[\s().\-/]/g, '');
    if (!contact.customerName.trim() || !/^\+?\d{7,15}$/.test(phone)) {
      setFormError('Please enter your name and a valid contact number.');
      return;
    }
    setFormError('');
    setContact(current => ({ ...current, phone }));
    setStep('payment');
  }

  async function reserve() {
    if (!accepted || !options || pending) return;
    const body = {
      vehicleId: car.id,
      customerName: contact.customerName.trim(), email: contact.email.trim(), phone: contact.phone,
      expectedPricePence: pricePence, expectedDepositPence: options.depositPence,
      termsAccepted: true as const, terms: options.terms,
      ...(partExchange?.registration.trim() && Number.isInteger(partExchange.mileage) ? { partExchange } : {}),
    };
    const data = JSON.stringify(body);
    if (attempt.current?.data !== data) attempt.current = { data, key: reservationRequestKey() };
    if (readiness.isError || !readiness.data) { setFormError('Payment availability could not be checked. Please try again or contact the showroom.'); return; }
    if (paymentEnabled) {
      setCheckoutPending(true); setFormError('');
      try {
        const result = await customFetch<{ checkoutUrl: string }>('/api/reservations/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, idempotencyKey: attempt.current.key }) });
        const destination = new URL(result.checkoutUrl);
        if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com') throw new Error('The secure payment link is unavailable. Please contact the showroom.');
        window.location.assign(destination.href);
      } catch (error) { setFormError(error instanceof Error ? error.message : 'Secure payment could not be opened.'); setCheckoutPending(false); }
      return;
    }
    mutation.mutate({ data: { ...body, idempotencyKey: attempt.current.key } as OnlineReservationInput }, {
      onSuccess: () => {
        void cache.invalidateQueries({ queryKey: getGetStockQueryKey() });
        void cache.invalidateQueries({ queryKey: ['/api/reservations'] });
        void cache.invalidateQueries({ queryKey: ['/api/leads'] });
      },
      onError: () => {
        void cache.invalidateQueries({ queryKey: getGetStockQueryKey() });
        void cache.invalidateQueries({ queryKey: getGetDealerSettingsQueryKey() });
      },
    });
  }

  const error = mutation.error as { data?: { error?: string } } | null;
  return (
    <Dialog open={open} onOpenChange={next => {
      if (pending) return;
      setOpen(next);
      if (next && !result) {
        setContact(customer ?? { customerName: '', email: '', phone: '' });
        setStep('details'); setAccepted(false); setFormError(''); mutation.reset();
      }
    }}>
      {options?.enabled && <DialogTrigger asChild>
        <Button id="reserve-car-online" type="button" variant="outline" className={className}>
          <CreditCard className="h-4 w-4" aria-hidden="true" />{result ? 'View reservation' : 'Reserve car online'}
        </Button>
      </DialogTrigger>}
      <DialogContent className="vehicle-action-dialog vehicle-reservation-dialog" style={dialogTheme} data-testid="reserve-car-dialog" onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onInteractOutside={event => { if (pending) event.preventDefault(); }}>
        <div className="vehicle-dialog-header">
          <p className="vehicle-dialog-eyebrow">{result ? 'Your reservation' : 'Online reservation'}</p>
          <DialogTitle ref={heading} tabIndex={-1} className="focus:outline-none">
            {result ? (result.status === 'cancelled' ? 'Reservation cancelled' : 'Your car is reserved') : step === 'details' ? 'Reserve this car' : 'Review your reservation'}
          </DialogTitle>
          <DialogDescription>
            {result ? (result.status === 'cancelled' ? 'This reservation has been cancelled. No money was received and this reservation no longer holds the car.' : 'Keep your reference below. The team will follow up with you about the car.') : step === 'details' ? 'Leave your contact details, then review the deposit and reservation terms.' : 'Check your details and the terms before confirming.'}
          </DialogDescription>
        </div>
        {!result && <ol className="vehicle-dialog-steps" aria-label="Reservation progress">
          <li aria-current={step === 'details' ? 'step' : undefined} data-complete={step === 'payment' || undefined}>
            <span aria-hidden="true">{step === 'payment' ? <Check className="h-4 w-4" /> : '1'}</span>Your details
          </li>
          <li aria-current={step === 'payment' ? 'step' : undefined}><span aria-hidden="true">2</span>Review & confirm</li>
        </ol>}
        <VehicleDialogVehicle car={car} />
        {result ? <div className="vehicle-dialog-result" data-status={result.status} data-testid="reservation-success">
          <div className="vehicle-dialog-confirmation" role="status">
            {result.status === 'cancelled' ? <CircleAlert className="h-5 w-5 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />}
            <div><p className="vehicle-dialog-eyebrow">Reservation reference</p><p className="vehicle-dialog-reference">{result.reference}</p></div>
          </div>
          <dl className="vehicle-dialog-review-summary">
            <div><dt>Reservation deposit</dt><dd>{pounds(result.depositPence)}</dd></div>
            <div><dt>Amount received</dt><dd>£0</dd></div>
            <div><dt>Payment status</dt><dd>Simulated</dd></div>
          </dl>
          <p className="vehicle-dialog-notice">Your full vehicle balance is still outstanding. This is a reservation record, not a payment receipt.</p>
          <p className="vehicle-dialog-muted">{result.status === 'cancelled' ? 'Contact the dealership or refresh the vehicle page to check its current availability.' : 'Contact the dealership with this reference if you need to change or cancel your reservation. A test drive must be booked separately.'}</p>
          <div className="vehicle-dialog-actions"><DialogClose asChild><Button type="button" className="vehicle-dialog-primary">Done</Button></DialogClose></div>
        </div> : <>
          <div className="vehicle-dialog-deposit">
            <dl><div><dt>Reservation deposit</dt><dd>{pounds(depositPence)}</dd></div></dl>
            <p>{paymentEnabled ? (readiness.data?.mode === 'test' ? 'Stripe test payment · no real charge' : 'Pay securely by card with Stripe') : 'Payment simulated · £0 charged now'}</p>
          </div>
          {step === 'details' ? <form onSubmit={review} className="vehicle-dialog-form">
          <label className="block"><span className="field-label">Your name</span><Input required minLength={2} maxLength={120} autoComplete="name" value={contact.customerName} onChange={e => setContact({ ...contact, customerName: e.target.value })} /></label>
          <label className="block"><span className="field-label">Email address</span><Input required type="email" maxLength={254} autoComplete="email" value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} /></label>
          <label className="block"><span className="field-label">Phone number</span><Input required type="tel" maxLength={30} autoComplete="tel" value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></label>
          {formError && <p role="alert" className="vehicle-dialog-error">{formError}</p>}
          <p className="vehicle-dialog-muted">The team will use these details to follow up on this reservation.</p>
          <div className="vehicle-dialog-actions"><Button type="submit" className="vehicle-dialog-primary">Continue · {pounds(depositPence)} deposit</Button></div>
        </form> : <div className="vehicle-dialog-review" aria-busy={pending}>
          <section className="vehicle-dialog-contact-summary" aria-label="Your reservation contact details">
            <h3>Your details</h3>
            <dl className="vehicle-dialog-review-summary">
              <div><dt>Name</dt><dd>{contact.customerName.trim()}</dd></div>
              <div><dt>Email</dt><dd>{contact.email.trim()}</dd></div>
              <div><dt>Phone</dt><dd>{contact.phone}</dd></div>
            </dl>
          </section>
          <section className="vehicle-dialog-terms" aria-label="Reservation terms"><h3>Reservation terms</h3><p className="whitespace-pre-line">{options?.terms}</p></section>
          <label className="vehicle-dialog-consent"><input type="checkbox" className="h-5 w-5 shrink-0" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>I accept these reservation terms. {paymentEnabled ? (readiness.data?.mode === 'test' ? 'This is a test payment; no real money will be received.' : `I will pay ${pounds(depositPence)} securely on Stripe.`) : 'No money will be taken during this simulated payment.'}</span></label>
          <p className="vehicle-dialog-notice">{paymentEnabled ? 'Your deposit is recorded only after Stripe confirms a successful payment.' : 'Confirming creates a reservation for this car. It does not record a paid deposit.'}</p>
          {formError && <p role="alert" className="vehicle-dialog-error">{formError}</p>}
          {mutation.isError && <p role="alert" className="vehicle-dialog-error">{error?.data?.error || 'We could not confirm your reservation. Please try again. No payment has been taken.'}</p>}
          {mutation.isPending && <p role="status" className="vehicle-dialog-muted">We’re confirming the reservation. Please keep this window open.</p>}
          <div className="vehicle-dialog-actions">
            <Button type="button" className="vehicle-dialog-primary" disabled={!accepted || pending || readiness.isLoading || readiness.isError} onClick={reserve}>{pending ? 'Preparing your reservation…' : paymentEnabled ? `Continue to secure payment · ${pounds(depositPence)}` : 'Confirm reservation · simulate payment'}</Button>
            <Button type="button" variant="ghost" className="vehicle-dialog-back" disabled={pending} onClick={() => { setStep('details'); mutation.reset(); }}>Back to your details</Button>
          </div>
        </div>}
        </>}
      </DialogContent>
    </Dialog>
  );
}
