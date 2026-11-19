import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { vehicleDetailPath } from '@workspace/vehicle-meta';
import type { Car } from '@/lib/stock-context';
import type { StockFilters } from '@/features/stock-search/types';
import { ArrowRight, Camera, Check, ChevronLeft, ChevronRight, Copy, Heart, SlidersHorizontal } from '@/components/icons';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { SaveCarButton } from '@/components/saved-car-controls';
import { TermHelp, VehicleTerm } from '@/components/customer-help';
import { StockPhotoBadge } from '@/components/stock-photo-badge';
import { StockPromiseAd } from '@/components/stock-promise-ad';
import { StockAlertOffer } from '@/components/stock-alert-signup';
import { StockSearchRecovery } from '@/components/stock-search-recovery';
import { usePhotoSwipe } from '@/hooks/use-photo-swipe';
import { trackEvent } from '@/lib/analytics';
import { rememberStockPosition } from '@/lib/browse-session';
import { vehicleContent } from '@/lib/vehicle-content';
import { vehicleInsuranceDisclosure } from '@/lib/vehicle-history';
import { deliveryPriceQualification } from '@/lib/delivery-estimate';
import { stockRegistrationYear, stockVariant } from '@/lib/stock-presentation';
import { responsiveVehicleImage, retryOriginalImage } from '@/lib/responsive-vehicle-image';
import { cn, formatMileage, formatPrice, getSafeImageUrl, getThumbnailUrl, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import './grand-touring-stock.css';

type CompareAction = { selected: boolean; disabled: boolean; onToggle: () => void };

/** Grand Touring's photo-led card; stock facts, imagery and customer actions stay shared. */
export function GrandTouringStockCard({ car, priority = false, layout = 'card', compareAction, source = 'showroom', photoControls = true }: {
  car: Car;
  priority?: boolean;
  layout?: 'card' | 'compact';
  compareAction?: CompareAction;
  source?: 'stock' | 'showroom' | 'similar_cars';
  photoControls?: boolean;
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
  const imageSizes = source === 'stock'
    ? layout === 'compact'
      ? '(max-width: 767px) calc(100vw - 32px), (max-width: 1100px) calc(35vw - 17px), (max-width: 1471px) calc(35vw - 34px), 480px'
      : '(max-width: 767px) calc(100vw - 32px), (max-width: 1100px) calc(50vw - 36px), (max-width: 1471px) calc(50vw - 62px), 674px'
    : '(max-width: 640px) calc(100vw - 32px), (max-width: 900px) calc(50vw - 44px), (max-width: 1100px) calc((100vw - 112px) / 3), (max-width: 1471px) calc((100vw - 144px) / 3), 443px';

  return <article aria-label={label} className={cn('gt-stock-card', layout === 'compact' && 'gt-stock-card--compact')} data-testid={`${layout === 'compact' ? 'compact' : 'card'}-vehicle-${car.id}`}>
    <div className="gt-stock-card-photo">
      <Link {...swipe} href={href} draggable={false} onClick={onOpen} onKeyDown={event => { if (canBrowse && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); changePhoto(event.key === 'ArrowRight' ? 1 : -1); } }} aria-label={`View full details of ${label}`} aria-describedby={canBrowse ? photoHelpId : undefined} className="gt-stock-photo-link" style={canBrowse ? { touchAction: 'pan-y pinch-zoom' } : undefined}>
        {usableImages.length ? <img
          key={usableImages[activeIndex]} src={usableImages[activeIndex]} draggable={false}
          {...responsiveVehicleImage(usableImages[activeIndex], imageSizes)}
          alt={label} width={800} height={600} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async"
          onError={event => { if (!retryOriginalImage(event.currentTarget)) setFailedImages(previous => [...previous, usableImages[activeIndex]]); }}
        /> : <span className="gt-stock-photo-missing"><Camera size={28} aria-hidden="true" /><span>Photographs to follow</span></span>}
      </Link>
      {canBrowse && <span id={photoHelpId} className="sr-only">Swipe or use the arrow buttons to browse photos. Select the photograph to view the car.</span>}
      <StockPhotoBadge car={car} />
      {photoControls && usableImages.length > 0 && <span className="gt-stock-photo-count" aria-label={canBrowse ? `Photo ${activeIndex + 1} of ${usableImages.length}` : `${usableImages.length} photo${usableImages.length === 1 ? '' : 's'}`}><Camera size={14} aria-hidden="true" />{canBrowse ? `${activeIndex + 1} / ${usableImages.length}` : usableImages.length}</span>}
      {canBrowse && <div className="gt-stock-photo-arrows">
        <button type="button" aria-label={`Previous photo of ${label}`} onClick={() => changePhoto(-1)}><ChevronLeft size={19} aria-hidden="true" /></button>
        <button type="button" aria-label={`Next photo of ${label}`} onClick={() => changePhoto(1)}><ChevronRight size={19} aria-hidden="true" /></button>
      </div>}
      {!usableImages.length && images.length > 0 && <button className="gt-stock-photo-retry" type="button" onClick={() => setFailedImages([])}>Retry photos</button>}
    </div>
    <div className="gt-stock-card-copy">
      <div className="gt-stock-card-identity">
        <div className="gt-stock-card-lead">
          <h3><Link href={href} onClick={onOpen}>{label}</Link></h3>
          <div className={cn('gt-stock-card-price', !hasPrice && 'gt-stock-card-price--enquiry')}><p>{hasPrice ? formatPrice(car.price!, car.currency) : 'Price on request'}</p>{priceQualifier && <span>{priceQualifier}</span>}</div>
        </div>
        {variant && <p className="gt-stock-card-variant">{variant}</p>}
        {registration && <div className="gt-stock-card-registration"><UKNumberPlate value={registration} size="sm" variant="front" showFlag={false} /></div>}
      </div>
      {(car.inventoryStatus === 'reserved' || disclosure) && <div className="gt-stock-card-status">
        {car.inventoryStatus === 'reserved' && <span>Reserved</span>}
        {disclosure && <TermHelp text={disclosure.explanation}>{disclosure.cardLabel}</TermHelp>}
      </div>}
      {facts.length > 0 && <dl className="gt-stock-card-facts" aria-label="Vehicle specifications">
        {facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd><VehicleTerm label={fact.label} value={fact.value} ariaLabel={`${fact.label}: ${fact.value}`}>{fact.value}</VehicleTerm></dd></div>)}
      </dl>}
      <div className="gt-stock-card-actions" data-testid={layout === 'compact' ? `compact-actions-${car.id}` : undefined}>
        <Link href={href} onClick={onOpen} className="gt-stock-view-car">View car <ArrowRight size={16} aria-hidden="true" /></Link>
        <SaveCarButton car={car} variant="inline" />
        {compareAction && <button type="button" className="gt-stock-compare" aria-label={`Compare ${label}`} aria-pressed={compareAction.selected} disabled={compareAction.disabled} onClick={compareAction.onToggle}>{compareAction.selected ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}<span>Compare</span></button>}
      </div>
    </div>
  </article>;
}

export type GrandTouringStockPageProps = {
  title: string;
  introduction?: string;
  cars: Car[];
  filteredCars: Car[];
  displayedCars: Car[];
  loading: boolean;
  hasError: boolean;
  showCatalogue: boolean;
  hasStock: boolean;
  savedCount: number;
  view: 'cards' | 'compact';
  viewMode: 'default' | 'override';
  showPromiseAd: boolean;
  photoControls: boolean;
  publicEnquiriesEnabled?: boolean;
  privacyUrl?: string;
  filters: StockFilters;
  filterControls: ReactNode;
  viewOptions: ReactNode;
  compareActionFor: (car: Car) => CompareAction | undefined;
  onRetry: () => void;
  onShowMore: () => void;
  onClearFilters: () => void;
  onChangeFilters: (patch: Partial<StockFilters>) => void;
  children?: ReactNode;
};

/** Presentation only: Home retains URL, inventory, saved, pagination and comparison state. */
export function GrandTouringStockPage(props: GrandTouringStockPageProps) {
  const { title, introduction, cars, filteredCars, displayedCars, loading, hasError, showCatalogue, hasStock, savedCount, view, viewMode, showPromiseAd, photoControls, publicEnquiriesEnabled, privacyUrl, filters, filterControls, viewOptions, compareActionFor, onRetry, onShowMore, onClearFilters, onChangeFilters, children } = props;
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const filterRegionId = useId();
  return <div className="gt-design gt-stock-page template-stock-page template-stock--grand-touring" data-stock-template="grand-touring" data-stock-view={view} data-stock-mode={viewMode} data-stock-composition="grand-touring" aria-busy={loading || undefined}>
    <header className="gt-stock-heading">
      <div className="gt-stock-title"><h1 id="vehicle-results-heading" tabIndex={-1}>{title}</h1>{!loading && showCatalogue && <span aria-hidden="true">{filteredCars.length} {filteredCars.length === 1 ? 'car' : 'cars'}</span>}</div>
      <div className="gt-stock-heading-actions"><Link href="/saved" className="gt-stock-saved" aria-label={`Saved cars (${savedCount})`}><Heart size={18} aria-hidden="true" /><span>Saved ({savedCount})</span></Link>{showCatalogue && !loading && viewOptions}</div>
    </header>
    {loading ? <section className="gt-stock-loading" aria-label="Loading stock"><span role="status" className="sr-only">Loading used cars</span><div aria-hidden="true" className="gt-stock-loading-controls" /><div className="gt-stock-results" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div key={index} className="gt-stock-loading-card"><div /><span /><span /></div>)}</div></section> : <section id="stock" data-home-section className={cn('gt-stock-catalogue', !showCatalogue && 'gt-stock-catalogue--unavailable')}>
      {showCatalogue && <div className="gt-stock-tools" data-filters-expanded={filtersExpanded}>
        <button type="button" className="gt-stock-filter-toggle" aria-label={filtersExpanded ? 'Hide filters' : 'Show filters'} aria-expanded={filtersExpanded} aria-controls={filterRegionId} onClick={() => setFiltersExpanded(expanded => !expanded)}>
          <SlidersHorizontal size={19} aria-hidden="true" /><span>Filters</span>
        </button>
        <div id={filterRegionId} className="gt-stock-filter-controls" role="group" aria-label="Search, sort and filter cars">{filterControls}</div>
      </div>}
      <div id="vehicle-results" tabIndex={-1} aria-label="Vehicle results" data-home-section className="gt-stock-results-region">
        {showCatalogue && hasError && <div className="gt-stock-notice" role="status"><p>We couldn’t refresh availability. You’re viewing the last loaded stock.</p><button type="button" onClick={onRetry}>Refresh stock</button></div>}
        {!showCatalogue ? <div className="gt-stock-empty" role="alert"><h2>Stock is temporarily unavailable</h2><p>Try loading the stock again, or contact us to check what’s available.</p><div className="gt-stock-empty-actions"><button type="button" onClick={onRetry}>Try again</button><Link href="/contact">Contact us</Link></div></div>
          : filteredCars.length > 0 ? <><div className={cn('gt-stock-results template-stock-results', view === 'compact' && 'gt-stock-results--list')}>{displayedCars.map((car, index) => <Fragment key={car.id}>{showPromiseAd && index === 7 && <StockPromiseAd />}<GrandTouringStockCard car={car} priority={index < 2} layout={view === 'compact' ? 'compact' : 'card'} source="stock" photoControls={photoControls} compareAction={compareActionFor(car)} /></Fragment>)}</div><div className="gt-stock-results-end"><p>Showing {displayedCars.length} of {filteredCars.length} {filteredCars.length === 1 ? 'car' : 'cars'}</p>{displayedCars.length < filteredCars.length && <button type="button" onClick={onShowMore}>Show more cars</button>}</div></>
            : !cars.length ? <div className="gt-stock-empty" data-testid="empty-stock"><h3>No cars to show right now</h3><p>Tell us what you’re looking for, or ask us about our stock.</p>{hasStock && <StockAlertOffer filters={filters} privacyUrl={privacyUrl} />}<Link className="gt-stock-empty-link" href={publicEnquiriesEnabled ? '/enquire?type=general' : '/contact'}>Ask about upcoming stock <ArrowRight size={17} aria-hidden="true" /></Link></div>
              : <div className="gt-stock-empty"><h3>No matches</h3><p>We couldn’t find a car with these filters. Remove a filter above or widen your search below.</p>{hasStock && <StockAlertOffer filters={filters} privacyUrl={privacyUrl} />}<StockSearchRecovery cars={cars} filters={filters} onChange={onChangeFilters} /><button type="button" data-testid="button-clear-filters" onClick={onClearFilters}>Clear filters</button></div>}
        {introduction && <p className="gt-stock-introduction">{introduction}</p>}
        {children}
      </div>
    </section>}
  </div>;
}
