import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CreditCard } from 'lucide-react';
import type { Car } from '@/lib/stock-context';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

// An illustrative amount only. This flow never calls a payment or reservation API.
const DEMO_DEPOSIT = 100;

export function DepositDemo({ car, className }: { car: Car; className?: string }) {
  const [open, setOpen] = useState(false);
  const [complete, setComplete] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const photo = getThumbnailUrl(car);
  const title = vehicleDisplayTitle(car);
  const showBalance = car.price != null && car.price >= DEMO_DEPOSIT && (!car.currency || car.currency === 'GBP');

  useEffect(() => {
    if (complete) heading.current?.focus();
  }, [complete]);

  return (
    <Dialog open={open} onOpenChange={next => {
      setOpen(next);
      if (next) { setComplete(false); setImageFailed(false); }
    }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className={className}>
          <CreditCard className="h-4 w-4" aria-hidden="true" />Leave a deposit · demo
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="deposit-demo-dialog">
        <div className="pr-12">
          <p className="luxxy-label mb-3 text-accent">Demo only · no money taken</p>
          <DialogTitle ref={heading} tabIndex={-1} className="focus:outline-none">
            {complete ? 'Demo payment complete' : 'Leave a deposit'}
          </DialogTitle>
          <DialogDescription className="mt-3 font-normal">
            {complete
              ? 'No money was taken and this car has not been reserved. Your viewing or enquiry stays unchanged.'
              : 'Try the deposit experience with a £100 example payment. No card details are needed and the car will not be reserved.'}
          </DialogDescription>
        </div>

        <div className="flex items-center gap-4 border-y border-border py-4">
          {photo && !imageFailed && <img src={photo} alt={title} width={120} height={90}
            onError={() => setImageFailed(true)} className="aspect-[4/3] w-24 shrink-0 rounded-sm object-cover sm:w-28" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{[car.year, car.transmission].filter(Boolean).join(' · ')}</p>
            <p className="mt-2 font-semibold">{car.price ? formatPrice(car.price, car.currency) : 'Price on application'}</p>
          </div>
        </div>

        {complete ? (
          <div className="space-y-5" data-testid="deposit-demo-success">
            <div className="flex items-start gap-3 bg-secondary/50 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div><p className="font-semibold">£100 simulated payment</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">This is a demonstration, not a payment receipt. Contact the team to discuss a real deposit and its terms.</p>
              </div>
            </div>
            <DialogClose asChild><Button type="button" className="w-full">Done</Button></DialogClose>
          </div>
        ) : (
          <div className="space-y-5">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt>Example deposit</dt><dd className="font-semibold">£100</dd></div>
              {showBalance && <div className="flex justify-between gap-3 text-muted-foreground"><dt>Illustrative balance after deposit</dt><dd className="shrink-0">{formatPrice(car.price! - DEMO_DEPOSIT, 'GBP')}</dd></div>}
              <div className="flex justify-between gap-3 border-t border-border pt-3"><dt>Charged today</dt><dd className="font-semibold">£0 · demo</dd></div>
            </dl>
            <p className="text-xs leading-6 text-muted-foreground">The amount and deposit terms are examples for this preview. A real payment service has not been connected.</p>
            <Button type="button" className="w-full" onClick={() => setComplete(true)}>
              Pretend pay £100
            </Button>
            <DialogClose asChild><Button type="button" variant="ghost" className="w-full">Cancel</Button></DialogClose>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
