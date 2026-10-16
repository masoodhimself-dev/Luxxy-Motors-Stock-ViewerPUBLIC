import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Link, useSearch } from 'wouter';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/page-ui';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useDealerSettings } from '@/lib/dealer-settings-context';

type Payment = {
  reference: string;
  vehicleId: string;
  vehicleTitle: string;
  vehicleRegistration?: string;
  amountReceivedPence: number;
  depositPence: number;
  paymentStatus: string;
  status: string;
  mode: 'test' | 'live';
  needsReview: boolean;
};

export default function ReservationPaymentReturn() {
  const params = new URLSearchParams(useSearch());
  const reference = params.get('reference') ?? '';
  const token = params.get('token') ?? '';
  const incompleteLink = !reference || !token;
  const { settings } = useDealerSettings();

  usePageMeta({ title: `Reservation payment | ${settings.identity.name}`, description: 'Check your reservation payment status or contact us for help.' });
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const query = useQuery({
    queryKey: ['reservation-payment-status', reference, token],
    queryFn: () => customFetch<{ reservation: Payment }>('/api/reservations/payment-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference, token }), cache: 'no-store', referrerPolicy: 'no-referrer',
    }),
    enabled: !incompleteLink,
    retry: false,
    refetchInterval: query => query.state.data?.reservation.paymentStatus === 'pending' ? 15000 : false,
  });

  const record = query.data?.reservation;
  const paid = record?.mode === 'live' && record.paymentStatus === 'confirmed' && record.status === 'reserved';
  const test = record?.paymentStatus === 'test_confirmed';
  const title = incompleteLink ? 'Payment link unavailable'
    : paid ? 'Your car is reserved'
    : test ? 'Test payment completed'
    : record?.status === 'expired' ? 'Payment session expired'
    : record?.status === 'cancelled' ? 'Reservation cancelled'
    : record && record.paymentStatus.includes('refund') ? 'Your refund update'
    : query.isError ? 'We couldn’t check your payment'
    : record ? 'Payment confirmation pending' : 'Checking your reservation';
  const description = incompleteLink ? 'This payment link is incomplete. Contact us with your reservation reference.'
    : query.isError ? `Please contact us with reference ${reference}. Please don’t pay again until we’ve checked the status.`
    : !record ? 'Checking the confirmed payment status…'
    : paid ? `Your ${(record.amountReceivedPence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })} deposit has been confirmed. We’ll be in touch about your next steps.`
    : test ? 'No real money has been received. This test payment does not create a paid receipt.'
    : record.status === 'expired' ? 'No confirmed payment has been recorded. Return to the car to check current availability.'
    : record.status === 'cancelled' ? 'This payment session has been cancelled. Contact us to check your reservation.'
    : record.paymentStatus === 'refunded' ? 'Your payment has been refunded. Contact us for help.'
    : record.paymentStatus === 'partially_refunded' ? 'Part of your payment has been refunded. Contact us for the remaining balance.'
    : record.paymentStatus === 'refund_pending' ? 'Your refund is being processed. We’ll confirm when the payment provider has completed it.'
    : record.paymentStatus === 'refund_failed' ? 'The refund needs review. Contact us with your reference.'
    : 'We are waiting for the payment provider to confirm the payment. This page checks automatically. Please do not pay again.';

  return <div className="luxxy-shell min-h-[60vh] px-4 py-12 sm:px-6 lg:px-8">
    <section className="mx-auto w-full max-w-xl rounded-sm border border-border bg-card p-6 sm:p-10">
      <PageHeading eyebrow="Online reservation" title={title} />
      {record && <dl className="mb-6 space-y-3 rounded-sm border border-border bg-secondary/40 p-4 text-sm">
        <div><dt className="text-xs font-medium text-muted-foreground">Vehicle</dt><dd className="mt-1 break-words font-semibold text-primary">{record.vehicleTitle}{record.vehicleRegistration && ` · ${record.vehicleRegistration}`}</dd></div>
        <div><dt className="text-xs font-medium text-muted-foreground">Reservation reference</dt><dd className="mt-1 break-all font-semibold text-primary">{record.reference}</dd></div>
      </dl>}
      <p className="break-words text-base leading-7 text-muted-foreground" role={incompleteLink || query.isError ? 'alert' : 'status'}>{description}</p>
      {record?.needsReview && <p className="mt-4 border-l-2 border-accent pl-4 text-sm leading-6">We need to review the payment status before confirming your reservation.</p>}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {record && <Button asChild><Link href={`/vehicle/${record.vehicleId}`}>View your car</Link></Button>}
        <Button asChild variant={record ? 'outline' : 'default'}><Link href="/contact">Contact us</Link></Button>
        {query.isError && <Button onClick={() => void query.refetch()} disabled={query.isFetching} variant="outline">{query.isFetching ? 'Checking…' : 'Check again'}</Button>}
      </div>
    </section>
  </div>;
}
