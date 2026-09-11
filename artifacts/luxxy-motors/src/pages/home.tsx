import { useEffect, useMemo, useState } from 'react';
import { useStock } from '@/lib/stock-context';
import { CarCard } from '@/components/car-card';
import { Filters, type FilterState } from '@/components/filters';
import { cn } from '@/lib/utils';
import { getContactHref } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { focusHomeTarget, flushPendingHomeTarget, scrollToHomeTarget } from '@/lib/home-navigation';
import { usePageMeta } from '@/hooks/use-page-meta';
import { showroomPageMeta } from '@/lib/page-meta';
import { ArrowRight, Grid2X2, List, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';
import { getGetRecentHandoversQueryKey, useGetRecentHandovers } from '@workspace/api-client-react';

const defaultFilters: FilterState = {
  make: '',
  model: '',
  minPrice: '',
  maxPrice: '',
  fuel: '',
  transmission: '',
  search: '',
  catS: false,
  catN: false,
  noWriteOff: false,
  sort: '',
};
const STOCK_VIEW_KEY = 'luxxy.stock-view.v1';

export default function Home() {
  const { stock, isLoading } = useStock();
  const { settings: dealerConfig } = useDealerSettings();
  const recentHandoversQuery = useGetRecentHandovers({
    query: {
      queryKey: getGetRecentHandoversQueryKey(),
      enabled: dealerConfig.recentHandovers.enabled,
    },
  });
  const [showAll, setShowAll] = useState(false);
  const [stockView, setStockView] = useState<'cards' | 'compact'>(() =>
    window.localStorage.getItem(STOCK_VIEW_KEY) === 'compact' ? 'compact' : 'cards',
  );

  usePageMeta(showroomPageMeta(dealerConfig, { count: stock?.cars.length ?? null }));

  const [filters, setFilters] = useState<FilterState>(defaultFilters);

  const filteredCars = useMemo(() => {
    if (!stock) return [];

    let result = [...stock.cars];

    // Search
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(c =>
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.make && c.make.toLowerCase().includes(q)) ||
        (c.model && c.model.toLowerCase().includes(q)) ||
        (c.plate && c.plate.toLowerCase().includes(q)) ||
        (c.registration && c.registration.toLowerCase().includes(q))
      );
    }

    if (filters.make) result = result.filter(c => c.make === filters.make);
    if (filters.model) result = result.filter(c => c.model === filters.model);
    if (filters.fuel) result = result.filter(c => c.fuel === filters.fuel);
    if (filters.transmission) result = result.filter(c => c.transmission === filters.transmission);

    if (filters.minPrice) {
      const min = parseFloat(filters.minPrice);
      if (!isNaN(min)) result = result.filter(c => c.price && c.price >= min);
    }
    if (filters.maxPrice) {
      const max = parseFloat(filters.maxPrice);
      if (!isNaN(max)) result = result.filter(c => c.price && c.price <= max);
    }

    if (filters.noWriteOff || filters.catS || filters.catN) {
      result = result.filter(c => {
        const cat = (c.writeOffCategory || '').toUpperCase();
        const isS = cat.includes('S') || cat === 'CAT S';
        const isN = cat.includes('N') || cat === 'CAT N';
        const isClear = !isS && !isN;

        if (filters.noWriteOff && isClear) return true;
        if (filters.catS && isS) return true;
        if (filters.catN && isN) return true;

        return false;
      });
    }

    if (filters.sort) {
      result.sort((a, b) => {
        switch (filters.sort) {
          case 'price-asc': return (a.price || 0) - (b.price || 0);
          case 'price-desc': return (b.price || 0) - (a.price || 0);
          case 'mileage-asc': return (a.mileage || 0) - (b.mileage || 0);
          case 'mileage-desc': return (b.mileage || 0) - (a.mileage || 0);
          default: return 0;
        }
      });
    }

    return result;
  }, [stock, filters]);

  useEffect(() => {
    setShowAll(false);
  }, [filters]);

  useEffect(() => {
    if (!isLoading) {
      requestAnimationFrame(flushPendingHomeTarget);
    }
  }, [isLoading]);

  const displayedCars = showAll ? filteredCars : filteredCars.slice(0, 4);
  const recentHandovers = recentHandoversQuery.data?.handovers ?? [];

  const stockCount = stock?.count ?? stock?.cars.length ?? 0;
  useEffect(() => {
    window.localStorage.setItem(STOCK_VIEW_KEY, stockView);
  }, [stockView]);

  const revealResults = (source: 'quick_filter' | 'filter_panel' | 'view_all') => {
    trackEvent('stock_results_opened', { source, result_count: filteredCars.length });
    setShowAll(true);
    requestAnimationFrame(() => {
      if (scrollToHomeTarget('vehicle-results')) {
        focusHomeTarget('vehicle-results-heading');
      }
    });
  };

  const applyQuickFilter = (nextFilters: Partial<FilterState>) => {
    const preset = nextFilters.transmission ? 'automatic' : nextFilters.maxPrice ? 'under_5000' : 'low_mileage';
    trackEvent('showroom_filter_applied', {
      source: 'quick_filter',
      preset,
      filter_count: 1,
    });
    setFilters({ ...defaultFilters, ...nextFilters });
    revealResults('quick_filter');
  };

  if (isLoading) {
    return (
      <div className="min-h-[70vh] bg-secondary" aria-label="Loading showroom" aria-busy="true">
        <div className="container mx-auto grid min-h-[70vh] items-center gap-10 px-4 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="h-3 w-40 animate-pulse bg-primary/10" />
            <div className="h-24 w-full max-w-xl animate-pulse bg-primary/10" />
            <div className="h-5 w-3/4 animate-pulse bg-primary/10" />
            <div className="h-14 w-44 animate-pulse bg-primary/10" />
          </div>
          <div className="h-[320px] animate-pulse bg-primary/20 lg:h-[440px]" />
        </div>
      </div>
    );
  }

  const quickFilterClass = 'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary bg-secondary/60 hover:bg-secondary transition-colors';

  return (
    <div className="luxxy-shell luxxy-grain flex min-h-screen flex-col">
      {/* Short welcome before the live stock */}
      <section className="border-b border-primary/10 bg-secondary text-primary">
        <div className="container mx-auto px-4 pb-7 pt-[calc(var(--site-header-height,4.5rem)+1.25rem)] sm:px-6 sm:pb-9 lg:px-8">
          <p className="font-display text-2xl sm:text-3xl">Welcome to {dealerConfig.identity.name}.</p>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-primary/75">
            Browse our current stock, compare the details and choose a car that suits you.
          </p>
          <p className="mt-3 text-[15px] text-primary/65">
            {stockCount} {stockCount === 1 ? 'car' : 'cars'} available
          </p>
        </div>
      </section>

      {/* Stock */}
      <div id="stock" data-home-section className="px-0 pb-20 pt-5 md:pt-16 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-4 flex flex-col gap-2 sm:mb-10 sm:flex-row sm:items-end sm:justify-between border-b border-primary/10 pb-4 sm:pb-8">
            <div>
              <h2 id="vehicle-results-heading" tabIndex={-1} className="heading-2 text-primary">
                {showAll ? 'Every car on site' : 'Latest arrivals'}
              </h2>
            </div>
            {stock && (
              <p className="text-[15px] text-primary/70 mb-2" data-testid="text-filtered-stock-count" role="status" aria-live="polite" aria-atomic="true">
                {filteredCars.length} {filteredCars.length === 1 ? 'vehicle' : 'vehicles'} available
              </p>
            )}
          </div>

          <Filters
            cars={stock?.cars || []}
            filters={filters}
            setFilters={setFilters}
            onSearch={() => {
              trackEvent('showroom_filter_applied', {
                source: 'filter_panel',
                filter_count: [
                  filters.make,
                  filters.model,
                  filters.minPrice || filters.maxPrice,
                  filters.fuel,
                  filters.transmission,
                  filters.search,
                  filters.noWriteOff,
                  filters.catS,
                  filters.catN,
                ].filter(Boolean).length,
                search_used: Boolean(filters.search),
                budget_used: Boolean(filters.minPrice || filters.maxPrice),
                insurance_filter_used: filters.noWriteOff || filters.catS || filters.catN,
                sort: filters.sort || 'recommended',
                result_count: filteredCars.length,
              });
              revealResults('filter_panel');
            }}
            vehicleCount={stockCount}
          />

          <section className="mt-4 sm:mt-6 flex flex-col justify-between gap-3 lg:flex-row lg:items-center pb-4 sm:pb-8 border-b border-primary/10">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-[15px] font-medium text-primary/70 mr-2 hidden sm:inline">Shortcuts</span>
              <button type="button" onClick={() => applyQuickFilter({ transmission: 'Automatic' })} className="text-[15px] text-primary/80 hover:text-primary transition-colors border-b border-transparent hover:border-primary min-h-[44px] flex items-center" data-testid="button-quick-automatic">
                Automatic
              </button>
              <button type="button" onClick={() => applyQuickFilter({ maxPrice: '5000' })} className="text-[15px] text-primary/80 hover:text-primary transition-colors border-b border-transparent hover:border-primary min-h-[44px] flex items-center" data-testid="button-quick-under-5000">
                Under £5k
              </button>
              <button type="button" onClick={() => applyQuickFilter({ sort: 'mileage-asc' })} className="text-[15px] text-primary/80 hover:text-primary transition-colors border-b border-transparent hover:border-primary min-h-[44px] flex items-center" data-testid="button-quick-low-mileage">
                Low miles
              </button>
            </div>
            <div className="flex items-center gap-4 text-[15px]" aria-label="Vehicle display">
              <span className="text-primary/60 hidden sm:inline">Layout</span>
              <button
                type="button"
                aria-pressed={stockView === 'cards'}
                onClick={() => {
                  setStockView('cards');
                  trackEvent('stock_view_changed', { view: 'cards' });
                }}
                data-testid="button-stock-view-cards"
                className={cn('transition-colors hover:text-primary flex items-center gap-2 min-h-[44px] px-2 -ml-2', stockView === 'cards' ? 'text-primary font-medium' : 'text-primary/60')}
              >
                <Grid2X2 className="h-4 w-4" /> Cards
              </button>
              <button
                type="button"
                aria-pressed={stockView === 'compact'}
                onClick={() => {
                  setStockView('compact');
                  trackEvent('stock_view_changed', { view: 'compact' });
                }}
                data-testid="button-stock-view-compact"
                className={cn('transition-colors hover:text-primary flex items-center gap-2 min-h-[44px] px-2', stockView === 'compact' ? 'text-primary font-medium' : 'text-primary/60')}
              >
                <List className="h-4 w-4" /> Compact
              </button>
            </div>
          </section>

          <div id="vehicle-results" data-home-section className="mt-5 sm:mt-12">
            {filteredCars.length > 0 ? (
              <>
                <div className={cn('grid', stockView === 'compact' ? 'gap-4 xl:grid-cols-2' : 'gap-8 sm:grid-cols-2 xl:grid-cols-4')}>
                  {displayedCars.map(car => (
                    <CarCard
                      key={car.id}
                      car={car}
                      layout={stockView === 'compact' ? 'compact' : 'card'}
                      stretchedLink
                    />
                  ))}
                </div>
                {filteredCars.length > 4 && !showAll && (
                  <div className="mt-16 flex justify-center">
                    <Button
                      onClick={() => {
                        revealResults('view_all');
                      }}
                      size="lg"
                      data-testid="button-view-all-vehicles"
                      className="h-14 bg-primary px-10 text-base font-medium hover:bg-primary/90 rounded-none text-primary-foreground"
                    >
                      View all {filteredCars.length} vehicles
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="mx-auto max-w-2xl py-24 text-center">
                <Search className="mx-auto mb-6 h-8 w-8 text-primary/40" />
                <p className="heading-3 text-primary">Nothing matches that search</p>
                <p className="mx-auto mb-10 mt-4 body-base max-w-md text-primary/70">
                  Try widening your budget or clearing the filters to see the full stock list.
                </p>
                <Button size="lg" onClick={() => { setFilters(defaultFilters); setShowAll(false); }} data-testid="button-clear-filters" className="h-14 px-8 text-base font-medium rounded-none bg-primary text-primary-foreground hover:bg-primary/90">
                  Clear all filters
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {dealerConfig.recentHandovers.enabled && recentHandovers.length > 0 && (
        <section
          id="recent-handovers"
          data-home-section
          data-testid="recent-handovers-section"
          className="bg-primary py-20 md:py-28 border-t border-primary/10 text-primary-foreground"
          aria-labelledby="recent-handovers-heading"
        >
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-primary-foreground/10 pb-8">
              <div>
                <p className="label-sm text-accent">Recent deliveries</p>
                <h2 id="recent-handovers-heading" className="mt-3 heading-2 text-primary-foreground">
                  Recently handed over
                </h2>
              </div>
              <p className="max-w-xs body-sm text-primary-foreground/70 mb-2">
                A few recent deliveries and collections from the showroom.
              </p>
            </div>
            <div className="grid gap-x-12 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
              {recentHandovers.map((handover) => {
                const vehicle = handover.vehicle;
                const vehicleName = [vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ') || 'Vehicle';
                return (
                  <article key={`${vehicleName}-${handover.handoverMonth}`} className="flex flex-col" data-testid="recent-handover">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="label-sm text-accent">{handover.handoverMonth}</span>
                    </div>
                    <h3 className="heading-3 text-primary-foreground">{vehicleName}</h3>
                    <p className="mt-3 body-sm text-primary-foreground/70">
                      {[vehicle.year, vehicle.bodyType, vehicle.fuel, vehicle.transmission].filter(Boolean).join(', ')}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* How we work */}
      {dealerConfig.whyBuy && dealerConfig.whyBuy.length > 0 && (
        <section id="about" data-home-section className="bg-secondary py-16 md:py-24 border-t border-secondary text-primary">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid gap-16 lg:grid-cols-[.9fr_1.1fr] lg:gap-20">
              <div className="max-w-md">
                <p className="text-[15px] font-medium text-primary/70">How we work</p>
                <h2 id="about-heading" tabIndex={-1} className="mt-4 heading-2 text-primary">
                  Good cars. <br/><span className="italic text-accent font-normal">Good sense.</span>
                </h2>
                <p className="mt-6 text-lg leading-relaxed text-primary/80">
                  A used-car showroom should make choosing feel clearer, not louder. That is the standard we bring to every vehicle and every conversation.
                </p>
              </div>
              <div className="grid gap-x-12 gap-y-12 sm:grid-cols-2 mt-4 lg:mt-0">
                {dealerConfig.whyBuy.map((item, idx) => (
                  <article key={idx} className="flex flex-col border-t border-primary/10 pt-6">
                    <h3 className="text-base font-medium text-primary">{item.title}</h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-primary/70">{item.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Services */}
      <section className="bg-secondary py-16 md:py-24 border-t border-secondary">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-16 flex flex-col justify-between gap-6 md:flex-row md:items-end border-b border-primary/10 pb-10">
            <div>
              <p className="label-sm text-primary/70">Once you've found it</p>
              <h2 className="mt-4 max-w-xl heading-2 text-primary">
                The useful bits,<br />handled properly.
              </h2>
            </div>
            <p className="max-w-sm body-lg text-primary/80 mb-2">
              From warranty questions to getting the car to your door, ask us plainly and we will give you a plain answer.
            </p>
          </div>
          <div className="grid gap-16 md:gap-12 md:grid-cols-2">
            {dealerConfig.warranty?.enabled && (
              <article id="warranty" data-home-section className="flex flex-col sm:pr-8 border-t border-primary/10 pt-6">
                <h3 id="warranty-heading" tabIndex={-1} className="heading-3 text-primary">{dealerConfig.warranty.title}</h3>
                <p className="mt-5 flex-1 body-base text-primary/80">{dealerConfig.warranty.description}</p>
                <Button asChild variant="link" size="lg" data-testid="link-warranty-enquiry" className="mt-8 w-fit px-0 text-base font-medium text-primary hover:text-accent">
                  <a href={getContactHref('Warranty Enquiry')}>{dealerConfig.warranty.ctaLabel}<ArrowRight className="ml-2 h-4 w-4" /></a>
                </Button>
              </article>
            )}
            {dealerConfig.partExchange?.enabled && (
              <article id="part-exchange" data-home-section className="flex flex-col sm:pr-8 border-t border-primary/10 pt-6">
                <h3 id="part-exchange-heading" tabIndex={-1} className="heading-3 text-primary">{dealerConfig.partExchange.title}</h3>
                <p className="mt-5 flex-1 body-base text-primary/80">{dealerConfig.partExchange.description}</p>
                <Button asChild variant="link" size="lg" data-testid="link-px-enquiry" className="mt-8 w-fit px-0 text-base font-medium text-primary hover:text-accent">
                  <a href={getContactHref('Part Exchange Enquiry')}>{dealerConfig.partExchange.ctaLabel}<ArrowRight className="ml-2 h-4 w-4" /></a>
                </Button>
              </article>
            )}
            {dealerConfig.delivery?.enabled && (
              <article id="delivery" data-home-section className="flex flex-col sm:pr-8 border-t border-primary/10 pt-6">
                <h3 id="delivery-heading" tabIndex={-1} className="heading-3 text-primary">{dealerConfig.delivery.title}</h3>
                <p className="mt-5 flex-1 body-base text-primary/80">{dealerConfig.delivery.description}</p>
                <Button asChild variant="link" size="lg" data-testid="link-delivery-enquiry" className="mt-8 w-fit px-0 text-base font-medium text-primary hover:text-accent">
                  <a href={getContactHref('Delivery Enquiry')}>{dealerConfig.delivery.ctaLabel}<ArrowRight className="ml-2 h-4 w-4" /></a>
                </Button>
              </article>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
