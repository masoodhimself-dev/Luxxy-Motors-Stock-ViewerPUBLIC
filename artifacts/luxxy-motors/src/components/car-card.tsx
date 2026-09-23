import { rememberStockPosition } from "@/lib/browse-session";
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Car } from '@/lib/stock-context';
import {
  cn,
  formatMileage,
  formatPrice,
  getSafeImageUrl,
  getThumbnailUrl,
  vehicleDisplayTitle,
  vehicleRegistration,
} from '@/lib/utils';
import {
  getPhoneHref,
  getVehicleBookingHref,
  getVehicleWhatsAppHref,
  recordBookingIntent,
  recordContactIntent,
} from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
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
    const addImage = (
      image: string | { url: string; caption?: string | null } | null | undefined,
    ) => {
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
  const whatsappHref = getVehicleWhatsAppHref(
    car,
    'get more information about this vehicle',
    dealerConfig,
  );
  const bookingHref = getVehicleBookingHref(car);
  const recordVehicleOpen = () => {
    rememberStockPosition(car.id);
    trackEvent('vehicle_opened', {
      source: analyticsSource,
      layout,
    });
  };

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
    car.mileage != null
      ? { label: 'Mileage', value: formatMileage(car.mileage) }
      : car.mileageText
        ? { label: 'Mileage', value: car.mileageText }
        : null,
    car.fuel ? { label: 'Fuel', value: car.fuel } : null,
    car.transmission ? { label: 'Gearbox', value: car.transmission } : null,
    car.engineSize ? { label: 'Engine', value: car.engineSize } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const visibleSpecs = specs.slice(0, 4);
  return (
    <article
      className={cn(
        'vehicle-card group flex',
        isRow
          ? 'flex-col md:flex-row'
          : isCompact
            ? 'flex-col min-[480px]:flex-row'
            : 'h-full flex-col',
      )}
      data-testid={`${isCompact ? 'compact' : isRow ? 'row' : 'card'}-vehicle-${car.id}`}
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden bg-muted',
          isRow ? 'w-full md:w-[38%]' : isCompact ? 'w-full min-[480px]:w-[40%]' : 'w-full',
        )}
        onMouseEnter={() => {
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setIsPreviewing(true);
        }}
        onMouseLeave={() => {
          setIsPreviewing(false);
          setActiveImageIndex(0);
        }}
      >
        <Link
          href={detailHref}
          data-stock-link={car.id}
          onClick={recordVehicleOpen}
          className="relative block aspect-[4/3]"
          aria-label={`View full details for ${vehicleLabel}`}
        >
          {galleryUrls.length ? (
            galleryUrls
              .filter(
                (_, index) =>
                  index === 0 || isPreviewing || index === activeIndex,
              )
              .map((url) => (
                <img
                  key={url}
                  src={url}
                  alt={url === galleryUrls[activeIndex] ? vehicleLabel : ""}
                  decoding="async"
                  width={800}
                  height={600}
                  loading="lazy"
                  className={cn(
                    'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
                    url === galleryUrls[activeIndex]
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                  onError={() => setFailedImageUrls((prev) => new Set(prev).add(url))}
                />
              ))
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Camera className="h-7 w-7" />
              <span className="text-xs">Photographs to follow</span>
            </div>
          )}
        </Link>
        <SaveCarButton
          car={car}
          className="absolute right-3 top-3 h-11 w-11 rounded-full border-white bg-white text-primary shadow-none"
        />
        {photoCount > 0 && (
          <span className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-sm bg-black/65 px-2 py-1 text-xs text-white">
            <Camera className="h-3.5 w-3.5" />
            {photoCount}
          </span>
        )}
        {badges.length > 0 && (
          <span className="absolute left-3 top-3 max-w-[70%] rounded-sm bg-primary px-2 py-1 text-xs text-primary-foreground">
            {badges[0]}
          </span>
        )}
      </div>
      <div className={cn('flex min-w-0 flex-1 flex-col p-4', isRow && 'md:p-6')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div
            className={cn(
              "min-w-0 w-full",
              !isRow && !isCompact && "vehicle-card-heading",
            )}
          >
            <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-primary">
              <Link
                href={detailHref}
                onClick={recordVehicleOpen}
                className="hover:underline underline-offset-4"
              >
                {vehicleLabel}
              </Link>
            </h3>
            {(car.variant || car.trim) && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {car.variant || car.trim}
              </p>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          <p className="luxxy-price text-2xl text-primary">
            {car.price
              ? formatPrice(car.price, car.currency)
              : 'Price on application'}
          </p>
          {car.priceType && car.priceType.toLowerCase() !== 'cash' && (
            <span className="text-xs text-muted-foreground">
              {car.priceType}
            </span>
          )}
        </div>
        <div className="vehicle-specs mb-3 mt-2">
          {visibleSpecs.map((spec) => (
            <span key={spec.label} aria-label={`${spec.label}: ${spec.value}`}>{spec.value}</span>
          ))}
        </div>
        {registration && isRow && (
          <p className="mb-4 text-xs text-muted-foreground">
            Registration{" "}
            <span className="font-medium text-primary">{registration}</span>
          </p>
        )}
        <div
          className="mt-auto flex flex-wrap items-center justify-between gap-1 border-t border-border pt-2"
          data-testid={isCompact ? `compact-actions-${car.id}` : undefined}
        >
          <Link href={detailHref} onClick={recordVehicleOpen} className="text-link text-xs">
            View vehicle
            <ArrowRight className="h-4 w-4" />
          </Link>
          <CompareCarButton
            car={car}
            variant="compact"
            className="min-h-11 px-2 text-xs font-medium text-muted-foreground"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-1 border-t border-border/60 text-xs text-muted-foreground">
          <a
            href={bookingHref}
            onClick={() => recordBookingIntent({ source: 'car_card', vehicleContext: true })}
            className="flex min-h-11 items-center gap-1.5 hover:text-primary"
          >
            <Calendar className="h-3.5 w-3.5" />
            Book a viewing
          </a>
          {phoneHref && (
            <a
              href={phoneHref}
              aria-label={`Call about ${vehicleLabel}`}
              onClick={() => recordContactIntent({ channel: 'call', car, source: 'car-card' })}
              className="ml-auto grid h-11 w-11 place-items-center hover:text-primary"
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
          {whatsappHref && (
            <a
              href={whatsappHref}
              aria-label={`WhatsApp about ${vehicleLabel}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => recordContactIntent({ channel: 'whatsapp', car, source: 'car-card' })}
              className="grid h-11 w-11 place-items-center text-[hsl(var(--contact))]"
            >
              <MessageCircle className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
