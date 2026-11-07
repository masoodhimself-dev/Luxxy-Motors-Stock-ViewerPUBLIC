import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { isUKNumberPlate } from '@/lib/utils';
import { multiCustomerThemeVariables } from '@/lib/multi-customer-theme';
import './reservation-test-checkout.css';

type Checkout = {
  vehicleId: string;
  vehicleTitle: string;
  registration: string | null;
  photo: string | null;
  pricePence: number;
  depositPence: number;
  state: 'pending' | 'paid' | 'cancelled' | 'refunded';
};
type Action = 'read' | 'pay' | 'cancel' | 'refund';
const palette = multiCustomerThemeVariables('racing-green') as CSSProperties;
const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const copy = {
  pending: ['Pay your reservation deposit', 'Try the £99 deposit using the test payment button below.'],
  paid: ['Test reservation confirmed', 'The car is marked reserved in this preview. Try a full refund to release it.'],
  cancelled: ['Test payment cancelled', 'The car is still available in the preview.'],
  refunded: ['Test refund completed', 'The full £99 was refunded in the preview and the car is available again.'],
};

async function request(token: string, action: Action, signal?: AbortSignal): Promise<Checkout> {
  const response = await fetch('/api/reservations/test-checkout', {
    method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Open a new test checkout from the car page.');
  return data;
}

export default function ReservationTestCheckout() {
  const [token] = useState(() => window.location.hash.slice(1));
  const canTest = import.meta.env.DEV && window.location.hostname === '127.0.0.1' && /^[a-f0-9]{48}$/.test(token)
    && document.querySelector('meta[name="luxxy-reservation-test"]')?.getAttribute('content') === 'true';
  const [checkout, setCheckout] = useState<Checkout>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!canTest) return;
    const controller = new AbortController();
    void request(token, 'read', controller.signal)
      .then(data => { if (!controller.signal.aborted) setCheckout(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [canTest, token]);

  useEffect(() => {
    if (checkout && checkout.state !== 'pending') heading.current?.focus({ preventScroll: true });
  }, [checkout]);

  async function update(action: Exclude<Action, 'read'>) {
    if (inFlight.current || !canTest) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      setCheckout(await request(token, action));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Try again or return to the car.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const [title, description] = checkout ? copy[checkout.state]
    : !canTest || error ? ['Test checkout unavailable', 'Open a new test checkout from a vehicle page.']
    : ['Opening test payment', 'Finding the car and deposit details.'];

  return <main className="reservation-test dealer-site-theme" style={palette}>
    <header className="reservation-test-header">
      <img src="/brand/multi-choice-motors/multi-choice-wordmark.svg" width="192" height="40" alt="Multi Choice Motors" />
      <span>Test payment</span>
    </header>
    <section className="reservation-test-card" aria-busy={busy}>
      <div className="reservation-test-heading">
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </div>
      {checkout && <>
        <div className="reservation-test-car">
          {checkout.photo && <img src={checkout.photo} width="144" height="108" alt="" referrerPolicy="no-referrer" />}
          <div>
            <strong>{checkout.vehicleTitle}</strong>
            {checkout.registration && isUKNumberPlate(checkout.registration) && <UKNumberPlate value={checkout.registration} size="sm" variant="front" />}
            <p>{money.format(checkout.pricePence / 100)} vehicle price</p>
          </div>
        </div>
        <dl className="reservation-test-deposit"><div><dt>{checkout.state === 'refunded' ? 'Test refund' : 'Reservation deposit'}</dt><dd>{money.format(checkout.depositPence / 100)}</dd></div></dl>
      </>}
      {error && <p className="reservation-test-error" role="alert">{error}</p>}
      <div className="reservation-test-actions">
        {checkout?.state === 'pending' && <>
          <Button disabled={busy} onClick={() => void update('pay')}>{busy ? 'Updating test payment…' : 'Pay £99 in test mode'}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void update('cancel')}>Cancel test payment</Button>
        </>}
        {checkout?.state === 'paid' && <Button disabled={busy} onClick={() => void update('refund')}>{busy ? 'Processing test refund…' : 'Test full refund'}</Button>}
        {checkout?.state !== 'pending' && <Button asChild variant="outline"><a href={checkout ? `/vehicle/${encodeURIComponent(checkout.vehicleId)}` : '/stock'}>{checkout ? 'Back to the car' : 'Browse test stock'}</a></Button>}
      </div>
      <p className="reservation-test-note">No money is taken or returned in this preview.</p>
    </section>
  </main>;
}
