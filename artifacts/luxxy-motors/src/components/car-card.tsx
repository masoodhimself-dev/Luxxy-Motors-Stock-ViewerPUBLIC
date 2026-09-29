import { shortTrim, stockHighlights, stockRegistrationYear } from '@/lib/stock-presentation';
import { responsiveVehicleImage, retryOriginalImage } from "@/lib/responsive-vehicle-image";
import { vehicleAvailability } from '@/lib/customer-convenience';
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
import { CompareCarButton, SaveCarButton } from '@/components/saved-car-controls';
import { ArrowRight, Camera, ChevronLeft, ChevronRight } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';



export function CarCard({
  car,
  priority = false,
  layout = 'card',
  stretchedLink = false,
  badges = [],
  photoControls = true,
  catalogue = false,
  analyticsSource = 'showroom',
}: {
  car: Car;
  priority?: boolean;
  layout?: 'row' | 'card' | 'compact';
  stretchedLink?: boolean;
  badges?: string[];
  photoControls?: boolean;
  catalogue?: boolean;
  analyticsSource?: 'showroom' | 'similar_cars' | 'saved_cars';
}) {
  const displayBadges = [...new Set([vehicleAvailability(car.inventoryStatus), ...badges])];
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

  const visibleImageUrls = imageUrls.filter((url) => !failedImageUrls.has(url));
  const galleryUrls = visibleImageUrls;
  const activeIndex = galleryUrls.length > 0 ? activeImageIndex % galleryUrls.length : 0;
  const photoCount = car.imageCount || car.images?.length || visibleImageUrls.length;

  const vehicleLabel = vehicleDisplayTitle(car);
  const registration = vehicleRegistration(car);
  const detailHref = `/vehicle/${car.id}`;
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
  }, [car.id, imageSignature]);

  const specs = [
    car.year ? { label: 'Year', value: stockRegistrationYear(car) } : null,
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
        'vehicle-card group flex relative',
        isRow
          ? 'flex-col md:flex-row'
          : isCompact
            ? 'flex-col min-[480px]:flex-row'
            : 'vehicle-card-grid h-full flex-col',
      )}
      data-testid={`${isCompact ? 'compact' : isRow ? 'row' : 'card'}-vehicle-${car.id}`}
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden bg-muted',
          stretchedLink && photoControls && 'z-20',
          isRow ? 'w-full md:w-[38%]' : isCompact ? 'w-full min-[480px]:w-[40%]' : 'w-full',
        )}
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
                  index === activeIndex,
              )
              .map((url) => (
                <img
                  key={url}
                  src={url}
                  {...responsiveVehicleImage(url, "(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 440px")}
                  alt={url === galleryUrls[activeIndex] ? vehicleLabel : ""}
                  decoding="async"
                  width={800}
                  height={600}
                  loading={priority ? "eager" : "lazy"}
                  fetchPriority={priority ? "high" : "auto"}
                  className={cn(
                    'absolute inset-0 h-full w-full object-contain transition-opacity duration-300',
                    url === galleryUrls[activeIndex]
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                  onError={(event) => {if (!retryOriginalImage(event.currentTarget)) setFailedImageUrls((prev) => new Set(prev).add(url));}}
                />
              ))
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Camera className="h-7 w-7" />
              <span className="text-xs">Photographs to follow</span>
            </div>
          )}
        </Link>
        {photoControls && galleryUrls.length > 1 && (
          <div className="stock-photo-controls">
            <button type="button" className="stock-photo-arrow left-2"
              aria-label={`Previous photo of ${vehicleLabel}`}
              onClick={() => setActiveImageIndex((activeIndex + galleryUrls.length - 1) % galleryUrls.length)}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" className="stock-photo-arrow right-2"
              aria-label={`Next photo of ${vehicleLabel}`}
              onClick={() => setActiveImageIndex((activeIndex + 1) % galleryUrls.length)}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        )}
        {photoControls && <SaveCarButton
          car={car}
          className="absolute right-3 top-3 h-11 w-11 rounded-full border-white bg-white text-primary shadow-none"
        />}
        {photoControls && !catalogue && photoCount > 0 && (
          <span className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-sm bg-black/65 px-2 py-1 text-xs text-white">
            <Camera className="h-3.5 w-3.5" />
            {galleryUrls.length > 1 ? `${activeIndex + 1} / ${galleryUrls.length}` : photoCount}
          </span>
        )}
        {!catalogue && displayBadges.length > 0 && (photoControls || displayBadges[0] !== 'Available') && (
          <span className="absolute left-3 top-3 max-w-[70%] rounded-sm bg-primary px-2 py-1 text-xs text-primary-foreground">
            {displayBadges[0]}
          </span>
        )}
      </div>
      <div className={cn('vehicle-card-details flex min-w-0 flex-1 flex-col p-4', isRow && 'md:p-6')}>
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
                className={cn("hover:underline underline-offset-4", stretchedLink && "after:absolute after:inset-0 after:z-10 focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-ring")}
              >
                {vehicleLabel}
              </Link>
            </h3>
            {(car.variant || car.trim) && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {shortTrim(car)}
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
          {catalogue && car.inventoryStatus === 'reserved' && <span className="text-xs font-medium text-muted-foreground">Reserved</span>}
          {car.priceType && /^(?:\+\s*VAT|VAT (?:included|qualifying)|inc(?:lusive of)?\.? VAT|ex(?:cluding)?\.? VAT)$/i.test(car.priceType.trim()) && <span className="text-xs text-muted-foreground">{car.priceType}</span>}

        </div>
        <div className="vehicle-specs mb-3 mt-2">
          {visibleSpecs.map((spec) => (
            <span key={spec.label} aria-label={`${spec.label}: ${spec.value}`}>{spec.value}</span>
          ))}
        </div>
        {stockHighlights(car).length > 0 && <p className="stock-card-highlights mb-3 text-xs text-muted-foreground">{stockHighlights(car).join(' · ')}</p>}
        {registration && isRow && (
          <p className="mb-4 text-xs text-muted-foreground">
            Registration{" "}
            <span className="font-medium text-primary">{registration}</span>
          </p>
        )}
        <div
          className="vehicle-card-actions relative z-20 mt-auto flex flex-wrap items-center justify-between gap-1 border-t border-border pt-2"
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

      </div>
    </article>
  );
}
