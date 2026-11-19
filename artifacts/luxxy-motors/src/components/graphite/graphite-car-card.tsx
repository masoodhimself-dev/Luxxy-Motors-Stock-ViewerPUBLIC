import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { vehicleDetailPath } from '@workspace/vehicle-meta';
import type { Car } from '@/lib/stock-context';
import { Camera, Check, ChevronLeft, ChevronRight, Copy } from '@/components/icons';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { SaveCarButton } from '@/components/saved-car-controls';
import { TermHelp, VehicleTerm } from '@/components/customer-help';
import { StockPhotoBadge } from '@/components/stock-photo-badge';
import { usePhotoSwipe } from '@/hooks/use-photo-swipe';
import { trackEvent } from '@/lib/analytics';
import { rememberStockPosition } from '@/lib/browse-session';
import { prominentVehicleFeatures, vehicleContent } from '@/lib/vehicle-content';
import { vehicleInsuranceDisclosure } from '@/lib/vehicle-history';
import { deliveryPriceQualification } from '@/lib/delivery-estimate';
import { stockRegistrationYear, stockVariant } from '@/lib/stock-presentation';
import { responsiveVehicleImage, retryOriginalImage } from '@/lib/responsive-vehicle-image';
import { cn, formatMileage, formatPrice, getSafeImageUrl, getThumbnailUrl, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { VehicleSellingPoints } from '@/components/vehicle-selling-points';
import { vehicleSellingPoints } from '@/lib/vehicle-selling-points';
import './graphite-car-card.css';

export type GraphiteCompareAction = { selected: boolean; disabled: boolean; onToggle: () => void };

/** Real vehicle data and shared retail controls in the approved Graphite card. */
export function GraphiteCarCard({ car, priority = false, layout = 'card', compareAction, source = 'showroom', photoControls = true, imageSizes: suppliedImageSizes }: {
  car: Car;
  priority?: boolean;
  layout?: 'card' | 'compact';
  compareAction?: GraphiteCompareAction;
  source?: 'stock' | 'showroom' | 'similar_cars';
  photoControls?: boolean;
  imageSizes?: string;
}) {
  const images = useMemo(() => {
    const result: string[] = [];
    for (const candidate of [getThumbnailUrl(car), ...(car.images ?? []), car.heroImage]) {
      const url = candidate ? getSafeImageUrl(candidate) : '';
      if (url && !result.includes(url)) result.push(url);
    }
    return result;
  }, [car]);
  const [imageIndex, setImageIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const usableImages = images.filter(image => !failedImages.includes(image));
  const activeIndex = usableImages.length ? imageIndex % usableImages.length : 0;
  const canBrowse = photoControls && usableImages.length > 1;
  const photoHelpId = useId();
  const changePhoto = (direction: -1 | 1) => {
    if (canBrowse) setImageIndex((activeIndex + direction + usableImages.length) % usableImages.length);
  };
  const swipe = usePhotoSwipe(canBrowse, changePhoto);
  const imageSignature = images.join('|');
  useEffect(() => { setImageIndex(0); setFailedImages([]); }, [car.id, imageSignature]);
  const label = vehicleDisplayTitle(car);
  const registration = vehicleRegistration(car);
  const variant = stockVariant(car);
  const content = vehicleContent(car);
  const disclosure = vehicleInsuranceDisclosure(car, content.description);
  const href = vehicleDetailPath(car) + (source === 'stock' ? '?from=stock' : '');
  const onOpen = () => {
    rememberStockPosition(car.id);
    trackEvent('vehicle_opened', { source: source === 'stock' ? 'showroom' : source, layout });
  };
  const facts = [
    { label: 'Year', value: stockRegistrationYear(car) },
    { label: 'Mileage', value: car.mileage != null ? formatMileage(car.mileage) : car.mileageText },
    { label: 'Fuel', value: car.fuel },
    { label: 'Gearbox', value: car.transmission },
    { label: 'Engine', value: car.engineSize },
    { label: 'Body', value: car.bodyType },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));
  const hasPrice = typeof car.price === 'number' && Number.isFinite(car.price) && car.price > 0;
  const priceQualification = hasPrice ? deliveryPriceQualification(car.priceType) : null;
  const priceQualifier = priceQualification
    ? priceQualification.includes('excludes VAT') ? 'Excludes VAT' : 'Confirm the full price with us'
    : hasPrice && car.priceType && /vat/i.test(car.priceType) ? car.priceType : null;
  const imageSizes = suppliedImageSizes ?? (source === 'stock'
    ? layout === 'compact'
      ? '(max-width: 639px) calc(100vw - 36px), (max-width: 767px) calc(100vw - 64px), (max-width: 1199px) calc(35vw - 23px), (max-width: 1439px) calc(35vw - 45px), 459px'
      : '(max-width: 639px) calc(100vw - 36px), (max-width: 767px) calc(100vw - 64px), (max-width: 1199px) calc(50vw - 44px), (max-width: 1439px) calc(50vw - 76px), 644px'
    : '(max-width: 639px) calc(100vw - 36px), (max-width: 700px) calc(100vw - 64px), (max-width: 1100px) calc(50vw - 44px), (max-width: 1199px) calc((100vw - 112px) / 3), (max-width: 1439px) calc((100vw - 176px) / 3), 421px');
  const features = prominentVehicleFeatures(content.features, 2);
  const hasChecks = features.length > 0 || vehicleSellingPoints(car).some(point => point.label !== 'Mileage');

  return <article aria-label={label} className={cn('gr-car-card', layout === 'compact' && 'gr-car-card--compact')} data-testid={`${layout === 'compact' ? 'compact' : 'card'}-vehicle-${car.id}`}>
    <div className="gr-card-photo">
      <Link {...swipe} href={href} data-stock-link={car.id} draggable={false} onClick={onOpen} onKeyDown={event => { if (canBrowse && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); changePhoto(event.key === 'ArrowRight' ? 1 : -1); } }} aria-label={`View full details for ${label}`} aria-describedby={canBrowse ? photoHelpId : undefined} className="gr-card-photo-link" style={canBrowse ? { touchAction: 'pan-y pinch-zoom' } : undefined}>
        {usableImages.length ? <img
          key={usableImages[activeIndex]} src={usableImages[activeIndex]} draggable={false}
          {...responsiveVehicleImage(usableImages[activeIndex], imageSizes)}
          alt={label} width={800} height={600} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async"
          onError={event => { if (!retryOriginalImage(event.currentTarget)) setFailedImages(previous => [...previous, usableImages[activeIndex]]); }}
        /> : <span className="gr-card-photo-missing"><Camera size={28} aria-hidden="true" /><span>Photographs to follow</span></span>}
      </Link>
      {canBrowse && <span id={photoHelpId} className="sr-only">Swipe or use the arrow buttons to browse photos. Select the photograph to view the car.</span>}
      <StockPhotoBadge car={car} />
      {photoControls && usableImages.length > 0 && <span className="gr-card-photo-count" aria-label={canBrowse ? `Photo ${activeIndex + 1} of ${usableImages.length}` : `${usableImages.length} photo${usableImages.length === 1 ? '' : 's'}`}><Camera size={14} aria-hidden="true" />{canBrowse ? `${activeIndex + 1} / ${usableImages.length}` : usableImages.length}</span>}
      {canBrowse && <div className="gr-card-photo-arrows">
        <button type="button" aria-label={`Previous photo of ${label}`} onClick={() => changePhoto(-1)}><ChevronLeft size={19} aria-hidden="true" /></button>
        <button type="button" aria-label={`Next photo of ${label}`} onClick={() => changePhoto(1)}><ChevronRight size={19} aria-hidden="true" /></button>
      </div>}
      {!usableImages.length && images.length > 0 && <button className="gr-card-photo-retry" type="button" onClick={() => setFailedImages([])}>Retry photos</button>}
    </div>
    <div className="gr-card-copy">
      <div className="gr-card-identity">
        <div className="gr-card-lead">
          <h3><Link href={href} onClick={onOpen}>{label}</Link></h3>
          <div className={cn('gr-card-price', !hasPrice && 'gr-card-price--enquiry')}><p>{hasPrice ? formatPrice(car.price!, car.currency) : 'Price on request'}</p>{priceQualifier && <span>{priceQualifier}</span>}</div>
        </div>
        {variant && <p className="gr-card-variant">{variant}</p>}
        {registration && <div className="gr-card-registration"><UKNumberPlate value={registration} size="sm" variant="front" showFlag={false} /></div>}
      </div>
      {(car.inventoryStatus === 'reserved' || disclosure) && <div className="gr-card-status">
        {car.inventoryStatus === 'reserved' && <span>Reserved</span>}
        {disclosure && <TermHelp text={disclosure.explanation}>{disclosure.cardLabel}</TermHelp>}
      </div>}
      {facts.length > 0 && <dl className="gr-card-facts" aria-label="Vehicle specifications">
        {facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd><VehicleTerm label={fact.label} value={fact.value} ariaLabel={`${fact.label}: ${fact.value}`}>{fact.value}</VehicleTerm></dd></div>)}
      </dl>}
      {hasChecks && <details className="gr-card-checks"><summary>Checks &amp; details</summary><VehicleSellingPoints car={car} omitMileage />{features.length > 0 && <ul className="gr-card-equipment" aria-label="Key features">{features.map(feature => <li key={feature}>{feature}</li>)}</ul>}</details>}
      <div className="gr-card-actions" data-testid={layout === 'compact' ? `compact-actions-${car.id}` : undefined}>
        <Link href={href} onClick={onOpen} className="gr-card-view">View car <img src="/brand/graphite/icon-arrow-right.svg" width={24} height={24} alt="" aria-hidden="true" /></Link>
        <span className="gr-card-save-wrap"><img src="/brand/graphite/icon-heart.svg" width={24} height={24} alt="" aria-hidden="true" /><SaveCarButton car={car} variant="inline" /></span>
        {compareAction && <button type="button" className="gr-card-compare" aria-label={`Compare ${label}`} aria-pressed={compareAction.selected} disabled={compareAction.disabled} onClick={compareAction.onToggle}>{compareAction.selected ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}<span className="sr-only">Compare</span></button>}
      </div>
    </div>
  </article>;
}
