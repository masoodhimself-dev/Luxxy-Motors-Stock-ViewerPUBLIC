import { RecentlyViewed } from '@/components/recently-viewed';
import { DealershipVisit } from "@/components/dealership-visit";
import { ShowroomPhoto } from "@/components/showroom-photo";
import { DealershipPhotograph } from '@/components/dealership-photograph';
import { dealershipPhotography } from '@/lib/dealership-photography';
import luxxyHeroImage from "@/assets/luxxy-hero.jpg";
import {
  readBrowseSession,
  saveBrowseSession,
  restoreBrowsePosition,
} from "@/lib/browse-session";
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useStock } from '@/lib/stock-context';
import { CarCard } from '@/components/car-card';
import { Filters, type FilterState } from '@/components/filters';
import { cn, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { getContactHref } from '@/lib/cta-helpers';
import { hasExplicitClearHistory, recordedWriteOffCategory } from '@/lib/vehicle-history';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import {
  focusHomeTarget,
  flushPendingHomeTarget,
  scrollToHomeTarget,
  hasPendingHomeTarget,
} from '@/lib/home-navigation';
import { usePageMeta } from '@/hooks/use-page-meta';
import { showroomPageMeta } from '@/lib/page-meta';
import { ArrowRight, Grid2X2, List, Search, ArrowUpRight } from 'lucide-react';
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
  const [showAll, setShowAll] = useState(
    () => readBrowseSession().showAll === true,
  );
  const [stockView, setStockView] = useState<'cards' | 'compact'>(() => {
    try {
      return window.localStorage.getItem(STOCK_VIEW_KEY) === 'compact' ? 'compact' : 'cards';
    } catch {
      return 'cards';
    }
  });

  usePageMeta(showroomPageMeta(dealerConfig, { count: stock?.cars.length ?? null }));

  const [filters, setFilters] = useState<FilterState>(() => {
    const saved = readBrowseSession().filters;
    return saved &&
      Object.keys(defaultFilters).every(
        (key) =>
          typeof saved[key as keyof FilterState] ===
          typeof defaultFilters[key as keyof FilterState],
      )
      ? saved
      : defaultFilters;
  });

  const filteredCars = useMemo(() => {
    if (!stock) return [];

    let result = [...stock.cars];

    const q = filters.search.trim().toLowerCase();
    if (q) {
      const compactRegistration = q.replace(/[\s-]/g, '');
      result = result.filter(
        (c) =>
          (c.title && c.title.toLowerCase().includes(q)) ||
          (c.make && c.make.toLowerCase().includes(q)) ||
          (c.model && c.model.toLowerCase().includes(q)) ||
          [c.plate, c.vrm, c.registration].some((registration) =>
            compactRegistration && registration?.toLowerCase().replace(/[\s-]/g, '').includes(compactRegistration),
          ),
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
        const cat = recordedWriteOffCategory(c.writeOffCategory);
        const isS = cat === 'S';
        const isN = cat === 'N';
        const isClear = hasExplicitClearHistory(c.writeOffCategory);

        if (filters.noWriteOff && isClear) return true;
        if (filters.catS && isS) return true;
        if (filters.catN && isN) return true;

        return false;
      });
    }

    if (filters.sort) {
      result.sort((a, b) => {
        const field = filters.sort.startsWith('price') ? 'price' : 'mileage';
        const first = a[field];
        const second = b[field];
        // Unknown values belong after known values in either direction.
        if (first == null || !Number.isFinite(first)) return second == null || !Number.isFinite(second) ? 0 : 1;
        if (second == null || !Number.isFinite(second)) return -1;
        switch (filters.sort) {
          case 'price-asc':
          case 'mileage-asc':
            return first - second;
          case 'price-desc':
          case 'mileage-desc':
            return second - first;
          default:
            return 0;
        }
      });
    }

    return result;
  }, [stock, filters]);

  const changeFilters = (next: FilterState) => {
    setFilters(next);
    setShowAll(false);
  };
  useEffect(() => {
    saveBrowseSession({ filters, showAll });
  }, [filters, showAll]);

  useEffect(() => {
    if (!isLoading) {
      requestAnimationFrame(() => {
        if (hasPendingHomeTarget()) {
          restoreBrowsePosition(true);
          flushPendingHomeTarget();
        } else restoreBrowsePosition();
      });
    }
  }, [isLoading]);

  const displayedCars = showAll ? filteredCars : filteredCars.slice(0, 3);
  const recentHandovers = recentHandoversQuery.data?.handovers ?? [];
  const stockCount = stock?.count ?? stock?.cars.length ?? 0;

  useEffect(() => {
    try {
      window.localStorage.setItem(STOCK_VIEW_KEY, stockView);
    } catch {
      // Keep the selected view usable when storage is unavailable or full.
    }
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

  // The hero is a dealership introduction; featured stock only orders the stock list.
  const heroFallbackCar = stock?.cars.find((car) => getThumbnailUrl(car));

  const configuredHeroImage = dealerConfig.presentation?.heroImageUrl;
  // Custom homepage photography is independent of featured stock selections.
  const usesLuxxyBrandImage =
    !configuredHeroImage &&
    /^luxxy\s+motors$/i.test(dealerConfig.identity.name.trim());
  const heroImage = configuredHeroImage || (usesLuxxyBrandImage ? luxxyHeroImage : undefined);
  const heroAlt = configuredHeroImage
    ? dealerConfig.presentation?.heroImageAlt || `${dealerConfig.identity.name} showroom`
    : usesLuxxyBrandImage
      ? "Illustrative Luxxy brand image: a dark blue Mercedes-Benz overlooking a lake"
      : vehicleDisplayTitle(heroFallbackCar);

  const heroPhotoSource = heroImage || getThumbnailUrl(heroFallbackCar);
  const introductionPhoto = dealershipPhotography(dealerConfig).introduction;
  const introductionImage = introductionPhoto?.src || heroPhotoSource;

  const dealershipPoints = dealerConfig.whyBuy?.length ? (
    <ul className="divide-y divide-border border-y border-border">
      {(dealerConfig.whyBuy || []).map((item) => (
        <li key={item.title} className="grid gap-1.5 py-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] sm:gap-6">
          <h3 className="text-sm font-semibold leading-relaxed">{item.title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
        </li>
      ))}
    </ul>
  ) : dealerConfig.trustItems?.length ? <ul className="divide-y divide-border">{dealerConfig.trustItems.map(item => <li key={item} className="py-3 text-sm">{item}</li>)}</ul> : null;

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
      <section className="pt-[var(--site-header-height)]" aria-labelledby="home-heading">
        <div className="container mx-auto sm:px-6 sm:pt-6 lg:px-8">
          <div className={cn("showroom-hero", !heroPhotoSource && "showroom-hero-without-photo")}>
            <div className="showroom-hero-copy" data-testid="showroom-hero-copy">
              <p className="text-xs font-medium tracking-wide text-primary-foreground/80">
                {dealerConfig.hero.announcement ||
                  `Used cars ${dealerConfig.address?.city ? `in ${dealerConfig.address.city}` : "from an independent dealership"}`}
              </p>
              <h1 id="home-heading" tabIndex={-1} className="showroom-hero-heading">
                {dealerConfig.hero.copy}
              </h1>
              {dealerConfig.hero.subcopy && <p className="showroom-hero-introduction">
                {dealerConfig.hero.subcopy}
              </p>}
              {dealerConfig.hero.primaryCta && (
                <a href="#stock" className="showroom-hero-button">
                  {dealerConfig.hero.primaryCta} <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </a>
              )}
            </div>
            {heroPhotoSource && (
              <Link href="/#stock" className="showroom-hero-photo" aria-label="Explore our current stock" data-testid="showroom-hero-photo">
                <ShowroomPhoto src={heroPhotoSource} alt={heroAlt} priority fit="cover" className="showroom-hero-image" />
              </Link>
            )}
          </div>
        </div>
      </section>

      <section id="stock" data-home-section className="py-5 md:py-6">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <div>
              <h2 id="vehicle-results-heading" tabIndex={-1} className="section-heading">
                {showAll ? 'All stock' : 'Latest arrivals'}
              </h2>
              {!showAll && stockCount > 3 && <button type="button" onClick={() => { setFilters({ ...defaultFilters }); revealResults('view_all'); }} className="text-link min-h-11 text-sm" data-testid="button-header-all-stock">View all stock <ArrowRight className="h-4 w-4" /></button>}
            </div>
            {stock && (
              <p
                className="col-start-2 row-start-1 text-right text-xs text-muted-foreground sm:text-sm lg:col-start-3"
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
            <div className="col-start-1 row-start-2 flex flex-wrap gap-1 text-xs lg:col-start-2 lg:row-start-1">
              <button
                type="button"
                onClick={() => applyQuickFilter({ transmission: 'Automatic' })}
                className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                data-testid="button-quick-automatic"
                disabled={!stock?.cars.some(car => /automatic/i.test(car.transmission || ""))}
              >
                Automatic
              </button>
              <button
                type="button"
                onClick={() => applyQuickFilter({ maxPrice: '5000' })}
                className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                data-testid="button-quick-under-5000"
                disabled={!stock?.cars.some(car => car.price != null && car.price <= 5000)}
              >
                Under £5k
              </button>
              <button
                type="button"
                onClick={() => applyQuickFilter({ sort: 'mileage-asc' })}
                className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                data-testid="button-quick-low-mileage"
              >
                Low miles
              </button>
              {stock?.cars.some(car => car.price != null && car.price <= 15000) && <button type="button" className="min-h-11 px-2 text-muted-foreground underline underline-offset-4 hover:text-primary" onClick={() => applyQuickFilter({maxPrice:'15000'})}>Under £15k</button>}
            </div>
            <div className="col-start-2 row-start-2 flex justify-end gap-1 lg:col-start-4 lg:row-start-1" aria-label="Vehicle display">
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
          <Filters
            cars={stock?.cars || []}
            filters={filters}
            setFilters={changeFilters}
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

          <div id="vehicle-results" data-home-section className="mt-4">
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
            ) : !stock?.cars.length ? (
              <div className="surface px-6 py-12 text-center" data-testid="empty-stock">
                <h3 className="section-heading">No vehicles currently listed</h3>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">Contact the team about upcoming stock or tell us what you’re looking for.</p>
                <Button asChild className="mt-6"><Link href="/enquire?type=general">Ask about upcoming stock <ArrowRight className="h-4 w-4" /></Link></Button>
              </div>
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
                    <p className="text-xs text-muted-foreground">
                      {handover.handoverMonth}
                    </p>
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

      {(dealerConfig.presentation?.showroomImageUrl || dealerConfig.whyBuy?.length > 0 || dealerConfig.trustItems?.length > 0) && (
        <section
          id="about"
          data-home-section
          aria-labelledby="about-heading"
          className="section-space border-t border-border bg-card"
        >
          <div className={cn("container mx-auto grid gap-6 px-4 sm:px-6 lg:gap-x-12 lg:px-8", introductionImage ? "lg:grid-cols-[1.1fr_1fr]" : "lg:grid-cols-2")}>
            <div className={introductionImage ? "lg:col-start-2" : undefined}>
              <p className="luxxy-kicker mb-3">Why {dealerConfig.identity.name}</p>
              <h2 id="about-heading" tabIndex={-1} className="heading-2">Come and see for yourself.</h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                {dealerConfig.address?.city ? `Visit us in ${dealerConfig.address.city}` : "Visit the showroom"}
                {" to see the car and talk through the details."}
              </p>
            </div>
            {introductionPhoto ? (
              <DealershipPhotograph photo={introductionPhoto} className="lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:self-center" />
            ) : introductionImage && (
              <ShowroomPhoto
                src={introductionImage}
                alt={heroAlt}
                fit="contain"
                className="aspect-[3/2] lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:self-center"
              />
            )}
            <div className={introductionImage ? "lg:col-start-2" : undefined}>
              {dealershipPoints}
              <Link href="/enquire?type=viewing" className="text-link mt-4 min-h-11">
                Arrange a viewing <ArrowRight className="h-4 w-4" />
              </Link>
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
                      href={id === 'warranty' ? '/warranty' : getContactHref(subject)}
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
      <DealershipVisit />
      <RecentlyViewed />
    </div>
  );
}
