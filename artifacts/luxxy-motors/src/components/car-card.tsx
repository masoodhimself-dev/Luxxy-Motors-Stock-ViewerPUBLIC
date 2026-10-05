import { VehicleFactIcon } from './vehicle-fact-icon';
import { HoverHelp, VehicleTerm } from './customer-help';
import { VehicleSellingPoints } from './vehicle-selling-points';
import { vehicleSellingPoints } from '@/lib/vehicle-selling-points';
import { recordedWriteOffCategory } from '@/lib/vehicle-history';
import { PriceReduction } from '@/components/price-reduction';
import { shortTrim, stockHighlights, stockRegistrationYear } from '@/lib/stock-presentation';
import { customerRegistrationDetails } from '@/lib/customer-vehicle-meta';
import { responsiveVehicleImage, retryOriginalImage } from "@/lib/responsive-vehicle-image";
import { vehicleAvailability } from '@/lib/customer-convenience';
import { rememberStockPosition } from "@/lib/browse-session";
import { usePhotoSwipe } from '@/hooks/use-photo-swipe';
import { useEffect, useId, useMemo, useState } from 'react';
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
  summaryOnly = false,
  analyticsSource = 'showroom',
}: {
  car: Car;
  priority?: boolean;
  layout?: 'row' | 'card' | 'compact';
  stretchedLink?: boolean;
  badges?: string[];
  photoControls?: boolean;
  catalogue?: boolean;
  summaryOnly?: boolean;
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
  const [photoDirection, setPhotoDirection] = useState<-1 | 0 | 1>(0);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());

  const visibleImageUrls = imageUrls.filter((url) => !failedImageUrls.has(url));
  const galleryUrls = visibleImageUrls;
  const activeIndex = galleryUrls.length > 0 ? activeImageIndex % galleryUrls.length : 0;
  const photoCount = car.imageCount || car.images?.length || visibleImageUrls.length;
  const photoHelpId = useId();
  const canBrowsePhotos = photoControls && galleryUrls.length > 1;
  const changePhoto = (direction: -1 | 1) => {
    if (!canBrowsePhotos) return;
    setPhotoDirection(direction);
    setActiveImageIndex((activeIndex + direction + galleryUrls.length) % galleryUrls.length);
  };
  const photoSwipe = usePhotoSwipe(canBrowsePhotos, changePhoto);

  const vehicleLabel = vehicleDisplayTitle(car);
  const registration = vehicleRegistration(car);
  const registrationYear = stockRegistrationYear(car);
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
    setPhotoDirection(0);
    setFailedImageUrls(new Set());
  }, [car.id, imageSignature]);

  const specs = [
    registrationYear ? { label: 'Year', value: registrationYear } : null,
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
  const catalogueHighlights = catalogue ? vehicleSellingPoints(car).slice(0, 2).map(point => ({ ...point, text: point.label === 'Mileage' ? 'Below average mileage' : point.text })) : [];
  const category = catalogue ? recordedWriteOffCategory(car.writeOffCategory) : null;
  return (
    <article
      className={cn(
        'vehicle-card group flex relative',
        catalogue && 'vehicle-card-catalogue',
        catalogue && isCompact && 'vehicle-card-catalogue-compact',
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
          'vehicle-card-photo relative shrink-0 overflow-hidden bg-muted',
          stretchedLink && photoControls && 'z-20',
          isRow ? 'w-full md:w-[38%]' : isCompact ? 'w-full min-[480px]:w-[40%]' : 'w-full',
        )}
      >
        <Link
          href={detailHref}
          data-stock-link={car.id}
          draggable={false}
          {...photoSwipe}
          onClick={recordVehicleOpen}
          onKeyDown={event => {
            if (canBrowsePhotos && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
              event.preventDefault();
              changePhoto(event.key === 'ArrowRight' ? 1 : -1);
            }
          }}
          className={cn('relative block aspect-[4/3]', canBrowsePhotos && 'stock-photo-swipe')}
          aria-label={`View full details for ${vehicleLabel}`}
          aria-describedby={canBrowsePhotos ? photoHelpId : undefined}
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
                  {...responsiveVehicleImage(url, catalogue ? "(max-width: 767px) 100vw, (pointer: coarse) and (max-width: 1366px) 50vw, (max-width: 1199px) 50vw, (max-width: 1599px) 33vw, 500px" : "(max-width: 639px) 100vw, (pointer: coarse) and (min-width: 1100px) 33vw, (max-width: 1279px) 50vw, 440px")}
                  alt={url === galleryUrls[activeIndex] ? vehicleLabel : ""}
                  decoding="async"
                  width={800}
                  height={600}
                  draggable={false}
                  loading={priority ? "eager" : "lazy"}
                  fetchPriority={priority ? "high" : "auto"}
                  className={cn(
                    'absolute inset-0 h-full w-full object-contain transition-opacity duration-300',
                    url === galleryUrls[activeIndex]
                      ? "opacity-100"
                      : "opacity-0",
                    photoDirection === 1 && 'stock-photo-next',
                    photoDirection === -1 && 'stock-photo-previous',
                  )}
                  onError={(event) => {if (!retryOriginalImage(event.currentTarget)) setFailedImageUrls((prev) => new Set(prev).add(url));}}
                />
              ))
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              {!summaryOnly && <Camera className="h-7 w-7" />}
              <span className="text-xs">Photographs to follow</span>
            </div>
          )}
        </Link>
        {canBrowsePhotos && <span id={photoHelpId} className="sr-only">Swipe left or right, or use the arrow keys, to browse photographs. Tap or press Enter to view the car.</span>}
        {photoControls && <span className="sr-only" aria-live="polite" aria-atomic="true">{photoDirection !== 0 && galleryUrls.length > 0 ? `Photograph ${activeIndex + 1} of ${galleryUrls.length}` : ''}</span>}
        {photoControls && galleryUrls.length > 1 && (
          <div className="stock-photo-controls">
            <HoverHelp text="See the previous photograph without opening the vehicle page."><button type="button" className="photo-glass-control stock-photo-arrow left-2"
              aria-label={`Previous photo of ${vehicleLabel}`}
              onClick={() => changePhoto(-1)}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button></HoverHelp>
            <HoverHelp text="See the next photograph without opening the vehicle page."><button type="button" className="photo-glass-control stock-photo-arrow right-2"
              aria-label={`Next photo of ${vehicleLabel}`}
              onClick={() => changePhoto(1)}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button></HoverHelp>
          </div>
        )}
        {photoControls && <SaveCarButton
          car={car}
          className="absolute right-3 top-3"
        />}
        {photoControls && photoCount > 0 && (
          <span className={cn("pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-sm bg-black/65 px-2 py-1 text-xs text-white", catalogue && "stock-photo-count")}>
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
            {!summaryOnly && (car.variant || car.trim) && (
              <p className="vehicle-card-variant mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {shortTrim(car)}
              </p>
            )}
            {registration && <p className="mt-1 text-xs text-muted-foreground">{summaryOnly ? customerRegistrationDetails(car) : registration}</p>}
          </div>
        </div>
        <div className="vehicle-card-price mt-2 flex flex-wrap items-baseline gap-2">
          <p className="luxxy-price text-2xl text-primary">
            {car.price
              ? formatPrice(car.price, car.currency)
              : 'Price on application'}
          </p>
          {!summaryOnly && <PriceReduction car={car} />}
          {car.priceType && /^(?:\+\s*VAT|VAT (?:included|qualifying)|inc(?:lusive of)?\.? VAT|ex(?:cluding)?\.? VAT)$/i.test(car.priceType.trim()) && <span className="text-xs text-muted-foreground">{car.priceType}</span>}

        </div>
        {!summaryOnly && (
          <>
            {catalogue && (car.inventoryStatus === 'reserved' || category) && <div className="stock-card-status">
              {car.inventoryStatus === 'reserved' && <span>Reserved</span>}
              {category && <VehicleTerm label="Insurance history" value={`Category ${category} recorded`}>Category {category} recorded</VehicleTerm>}
            </div>}
            {!catalogue && <VehicleSellingPoints car={car} compact />}
            <div className="vehicle-specs mb-3 mt-2">
              {visibleSpecs.map((spec) => (
                <VehicleTerm key={spec.label} label={spec.label} value={spec.value} className="inline-flex items-center gap-1.5" ariaLabel={`${spec.label}: ${spec.value}`}><VehicleFactIcon label={spec.label} />{spec.value}</VehicleTerm>
              ))}
            </div>
            {catalogueHighlights.length > 0 && <ul className="stock-catalogue-highlights" aria-label="Vehicle highlights">{catalogueHighlights.map(point => <li key={point.label}><VehicleTerm label={point.label} value={point.text}><VehicleFactIcon label={point.label} />{point.text}</VehicleTerm></li>)}</ul>}
            {(!catalogue || catalogueHighlights.length === 0) && stockHighlights(car).length > 0 && <p className="stock-card-highlights mb-3 text-xs text-muted-foreground">{stockHighlights(car).join(' · ')}</p>}
            <div
              className="vehicle-card-actions relative z-20 mt-auto flex flex-wrap items-center justify-between gap-1 border-t border-border pt-2"
              data-testid={isCompact ? `compact-actions-${car.id}` : undefined}
            >
              <Link href={detailHref} onClick={recordVehicleOpen} className="vehicle-card-view text-link text-sm">
                View vehicle
                <ArrowRight className="h-4 w-4" />
              </Link>
              <CompareCarButton
                car={car}
                variant="compact"
                className="min-h-11 px-2 text-xs font-medium text-muted-foreground"
              />
            </div>
          </>
        )}

      </div>
    </article>
  );
}
