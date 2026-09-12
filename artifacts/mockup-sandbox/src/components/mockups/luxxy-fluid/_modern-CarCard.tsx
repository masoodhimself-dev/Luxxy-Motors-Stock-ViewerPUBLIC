import { useMemo, useState } from 'react';
import { Camera, Check, ChevronRight, Heart, Scale } from 'lucide-react';
import { MockLink } from './_shared/Link';
import { Car, cn, formatMileage, formatPrice, getSafeImageUrl, getThumbnailUrl, vehicleDisplayTitle } from './_data';

export function ModernCarCard({ car, featured = false }: { car: Car; featured?: boolean }) {
  const [saved, setSaved] = useState(false);
  const [compared, setCompared] = useState(false);
  const images = useMemo(() => {
    const urls: string[] = [];
    [getThumbnailUrl(car), ...(car.images || []), car.heroImage].forEach((image) => {
      const url = getSafeImageUrl(image);
      if (url && !urls.includes(url)) urls.push(url);
    });
    return urls;
  }, [car]);
  const label = vehicleDisplayTitle(car);
  const specs = [car.year ? String(car.year) : null, car.mileage ? formatMileage(car.mileage) : car.mileageText, car.fuel, car.transmission].filter(Boolean) as string[];

  return (
    <article className={cn('modern-vehicle group min-w-0', featured && 'md:min-w-[430px]')}>
      <div className={cn('relative overflow-hidden bg-[hsl(var(--modern-panel))]', featured ? 'aspect-[16/10]' : 'aspect-[4/3]')}>
        <MockLink href={`/vehicle/${car.id}`} className="modern-focus absolute inset-0 z-10" aria-label={`View ${label}`}><span className="sr-only">View vehicle</span></MockLink>
        {images.length ? (
          <img src={images[0]} alt="" loading="lazy" className="modern-image h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-[hsl(var(--modern-muted))]"><Camera className="h-8 w-8" /></div>
        )}
        <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between p-3">
          <span className="bg-[hsl(var(--modern-ivory)/.9)] px-2 py-1 text-[11px] font-semibold text-[hsl(var(--modern-ink))]">{car.imageCount || images.length} photos</span>
          <button
            type="button"
            onClick={() => setSaved((value) => !value)}
            aria-pressed={saved}
            aria-label={saved ? `Remove ${label} from saved cars` : `Save ${label}`}
            className={cn('modern-focus grid h-11 w-11 place-items-center rounded-full backdrop-blur-md', saved ? 'bg-[hsl(var(--modern-blue))] text-white' : 'bg-[hsl(var(--modern-ivory)/.9)] text-[hsl(var(--modern-ink))] hover:text-[hsl(var(--modern-blue))]')}
          >
            <Heart className={cn('h-4 w-4', saved && 'fill-current')} />
          </button>
        </div>
      </div>
      <div className="border-b modern-rule py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="modern-display truncate text-lg font-semibold">{label}</h3>
            {(car.variant || car.trim) && <p className="mt-1 truncate text-sm text-[hsl(var(--modern-muted))]">{car.variant || car.trim}</p>}
          </div>
          <p className="shrink-0 text-lg font-semibold">{car.price ? formatPrice(car.price, car.currency) : 'POA'}</p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[hsl(var(--modern-muted))]">
          {specs.map((spec, index) => <span key={`${spec}-${index}`} className="flex items-center gap-2">{index > 0 && <i className="h-1 w-1 rounded-full bg-[hsl(var(--modern-line))]" />}{spec}</span>)}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={() => setCompared((value) => !value)} aria-pressed={compared} className={cn('modern-focus flex min-h-11 items-center gap-2 rounded-sm px-1 text-xs font-semibold', compared ? 'text-[hsl(var(--modern-blue))]' : 'text-[hsl(var(--modern-muted))] hover:text-[hsl(var(--modern-ink))]')}>
            {compared ? <Check className="h-4 w-4" /> : <Scale className="h-4 w-4" />} {compared ? 'Comparing' : 'Compare'}
          </button>
          <MockLink href={`/vehicle/${car.id}`} className="modern-focus flex min-h-11 items-center gap-1 rounded-sm px-1 text-xs font-semibold text-[hsl(var(--modern-blue))]">View car <ChevronRight className="h-4 w-4" /></MockLink>
        </div>
      </div>
    </article>
  );
}