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

type SpecEntry = { label: string; value: string };

const actionBase =
  'relative z-10 inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card';

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
  // Every gallery image gets its own indicator, so keep the previewable set small enough to control.
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

  // Reset on the image set itself, so a stock refresh that swaps photos on the same
  // vehicle clears stale failures and selection too.
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
    car.transmission ? { label: 'Gearbox', value: car.transmission } : null,
    car.bodyType ? { label: 'Body', value: car.bodyType } : null,
    car.engineSize ? { label: 'Engine', value: car.engineSize } : null,
    car.colour ? { label: 'Colour', value: car.colour } : null,
    car.owners ? { label: 'Owners', value: String(car.owners) } : null,
  ].filter((entry): entry is SpecEntry => Boolean(entry));

  const visibleSpecs = specs.slice(0, isRow ? 6 : isCompact ? 3 : 4);

  const imageBlock = (
    <div
      className={cn(
        'relative overflow-hidden bg-secondary/60',
        isRow
          ? 'aspect-[4/3] md:aspect-auto md:min-h-[16rem]'
          : isCompact
            ? 'h-full min-h-36'
            : 'aspect-[16/10] sm:aspect-[4/3]',
      )}
      onMouseEnter={() => setIsPreviewing(true)}
      onMouseLeave={() => setIsPreviewing(false)}
    >
      <Link
        href={detailHref}
        onClick={recordVehicleOpen}
        aria-label={`View details for ${vehicleLabel}`}
        className="absolute inset-0 block outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        {galleryUrls.length > 0 ? (
          galleryUrls.map((imageUrl, index) => (
            <img
              key={imageUrl}
              src={imageUrl}
              alt={index === activeIndex ? vehicleLabel : ''}
              aria-hidden={index !== activeIndex}
              loading={index === 0 ? 'eager' : 'lazy'}
              referrerPolicy="no-referrer"
              onError={() => {
                setFailedImageUrls((current) => {
                  const next = new Set(current);
                  next.add(imageUrl);
                  return next;
                });
              }}
              className={cn(
                'absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-out',
                index === activeIndex ? 'opacity-100' : 'opacity-0',
              )}
            />
          ))
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Camera className="h-7 w-7 opacity-40" />
            <span className="label-micro">Photographs to follow</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-primary/60 via-primary/5 to-transparent" />
      </Link>

      <SaveCarButton car={car} className="absolute right-3 top-3 z-10" />

      {badges.length > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-1.5">
          {badges.slice(0, 3).map((badge) => (
            <span key={badge} className="bg-primary/90 px-2.5 py-1 label-micro text-primary-foreground backdrop-blur-sm">
              {badge}
            </span>
          ))}
        </div>
      )}

      {photoCount > 0 && (
        <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 bg-primary/80 px-2.5 py-1 font-mono text-[10px] font-bold text-primary-foreground backdrop-blur-sm">
          <Camera className="h-3 w-3" />
          {photoCount}
        </span>
      )}

      {galleryUrls.length > 1 && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5">
          {galleryUrls.map((imageUrl, index) => (
            <button
              key={imageUrl}
              type="button"
              onClick={() => {
                setActiveImageIndex(index);
                setIsPreviewing(false);
              }}
              aria-label={`Show photograph ${index + 1} of ${vehicleLabel}`}
              aria-current={index === activeIndex}
              className={cn(
                'h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                index === activeIndex ? 'w-6 bg-accent' : 'w-1.5 bg-primary-foreground/60 hover:bg-primary-foreground',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );

  const ledger = visibleSpecs.length > 0 && (
    <dl className={cn('grid grid-cols-2 gap-x-4 gap-y-3 text-sm', isRow && 'sm:grid-cols-3')}>
      {visibleSpecs.map((spec) => (
        <div key={spec.label} className="min-w-0">
          <dt className="text-muted-foreground">{spec.label}</dt>
          <dd className="mt-0.5 truncate font-medium text-foreground">{spec.value}</dd>
        </div>
      ))}
    </dl>
  );

  const priceBlock = (
    <div>
      <p className="text-sm text-muted-foreground mb-0.5">Price</p>
      <p className={cn('luxxy-price text-2xl text-primary', isRow ? 'sm:text-3xl' : '')}>
        {car.price ? formatPrice(car.price, car.currency) : 'POA'}
      </p>
    </div>
  );

  const bookingAction = (
    <a
      href={bookingHref}
      onClick={() => recordBookingIntent({ source: `${analyticsSource}_${layout}`, vehicleContext: true })}
      target={bookingHref.startsWith('https://') ? '_blank' : undefined}
      rel={bookingHref.startsWith('https://') ? 'noopener noreferrer' : undefined}
      aria-label={`${dealerConfig.bookViewing.ctaLabel} for ${vehicleLabel}`}
      data-vehicle-contact="booking"
      className={cn(
        actionBase,
        'bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary',
        !isRow && 'min-w-0 px-2 sm:px-4',
      )}
    >
      <Calendar className="h-4 w-4" />
      {dealerConfig.bookViewing.ctaLabel}
    </a>
  );

  const callAction = phoneHref && (
    <a
      href={phoneHref}
      title={`Call about ${vehicleLabel}`}
      aria-label={`Call about ${vehicleLabel}`}
      onClick={() => recordContactIntent({ channel: 'call', car, source: `${analyticsSource}-${layout}` })}
      data-vehicle-contact="call"
      className={cn(actionBase, 'border border-border bg-background text-foreground hover:border-primary/45 hover:bg-secondary focus-visible:ring-primary')}
    >
      <Phone className="h-4 w-4 text-accent" />
      Call
    </a>
  );

  const whatsappAction = whatsappHref && (
    <a
      href={whatsappHref}
      target="_blank"
      rel="noopener noreferrer"
      title={`WhatsApp about ${vehicleLabel}`}
      aria-label={`WhatsApp about ${vehicleLabel}`}
      onClick={() => recordContactIntent({ channel: 'whatsapp', car, source: `${analyticsSource}-${layout}` })}
      data-vehicle-contact="whatsapp"
       className={cn(actionBase, 'luxxy-contact hover:bg-[hsl(var(--contact)/.18)] focus-visible:ring-[hsl(var(--contact))]')}
    >
      <MessageCircle className="h-4 w-4" />
      WhatsApp
    </a>
  );

  const title = (
    <h3
      className={cn(
        'break-words font-display font-medium leading-tight tracking-tight text-primary',
        isRow ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl',
      )}
    >
      <Link
        href={detailHref}
        onClick={recordVehicleOpen}
        aria-label={stretchedLink ? `View full details for ${vehicleLabel}` : undefined}
        className={cn(
          'outline-none transition-colors hover:text-accent focus-visible:underline',
          stretchedLink && "after:absolute after:inset-0 after:z-[1] after:content-['']",
        )}
      >
        {vehicleLabel}
      </Link>
    </h3>
  );

  const subtitle = (car.variant || car.trim) && (
    <p className="mt-1 line-clamp-1 text-sm leading-6 text-muted-foreground">{car.variant || car.trim}</p>
  );

  if (isCompact) {
    return (
      <article
        className="group relative grid min-h-36 grid-cols-[7.5rem_minmax(0,1fr)] border border-border/70 bg-card transition-colors hover:border-primary/35 hover:bg-secondary/15 sm:grid-cols-[10rem_minmax(0,1fr)]"
        data-testid={`compact-vehicle-${car.id}`}
      >
        {imageBlock}
        <div className="flex min-w-0 flex-col p-4">
          <div className="min-w-0">
            {title}
            {subtitle}
          </div>
          <p className="luxxy-price mt-2 text-xl sm:text-2xl text-primary">
            {car.price ? formatPrice(car.price, car.currency) : 'POA'}
          </p>
          {ledger && <div className="mt-3 overflow-hidden">{ledger}</div>}
          <div className="relative z-10 mt-auto grid grid-cols-1 gap-2 pt-3 sm:grid-cols-[1fr_auto]" data-testid={`compact-actions-${car.id}`}>
            <a
              href={bookingHref}
              onClick={() => recordBookingIntent({ source: `${analyticsSource}_compact`, vehicleContext: true })}
              aria-label={`${dealerConfig.bookViewing.ctaLabel} for ${vehicleLabel}`}
              className="inline-flex min-h-11 min-w-0 items-center justify-center bg-primary px-2 text-sm font-medium text-primary-foreground sm:px-3"
            >
              <Calendar className="mr-2 h-3.5 w-3.5 shrink-0" />
              <span className="sm:hidden">Book</span>
              <span className="hidden truncate sm:inline">{dealerConfig.bookViewing.ctaLabel}</span>
            </a>
            <CompareCarButton car={car} variant="compact" className="min-h-11 min-w-0 justify-center border border-border px-2 sm:px-3" />
          </div>
        </div>
      </article>
    );
  }

  if (isRow) {
    return (
      <article
        className="group grid border border-border/70 bg-card transition-colors hover:border-primary/35 md:grid-cols-[minmax(0,38%)_minmax(0,1fr)]"
        data-testid={`row-vehicle-${car.id}`}
      >
        {imageBlock}
        <div className="flex min-w-0 flex-col gap-5 p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
            <div className="min-w-0 flex-1">
              {title}
              {subtitle}
            </div>
            {registration && (
              <UKNumberPlate size="sm" value={registration} testId={`plate-vehicle-${car.id}`} className="w-[122px] shrink-0" />
            )}
          </div>

          {ledger && <div className="border-y border-border/70 py-4">{ledger}</div>}

          <div className="mt-auto flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            {priceBlock}
            <div className="flex flex-wrap items-center gap-2">
              {bookingAction}
              {callAction}
              {whatsappAction}
              <CompareCarButton car={car} />
            </div>
          </div>

          <Link
            href={detailHref}
            onClick={recordVehicleOpen}
            className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 transition-colors hover:text-accent hover:underline"
          >
            Full vehicle details
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col border border-border/70 bg-card transition-colors hover:border-primary/35',
        stretchedLink && 'cursor-pointer hover:bg-secondary/15 focus-within:border-primary/45',
      )}
      data-testid={`card-vehicle-${car.id}`}
    >
      {imageBlock}
      <div className="flex flex-1 flex-col gap-3 p-4 sm:gap-4 sm:p-5">
        <div>
          {title}
          {subtitle}
          <div className="mt-3">{priceBlock}</div>
        </div>

        {ledger && <div className="border-y border-border/70 py-3 sm:py-4">{ledger}</div>}

        {registration && (
          <UKNumberPlate size="sm" value={registration} testId={`plate-vehicle-${car.id}`} className="w-[104px] shrink-0" />
        )}

        <div className="mt-auto grid grid-cols-2 gap-2">
          <div className="col-span-2 [&>a]:w-full">{bookingAction}</div>
          {callAction}
          {whatsappAction}
          <CompareCarButton
            car={car}
            className="relative z-10 col-span-2 h-9 min-w-0 border-0 bg-transparent px-2 text-muted-foreground hover:bg-secondary hover:text-primary"
          />
        </div>
      </div>
    </article>
  );
}
