import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
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
      <div className="min-h-[70vh] bg-background luxxy-shell" aria-label="Loading showroom" aria-busy="true">
        <div className="container mx-auto grid min-h-[70vh] items-center gap-10 px-4 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="h-4 w-40 animate-pulse bg-primary/20" />
            <div className="h-32 w-full max-w-xl animate-pulse bg-primary/20" />
            <div className="h-6 w-3/4 animate-pulse bg-primary/20" />
            <div className="h-16 w-48 animate-pulse bg-primary/20 border-2 border-primary" />
          </div>
          <div className="h-[320px] animate-pulse bg-primary/10 border-2 border-primary lg:h-[480px] shadow-[8px_8px_0px_hsl(var(--primary))]" />
        </div>
      </div>
    );
  }

  return (
    <div className="luxxy-shell flex min-h-screen flex-col">
      <section className="overflow-hidden border-b border-primary/10 bg-primary text-primary-foreground">
        <div className="container relative mx-auto px-4 pb-7 pt-[calc(var(--site-header-height,4.75rem)+1.15rem)] sm:px-6 sm:pb-10 sm:pt-[calc(var(--site-header-height,4.75rem)+1.75rem)] lg:px-8">
          <div className="relative z-10 max-w-4xl">
            {dealerConfig.hero.announcement && (
              <p className="mb-3 inline-flex items-center rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1.5 font-display text-[11px] font-semibold tracking-[.06em] text-primary-foreground/85">
                {dealerConfig.hero.announcement}
              </p>
            )}
            <h1 id="home-heading" tabIndex={-1} className="heading-1 !text-[2.55rem] text-primary-foreground sm:!text-[clamp(3rem,6vw,5rem)]">
              {dealerConfig.hero.copy}
            </h1>
            <p className="mt-3 max-w-2xl border-l-2 border-accent pl-4 text-[14px] font-medium leading-6 text-primary-foreground/72 sm:mt-5 sm:text-lg sm:leading-relaxed whitespace-pre-wrap">
              {dealerConfig.hero.subcopy}
            </p>
            <div className="mt-5 hidden flex-col gap-3 sm:flex sm:flex-row">
              {dealerConfig.hero.primaryCta && (
                <Button asChild size="lg" className="w-full border-transparent bg-accent text-accent-foreground shadow-none hover:bg-primary-foreground hover:text-primary sm:w-auto">
                  <a href="#stock">{dealerConfig.hero.primaryCta}</a>
                </Button>
              )}
              {dealerConfig.hero.secondaryCta && (
                <Button asChild variant="outline" size="lg" className="w-full border-primary-foreground/25 bg-transparent text-primary-foreground shadow-none hover:bg-primary-foreground/10 hover:text-primary-foreground sm:w-auto">
                  <Link href="/find-my-car">{dealerConfig.hero.secondaryCta}</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Stock */}
      <div id="stock" data-home-section className="bg-background px-0 pb-20 pt-7 md:pt-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
           <div className="mb-3 flex items-end justify-between gap-3 border-b border-primary/15 pb-3 sm:mb-5 sm:gap-4 sm:pb-4">
            <div>
              <h2 id="vehicle-results-heading" tabIndex={-1} className="heading-2 !text-[2rem] text-primary sm:!text-[clamp(2.25rem,5vw,3.5rem)]">
                {showAll ? 'All stock' : 'Latest arrivals'}
              </h2>
            </div>
            {stock && (
             <p className="mb-1 shrink-0 rounded-full border border-primary/10 bg-primary/5 px-2.5 py-1 font-display text-[10px] font-semibold tracking-[.04em] text-primary/70 sm:mb-2 sm:px-3 sm:text-sm" data-testid="text-filtered-stock-count" role="status" aria-live="polite" aria-atomic="true">
                {filteredCars.length === stockCount ? `${filteredCars.length} vehicles available` : `${filteredCars.length} matches`}
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
                  filters.make, filters.model, filters.minPrice || filters.maxPrice,
                  filters.fuel, filters.transmission, filters.search, filters.noWriteOff, filters.catS, filters.catN,
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

           <section className="mt-4 flex flex-col justify-between gap-3 border-b border-primary/10 pb-4 sm:mt-5 sm:gap-4 sm:pb-5 lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-center gap-3">
               <span className="mr-2 hidden font-display text-[12px] font-semibold text-primary/55 sm:inline">Quick filters</span>
               <button type="button" onClick={() => applyQuickFilter({ transmission: 'Automatic' })} className="rounded-full border border-primary/20 bg-card px-3 py-1.5 font-display text-[13px] font-semibold text-primary transition-colors hover:border-accent hover:bg-accent hover:text-accent-foreground" data-testid="button-quick-automatic">
                Automatic
              </button>
               <button type="button" onClick={() => applyQuickFilter({ maxPrice: '5000' })} className="rounded-full border border-primary/20 bg-card px-3 py-1.5 font-display text-[13px] font-semibold text-primary transition-colors hover:border-accent hover:bg-accent hover:text-accent-foreground" data-testid="button-quick-under-5000">
                Under £5k
              </button>
               <button type="button" onClick={() => applyQuickFilter({ sort: 'mileage-asc' })} className="rounded-full border border-primary/20 bg-card px-3 py-1.5 font-display text-[13px] font-semibold text-primary transition-colors hover:border-accent hover:bg-accent hover:text-accent-foreground" data-testid="button-quick-low-mileage">
                Low miles
              </button>
            </div>
             <div className="flex items-center gap-1 rounded-xl border border-primary/10 bg-primary/5 p-1" aria-label="Vehicle display">
              <button
                type="button"
                aria-pressed={stockView === 'cards'}
                onClick={() => {
                  setStockView('cards');
                  trackEvent('stock_view_changed', { view: 'cards' });
                }}
                data-testid="button-stock-view-cards"
                 className={cn('flex items-center gap-2 rounded-lg px-3 py-2 font-display text-[11px] font-semibold transition-colors', stockView === 'cards' ? 'bg-primary text-primary-foreground' : 'text-primary/60 hover:text-primary')}
              >
                <Grid2X2 className="h-4 w-4" /> Grid
              </button>
              <button
                type="button"
                aria-pressed={stockView === 'compact'}
                onClick={() => {
                  setStockView('compact');
                  trackEvent('stock_view_changed', { view: 'compact' });
                }}
                data-testid="button-stock-view-compact"
                 className={cn('flex items-center gap-2 rounded-lg px-3 py-2 font-display text-[11px] font-semibold transition-colors', stockView === 'compact' ? 'bg-primary text-primary-foreground' : 'text-primary/60 hover:text-primary')}
              >
                <List className="h-4 w-4" /> List
              </button>
            </div>
          </section>

          <div id="vehicle-results" data-home-section className="mt-4 sm:mt-12">
            {filteredCars.length > 0 ? (
              <>
                <div className={cn('grid', stockView === 'compact' ? 'gap-6 xl:grid-cols-2' : 'gap-8 sm:grid-cols-2 xl:grid-cols-4')}>
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
                      onClick={() => revealResults('view_all')}
                      size="lg"
                      data-testid="button-view-all-vehicles"
                      className="h-16 font-display text-[15px] font-bold uppercase tracking-[0.15em] bg-primary px-12 text-primary-foreground hover:bg-accent rounded-none shadow-[6px_6px_0px_hsl(var(--primary))] transition-all hover:-translate-y-1 hover:shadow-[8px_8px_0px_hsl(var(--accent))]"
                    >
                      View all {filteredCars.length} vehicles
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="mx-auto max-w-2xl py-24 text-center border-4 border-dashed border-primary/20 bg-primary/5">
                <Search className="mx-auto mb-6 h-12 w-12 text-primary/40" />
                <p className="heading-3 text-primary">No Matches</p>
                <p className="mx-auto mb-10 mt-4 font-bold max-w-md text-primary/70">
                  Try widening your budget or clearing the filters to see the full stock list.
                </p>
                <Button size="lg" onClick={() => { setFilters(defaultFilters); setShowAll(false); }} data-testid="button-clear-filters" className="h-14 px-8 font-display text-[13px] font-bold uppercase tracking-widest rounded-none bg-primary text-primary-foreground shadow-[4px_4px_0px_hsl(var(--primary))] hover:bg-accent hover:shadow-[4px_4px_0px_hsl(var(--accent))] transition-all">
                  Clear Filters
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
          className="bg-primary py-24 border-t-8 border-accent text-primary-foreground relative overflow-hidden"
          aria-labelledby="recent-handovers-heading"
        >
          <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
            <span className="font-display text-[20rem] font-black leading-none">SOLD</span>
          </div>
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="mb-16 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between border-b-2 border-primary-foreground/20 pb-8">
              <div>
                <p className="font-display text-sm font-black uppercase tracking-[0.2em] text-accent mb-4">Recent Deliveries</p>
                <h2 id="recent-handovers-heading" className="heading-2 text-primary-foreground">
                  Recently handed over
                </h2>
              </div>
              <p className="max-w-xs font-bold text-primary-foreground/70 mb-2 uppercase tracking-wide text-sm">
                A few recent deliveries and collections from the showroom.
              </p>
            </div>
            <div className="grid gap-x-12 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
              {recentHandovers.map((handover) => {
                const vehicle = handover.vehicle;
                const vehicleName = [vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ') || 'Vehicle';
                return (
                  <article key={`${vehicleName}-${handover.handoverMonth}`} className="flex flex-col border-l-4 border-accent pl-6 bg-background/5 p-6 hover:bg-background/10 transition-colors" data-testid="recent-handover">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="font-display text-[11px] font-black uppercase tracking-widest bg-accent text-accent-foreground px-2 py-1 shadow-[2px_2px_0px_#000]">{handover.handoverMonth}</span>
                    </div>
                    <h3 className="font-display text-xl font-black uppercase tracking-tight text-primary-foreground">{vehicleName}</h3>
                    <p className="mt-4 font-bold text-sm text-primary-foreground/70 uppercase tracking-widest">
                      {[vehicle.year, vehicle.bodyType, vehicle.fuel, vehicle.transmission].filter(Boolean).join(' • ')}
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
        <section id="about" data-home-section className="bg-background py-24 border-y-4 border-primary">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid gap-16 lg:grid-cols-[.9fr_1.1fr] lg:gap-20">
              <div className="max-w-md">
                <p className="font-display text-sm font-black uppercase tracking-[0.2em] text-accent mb-4">How we work</p>
                <h2 id="about-heading" tabIndex={-1} className="heading-2 text-primary">
                  GOOD CARS.<br/>GOOD SENSE.
                </h2>
                <div className="mt-8 h-2 w-16 bg-accent" />
                <p className="mt-8 text-lg font-bold uppercase tracking-wide leading-relaxed text-primary/80">
                  A used-car showroom should make choosing feel clearer, not louder. That is the standard we bring to every vehicle and every conversation.
                </p>
              </div>
              <div className="grid gap-x-12 gap-y-12 sm:grid-cols-2 mt-4 lg:mt-0">
                {dealerConfig.whyBuy.map((item, idx) => (
                  <article key={idx} className="flex flex-col border-2 border-primary bg-primary/5 p-6 shadow-[4px_4px_0px_hsl(var(--primary))] hover:-translate-y-1 hover:shadow-[6px_6px_0px_hsl(var(--primary))] transition-all">
                    <h3 className="font-display text-lg font-black uppercase tracking-wider text-primary">{item.title}</h3>
                    <p className="mt-4 text-[14px] font-medium leading-relaxed text-primary/80">{item.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Services */}
      <section className="bg-secondary py-24 border-t-8 border-primary">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-16 flex flex-col justify-between gap-8 md:flex-row md:items-end border-b-2 border-primary/20 pb-10">
            <div>
              <p className="font-display text-sm font-black uppercase tracking-[0.2em] text-accent mb-4">Services</p>
              <h2 className="heading-2 text-primary">
                THE USEFUL BITS,<br />HANDLED PROPERLY.
              </h2>
            </div>
            <p className="max-w-sm text-base font-bold uppercase tracking-wide text-primary/80 mb-2">
              From warranty questions to getting the car to your door, ask us plainly and we will give you a plain answer.
            </p>
          </div>
          <div className="grid gap-10 md:grid-cols-3">
            {dealerConfig.warranty?.enabled && (
              <article id="warranty" data-home-section className="flex flex-col border-2 border-primary bg-background p-8 shadow-[4px_4px_0px_hsl(var(--primary))] hover:-translate-y-1 transition-transform">
                <h3 id="warranty-heading" tabIndex={-1} className="font-display text-2xl font-black uppercase tracking-tighter text-primary">{dealerConfig.warranty.title}</h3>
                <p className="mt-6 flex-1 text-sm font-medium leading-relaxed text-primary/80">{dealerConfig.warranty.description}</p>
                <Button asChild size="lg" data-testid="link-warranty-enquiry" className="mt-8 w-full font-display text-[13px] font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-none hover:bg-accent shadow-[3px_3px_0px_rgba(0,0,0,0.1)] whitespace-normal h-auto py-3 text-center">
                  <a href={getContactHref('Warranty Enquiry')}>{dealerConfig.warranty.ctaLabel}<ArrowRight className="ml-2 h-4 w-4 shrink-0" /></a>
                </Button>
              </article>
            )}
            {dealerConfig.partExchange?.enabled && (
              <article id="part-exchange" data-home-section className="flex flex-col border-2 border-primary bg-background p-8 shadow-[4px_4px_0px_hsl(var(--primary))] hover:-translate-y-1 transition-transform">
                <h3 id="part-exchange-heading" tabIndex={-1} className="font-display text-2xl font-black uppercase tracking-tighter text-primary">{dealerConfig.partExchange.title}</h3>
                <p className="mt-6 flex-1 text-sm font-medium leading-relaxed text-primary/80">{dealerConfig.partExchange.description}</p>
                <Button asChild size="lg" data-testid="link-px-enquiry" className="mt-8 w-full font-display text-[13px] font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-none hover:bg-accent shadow-[3px_3px_0px_rgba(0,0,0,0.1)] whitespace-normal h-auto py-3 text-center">
                  <a href={getContactHref('Part Exchange Enquiry')}>{dealerConfig.partExchange.ctaLabel}<ArrowRight className="ml-2 h-4 w-4 shrink-0" /></a>
                </Button>
              </article>
            )}
            {dealerConfig.delivery?.enabled && (
              <article id="delivery" data-home-section className="flex flex-col border-2 border-primary bg-background p-8 shadow-[4px_4px_0px_hsl(var(--primary))] hover:-translate-y-1 transition-transform">
                <h3 id="delivery-heading" tabIndex={-1} className="font-display text-2xl font-black uppercase tracking-tighter text-primary">{dealerConfig.delivery.title}</h3>
                <p className="mt-6 flex-1 text-sm font-medium leading-relaxed text-primary/80">{dealerConfig.delivery.description}</p>
                <Button asChild size="lg" data-testid="link-delivery-enquiry" className="mt-8 w-full font-display text-[13px] font-bold uppercase tracking-widest bg-primary text-primary-foreground rounded-none hover:bg-accent shadow-[3px_3px_0px_rgba(0,0,0,0.1)] whitespace-normal h-auto py-3 text-center">
                  <a href={getContactHref('Delivery Enquiry')}>{dealerConfig.delivery.ctaLabel}<ArrowRight className="ml-2 h-4 w-4 shrink-0" /></a>
                </Button>
              </article>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}