import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useStock } from '@/lib/stock-context';
import { CarCard } from '@/components/car-card';
import { Filters, type FilterState } from '@/components/filters';
import { cn, formatMileage, formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { getContactHref, recordBookingIntent, recordContactIntent } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { flushPendingHomeTarget, scrollToHomeTarget } from '@/lib/home-navigation';
import { usePageMeta } from '@/hooks/use-page-meta';
import { showroomPageMeta } from '@/lib/page-meta';
import { ArrowRight, ChevronLeft, ChevronRight, Grid2X2, List, Pause, Play, Search } from 'lucide-react';
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
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);

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

  const locationLabel = [dealerConfig.address?.city, dealerConfig.address?.region].filter(Boolean).join(', ');
  const makes = useMemo(
    () => Array.from(new Set((stock?.cars || []).map(car => car.make).filter(Boolean) as string[])).sort(),
    [stock?.cars],
  );
  const stockCount = stock?.count ?? stock?.cars.length ?? 0;
  const featuredCars = useMemo(() => {
    const carsWithPhotos = (stock?.cars || []).filter((car) => Boolean(getThumbnailUrl(car)));
    
    if (dealerConfig.featuredVehicleIds?.length > 0) {
      const curated = dealerConfig.featuredVehicleIds
        .map(id => carsWithPhotos.find(car => car.id === id))
        .filter(Boolean) as typeof carsWithPhotos;
        
      if (curated.length > 0) {
        return curated.slice(0, 8);
      }
    }

    return carsWithPhotos.slice(0, 8);
  }, [stock?.cars, dealerConfig.featuredVehicleIds]);
  const featuredCar = featuredCars[featuredIndex % Math.max(featuredCars.length, 1)];
  const heroHeadline = dealerConfig.hero.copy.trim().toLowerCase() === 'find your next car'
    ? 'Carefully chosen cars.'
    : dealerConfig.hero.copy;
  const heroAnnouncement = dealerConfig.hero.announcement?.trim().toLowerCase() === 'independent cars, carefully chosen'
    ? `Independent used-car dealer in ${dealerConfig.address?.city || 'Harrow'}`
    : dealerConfig.hero.announcement;
  const heroSubcopy = dealerConfig.hero.subcopy.trim().toLowerCase() === 'quality used vehicles. straightforward buying. exceptional service.'
    ? 'Clear details, fair prices and time to look properly before you decide.'
    : dealerConfig.hero.subcopy;
  const heroPrimaryLabel = 'See all cars';
  const oldSecondaryLabels = ['get a part-exchange valuation', 'part exchange'];
  const heroSecondaryLabel = oldSecondaryLabels.includes(dealerConfig.hero.secondaryCta.trim().toLowerCase())
    ? 'Find my car'
    : dealerConfig.hero.secondaryCta;

  useEffect(() => {
    setFeaturedIndex(0);
  }, [featuredCars]);

  useEffect(() => {
    window.localStorage.setItem(STOCK_VIEW_KEY, stockView);
  }, [stockView]);

  useEffect(() => {
    if (
      featuredCars.length < 2 ||
      carouselPaused ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setFeaturedIndex((current) => (current + 1) % featuredCars.length);
    }, 5500);

    return () => window.clearInterval(timer);
  }, [featuredCars.length, carouselPaused]);

  const revealResults = () => {
    trackEvent('stock_results_opened', { source: 'hero', result_count: filteredCars.length });
    setShowAll(true);
    requestAnimationFrame(() => scrollToHomeTarget('vehicle-results'));
  };

  const applyQuickFilter = (nextFilters: Partial<FilterState>) => {
    const preset = nextFilters.transmission ? 'automatic' : nextFilters.maxPrice ? 'under_5000' : 'low_mileage';
    trackEvent('showroom_filter_applied', {
      source: 'quick_filter',
      preset,
      filter_count: 1,
    });
    setFilters({ ...defaultFilters, ...nextFilters });
    revealResults();
  };

  if (isLoading) {
    return (
      <div className="min-h-[70vh] bg-background" aria-label="Loading showroom" aria-busy="true">
        <div className="container mx-auto grid min-h-[70vh] items-center gap-10 px-4 lg:grid-cols-2">
          <div className="space-y-5">
            <div className="h-3 w-40 animate-pulse bg-secondary" />
            <div className="h-24 w-full max-w-xl animate-pulse bg-secondary" />
            <div className="h-5 w-3/4 animate-pulse bg-secondary" />
            <div className="h-14 w-44 animate-pulse bg-secondary" />
          </div>
          <div className="h-[320px] animate-pulse bg-secondary lg:h-[440px]" />
        </div>
      </div>
    );
  }

  const quickFilterClass = 'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary bg-secondary/60 hover:bg-secondary transition-colors';

  return (
    <div className="luxxy-shell luxxy-grain flex min-h-screen flex-col">
      {/* Forecourt hero */}
      <section className="relative overflow-hidden bg-background text-foreground">
        <div className="container mx-auto px-4 pt-[calc(var(--site-header-height,4.5rem)+1rem)] sm:px-6 lg:px-8 lg:pt-[calc(var(--site-header-height,4.5rem)+2rem)]">
          <div className="grid lg:min-h-[30rem] lg:grid-cols-[0.9fr_1.1fr] gap-8 lg:gap-12">
            <div className="relative z-10 flex flex-col justify-center py-4 sm:py-8 lg:py-12">
              <p className="luxxy-reveal text-sm font-medium text-muted-foreground">
                {heroAnnouncement || `Independent used-car dealer in ${dealerConfig.address?.city || 'Harrow'}`}
              </p>
              <h1 className="luxxy-reveal luxxy-reveal-1 mt-4 max-w-2xl break-words font-display text-[clamp(2.5rem,8vw,4.5rem)] leading-[1.05] tracking-tight text-primary">
                {heroHeadline}
              </h1>
              <p className="luxxy-reveal luxxy-reveal-2 mt-4 max-w-lg text-base leading-7 text-muted-foreground sm:mt-6 sm:text-lg sm:leading-relaxed">
                {heroSubcopy}
              </p>
              <p className="mt-5 text-sm text-primary/80 sm:mt-8">
                {stockCount} cars available · {locationLabel || 'Harrow, London'}
              </p>
              <div className="luxxy-reveal luxxy-reveal-3 mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:flex sm:flex-wrap sm:gap-4">
                <Button
                  type="button"
                  size="lg"
                  onClick={revealResults}
                  data-testid="button-hero-primary"
                  className="h-12 bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 rounded-none sm:px-8"
                >
                  <span className="truncate">{heroPrimaryLabel}</span>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  data-testid="link-hero-find-my-car"
                  className="h-12 border-primary/30 bg-transparent px-4 text-sm font-medium text-primary hover:border-primary hover:bg-secondary rounded-none sm:px-8"
                >
                  <Link href="/find-my-car">
                    <span className="truncate">{heroSecondaryLabel}</span>
                  </Link>
                </Button>
              </div>
            </div>

            <div className="relative min-h-[19rem] overflow-hidden bg-primary sm:min-h-[26rem] lg:min-h-full">
              {featuredCar ? (
                <>
                  <div className="absolute inset-0 overflow-hidden" data-testid="featured-forecourt-carousel">
                    {featuredCars.map((car, index) => {
                      const offset = index - featuredIndex;
                      return (
                        <Link
                          key={car.id}
                          href={`/vehicle/${car.id}`}
                          onClick={() => trackEvent('vehicle_opened', { source: 'featured_carousel', layout: 'hero' })}
                          aria-label={`View ${vehicleDisplayTitle(car)}`}
                          aria-hidden={index !== featuredIndex}
                          tabIndex={index === featuredIndex ? 0 : -1}
                          className="group absolute inset-0 block transition-transform duration-700 ease-out"
                          style={{ transform: `translateX(${offset * 100}%)` }}
                        >
                          <img
                            src={getThumbnailUrl(car)}
                            alt=""
                            className="h-full w-full bg-primary object-contain p-3 transition-transform duration-700 group-hover:scale-[1.01] sm:p-6"
                          />
                           <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/25" aria-hidden="true" />
                          <span className="absolute inset-x-0 bottom-0 flex flex-col sm:flex-row sm:items-end justify-between gap-4 p-6 text-primary-foreground sm:p-8">
                            <span>
                              <span className="block text-sm text-primary-foreground/70">Featured on the forecourt</span>
                              <span className="mt-1 block font-display text-2xl font-medium">{vehicleDisplayTitle(car)}</span>
                              <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-primary-foreground/80">
                                {car.year && <span>{car.year}</span>}
                                {car.mileage != null && <span>· {formatMileage(car.mileage)}</span>}
                                {car.fuel && <span>· {car.fuel}</span>}
                                {car.transmission && <span>· {car.transmission}</span>}
                              </span>
                            </span>
                            <span className="text-2xl font-medium">
                              {car.price ? formatPrice(car.price, car.currency) : 'POA'}
                            </span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>

                  {featuredCars.length > 1 && (
                     <div className="absolute right-4 top-4 z-20 flex bg-black/40 backdrop-blur-md">
                       <button
                         type="button"
                         aria-label={carouselPaused ? 'Play featured vehicles' : 'Pause featured vehicles'}
                         aria-pressed={carouselPaused}
                         onClick={() => {
                           trackEvent('carousel_control_used', { action: carouselPaused ? 'play' : 'pause' });
                           setCarouselPaused(!carouselPaused);
                         }}
                         className="grid h-10 w-10 place-items-center text-white hover:bg-white/20 transition-colors"
                       >
                         {carouselPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                       </button>
                      <button
                        type="button"
                        aria-label="Previous featured car"
                         onClick={() => {
                           trackEvent('carousel_control_used', { action: 'previous' });
                           setFeaturedIndex((current) => (current - 1 + featuredCars.length) % featuredCars.length);
                         }}
                        className="grid h-10 w-10 place-items-center text-primary-foreground transition-colors hover:bg-white/20"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                       <span aria-live="polite" aria-atomic="true" className="grid min-w-12 place-items-center px-1 text-xs font-medium text-primary-foreground">
                        {featuredIndex + 1} / {featuredCars.length}
                      </span>
                      <button
                        type="button"
                        aria-label="Next featured car"
                         onClick={() => {
                           trackEvent('carousel_control_used', { action: 'next' });
                           setFeaturedIndex((current) => (current + 1) % featuredCars.length);
                         }}
                        className="grid h-10 w-10 place-items-center text-primary-foreground transition-colors hover:bg-white/20"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="absolute inset-0 grid place-items-center px-8 text-center">
                  <p className="font-display text-3xl text-primary-foreground">Fresh stock arriving regularly.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {dealerConfig.trustItems?.length > 0 && (
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 mt-5 mb-6 sm:mt-6 sm:mb-10" aria-label={`${dealerConfig.identity.name} promises`}>
            <ul className="flex flex-wrap gap-x-8 gap-y-3 text-[13px] sm:text-sm text-primary/80">
              {dealerConfig.trustItems.slice(0, 4).map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 bg-accent/80 rounded-full" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Stock */}
      <div id="stock" data-home-section className="px-0 pb-16 pt-5 md:pt-12 border-t border-border/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-4 flex flex-col gap-2 sm:mb-8 sm:flex-row sm:items-end sm:justify-between border-b border-border/50 pb-4 sm:pb-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{showAll ? 'Full stock list' : 'Browse our stock'}</p>
              <h2 className="mt-2 font-display text-4xl font-medium tracking-tight text-primary md:text-5xl">
                {showAll ? 'Every car on site' : 'Latest arrivals'}
              </h2>
            </div>
            {stock && (
              <p className="text-sm text-muted-foreground mb-1" data-testid="text-filtered-stock-count" role="status" aria-live="polite" aria-atomic="true">
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
              setShowAll(true);
              requestAnimationFrame(() => scrollToHomeTarget('vehicle-results'));
            }}
            vehicleCount={stockCount}
          />

          <section className="mt-1 sm:mt-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center border-b border-border/40 pb-4 sm:pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground mr-2 hidden sm:inline">Shortcuts</span>
              <button type="button" onClick={() => applyQuickFilter({ transmission: 'Automatic' })} className={quickFilterClass} data-testid="button-quick-automatic">
                Automatic
              </button>
              <button type="button" onClick={() => applyQuickFilter({ maxPrice: '5000' })} className={quickFilterClass} data-testid="button-quick-under-5000">
                Under £5k
              </button>
              <button type="button" onClick={() => applyQuickFilter({ sort: 'mileage-asc' })} className={quickFilterClass} data-testid="button-quick-low-mileage">
                Low miles
              </button>
            </div>
            <div className="flex border border-border/50 bg-background sm:w-auto w-full" aria-label="Vehicle display">
              <button
                type="button"
                aria-pressed={stockView === 'cards'}
                onClick={() => {
                  setStockView('cards');
                  trackEvent('stock_view_changed', { view: 'cards' });
                }}
                data-testid="button-stock-view-cards"
                className={cn('flex-1 sm:flex-none inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors', stockView === 'cards' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary')}
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
                className={cn('flex-1 sm:flex-none inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors', stockView === 'compact' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary')}
              >
                <List className="h-4 w-4" /> Compact
              </button>
            </div>
          </section>

          <div id="vehicle-results" data-home-section className="mt-5 sm:mt-8">
            {filteredCars.length > 0 ? (
              <>
                <div className={cn('grid', stockView === 'compact' ? 'gap-4 xl:grid-cols-2' : 'gap-6 sm:grid-cols-2 xl:grid-cols-4')}>
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
                        trackEvent('stock_results_opened', { source: 'view_all', result_count: filteredCars.length });
                        setShowAll(true);
                        requestAnimationFrame(() => scrollToHomeTarget('vehicle-results'));
                      }}
                      size="lg"
                      data-testid="button-view-all-vehicles"
                      className="h-12 bg-primary px-8 text-sm font-medium hover:bg-primary/90 rounded-none"
                    >
                      View all {filteredCars.length} vehicles
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="mx-auto max-w-2xl py-20 text-center">
                <Search className="mx-auto mb-6 h-8 w-8 text-muted-foreground" />
                <p className="font-display text-3xl font-medium tracking-tight text-primary">Nothing matches that search</p>
                <p className="mx-auto mb-8 mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
                  Try widening your budget or clearing the filters to see the full stock list.
                </p>
                <Button size="lg" onClick={() => { setFilters(defaultFilters); setShowAll(false); }} data-testid="button-clear-filters" className="h-12 px-8 font-medium rounded-none">
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
          className="bg-secondary/30 py-16 md:py-24 border-t border-border/50"
          aria-labelledby="recent-handovers-heading"
        >
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Recent deliveries</p>
                <h2 id="recent-handovers-heading" className="mt-2 font-display text-3xl font-medium tracking-tight text-primary md:text-4xl">
                  Recently handed over
                </h2>
              </div>
              <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                A few recent deliveries and collections from the showroom.
              </p>
            </div>
            <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {recentHandovers.map((handover) => {
                const vehicle = handover.vehicle;
                const vehicleName = [vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ') || 'Vehicle';
                return (
                  <article key={`${vehicleName}-${handover.handoverMonth}`} className="flex flex-col" data-testid="recent-handover">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-medium text-primary/80">{handover.handoverMonth}</span>
                    </div>
                    <h3 className="font-display text-2xl font-medium text-primary">{vehicleName}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
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
        <section id="about" data-home-section className="bg-background py-20 md:py-28 border-t border-border/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid gap-16 lg:grid-cols-[.9fr_1.1fr] lg:gap-24">
              <div className="max-w-md">
                <p className="text-sm font-medium text-muted-foreground">How we work</p>
                <h2 className="mt-3 font-display text-4xl font-medium tracking-tight text-primary md:text-5xl">
                  Good cars. <span className="italic text-muted-foreground font-normal">Good sense.</span>
                </h2>
                <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                  A used-car showroom should make choosing feel clearer, not louder. That is the standard we bring to every vehicle and every conversation.
                </p>
              </div>
              <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
                {dealerConfig.whyBuy.map((item, idx) => (
                  <article key={idx} className="flex flex-col">
                    <h3 className="text-lg font-medium text-primary">{item.title}</h3>
                    <p className="mt-3 text-base leading-relaxed text-muted-foreground">{item.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Services */}
      <section className="bg-secondary/40 py-20 md:py-24 border-t border-border/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 flex flex-col justify-between gap-5 md:flex-row md:items-end border-b border-border/50 pb-8">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Once you've found it</p>
              <h2 className="mt-3 max-w-xl font-display text-4xl font-medium tracking-tight text-primary md:text-5xl">
                The useful bits,<br />handled properly.
              </h2>
            </div>
            <p className="max-w-sm text-base leading-relaxed text-muted-foreground">
              From warranty questions to getting the car to your door, ask us plainly and we will give you a plain answer.
            </p>
          </div>
          <div className="grid gap-12 md:gap-8 md:grid-cols-2">
            {dealerConfig.warranty?.enabled && (
              <article id="warranty" data-home-section className="flex flex-col sm:pr-8">
                <h3 className="font-display text-3xl font-medium text-primary">{dealerConfig.warranty.title}</h3>
                <p className="mt-4 flex-1 text-base leading-relaxed text-muted-foreground">{dealerConfig.warranty.description}</p>
                <Button asChild variant="link" size="lg" data-testid="link-warranty-enquiry" className="mt-6 w-fit px-0 font-medium text-primary hover:text-accent">
                  <a href={getContactHref('Warranty Enquiry')}>{dealerConfig.warranty.ctaLabel}<ArrowRight className="ml-2 h-4 w-4" /></a>
                </Button>
              </article>
            )}
            {dealerConfig.delivery?.enabled && (
              <article id="delivery" data-home-section className="flex flex-col sm:pr-8">
                <h3 className="font-display text-3xl font-medium text-primary">{dealerConfig.delivery.title}</h3>
                <p className="mt-4 flex-1 text-base leading-relaxed text-muted-foreground">{dealerConfig.delivery.description}</p>
                <Button asChild variant="link" size="lg" data-testid="link-delivery-enquiry" className="mt-6 w-fit px-0 font-medium text-primary hover:text-accent">
                  <a href={getContactHref('Delivery Enquiry')}>{dealerConfig.delivery.ctaLabel}<ArrowRight className="ml-2 h-4 w-4" /></a>
                </Button>
              </article>
            )}
          </div>
        </div>
      </section>

      {/* Book a viewing */}
      <section id="book-viewing" data-home-section className="bg-primary text-primary-foreground py-20 md:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 md:grid-cols-[.9fr_1.1fr] md:items-center">
            <div>
              <p className="text-sm font-medium text-primary-foreground/70 mb-2">Come and see it</p>
              <h2 className="max-w-xl font-display text-4xl font-medium tracking-tight md:text-5xl">{dealerConfig.bookViewing.title}</h2>
              <p className="mt-6 text-lg leading-relaxed text-primary-foreground/80 md:max-w-md">{dealerConfig.bookViewing.description}</p>
            </div>
            <div className="flex md:justify-end">
              <Button size="lg" asChild data-testid="link-book-viewing" className="h-12 shrink-0 bg-accent px-8 text-sm font-medium text-accent-foreground hover:bg-accent/90 rounded-none">
                <a href={getContactHref('Book a Viewing')} onClick={() => recordBookingIntent({ source: 'home_booking_panel' })}>{dealerConfig.bookViewing.ctaLabel}</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Visit us */}
      {dealerConfig.address && locationLabel && (
        <section id="visit" data-home-section className="bg-background py-20 md:py-24 border-t border-border/50">
          <div className="container mx-auto grid gap-16 px-4 sm:px-6 lg:grid-cols-[.9fr_1.1fr] lg:gap-24 lg:px-8">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Visit the showroom</p>
              <h2 className="mt-3 font-display text-4xl font-medium tracking-tight text-primary md:text-5xl">{locationLabel}</h2>
              <address className="mt-8 text-lg not-italic leading-relaxed text-muted-foreground">
                {dealerConfig.address.street && <p className="font-medium text-primary">{dealerConfig.address.street}</p>}
                {dealerConfig.address.postcode && <p>{dealerConfig.address.postcode}</p>}
              </address>
              {dealerConfig.address.mapsUrl && (
                <Button asChild size="lg" variant="link" data-testid="link-get-directions" className="mt-6 h-auto px-0 font-medium text-primary hover:text-accent">
                  <a href={dealerConfig.address.mapsUrl} target="_blank" rel="noopener noreferrer">Get directions<ArrowRight className="ml-2 h-4 w-4" /></a>
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-6">
              {dealerConfig.contact.phone && (
                <a data-testid="link-contact-phone" onClick={() => recordContactIntent({ channel: 'call', source: 'home_contact_panel' })} className="group py-4 border-b border-border/40 transition-colors hover:border-primary" href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}>
                  <span className="block text-sm text-muted-foreground">Call us</span>
                  <span className="mt-1 block text-2xl font-medium text-primary group-hover:text-accent">{dealerConfig.contact.phone}</span>
                </a>
              )}
              {dealerConfig.contact.email && (
                <a data-testid="link-contact-email" className="group py-4 border-b border-border/40 transition-colors hover:border-primary" href={`mailto:${dealerConfig.contact.email}`}>
                  <span className="block text-sm text-muted-foreground">Email us</span>
                  <span className="mt-1 block text-2xl font-medium text-primary group-hover:text-accent">{dealerConfig.contact.email}</span>
                </a>
              )}
              {dealerConfig.hours && dealerConfig.hours.length > 0 && (
                <div className="py-6">
                  <h3 className="text-sm font-medium text-primary mb-4">Opening hours</h3>
                  <div className="space-y-3">
                    {dealerConfig.hours.map(item => (
                      <div key={`${item.days}-${item.times}`} className="flex justify-between text-base">
                        <span className="text-muted-foreground">{item.days}</span>
                        <span className="font-medium text-primary">{item.times}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
