import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { VehicleDialogVehicle, useVehicleDialogTheme } from '@/components/vehicle-dialog-vehicle';
import { requestUuid } from '@/lib/request-uuid';
import type { Car } from '@/lib/stock-context';

const depositPence = 9900;
const paymentError = 'We couldn’t open secure payment. Try again or contact the dealership for help.';
type Readiness = { enabled?: boolean; depositPence?: number; terms?: string; test?: boolean };

export function ReserveCar({ car }: { car: Car }) {
  const pricePence = Math.round((car.price ?? 0) * 100);
  const eligible = (!car.inventoryStatus || car.inventoryStatus === 'available')
    && (!car.currency || car.currency.toUpperCase() === 'GBP')
    && Number.isSafeInteger(pricePence) && pricePence >= depositPence;
  const readiness = useQuery({
    queryKey: ['reservation-payment-readiness'],
    queryFn: async ({ signal }): Promise<Readiness> => {
      const response = await fetch('/api/reservations/payment-readiness', { credentials: 'omit', cache: 'no-store', signal });
      if (!response.ok) throw new Error('Could not check reservation availability.');
      return response.json();
    },
    enabled: eligible,
    staleTime: 30_000,
    retry: false,
  });
  const dialogTheme = useVehicleDialogTheme();
  const refundNoteId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [acceptedQuote, setAcceptedQuote] = useState('');
  const inFlight = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const terms = readiness.data?.terms;
  const testMode = import.meta.env.DEV && readiness.data?.test === true && window.location.hostname === '127.0.0.1'
    && document.querySelector('meta[name="luxxy-reservation-test"]')?.getAttribute('content') === 'true';
  const available = eligible && !readiness.isError && readiness.data?.enabled === true
    && (readiness.data.test !== true || testMode) && readiness.data.depositPence === depositPence && typeof terms === 'string' && terms.trim() !== '';
  const quote = available ? JSON.stringify([pricePence, terms]) : '';

  useEffect(() => {
    // Back navigation from Stripe can restore the previous document.
    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      inFlight.current = false;
      setPending(false);
      setOpen(false);
    }
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  if (!available && !open) return null;

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || acceptedQuote !== quote || inFlight.current) return;
    const form = new FormData(event.currentTarget);
    const customerName = String(form.get('customerName') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const phone = String(form.get('phone') ?? '').replace(/[\s().\-/]/g, '');
    if (customerName.length < 2 || !/^\+?\d{7,15}$/.test(phone)) {
      setError('Enter your name and a valid phone number.');
      return;
    }

    const body = {
      vehicleId: car.id, customerName, email, phone,
      expectedPricePence: pricePence, expectedDepositPence: depositPence, termsAccepted: true, terms,
    };
    const payload = JSON.stringify(body);
    inFlight.current = true;
    setPending(true);
    setError('');
    let redirecting = false;
    try {
      if (attempt.current?.payload !== payload) attempt.current = { payload, key: requestUuid() };
      const response = await fetch('/api/reservations/checkout', {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, idempotencyKey: attempt.current.key }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409 || response.status === 403) {
          setAcceptedQuote('');
          void readiness.refetch();
        }
        setError(typeof result?.error === 'string' ? result.error : paymentError);
        return;
      }
      const destination = new URL(result.checkoutUrl, window.location.origin);
      const validDestination = import.meta.env.DEV && testMode
        ? destination.origin === window.location.origin && destination.pathname === '/reservation-test-checkout'
        : destination.origin === 'https://checkout.stripe.com';
      if (!validDestination || destination.username || destination.password) {
        throw new Error('Invalid checkout destination');
      }
      window.location.assign(destination.href);
      redirecting = true;
    } catch {
      setError(paymentError);
    } finally {
      if (!redirecting) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }

  return (
    <div className="vehicle-reserve">
      <Dialog open={open} onOpenChange={next => {
        if (inFlight.current) return;
        setOpen(next);
        if (next) {
          setAcceptedQuote('');
          setError('');
        }
      }}>
        {available && <DialogTrigger asChild>
          <Button type="button" className="vehicle-reserve-button" aria-describedby={refundNoteId}>Reserve this car for £99</Button>
        </DialogTrigger>}
        <DialogContent className="vehicle-action-dialog vehicle-reservation-dialog" style={dialogTheme} closeDisabled={pending}>
          <div className="vehicle-dialog-header">
            <DialogTitle>Reserve this car for £99</DialogTitle>
            <DialogDescription>{testMode
              ? 'Test payment. Use the sample details below to try the fully refundable £99 reservation.'
              : 'The £99 deposit is fully refundable. You’ll pay securely by card on Stripe.'}</DialogDescription>
          </div>
          <VehicleDialogVehicle car={car} showRegistrationPlate />
          {available ? <form className="vehicle-dialog-form" onSubmit={checkout} aria-busy={pending}>
            <label className="block"><span className="field-label">Your name</span><Input required name="customerName" minLength={2} maxLength={120} autoComplete={testMode ? "off" : "name"} disabled={pending} readOnly={testMode} defaultValue={testMode ? "Jamie Patel" : undefined} /></label>
            <label className="block"><span className="field-label">Email address</span><Input required name="email" type="email" maxLength={254} autoComplete={testMode ? "off" : "email"} disabled={pending} readOnly={testMode} defaultValue={testMode ? "jamie@example.test" : undefined} /></label>
            <label className="block"><span className="field-label">Phone number</span><Input required name="phone" type="tel" maxLength={30} autoComplete={testMode ? "off" : "tel"} disabled={pending} readOnly={testMode} defaultValue={testMode ? "07700 900123" : undefined} /></label>
            <section className="vehicle-dialog-terms">
              <h3>Reservation terms</h3>
              <p className="whitespace-pre-wrap break-words">{terms}</p>
            </section>
            <label className="vehicle-dialog-consent min-h-11">
              <input type="checkbox" checked={acceptedQuote === quote} required disabled={pending} onChange={event => setAcceptedQuote(event.target.checked ? quote : '')} />
              <span>I accept the reservation terms.</span>
            </label>
            {error && <p role="alert" className="vehicle-dialog-error">{error}</p>}
            <Button type="submit" className="vehicle-dialog-primary" disabled={pending || acceptedQuote !== quote}>{pending ? 'Opening payment…' : testMode ? 'Continue to test payment' : 'Continue to £99 payment'}</Button>
          </form> : <p role="alert" className="vehicle-dialog-error">Online reservation is currently unavailable. Contact the dealership for help.</p>}
        </DialogContent>
      </Dialog>
      {available && <p id={refundNoteId}>£99 deposit · Fully refundable</p>}
    </div>
  );
}
