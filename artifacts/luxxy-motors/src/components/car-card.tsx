import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Car } from '@/lib/stock-context';
import { cn, formatMileage, formatPrice, getSafeImageUrl, getThumbnailUrl, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { getPhoneHref, getVehicleBookingHref, getVehicleWhatsAppHref, recordBookingIntent, recordContactIntent } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { CompareCarButton, SaveCarButton } from '@/components/saved-car-controls';
import { ArrowRight, Calendar, Camera, MessageCircle, Phone } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';

const MAX_PREVIEW_IMAGES = 6;

export function CarCard({
  car,
  layout = 'card',
  stretchedLink = false,
  badges = [],
  analyticsSource = 'showroom',
}: {
  car: Car;
  layout?: 'row' | 'card' | 'compact';
  stretchedLink?: boolean;
  badges?: string[];
  analyticsSource?: 'showroom' | 'similar_cars' | 'saved_cars';
}) {
  const { settings: dealerConfig } = useDealerSettings();
  const isRow = layout === 'row';
  const isCompact = layout === 'compact';

  const imageUrls = useMemo(() => {
    const urls: string[] = [];
    const addImage = (image: string | { url: string; caption?: string | null } | null | undefined) => {
      const url = image ? getSafeImageUrl(image) : '';
      if (url && !urls.includes(url)) urls.push(url);
    };

    addImage(getThumbnailUrl(car));
    car.images?.forEach(addImage);
    addImage(car.heroImage);

    return urls;
  }, [car]);

  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const [isPreviewing, setIsPreviewing] = useState(false);

  const visibleImageUrls = imageUrls.filter((url) => !failedImageUrls.has(url));
  const galleryUrls = visibleImageUrls.slice(0, MAX_PREVIEW_IMAGES);
  const activeIndex = galleryUrls.length > 0 ? activeImageIndex % galleryUrls.length : 0;
  const photoCount = car.imageCount || car.images?.length || visibleImageUrls.length;

  const vehicleLabel = vehicleDisplayTitle(car);
  const registration = vehicleRegistration(car);
  const detailHref = `/vehicle/${car.id}`;
  const phoneHref = getPhoneHref(dealerConfig);
  const whatsappHref = getVehicleWhatsAppHref(car, 'get more information about this vehicle', dealerConfig);
  const bookingHref = getVehicleBookingHref(car);
  const recordVehicleOpen = () => trackEvent('vehicle_opened', {
    source: analyticsSource,
    layout,
  });

  const imageSignature = imageUrls.join('|');
  useEffect(() => {
    setActiveImageIndex(0);
    setFailedImageUrls(new Set());
    setIsPreviewing(false);
  }, [car.id, imageSignature]);

  useEffect(() => {
    if (!isPreviewing || galleryUrls.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveImageIndex((current) => (current + 1) % galleryUrls.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [isPreviewing, galleryUrls.length]);

  const specs = [
    car.year ? { label: 'Year', value: String(car.year) } : null,
    car.mileage
      ? { label: 'Mileage', value: formatMileage(car.mileage) }
      : car.mileageText
        ? { label: 'Mileage', value: car.mileageText }
        : null,
    car.fuel ? { label: 'Fuel', value: car.fuel } : null,
    car.transmission ? { label: 'Trans', value: car.transmission } : null,
    car.engineSize ? { label: 'Engine', value: car.engineSize } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const visibleSpecs = isCompact ? specs.slice(0, 3) : specs.slice(0, 4);

  const imageBlock = (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-xl bg-muted transition-shadow duration-300',
        'aspect-[4/3] w-full'
      )}
      onMouseEnter={() => setIsPreviewing(true)}
      onMouseLeave={() => { setIsPreviewing(false); setActiveImageIndex(0); }}
    >
      {stretchedLink && (
        <Link href={detailHref} onClick={recordVehicleOpen} className="absolute inset-0 z-20" aria-label={`View full details for ${vehicleLabel}`}>
          <span className="sr-only">View vehicle</span>
        </Link>
      )}

      <SaveCarButton car={car} className="absolute right-3 top-3 z-30 h-10 w-10 rounded-full border border-background/70 bg-background/90 text-primary shadow-none backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground hover:border-accent" />

      <div className="absolute top-3 left-3 z-30 flex flex-col items-start gap-2">
        {photoCount > 0 && (
          <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-background/70 bg-background/90 px-2.5 text-[11px] font-semibold text-primary shadow-none backdrop-blur">
            <Camera className="h-3.5 w-3.5" />
            {photoCount}
          </div>
        )}
        {badges.map((badge, i) => (
          <div key={i} className="inline-flex h-8 items-center rounded-full bg-accent px-2.5 text-[11px] font-semibold text-accent-foreground shadow-none">
            {badge}
          </div>
        ))}
      </div>

      {galleryUrls.length > 0 ? (
        galleryUrls.map((url, index) => (
          <img
            key={url}
            src={url}
            alt=""
            loading={index === 0 ? 'eager' : 'lazy'}
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
              index === activeIndex ? 'opacity-100' : 'opacity-0'
            )}
            onError={() => setFailedImageUrls((prev) => new Set(prev).add(url))}
          />
        ))
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-secondary">
          <Camera className="h-8 w-8 text-primary/20" />
        </div>
      )}

      {galleryUrls.length > 1 && isPreviewing && (
        <div className="absolute bottom-3 left-3 right-3 z-30 flex gap-1">
          {galleryUrls.map((_, index) => (
            <div
              key={index}
              className={cn(
                'h-1.5 flex-1 transition-colors border border-primary/50',
                index === activeIndex ? 'bg-accent' : 'bg-background/80'
              )}
            />
          ))}
        </div>
      )}
    </div>
  );

  const wrappedImageBlock = !stretchedLink ? (
    <Link href={detailHref} onClick={recordVehicleOpen} className="block relative h-full w-full outline-none focus-visible:ring-4 focus-visible:ring-accent group/imagelink">
      {imageBlock}
    </Link>
  ) : imageBlock;

  const title = (
    <h3 className="mb-1 font-display text-xl font-semibold leading-[1.05] tracking-[-.03em] text-primary transition-colors group-hover:text-accent lg:text-2xl">
      <Link href={detailHref} onClick={recordVehicleOpen} className="outline-none hover:underline">
        {vehicleLabel}
      </Link>
    </h3>
  );

  const subtitle = (car.variant || car.trim) && (
    <p className="line-clamp-1 text-[13px] font-medium text-primary/65">{car.variant || car.trim}</p>
  );

  const priceBlock = (
    <div className="flex flex-col items-end">
      <div className="font-display text-2xl lg:text-3xl font-black tracking-tighter text-primary">
        {car.price ? formatPrice(car.price, car.currency) : 'POA'}
      </div>
      {car.priceType && car.priceType.toLowerCase() !== 'cash' && (
        <div className="mt-0.5 text-[10px] font-semibold text-primary/60">
          {car.priceType}
        </div>
      )}
    </div>
  );

  const bookingAction = (
    <Button
      asChild
      className="relative z-10 h-auto w-full whitespace-normal rounded-xl bg-accent py-3 text-center text-[13px] font-semibold text-accent-foreground shadow-none transition-colors hover:bg-primary hover:text-primary-foreground"
    >
      <a href={bookingHref} onClick={() => recordBookingIntent({ source: 'car_card', vehicleContext: true })}>
        <Calendar className="mr-2 h-4 w-4 shrink-0" />
        {dealerConfig.bookViewing.ctaLabel}
      </a>
    </Button>
  );

  const callAction = phoneHref && (
    <Button
      asChild
      variant="outline"
      className="relative z-10 h-12 flex-1 rounded-xl border border-primary/20 bg-background px-2 text-[13px] font-semibold text-primary shadow-none transition-colors hover:bg-primary hover:text-primary-foreground sm:px-6"
    >
      <a href={phoneHref} onClick={() => recordContactIntent({ channel: 'call', car, source: 'car-card' })}>
        <Phone className="mr-2 h-4 w-4 shrink-0" />
        Call
      </a>
    </Button>
  );

  const whatsappAction = whatsappHref && (
    <Button
      asChild
      variant="outline"
      className="relative z-10 h-12 flex-1 rounded-xl border border-[hsl(var(--contact))] bg-background px-2 text-[13px] font-semibold text-[hsl(var(--contact))] shadow-none transition-colors hover:bg-[hsl(var(--contact))] hover:text-[hsl(var(--contact-foreground))] sm:px-6"
    >
      <a href={whatsappHref} target="_blank" rel="noopener noreferrer" onClick={() => recordContactIntent({ channel: 'whatsapp', car, source: 'car-card' })}>
        <MessageCircle className="mr-2 h-4 w-4 shrink-0" />
        Msg
      </a>
    </Button>
  );

  if (isCompact) {
    return (
      <article className="group flex flex-col gap-4 border-b border-primary/10 py-6 first:pt-4 sm:flex-row sm:gap-6" data-testid={`compact-vehicle-${car.id}`}>
        <div className="w-full sm:w-[200px] shrink-0">
          {wrappedImageBlock}
        </div>
        <div className="flex flex-col flex-1 min-w-0 py-1">
          <div className="flex justify-between items-start gap-4">
            <div className="min-w-0">
              {title}
              {subtitle}
            </div>
            {priceBlock}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
             {visibleSpecs.map(s => (
                <span key={s.label} className="rounded-full bg-primary/5 px-2.5 py-1 text-[12px] font-medium text-primary/70">{s.value}</span>
             ))}
          </div>
          <div data-testid={`compact-actions-${car.id}`} className="mt-auto pt-4 flex gap-3 sm:grid-cols-[1fr_auto] grid-cols-1">
              <a
                href={bookingHref}
                onClick={() => recordBookingIntent({ source: 'car_card', vehicleContext: true })}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-accent text-[12px] font-semibold text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <Calendar className="mr-2 h-4 w-4 shrink-0" />
                <span>Book</span>
              </a>
              <CompareCarButton
                car={car}
                variant="compact"
                className="h-11 min-w-[104px] w-auto whitespace-nowrap justify-center rounded-xl border border-primary/20 bg-background px-3 text-primary shadow-none transition-colors hover:bg-primary hover:text-primary-foreground"
              />
          </div>
        </div>
      </article>
    );
  }

  if (isRow) {
    return (
      <article
        className="group grid border-b border-primary/10 py-8 transition-colors md:grid-cols-[minmax(0,40%)_minmax(0,1fr)] first:pt-4"
        data-testid={`row-vehicle-${car.id}`}
      >
        {wrappedImageBlock}
        <div className="flex min-w-0 flex-col gap-6 pt-5 md:pt-0 md:pl-10">
          <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
            <div className="min-w-0 flex-1">
              {title}
              {subtitle}
            </div>
            {registration && (
              <UKNumberPlate size="sm" value={registration} testId={`plate-vehicle-${car.id}`} className="w-[122px] shrink-0" />
            )}
          </div>

          <div className="flex flex-wrap gap-2 text-[12px] font-medium text-primary/80">
             {visibleSpecs.map(s => (
                <span key={s.label} className="rounded-full border border-primary/10 bg-primary/5 px-2.5 py-1.5">{s.value}</span>
             ))}
          </div>

          <div className="mt-auto flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between border-t-2 border-primary/5 pt-6">
            {priceBlock}
            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
              <div className="flex-1 lg:flex-none min-w-[140px]">{bookingAction}</div>
              {callAction}
              {whatsappAction}
               <CompareCarButton
                 car={car}
                 className="h-12 min-w-[104px] w-auto flex-none whitespace-nowrap border-2 border-primary bg-background px-3 text-primary shadow-[3px_3px_0px_hsl(var(--primary))] hover:bg-primary hover:text-primary-foreground hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[1px_1px_0px_hsl(var(--primary))] transition-all"
               />
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col rounded-2xl border border-primary/15 bg-card p-3 shadow-[0_12px_30px_hsl(var(--primary)/.07)] transition-transform hover:-translate-y-1',
        stretchedLink && 'cursor-pointer'
      )}
      data-testid={`card-vehicle-${car.id}`}
    >
      {wrappedImageBlock}
      <div className="flex flex-1 flex-col px-1 pb-1 pt-5">
        <div className="flex justify-between items-start gap-4">
          <div className="min-w-0">
            {title}
            {subtitle}
          </div>
        </div>

        <div className="mt-4 mb-4">
          {priceBlock}
        </div>

        <div className="flex flex-wrap gap-2 mb-6 mt-auto">
           {visibleSpecs.map(s => (
              <span key={s.label} className="rounded-full bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary/70">{s.value}</span>
           ))}
        </div>

        {registration && (
          <div className="mb-6">
            <UKNumberPlate size="sm" value={registration} testId={`plate-vehicle-${car.id}`} className="w-[104px]" />
          </div>
        )}

        <div className="mt-auto flex flex-col gap-3">
          <div className="w-full">{bookingAction}</div>
          <div className="flex gap-3">
            {callAction}
            {whatsappAction}
            <CompareCarButton
              car={car}
              className="relative z-10 h-12 min-w-[104px] w-auto flex-none justify-center whitespace-nowrap rounded-xl border border-primary/20 bg-background px-3 text-primary shadow-none transition-colors hover:bg-primary hover:text-primary-foreground"
            />
          </div>
        </div>
      </div>
    </article>
  );
}