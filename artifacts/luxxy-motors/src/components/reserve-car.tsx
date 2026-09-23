import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard } from 'lucide-react';
import { getGetStockQueryKey, getGetDealerSettingsQueryKey, useCreateReservation, type OnlineReservationInput } from '@workspace/api-client-react';
import type { Car } from '@/lib/stock-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const pounds = (pence: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(pence / 100).replace(/\.00$/, '');
type Contact = { customerName: string; email: string; phone: string };

export function ReserveCar({ car, className, customer, partExchange }: {
  car: Car;
  className?: string;
  customer?: Contact;
  partExchange?: { registration: string; mileage: number };
}) {
  const { settings } = useDealerSettings();
  const options = settings.onlineReservation;
  const cache = useQueryClient();
  const mutation = useCreateReservation();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'details' | 'payment'>('details');
  const [contact, setContact] = useState<Contact>({ customerName: '', email: '', phone: '' });
  const [accepted, setAccepted] = useState(false);
  const [formError, setFormError] = useState('');
  const [photoFailed, setPhotoFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const attempt = useRef<{ data: string; key: string } | null>(null);
  const photo = getThumbnailUrl(car);
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

  function reserve() {
    if (!accepted || !options || mutation.isPending) return;
    const body = {
      vehicleId: car.id,
      customerName: contact.customerName.trim(), email: contact.email.trim(), phone: contact.phone,
      expectedPricePence: pricePence, expectedDepositPence: options.depositPence,
      termsAccepted: true as const, terms: options.terms,
      ...(partExchange?.registration.trim() && Number.isInteger(partExchange.mileage) ? { partExchange } : {}),
    };
    const data = JSON.stringify(body);
    if (attempt.current?.data !== data) attempt.current = { data, key: crypto.randomUUID() };
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
      if (mutation.isPending) return;
      setOpen(next);
      if (next && !result) {
        setContact(customer ?? { customerName: '', email: '', phone: '' });
        setStep('details'); setAccepted(false); setFormError(''); setPhotoFailed(false); mutation.reset();
      }
    }}>
      {options?.enabled && <DialogTrigger asChild>
        <Button type="button" variant="outline" className={className}>
          <CreditCard className="h-4 w-4" aria-hidden="true" />{result ? 'View reservation' : 'Reserve car online'}
        </Button>
      </DialogTrigger>}
      <DialogContent data-testid="reserve-car-dialog" onEscapeKeyDown={event => { if (mutation.isPending) event.preventDefault(); }} onInteractOutside={event => { if (mutation.isPending) event.preventDefault(); }}>
        <div className="pr-12">
          <p className="luxxy-label mb-3 text-accent">{result ? 'Your reservation' : 'Reserve car online'}</p>
          <DialogTitle ref={heading} tabIndex={-1} className="focus:outline-none">
            {result ? (result.status === 'cancelled' ? 'Reservation cancelled' : 'Your car is reserved') : step === 'details' ? 'Make it your next car.' : 'Review your reservation'}
          </DialogTitle>
          <DialogDescription className="mt-3 font-normal">
            {result ? (result.status === 'cancelled' ? 'This reservation has been cancelled. No money was received and this reservation no longer holds the car.' : 'Keep your reference below. The team can now find your reservation and contact details.') : 'Reserve this car for the team to follow up with you. Only the payment is simulated for now.'}
          </DialogDescription>
        </div>
        <div className="flex items-center gap-3 border-y border-border py-4">
          {photo && !photoFailed && <img src={photo} alt={vehicleDisplayTitle(car)} width={120} height={90} onError={() => setPhotoFailed(true)} className="aspect-[4/3] w-24 shrink-0 rounded-sm object-cover" />}
          <div className="min-w-0"><p className="text-sm font-semibold">{vehicleDisplayTitle(car)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{[car.year, car.transmission].filter(Boolean).join(' · ')}</p>
            <p className="mt-2 font-semibold">{formatPrice(car.price ?? 0, 'GBP')}</p>
          </div>
        </div>
        {result ? <div className="space-y-4" data-testid="reservation-success">
          <div className="flex gap-3 bg-secondary/50 p-4"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" /><div>
            <p className="text-xs text-muted-foreground">Reservation reference</p><p className="mt-1 break-all font-mono text-lg font-semibold">{result.reference}</p>
            <p className="mt-2 text-sm">Deposit: {pounds(result.depositPence)} · Payment simulated</p>
            <p className="mt-2 text-sm text-muted-foreground">£0 received. Your full vehicle balance is still outstanding. This is a reservation record, not a payment receipt.</p>
          </div></div>
          <p className="text-sm leading-6 text-muted-foreground">{result.status === 'cancelled' ? 'Contact the dealership or refresh the vehicle page to check its current availability.' : 'Contact the dealership with this reference if you need to change or cancel your reservation. A viewing must be booked separately.'}</p>
          <DialogClose asChild><Button type="button" className="w-full">Done</Button></DialogClose>
        </div> : step === 'details' ? <form onSubmit={review} className="space-y-4">
          <label className="block"><span className="field-label">Your name</span><Input required minLength={2} maxLength={120} autoComplete="name" value={contact.customerName} onChange={e => setContact({ ...contact, customerName: e.target.value })} /></label>
          <label className="block"><span className="field-label">Email address</span><Input required type="email" maxLength={254} autoComplete="email" value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} /></label>
          <label className="block"><span className="field-label">Phone number</span><Input required type="tel" maxLength={30} autoComplete="tel" value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></label>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <Button type="submit" className="w-full">Continue · {pounds(depositPence)} deposit</Button>
        </form> : <div className="space-y-4">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-3"><dt>Reservation deposit</dt><dd className="font-semibold">{pounds(depositPence)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Charged now</dt><dd className="font-semibold">£0 · simulated payment</dd></div>
          </dl>
          <div className="border-y border-border py-4"><h3 className="text-sm font-semibold">Reservation terms</h3><p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{options?.terms}</p></div>
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={accepted} onChange={e => setAccepted(e.target.checked)} />I accept these reservation terms and understand that no money will be taken during this simulated payment.</label>
          <p className="text-xs leading-6 text-muted-foreground">Confirming creates a reservation for this car. It does not record a paid deposit.</p>
          {mutation.isError && <p role="alert" className="text-sm text-destructive">{error?.data?.error || 'We could not confirm your reservation. Please try again. No payment has been taken.'}</p>}
          <Button type="button" className="w-full" disabled={!accepted || mutation.isPending} onClick={reserve}>{mutation.isPending ? 'Reserving your car…' : 'Confirm reservation · simulate payment'}</Button>
          <Button type="button" variant="ghost" className="w-full" disabled={mutation.isPending} onClick={() => { setStep('details'); mutation.reset(); }}>Back to your details</Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
