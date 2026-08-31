import { useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, CalendarDays, Fuel, Heart, MapPin, Settings2 } from 'lucide-react';
import type { Car } from '@/lib/stock-context';
import { formatMileage, formatPrice, getThumbnailUrl } from '@/lib/utils';
import { getVehicleBookingHref } from '@/lib/cta-helpers';

function writeOffLabel(car: Car) {
  const category = car.writeOffCategory?.toUpperCase() || '';
  if (category.includes('S')) return 'CAT S';
  if (category.includes('N')) return 'CAT N';
  return null;
}

export function ConciergeCarCard({ car, saved, onToggle }: { car: Car; saved: boolean; onToggle: () => void }) {
  const [imageError, setImageError] = useState(false);
  const image = getThumbnailUrl(car);
  const label = car.title || [car.make, car.model].filter(Boolean).join(' ') || 'Vehicle';
  const writeOff = writeOffLabel(car);
  const rationale = [
    car.transmission === 'Automatic' ? 'easy automatic driving' : null,
    car.mileage ? `${formatMileage(car.mileage)} recorded mileage` : null,
    !writeOff ? 'no recorded write-off category' : `${writeOff} history disclosed`,
  ].filter(Boolean).join(' · ');

  return (
    <article className="group grid overflow-hidden rounded-[22px] border border-border bg-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl motion-reduce:transform-none motion-reduce:transition-none md:grid-cols-[280px_minmax(0,1fr)]" data-testid={`card-concierge-vehicle-${car.id}`}>
      <Link href={`/vehicle/${car.id}`} className="relative min-h-52 bg-secondary outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        {image && !imageError ? <img src={image} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageError(true)} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transform-none" /> : <div className="grid h-full place-items-center text-sm font-semibold text-muted-foreground">Image unavailable</div>}
        {writeOff && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-destructive px-2.5 py-1 text-[10px] font-extrabold text-destructive-foreground"><AlertTriangle className="h-3 w-3" />{writeOff}</span>}
      </Link>
      <div className="flex flex-col p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[.15em] text-muted-foreground">{[car.year, car.colour].filter(Boolean).join(' · ')}</p>
            <Link href={`/vehicle/${car.id}`} className="mt-1 block text-xl font-extrabold tracking-tight text-primary hover:text-accent">{label}</Link>
            {(car.variant || car.trim) && <p className="mt-1 text-sm font-medium text-muted-foreground">{car.variant || car.trim}</p>}
          </div>
          <button type="button" onClick={onToggle} aria-label={saved ? `Remove ${label} from shortlist` : `Save ${label} to shortlist`} data-testid={`button-shortlist-${car.id}`} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border transition-colors ${saved ? 'border-accent bg-accent/20 text-primary' : 'border-border text-muted-foreground hover:border-primary hover:text-primary'}`}><Heart className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} /></button>
        </div>
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-muted-foreground">
          {car.year && <span><CalendarDays className="mr-1 inline h-3.5 w-3.5 text-accent" />{car.year}</span>}
          {(car.mileage || car.mileageText) && <span><MapPin className="mr-1 inline h-3.5 w-3.5 text-accent" />{car.mileage ? formatMileage(car.mileage) : car.mileageText}</span>}
          {car.fuel && <span><Fuel className="mr-1 inline h-3.5 w-3.5 text-accent" />{car.fuel}</span>}
          {car.transmission && <span><Settings2 className="mr-1 inline h-3.5 w-3.5 text-accent" />{car.transmission}</span>}
        </div>
        <div className="mt-4 rounded-xl bg-secondary/60 px-3 py-3">
          <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-primary">Why it stands out</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-muted-foreground">{rationale || 'Explore the full vehicle details and condition information.'}</p>
          {writeOff && <p className="mt-1 text-[11px] font-bold text-destructive">Write-off category shown in the vehicle history disclosure.</p>}
        </div>
        <div className="mt-5 flex items-end justify-between gap-3 border-t border-border pt-4">
          <p className="text-2xl font-extrabold tracking-tight text-primary">{car.price ? formatPrice(car.price, car.currency) : 'POA'}</p>
          <a href={getVehicleBookingHref(car)} data-testid={`link-book-vehicle-${car.id}`} className="rounded-full bg-primary px-4 py-2.5 text-xs font-extrabold text-primary-foreground transition-colors hover:bg-primary/90">View & book</a>
        </div>
      </div>
    </article>
  );
}