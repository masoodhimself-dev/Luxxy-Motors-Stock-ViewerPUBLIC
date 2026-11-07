import { useEffect, useState } from 'react';
import { CustomerDocumentTheme } from '@/components/multi-customer-theme';
import { PageHeading } from '@/components/page-ui';
import { Button } from '@/components/ui/button';

type Reservation = {
  reference: string;
  vehicleId: string;
  vehicleTitle: string;
  vehicleRegistration?: string;
  depositPence: number;
  amountReceivedPence: number;
  amountRefundedPence: number;
  status: string;
  paymentStatus: string;
  mode: 'test' | 'live';
  needsReview: boolean;
};

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

function readCapability() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const parameters = fragment.has('token') ? fragment : new URLSearchParams(window.location.search);
  const reference = parameters.get('reference') ?? '';
  const token = parameters.get('token') ?? '';
  return /^[A-Z0-9-]{4,40}$/.test(reference) && /^[a-f0-9]{64}$/.test(token)
    ? { reference, token }
    : null;
}

function readStatus(value: unknown, reference: string): Reservation {
  const record = value as Reservation | undefined;
  if (record?.reference !== reference || typeof record.vehicleId !== 'string'
    || typeof record.vehicleTitle !== 'string' || typeof record.status !== 'string'
    || typeof record.paymentStatus !== 'string' || !Number.isSafeInteger(record.depositPence)
    || record.depositPence <= 0 || !Number.isSafeInteger(record.amountReceivedPence)
    || !Number.isSafeInteger(record.amountRefundedPence) || typeof record.needsReview !== 'boolean') {
    throw new Error('Invalid reservation status');
  }
  return record;
}

function paymentMessage(record: Reservation) {
  if (record.needsReview) return ['We’re checking your payment', 'Please contact the dealership to check your reservation before paying again.'];
  switch (record.paymentStatus) {
    case 'confirmed':
      if (record.mode === 'live' && record.status === 'reserved' && record.amountReceivedPence === record.depositPence
        && record.amountRefundedPence === 0) {
        return ['Your car is reserved', `Your ${money.format(record.amountReceivedPence / 100)} deposit has been confirmed. The dealership will be in touch about the next steps.`];
      }
      break;
    case 'refunded':
      return ['Your deposit was refunded', 'The payment provider confirmed your refund. Contact the dealership if you need help.'];
    case 'partially_refunded':
      return ['Your refund update', 'The payment provider confirmed a partial refund. Contact the dealership about the rest of your deposit.'];
    case 'refund_pending':
      return ['Your refund is in progress', 'The payment provider is processing your refund.'];
    case 'refund_failed':
      return ['Your refund needs a check', 'Please contact the dealership for help with your refund.'];
    case 'test_confirmed':
      return ['No payment received', 'Contact the dealership to check the current availability of the car.'];
  }
  if (record.status === 'expired') return ['Payment session expired', 'No payment was confirmed. Return to the car to check availability.'];
  if (record.status === 'cancelled') return ['Reservation cancelled', 'Contact the dealership if you need help.'];
  return ['Payment confirmation pending', 'We’re waiting for the payment provider to confirm your deposit. Please don’t pay again.'];
}

function ReservationStatus() {
  const [capability] = useState(readCapability);
  const [leftCheckout] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('cancelled') === '1');
  const [record, setRecord] = useState<Reservation>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Your reservation';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    const referrer = document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    document.head.append(robots, referrer);
    // Migrate historical query links to the fragment so later navigation does not send the token.
    if (capability && new URLSearchParams(window.location.search).has('token')) {
      const fragment = new URLSearchParams(capability).toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}#${fragment}`);
    }
    return () => { document.title = previousTitle; robots.remove(); referrer.remove(); };
  }, [capability]);

  useEffect(() => {
    if (!capability) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    async function check() {
      try {
        const response = await fetch('/api/reservations/payment-status', {
          method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
          signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(capability),
        });
        if (!response.ok) throw new Error('Payment status unavailable');
        const { reservation } = await response.json();
        const current = readStatus(reservation, capability!.reference);
        if (controller.signal.aborted) return;
        setRecord(current);
        if (!current.needsReview && (current.paymentStatus === 'pending' || current.paymentStatus === 'refund_pending') && ++polls < 12) {
          timer = setTimeout(check, 10_000);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt, capability]);

  const [title, description] = !capability ? ['Payment link unavailable', 'Contact the dealership with your name and car details.']
    : failed ? ['We couldn’t check your payment', 'Check again or contact the dealership before paying again.']
    : record && leftCheckout && !record.needsReview && record.paymentStatus === 'pending' && record.status === 'awaiting_payment'
      ? ['You left checkout', 'We haven’t confirmed a payment. Contact the dealership if you want to check your reservation or try again.']
      : record ? paymentMessage(record) : ['Checking your reservation', 'Checking for a confirmed payment…'];
  const checkAgain = failed || record?.paymentStatus === 'pending' || record?.paymentStatus === 'refund_pending';

  return <main className="luxxy-shell min-h-[100dvh] px-4 py-12 sm:px-6">
    <section className="mx-auto max-w-xl rounded-md border border-border bg-card p-6 sm:p-10">
      <PageHeading eyebrow="Online reservation" title={title} />
      {record && <dl className="mb-5 space-y-3 border-b border-border pb-5 text-sm">
        <div><dt className="text-muted-foreground">Vehicle</dt><dd className="break-words font-semibold">{record.vehicleTitle}{record.vehicleRegistration && ` · ${record.vehicleRegistration}`}</dd></div>
        <div><dt className="text-muted-foreground">Reservation reference</dt><dd className="font-semibold">{record.reference}</dd></div>
      </dl>}
      <p className="text-base leading-7 text-muted-foreground" role={!capability || failed ? 'alert' : 'status'}>{description}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild><a href="/contact">Contact the dealership</a></Button>
        {record && <Button asChild variant="outline"><a href={`/vehicle/${encodeURIComponent(record.vehicleId)}`}>View your car</a></Button>}
        {checkAgain && <Button type="button" variant="outline" onClick={() => { setRecord(undefined); setFailed(false); setAttempt(current => current + 1); }}>Check again</Button>}
      </div>
    </section>
  </main>;
}

export default function ReservationPaymentReturn() {
  return <CustomerDocumentTheme><ReservationStatus /></CustomerDocumentTheme>;
}
