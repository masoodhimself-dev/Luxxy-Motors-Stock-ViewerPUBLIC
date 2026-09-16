import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useStock } from '@/lib/stock-context';
import { CarCard } from '@/components/car-card';
import { Filters, type FilterState } from '@/components/filters';
import { cn, getThumbnailUrl, vehicleDisplayTitle, formatPrice } from '@/lib/utils';
import { getContactHref } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { focusHomeTarget, flushPendingHomeTarget, scrollToHomeTarget } from '@/lib/home-navigation';
import { usePageMeta } from '@/hooks/use-page-meta';
import { showroomPageMeta } from '@/lib/page-meta';
import { ArrowRight, Grid2X2, List, Search, Check, ArrowUpRight, MapPin } from 'lucide-react';
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
  const { stock, isLoading, error } = useStock();
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

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (c) =>
          (c.title && c.title.toLowerCase().includes(q)) ||
          (c.make && c.make.toLowerCase().includes(q)) ||
          (c.model && c.model.toLowerCase().includes(q)) ||
          (c.plate && c.plate.toLowerCase().includes(q)) ||
          (c.registration && c.registration.toLowerCase().includes(q)),
      );
    }

    if (filters.make) result = result.filter((c) => c.make === filters.make);
    if (filters.model) result = result.filter((c) => c.model === filters.model);
    if (filters.fuel) result = result.filter((c) => c.fuel === filters.fuel);
    if (filters.transmission)
      result = result.filter((c) => c.transmission === filters.transmission);

    if (filters.minPrice) {
      const min = parseFloat(filters.minPrice);
      if (!isNaN(min)) result = result.filter((c) => c.price && c.price >= min);
    }
    if (filters.maxPrice) {
      const max = parseFloat(filters.maxPrice);
      if (!isNaN(max)) result = result.filter((c) => c.price && c.price <= max);
    }

    if (filters.noWriteOff || filters.catS || filters.catN) {
      result = result.filter((c) => {
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
          case 'price-asc':
            return (a.price || 0) - (b.price || 0);
          case 'price-desc':
            return (b.price || 0) - (a.price || 0);
          case 'mileage-asc':
            return (a.mileage || 0) - (b.mileage || 0);
          case 'mileage-desc':
            return (b.mileage || 0) - (a.mileage || 0);
          default:
            return 0;
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

  const displayedCars = showAll ? filteredCars : filteredCars.slice(0, 3);
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
    const preset = nextFilters.transmission
      ? 'automatic'
      : nextFilters.maxPrice
        ? 'under_5000'
        : 'low_mileage';
    trackEvent('showroom_filter_applied', {
      source: 'quick_filter',
      preset,
      filter_count: 1,
    });
    setFilters({ ...defaultFilters, ...nextFilters });
    revealResults('quick_filter');
  };

  const featuredCar =
    dealerConfig.featuredVehicleIds
      ?.map((id) => stock?.cars.find((car) => car.id === id))
      .find((car) => car && getThumbnailUrl(car)) ??
    stock?.cars.find((car) => getThumbnailUrl(car));

  if (isLoading)
    return (
      <div
        className="container mx-auto px-4 pb-16 pt-32"
        aria-label="Loading showroom"
        aria-busy="true"
      >
        <div className="h-64 animate-pulse rounded-md bg-muted" />
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-72 animate-pulse bg-muted" />
          ))}
        </div>
      </div>
    );

  return (
    <div className="luxxy-shell min-h-screen">
      <section className="border-b border-border bg-secondary/40 pt-[var(--site-header-height)]">
        <div className="container mx-auto grid items-stretch lg:grid-cols-2">
          <div className="flex flex-col justify-center px-4 py-7 sm:px-6 sm:py-10 lg:py-8 lg:pl-8 lg:pr-12">
            <p className="luxxy-kicker mb-3">
              {dealerConfig.hero.announcement ||
                `Independent car dealership · ${dealerConfig.address?.city || 'UK'}`}
            </p>
            <h1 id="home-heading" tabIndex={-1} className="heading-1 max-w-xl text-primary">
              {dealerConfig.hero.copy}
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base whitespace-pre-wrap">
              {dealerConfig.hero.subcopy}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {dealerConfig.hero.primaryCta && (
                <Button asChild>
                  <a href="#stock">
                    {dealerConfig.hero.primaryCta}
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
              )}
              {dealerConfig.hero.secondaryCta && (
                <Link href="/find-my-car" className="text-link px-2">
                  {dealerConfig.hero.secondaryCta}
                </Link>
              )}
            </div>
          </div>
          {featuredCar && (
            <Link
              href={`/vehicle/${featuredCar.id}`}
              className="group relative hidden h-[320px] overflow-hidden bg-muted lg:block"
              aria-label={`Explore ${vehicleDisplayTitle(featuredCar)}`}
            >
              <img
                src={getThumbnailUrl(featuredCar)}
                alt={vehicleDisplayTitle(featuredCar)}
                className="h-full w-full object-cover"
                fetchPriority="high"
              />
              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-4 bg-primary/95 px-6 py-4 text-primary-foreground">
                <div>
                  <span className="text-[11px] tracking-wide text-primary-foreground/75">
                    In the showroom
                  </span>
                  <p className="mt-1 text-sm font-medium">
                    {vehicleDisplayTitle(featuredCar)}
                    {featuredCar.price
                      ? ` · ${formatPrice(featuredCar.price, featuredCar.currency)}`
                      : ''}
                  </p>
                </div>
                <ArrowUpRight className="h-5 w-5 shrink-0" />
              </div>
            </Link>
          )}
        </div>
      </section>

      {dealerConfig.trustItems?.length > 0 && (
        <div className="hidden border-b border-border bg-card sm:block">
          <ul className="container mx-auto flex flex-wrap justify-between gap-x-6 gap-y-2 px-6 py-4 lg:px-8">
            {dealerConfig.trustItems.map((item) => (
              <li key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                <Check className="h-4 w-4 text-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section id="stock" data-home-section className="py-8 md:py-10">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="luxxy-kicker mb-2">Our collection</p>
              <h2 id="vehicle-results-heading" tabIndex={-1} className="section-heading">
                {showAll ? 'All stock' : 'Latest arrivals'}
              </h2>
            </div>
            {stock && (
              <p
                className="text-xs text-muted-foreground sm:text-sm"
                data-testid="text-filtered-stock-count"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {filteredCars.length === stockCount
                  ? `${filteredCars.length} vehicles available`
                  : `${filteredCars.length} matches`}
              </p>
            )}
          </div>
          <Filters
            cars={stock?.cars || []}
            filters={filters}
            setFilters={setFilters}
            vehicleCount={stockCount}
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
          />
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex flex-wrap gap-1 text-xs">
              <button
                type="button"
                onClick={() => applyQuickFilter({ transmission: 'Automatic' })}
                className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary"
                data-testid="button-quick-automatic"
              >
                Automatic
              </button>
              <button
                type="button"
                onClick={() => applyQuickFilter({ maxPrice: '5000' })}
                className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary"
                data-testid="button-quick-under-5000"
              >
                Under £5k
              </button>
              <button
                type="button"
                onClick={() => applyQuickFilter({ sort: 'mileage-asc' })}
                className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary"
                data-testid="button-quick-low-mileage"
              >
                Low miles
              </button>
            </div>
            <div className="flex gap-1" aria-label="Vehicle display">
              {(['cards', 'compact'] as const).map((view) => {
                const Icon = view === 'cards' ? Grid2X2 : List;
                return (
                  <button
                    key={view}
                    type="button"
                    aria-label={view === 'cards' ? 'Grid' : 'List'}
                    aria-pressed={stockView === view}
                    data-testid={`button-stock-view-${view}`}
                    onClick={() => {
                      setStockView(view);
                      trackEvent('stock_view_changed', { view });
                    }}
                    className={cn(
                      'grid h-11 w-11 place-items-center rounded-md border',
                      stockView === view
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:bg-secondary',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
          <div id="vehicle-results" data-home-section>
            {error ? (
              <div className="surface p-8" role="alert">
                <h3 className="section-heading">Stock is temporarily unavailable</h3>
                <p className="mt-3 text-muted-foreground">
                  Please try again or contact the showroom for current availability.
                </p>
                <Button className="mt-5" onClick={() => window.location.reload()}>
                  Try again
                </Button>
              </div>
            ) : filteredCars.length ? (
              <>
                <div
                  className={cn(
                    'grid gap-5',
                    stockView === 'compact' ? 'xl:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3',
                  )}
                >
                  {displayedCars.map((car) => (
                    <CarCard
                      key={car.id}
                      car={car}
                      layout={stockView === 'compact' ? 'compact' : 'card'}
                      stretchedLink
                    />
                  ))}
                </div>
                {filteredCars.length > 3 && !showAll && (
                  <div className="mt-8 text-center">
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => revealResults('view_all')}
                      data-testid="button-view-all-vehicles"
                    >
                      View all {filteredCars.length} vehicles
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="surface px-6 py-12 text-center">
                <Search className="mx-auto h-7 w-7 text-muted-foreground" />
                <h3 className="section-heading mt-4">No matches</h3>
                <p className="mt-3 text-sm text-muted-foreground">
                  Try widening your budget or clearing the filters.
                </p>
                <Button
                  variant="outline"
                  className="mt-6"
                  onClick={() => {
                    setFilters(defaultFilters);
                    setShowAll(false);
                  }}
                  data-testid="button-clear-filters"
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      {dealerConfig.recentHandovers.enabled && recentHandovers.length > 0 && (
        <section
          id="recent-handovers"
          data-home-section
          data-testid="recent-handovers-section"
          className="section-space border-y border-border bg-card"
          aria-labelledby="recent-handovers-heading"
        >
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <p className="luxxy-kicker mb-3">From our showroom</p>
            <h2 id="recent-handovers-heading" className="section-heading">
              Recently handed over
            </h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              {recentHandovers.map((handover) => {
                const v = handover.vehicle;
                const name = [v.make, v.model, v.trim].filter(Boolean).join(' ') || 'Vehicle';
                return (
                  <article
                    key={`${name}-${handover.handoverMonth}`}
                    data-testid="recent-handover"
                    className="border-t border-border pt-4"
                  >
                    <p className="text-xs text-muted-foreground">{handover.handoverMonth}</p>
                    <h3 className="mt-2 font-semibold">{name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {[v.year, v.bodyType, v.fuel, v.transmission].filter(Boolean).join(' · ')}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {dealerConfig.whyBuy && dealerConfig.whyBuy.length > 0 && (
        <section
          id="about"
          data-home-section
          className="section-space border-t border-border bg-card"
        >
          <div className="container mx-auto grid gap-8 px-4 sm:px-6 lg:grid-cols-[.85fr_1.15fr] lg:gap-20 lg:px-8">
            <div>
              <p className="luxxy-kicker mb-3">Why Luxxy Motors</p>
              <h2 id="about-heading" tabIndex={-1} className="heading-2">
                A more considered way
                <br className="hidden sm:block" /> to buy your next car.
              </h2>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
                Clear details, straightforward conversations and time to make the right decision.
                Visit our {dealerConfig.address?.city || 'UK'} showroom and get to know the car
                before you choose.
              </p>
              <Link href="/enquire?type=viewing" className="text-link mt-4">
                Arrange a visit
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {dealerConfig.whyBuy.map((item, index) => (
                <article key={item.title} className="border-t border-border pt-4">
                  <p className="text-xs tabular-nums text-accent">0{index + 1}</p>
                  <h3 className="mt-3 font-display text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section-space border-t border-border bg-secondary/40">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <p className="luxxy-kicker mb-3">Along the way</p>
          <h2 className="section-heading">The details, taken care of.</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {(
              [
                ['warranty', dealerConfig.warranty, 'Warranty Enquiry', 'link-warranty-enquiry'],
                [
                  'part-exchange',
                  dealerConfig.partExchange,
                  'Part Exchange Enquiry',
                  'link-px-enquiry',
                ],
                ['delivery', dealerConfig.delivery, 'Delivery Enquiry', 'link-delivery-enquiry'],
              ] as const
            ).map(
              ([id, service, subject, testid]) =>
                service?.enabled && (
                  <article
                    key={id}
                    id={id}
                    data-home-section
                    className="flex flex-col border-t border-border pt-5"
                  >
                    <h3
                      id={`${id}-heading`}
                      tabIndex={-1}
                      className="font-display text-xl font-semibold leading-snug"
                    >
                      {service.title}
                    </h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {service.description}
                    </p>
                    <a
                      className="text-link mt-4"
                      href={getContactHref(subject)}
                      data-testid={testid}
                    >
                      {service.ctaLabel}
                      <ArrowUpRight className="h-4 w-4" />
                    </a>
                  </article>
                ),
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
