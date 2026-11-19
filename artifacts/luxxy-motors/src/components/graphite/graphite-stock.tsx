import { Fragment, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import type { Car } from '@/lib/stock-context';
import type { StockFilters } from '@/features/stock-search/types';
import { ArrowRight, SlidersHorizontal } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { StockPromiseAd } from '@/components/stock-promise-ad';
import { StockAlertOffer } from '@/components/stock-alert-signup';
import { StockSearchRecovery } from '@/components/stock-search-recovery';
import { GraphiteCarCard, type GraphiteCompareAction } from './graphite-car-card';
import { cn } from '@/lib/utils';
import './graphite-stock.css';

export type GraphiteStockPageProps = {
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
  compareActionFor: (car: Car) => GraphiteCompareAction | undefined;
  onRetry: () => void;
  onShowMore: () => void;
  onClearFilters: () => void;
  onChangeFilters: (patch: Partial<StockFilters>) => void;
  children?: ReactNode;
};

/** Presentation only. Home owns inventory, URL filters, view choice and comparison. */
export function GraphiteStockPage(props: GraphiteStockPageProps) {
  const { title, introduction, cars, filteredCars, displayedCars, loading, hasError, showCatalogue, hasStock, savedCount, view, viewMode, showPromiseAd, photoControls, publicEnquiriesEnabled, privacyUrl, filters, filterControls, viewOptions, compareActionFor, onRetry, onShowMore, onClearFilters, onChangeFilters, children } = props;
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const filterRegionId = useId();
  return <div className="gr-stock-page" data-stock-composition="graphite" data-stock-view={view} data-stock-mode={viewMode} aria-busy={loading || undefined}>
    <section className="gr-stock-search-band" aria-label="Find a car">
      <div className="gr-container">
        <header className="gr-stock-heading">
          <h1 id="vehicle-results-heading" tabIndex={-1}>{title}</h1>
          <div className="gr-stock-heading-actions"><Link href="/saved" className="gr-stock-saved" aria-label={`Saved cars (${savedCount})`}><img src="/brand/graphite/icon-heart.svg" width={24} height={24} alt="" aria-hidden="true" /></Link>{!loading && showCatalogue && viewOptions}</div>
        </header>
        {!loading && showCatalogue && <div className="gr-stock-tools" data-filters-expanded={filtersExpanded}>
          <Button type="button" variant="outline" className="gr-stock-filter-toggle" aria-label={filtersExpanded ? 'Hide filters' : 'Show filters'} aria-expanded={filtersExpanded} aria-controls={filterRegionId} onClick={() => setFiltersExpanded(expanded => !expanded)}><SlidersHorizontal size={18} strokeWidth={2} aria-hidden="true" />Filters</Button>
          <div id={filterRegionId} className="gr-stock-filter-controls" role="group" aria-label="Search, sort and filter cars">{filterControls}</div>
        </div>}
      </div>
    </section>
    {loading ? <section className="gr-stock-loading gr-container" aria-label="Loading stock"><span role="status" className="sr-only">Loading used cars</span><div aria-hidden="true" className="gr-stock-loading-controls" /><div className="gr-stock-results" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div key={index} className="gr-stock-loading-card"><div /><span /><span /></div>)}</div></section> : <section id="stock" data-home-section className="gr-stock-catalogue gr-container">
      <div id="vehicle-results" tabIndex={-1} aria-label="Vehicle results" data-home-section className="gr-stock-results-region">
        {showCatalogue && hasError && <div className="gr-stock-notice" role="status"><p>We couldn’t refresh availability. You’re viewing the last loaded stock.</p><Button className="gr-button" onClick={onRetry}>Refresh stock</Button></div>}
        {!showCatalogue ? <div className="gr-stock-empty" role="alert"><h2>Stock is temporarily unavailable</h2><p>Try loading the stock again, or contact us to check what’s available.</p><div className="gr-stock-empty-actions"><Button className="gr-button" onClick={onRetry}>Try again</Button><Link className="gr-button gr-button--secondary" href="/contact">Contact us</Link></div></div>
          : filteredCars.length > 0 ? <><div className={cn('gr-stock-results', view === 'compact' && 'gr-stock-results--list')}>{displayedCars.map((car, index) => <Fragment key={car.id}>{showPromiseAd && index === 7 && <StockPromiseAd />}<GraphiteCarCard car={car} priority={index < 2} layout={view === 'compact' ? 'compact' : 'card'} source="stock" photoControls={photoControls} compareAction={compareActionFor(car)} /></Fragment>)}</div><div className="gr-stock-results-end"><p>Showing {displayedCars.length} of {filteredCars.length} {filteredCars.length === 1 ? 'car' : 'cars'}</p>{displayedCars.length < filteredCars.length && <Button variant="outline" className="gr-button gr-button--secondary" onClick={onShowMore}>Show more cars</Button>}</div></>
            : !cars.length ? <div className="gr-stock-empty" data-testid="empty-stock"><h2>No cars to show right now</h2><p>Tell us what you’re looking for, or ask us about our stock.</p>{hasStock && <StockAlertOffer filters={filters} privacyUrl={privacyUrl} />}<Link className="gr-stock-empty-link" href={publicEnquiriesEnabled ? '/enquire?type=general' : '/contact'}>Ask about upcoming stock <ArrowRight size={24} strokeWidth={2} aria-hidden="true" /></Link></div>
              : <div className="gr-stock-empty"><h2>No matches</h2><p>We couldn’t find a car with these filters. Remove a filter above or widen your search below.</p>{hasStock && <StockAlertOffer filters={filters} privacyUrl={privacyUrl} />}<StockSearchRecovery cars={cars} filters={filters} onChange={onChangeFilters} /><Button className="gr-button" data-testid="button-clear-filters" onClick={onClearFilters}>Clear filters</Button></div>}
        {introduction && <p className="gr-stock-introduction">{introduction}</p>}
        {children}
      </div>
    </section>}
  </div>;
}
