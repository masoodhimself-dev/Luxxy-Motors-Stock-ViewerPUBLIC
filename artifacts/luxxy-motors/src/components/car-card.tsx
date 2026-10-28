import { UKNumberPlate } from '@/components/uk-number-plate';
import { HoverHelp, TermHelp, VehicleTerm } from './customer-help';
import { VehicleSellingPoints } from './vehicle-selling-points';
import { vehicleSellingPoints } from '@/lib/vehicle-selling-points';
import { vehicleInsuranceDisclosure } from '@/lib/vehicle-history';
import { prioritiseVehicleFeatures, vehicleContent } from '@/lib/vehicle-content';
import { PriceReduction } from '@/components/price-reduction';
import { shortTrim, stockHighlights, stockRegistrationYear, stockVariant } from '@/lib/stock-presentation';
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
  formatCompactMileage,
  formatMileage,
  formatPrice,
  getSafeImageUrl,
  getThumbnailUrl,
  vehicleDisplayTitle,
  vehicleRegistration,
} from '@/lib/utils';
import { SaveCarButton } from '@/components/saved-car-controls';
import { ArrowRight, Camera, ChevronLeft, ChevronRight } from '@/components/icons';
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
  savedDetails = false,
  stockDetails = false,
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
  savedDetails?: boolean;
  stockDetails?: boolean;
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
      ? { label: 'Mileage', value: (savedDetails || stockDetails) ? formatMileage(car.mileage) : formatCompactMileage(car.mileage) }
      : car.mileageText
        ? { label: 'Mileage', value: car.mileageText }
        : null,
    car.fuel ? { label: 'Fuel', value: car.fuel } : null,
    car.transmission ? { label: 'Gearbox', value: car.transmission } : null,
    car.engineSize ? { label: 'Engine', value: car.engineSize } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const visibleSpecs = savedDetails ? [
    ...specs,
    car.bodyType ? { label: 'Body', value: car.bodyType } : null,
    car.colour ? { label: 'Colour', value: car.colour } : null,
    car.doors != null || car.seats != null ? { label: 'Doors / seats', value: [car.doors != null ? `${car.doors} doors` : null, car.seats != null ? `${car.seats} seats` : null].filter(Boolean).join(' · ') } : null,
  ].filter(Boolean) as { label: string; value: string }[] : stockDetails ? [...specs, ...(car.bodyType ? [{label: 'Body', value: car.bodyType}] : [])] : specs.slice(0, 4);
  const stockFeatures = stockDetails
    ? prioritiseVehicleFeatures(vehicleContent(car).features)
      .filter(feature => !/\b(?:no|not|without|unavailable|absent|removed|deleted|missing|excluded|disabled|inoperative|faulty|broken)\b|\b(?:isn['’]?t|doesn['’]?t|non[ -]?(?:functional|functioning|working))\b/i.test(feature))
      .slice(0, 2)
    : [];
  const variant = stockDetails ? stockVariant(car) : shortTrim(car);
  const savedFeatures = savedDetails
    ? prioritiseVehicleFeatures(vehicleContent(car).features).slice(0, 4)
    : [];
  const hasSellingPoints = vehicleSellingPoints(car).some(point => point.label !== 'Mileage');
  const insuranceDisclosure = vehicleInsuranceDisclosure(car, vehicleContent(car).description);
  return (
    <article
      className={cn(
        'vehicle-card group flex relative',
        savedDetails && 'vehicle-card-saved-details',
        stockDetails && 'stock-details-card',
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
              <span className="text-xs">{imageUrls.length ? 'Photos temporarily unavailable' : 'Photographs to follow'}</span>
            </div>
          )}
        </Link>
        {imageUrls.length > 0 && !galleryUrls.length && <button type="button" className="relative z-20 mx-auto mb-3 block min-h-11 px-3 text-sm underline underline-offset-4" onClick={() => setFailedImageUrls(new Set())}>Retry photos</button>}
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
            <h3 className="[overflow-wrap:anywhere] font-display text-lg font-semibold leading-snug tracking-tight text-primary">
              <Link
                href={detailHref}
                onClick={recordVehicleOpen}
                className={cn("hover:underline underline-offset-4", stretchedLink && "after:absolute after:inset-0 after:z-10 focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-ring")}
              >
                {vehicleLabel}
              </Link>
            </h3>
            {!summaryOnly && variant && (
              <p title={stockDetails ? variant : undefined} className="vehicle-card-variant mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {variant}
              </p>
            )}
            {registration && <p className="mt-1 text-xs text-muted-foreground">{summaryOnly ? customerRegistrationDetails(car) : <UKNumberPlate value={registration} size="sm" variant="front" showFlag={false} />}</p>}
          </div>
        </div>
        <div className="vehicle-card-price mt-2 flex flex-wrap items-baseline gap-2">
          <p className="luxxy-price text-2xl text-primary">
            {car.price
              ? formatPrice(car.price, car.currency)
              : 'Price on application'}
          </p>
          {summaryOnly && <p className="featured-car-facts">{[car.year, car.mileage != null ? formatCompactMileage(car.mileage) : car.mileageText, car.fuel, car.transmission].filter(Boolean).join(' · ')}</p>}
          {!summaryOnly && <PriceReduction car={car} />}
          {car.priceType && /^(?:\+\s*VAT|VAT (?:included|qualifying)|inc(?:lusive of)?\.? VAT|ex(?:cluding)?\.? VAT)$/i.test(car.priceType.trim()) && <span className="text-xs text-muted-foreground">{car.priceType}</span>}

        </div>
        {summaryOnly && insuranceDisclosure && <p className="stock-card-status mt-2 text-xs">{insuranceDisclosure.cardLabel}</p>}
        {!summaryOnly && (
          <>
            {((catalogue && car.inventoryStatus === 'reserved') || insuranceDisclosure) && <div className="stock-card-status">
              {catalogue && car.inventoryStatus === 'reserved' && <span>Reserved</span>}
              {insuranceDisclosure && <TermHelp text={insuranceDisclosure.explanation}>{insuranceDisclosure.cardLabel}</TermHelp>}
            </div>}
            <div className={cn("vehicle-specs mb-3 mt-2", savedDetails && "saved-car-specs")} aria-label={savedDetails ? 'Vehicle specifications' : undefined}>
              {visibleSpecs.map((spec) => (
                <VehicleTerm key={spec.label} label={spec.label} value={spec.value} className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]" ariaLabel={`${spec.label}: ${spec.value}`}>{savedDetails ? <span><span className="saved-spec-label">{spec.label}</span><span className="saved-spec-value">{spec.value}</span></span> : spec.value}</VehicleTerm>
              ))}
            </div>
            <VehicleSellingPoints car={car} compact omitMileage />
            {savedFeatures.length > 0 && <div className="saved-car-equipment">
              <p className="saved-equipment-heading">Key features</p>
              <ul aria-label="Key features">
                {savedFeatures.map(feature => <li key={feature}>{feature}</li>)}
              </ul>
            </div>}
            {stockFeatures.length > 0 && <ul className="stock-card-equipment" aria-label="Key features">
              {stockFeatures.map(feature => <li key={feature} title={feature}>{feature}</li>)}
            </ul>}
            {!stockDetails && !savedDetails && (!catalogue || !hasSellingPoints) && stockHighlights(car).length > 0 && <p className="stock-card-highlights mb-3 text-xs text-muted-foreground">{stockHighlights(car).join(' · ')}</p>}
            {(!stretchedLink || stockDetails) && <div
              className="vehicle-card-actions relative z-20 mt-auto flex flex-wrap items-center justify-between gap-1 border-t border-border pt-2"
              data-testid={isCompact ? `compact-actions-${car.id}` : undefined}
            >
              <Link href={detailHref} onClick={recordVehicleOpen} className="vehicle-card-view text-link text-sm">
                {stockDetails ? 'View car' : 'View vehicle'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>}
          </>
        )}

      </div>
    </article>
  );
}
