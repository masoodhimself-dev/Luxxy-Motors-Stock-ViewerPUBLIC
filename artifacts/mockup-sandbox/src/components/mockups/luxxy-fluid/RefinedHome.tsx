import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowRight, Grid2X2, List, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from './_shared/button';
import { CarCard } from './_shared/CarCard';
import { Filters, type FilterState } from './_shared/Filters';
import { Chrome } from './_shared/Chrome';
import { MockLink } from './_shared/Link';
import {
  cn,
  dealerConfig,
  focusHomeTarget,
  flushPendingHomeTarget,
  getContactHref,
  scrollToHomeTarget,
  stock,
  trackEvent,
} from './_data';

import './_group.css';

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

export default function RefinedHome() {
  const isLoading = false;
  const recentHandovers: Array<{
    vehicle: {
      make: string | null;
      model: string | null;
      trim: string | null;
      year: number | null;
      bodyType: string | null;
      fuel: string | null;
      transmission: string | null;
    };
    handoverMonth: string;
  }> = [];

  const [showAll, setShowAll] = useState(false);
  const [stockView, setStockView] = useState<'cards' | 'compact'>(() =>
    window.localStorage.getItem(STOCK_VIEW_KEY) === 'compact' ? 'compact' : 'cards',
  );
  const [filters, setFilters] = useState<FilterState>(defaultFilters);

  const filteredCars = useMemo(() => {
    if (!stock) return [];
    let result = [...stock.cars];
    const query = filters.search.trim().toLowerCase();

    if (query) {
      result = result.filter((car) =>
        [car.title, car.make, car.model, car.plate, car.registration]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query)),
      );
    }
    if (filters.make) result = result.filter((car) => car.make === filters.make);
    if (filters.model) result = result.filter((car) => car.model === filters.model);
    if (filters.fuel) result = result.filter((car) => car.fuel === filters.fuel);
    if (filters.transmission) result = result.filter((car) => car.transmission === filters.transmission);

    if (filters.minPrice) {
      const min = Number.parseFloat(filters.minPrice);
      if (!Number.isNaN(min)) result = result.filter((car) => car.price && car.price >= min);
    }
    if (filters.maxPrice) {
      const max = Number.parseFloat(filters.maxPrice);
      if (!Number.isNaN(max)) result = result.filter((car) => car.price && car.price <= max);
    }

    if (filters.noWriteOff || filters.catS || filters.catN) {
      result = result.filter((car) => {
        const category = (car.writeOffCategory || '').toUpperCase();
        const isS = category.includes('S') || category === 'CAT S';
        const isN = category.includes('N') || category === 'CAT N';
        const isClear = !isS && !isN;
        return (filters.noWriteOff && isClear) || (filters.catS && isS) || (filters.catN && isN);
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
  }, [filters]);

  useEffect(() => {
    setShowAll(false);
  }, [filters]);

  useEffect(() => {
    if (!isLoading) requestAnimationFrame(flushPendingHomeTarget);
  }, [isLoading]);

  useEffect(() => {
    window.localStorage.setItem(STOCK_VIEW_KEY, stockView);
  }, [stockView]);

  const stockCount = stock?.count ?? stock?.cars.length ?? 0;
  const displayedCars = showAll ? filteredCars : filteredCars.slice(0, 4);
  const activeFilterCount = [
    filters.make,
    filters.model,
    filters.minPrice,
    filters.maxPrice,
    filters.fuel,
    filters.transmission,
    filters.search,
    filters.noWriteOff,
    filters.catS,
    filters.catN,
  ].filter(Boolean).length;

  const revealResults = (source: 'quick_filter' | 'filter_panel' | 'view_all') => {
    trackEvent('stock_results_opened', { source, result_count: filteredCars.length });
    setShowAll(true);
    requestAnimationFrame(() => {
      if (scrollToHomeTarget('vehicle-results')) focusHomeTarget('vehicle-results-heading');
    });
  };

  const applyQuickFilter = (nextFilters: Partial<FilterState>) => {
    const preset = nextFilters.transmission ? 'automatic' : nextFilters.maxPrice ? 'under_5000' : 'low_mileage';
    trackEvent('showroom_filter_applied', { source: 'quick_filter', preset, filter_count: 1 });
    setFilters({ ...defaultFilters, ...nextFilters });
    revealResults('quick_filter');
  };

  const runFilterSearch = () => {
    trackEvent('showroom_filter_applied', {
      source: 'filter_panel',
      filter_count: activeFilterCount,
      search_used: Boolean(filters.search),
      budget_used: Boolean(filters.minPrice || filters.maxPrice),
      insurance_filter_used: filters.noWriteOff || filters.catS || filters.catN,
      sort: filters.sort || 'recommended',
      result_count: filteredCars.length,
    });
    revealResults('filter_panel');
  };

  if (isLoading) {
    return (
      <div className="luxxy-shell min-h-[70vh] bg-background px-4 py-16" aria-label="Loading showroom" aria-busy="true">
        <div className="container mx-auto grid min-h-[60vh] gap-10 lg:grid-cols-[1.1fr_.9fr]">
          <div className="space-y-5 self-center">
            <div className="h-4 w-44 animate-pulse bg-primary/20" />
            <div className="h-28 w-full max-w-2xl animate-pulse bg-primary/20" />
            <div className="h-6 w-3/4 animate-pulse bg-primary/20" />
          </div>
          <div className="h-[320px] animate-pulse border-2 border-primary bg-primary/10 shadow-[10px_10px_0px_hsl(var(--primary))] lg:h-[440px]" />
        </div>
      </div>
    );
  }

  return (
    <Chrome>
      <div className="luxxy-shell flex min-h-screen flex-col bg-background text-primary">
        <section className="overflow-hidden border-b-4 border-primary bg-background">
          <div className="container relative mx-auto grid gap-10 px-4 pb-10 pt-[calc(var(--site-header-height,5.5rem)+1rem)] sm:px-6 sm:pb-16 sm:pt-[calc(var(--site-header-height,5.5rem)+2rem)] lg:grid-cols-[1.12fr_.88fr] lg:items-center lg:gap-20 lg:px-8 lg:pb-20">
            <div className="relative z-10 max-w-3xl">
              {dealerConfig.hero.announcement && (
                <p className="mb-5 inline-flex items-center border-2 border-primary bg-accent px-3 py-1 font-display text-[11px] font-black uppercase tracking-[0.18em] text-accent-foreground shadow-[3px_3px_0px_hsl(var(--primary))]">
                  {dealerConfig.hero.announcement}
                </p>
              )}
              <p className="mb-4 font-display text-[11px] font-black uppercase tracking-[0.24em] text-primary/55">
                Independent stock / checked before collection
              </p>
              <h1 id="home-heading" tabIndex={-1} className="heading-1 !text-[2.55rem] leading-[.94] text-primary sm:!text-[clamp(3.25rem,6vw,5.8rem)]">
                {dealerConfig.hero.copy}
              </h1>
              <p className="mt-5 max-w-2xl border-l-4 border-accent pl-4 text-[14px] font-bold uppercase leading-6 tracking-wide text-primary/75 sm:mt-7 sm:text-lg sm:leading-relaxed">
                {dealerConfig.hero.subcopy}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {dealerConfig.hero.primaryCta && (
                  <Button asChild size="lg" className="w-full rounded-none bg-primary font-display text-[13px] font-bold uppercase tracking-[.14em] text-primary-foreground shadow-[4px_4px_0px_hsl(var(--accent))] transition-all hover:bg-accent hover:text-accent-foreground hover:shadow-[6px_6px_0px_hsl(var(--primary))] sm:w-auto">
                    <a href="#stock">{dealerConfig.hero.primaryCta}<ArrowDownRight className="ml-2 h-4 w-4" /></a>
                  </Button>
                )}
                {dealerConfig.hero.secondaryCta && (
                  <Button asChild variant="outline" size="lg" className="w-full rounded-none border-2 border-primary font-display text-[13px] font-bold uppercase tracking-[.14em] text-primary shadow-[4px_4px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground sm:w-auto">
                    <MockLink href="/find-my-car">{dealerConfig.hero.secondaryCta}</MockLink>
                  </Button>
                )}
              </div>
            </div>

            <div className="relative min-h-[260px] border-2 border-primary bg-primary p-5 text-primary-foreground shadow-[8px_8px_0px_hsl(var(--accent))] sm:min-h-[330px] lg:min-h-[390px]">
              <div className="absolute right-0 top-0 h-20 w-20 border-b-2 border-l-2 border-accent bg-primary/80" />
              <div className="absolute bottom-0 right-0 h-28 w-28 border-l-2 border-t-2 border-accent/60" />
              <div className="relative flex h-full min-h-[220px] flex-col justify-between sm:min-h-[290px] lg:min-h-[350px]">
                <div className="flex items-start justify-between gap-6">
                  <p className="font-display text-[11px] font-black uppercase tracking-[.2em] text-accent">The floor</p>
                  <span className="font-display text-[11px] font-bold uppercase tracking-widest text-primary-foreground/55">LXM / 01</span>
                </div>
                <div>
                  <p className="font-display text-[clamp(5rem,12vw,9rem)] font-black leading-[.78] tracking-[-.1em] text-primary-foreground">
                    {String(filteredCars.length || stockCount).padStart(2, '0')}
                  </p>
                  <div className="mt-7 flex items-end justify-between border-t border-primary-foreground/25 pt-4">
                    <p className="max-w-[13rem] font-display text-xs font-bold uppercase leading-5 tracking-widest text-primary-foreground/75">
                      cars ready for a closer look
                    </p>
                    <ArrowDownRight className="h-9 w-9 text-accent" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <main id="stock" data-home-section className="bg-background pb-20 pt-10 md:pt-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-5 border-b-4 border-primary pb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8 sm:pb-5">
              <div>
                <p className="mb-2 font-display text-[11px] font-black uppercase tracking-[.22em] text-accent">Browse the floor</p>
                <h2 id="vehicle-results-heading" tabIndex={-1} className="heading-2 !text-[2rem] text-primary sm:!text-[clamp(2.25rem,5vw,3.5rem)]">
                  {showAll ? 'All stock' : 'Latest arrivals'}
                </h2>
              </div>
              {stock && (
                <p className="inline-flex w-fit items-center border border-primary/15 bg-primary/[.04] px-3 py-2 font-display text-[10px] font-bold uppercase tracking-[.16em] text-primary/70 sm:mb-1 sm:text-xs" role="status" aria-live="polite" aria-atomic="true">
                  <span className="mr-2 h-2 w-2 bg-accent" />
                  {filteredCars.length === stockCount ? `${filteredCars.length} vehicles available` : `${filteredCars.length} matches`}
                </p>
              )}
            </div>

            <div className="mt-6 border-y-2 border-primary/10 py-4">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-accent" />
                  <span className="font-display text-xs font-black uppercase tracking-[.16em] text-primary">Find your next car</span>
                </div>
                {activeFilterCount > 0 && (
                  <span className="font-display text-[10px] font-bold uppercase tracking-widest text-primary/55">
                    {activeFilterCount} active {activeFilterCount === 1 ? 'filter' : 'filters'}
                  </span>
                )}
              </div>
              <Filters cars={stock?.cars || []} filters={filters} setFilters={setFilters} onSearch={runFilterSearch} />
            </div>

            <section className="mt-6 flex flex-col justify-between gap-4 border-b-2 border-primary/10 pb-5 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-3">
                <span className="mr-1 hidden font-display text-[11px] font-black uppercase tracking-[.18em] text-primary/50 sm:inline">Try:</span>
                <button type="button" onClick={() => applyQuickFilter({ transmission: 'Automatic' })} className="border-2 border-primary px-3 py-1.5 font-display text-[12px] font-bold uppercase tracking-widest text-primary shadow-[2px_2px_0px_hsl(var(--primary))] transition-colors hover:bg-primary hover:text-primary-foreground active:translate-x-[1px] active:translate-y-[1px] active:shadow-none" data-testid="button-quick-automatic">Automatic</button>
                <button type="button" onClick={() => applyQuickFilter({ maxPrice: '5000' })} className="border-2 border-primary px-3 py-1.5 font-display text-[12px] font-bold uppercase tracking-widest text-primary shadow-[2px_2px_0px_hsl(var(--primary))] transition-colors hover:bg-primary hover:text-primary-foreground active:translate-x-[1px] active:translate-y-[1px] active:shadow-none" data-testid="button-quick-under-5000">Under £5k</button>
                <button type="button" onClick={() => applyQuickFilter({ sort: 'mileage-asc' })} className="border-2 border-primary px-3 py-1.5 font-display text-[12px] font-bold uppercase tracking-widest text-primary shadow-[2px_2px_0px_hsl(var(--primary))] transition-colors hover:bg-primary hover:text-primary-foreground active:translate-x-[1px] active:translate-y-[1px] active:shadow-none" data-testid="button-quick-low-mileage">Low miles</button>
              </div>
              <div className="flex w-fit items-center gap-1 border border-primary/15 bg-primary/[.04] p-1" aria-label="Vehicle display">
                <button type="button" aria-pressed={stockView === 'cards'} onClick={() => { setStockView('cards'); trackEvent('stock_view_changed', { view: 'cards' }); }} data-testid="button-stock-view-cards" className={cn('flex items-center gap-2 px-3 py-2 font-display text-[11px] font-bold uppercase tracking-widest transition-colors', stockView === 'cards' ? 'bg-primary text-primary-foreground' : 'text-primary/55 hover:text-primary')}>
                  <Grid2X2 className="h-4 w-4" /> Grid
                </button>
                <button type="button" aria-pressed={stockView === 'compact'} onClick={() => { setStockView('compact'); trackEvent('stock_view_changed', { view: 'compact' }); }} data-testid="button-stock-view-compact" className={cn('flex items-center gap-2 px-3 py-2 font-display text-[11px] font-bold uppercase tracking-widest transition-colors', stockView === 'compact' ? 'bg-primary text-primary-foreground' : 'text-primary/55 hover:text-primary')}>
                  <List className="h-4 w-4" /> List
                </button>
              </div>
            </section>

            <div id="vehicle-results" data-home-section className="mt-7 sm:mt-10">
              {filteredCars.length > 0 ? (
                <>
                  <div className={cn('grid', stockView === 'compact' ? 'gap-6 xl:grid-cols-2' : 'gap-8 sm:grid-cols-2 xl:grid-cols-4')}>
                    {displayedCars.map((car) => (
                      <CarCard key={car.id} car={car} layout={stockView === 'compact' ? 'compact' : 'card'} stretchedLink />
                    ))}
                  </div>
                  {filteredCars.length > 4 && !showAll && (
                    <div className="mt-12 flex justify-center sm:mt-16">
                      <Button onClick={() => revealResults('view_all')} size="lg" data-testid="button-view-all-vehicles" className="h-14 rounded-none bg-primary px-9 font-display text-[13px] font-bold uppercase tracking-[.15em] text-primary-foreground shadow-[5px_5px_0px_hsl(var(--accent))] transition-all hover:-translate-y-1 hover:bg-accent hover:text-accent-foreground hover:shadow-[7px_7px_0px_hsl(var(--primary))]">
                        View all {filteredCars.length} vehicles <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="mx-auto max-w-2xl border-4 border-dashed border-primary/20 bg-primary/[.035] px-6 py-20 text-center">
                  <Search className="mx-auto mb-5 h-11 w-11 text-accent" />
                  <p className="heading-3 text-primary">No matches yet</p>
                  <p className="mx-auto mb-8 mt-4 max-w-md font-bold leading-relaxed text-primary/65">Try widening your budget or clearing a filter to see the full stock list.</p>
                  <Button size="lg" onClick={() => { setFilters(defaultFilters); setShowAll(false); }} data-testid="button-clear-filters" className="h-13 rounded-none bg-primary px-8 font-display text-[13px] font-bold uppercase tracking-widest text-primary-foreground shadow-[4px_4px_0px_hsl(var(--accent))] hover:bg-accent hover:text-accent-foreground">Clear filters</Button>
                </div>
              )}
            </div>
          </div>
        </main>

        {dealerConfig.recentHandovers.enabled && recentHandovers.length > 0 && (
          <section id="recent-handovers" data-home-section className="relative overflow-hidden border-t-8 border-accent bg-primary py-20 text-primary-foreground sm:py-24" aria-labelledby="recent-handovers-heading">
            <div className="pointer-events-none absolute right-0 top-0 p-8 opacity-[.06]"><span className="font-display text-[15rem] font-black leading-none">SOLD</span></div>
            <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
              <div className="mb-12 flex flex-col gap-5 border-b-2 border-primary-foreground/20 pb-7 sm:mb-16 sm:flex-row sm:items-end sm:justify-between">
                <div><p className="mb-3 font-display text-xs font-black uppercase tracking-[.2em] text-accent">Recent deliveries</p><h2 id="recent-handovers-heading" className="heading-2 text-primary-foreground">Recently handed over</h2></div>
                <p className="mb-1 max-w-xs text-sm font-bold uppercase tracking-wide text-primary-foreground/65">A few recent deliveries and collections from the showroom.</p>
              </div>
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {recentHandovers.map((handover) => {
                  const vehicle = handover.vehicle;
                  const vehicleName = [vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ') || 'Vehicle';
                  return (
                    <article key={`${vehicleName}-${handover.handoverMonth}`} className="border-l-4 border-accent bg-background/[.06] p-6 transition-colors hover:bg-background/10" data-testid="recent-handover">
                      <span className="bg-accent px-2 py-1 font-display text-[10px] font-black uppercase tracking-widest text-accent-foreground">{handover.handoverMonth}</span>
                      <h3 className="mt-5 font-display text-xl font-black uppercase tracking-tight text-primary-foreground">{vehicleName}</h3>
                      <p className="mt-3 text-sm font-bold uppercase tracking-widest text-primary-foreground/65">{[vehicle.year, vehicle.bodyType, vehicle.fuel, vehicle.transmission].filter(Boolean).join(' • ')}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {dealerConfig.whyBuy && dealerConfig.whyBuy.length > 0 && (
          <section id="about" data-home-section className="border-y-4 border-primary bg-background py-20 sm:py-24">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
              <div className="grid gap-12 lg:grid-cols-[.82fr_1.18fr] lg:gap-20">
                <div className="max-w-md">
                  <p className="mb-3 font-display text-xs font-black uppercase tracking-[.2em] text-accent">How we work</p>
                  <h2 id="about-heading" tabIndex={-1} className="heading-2 text-primary">GOOD CARS.<br />GOOD SENSE.</h2>
                  <div className="mt-7 h-2 w-16 bg-accent" />
                  <p className="mt-7 text-base font-bold uppercase leading-relaxed tracking-wide text-primary/75 sm:text-lg">A used-car showroom should make choosing feel clearer, not louder. That is the standard we bring to every vehicle and every conversation.</p>
                </div>
                <div className="grid gap-8 sm:grid-cols-2">
                  {dealerConfig.whyBuy.map((item, index) => (
                    <article key={index} className="border-2 border-primary bg-primary/[.035] p-6 shadow-[4px_4px_0px_hsl(var(--primary))] transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0px_hsl(var(--accent))]">
                      <span className="font-display text-[11px] font-black uppercase tracking-widest text-accent">0{index + 1}</span>
                      <h3 className="mt-5 font-display text-lg font-black uppercase tracking-wider text-primary">{item.title}</h3>
                      <p className="mt-3 text-[14px] font-medium leading-relaxed text-primary/75">{item.description}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="border-t-8 border-primary bg-secondary py-20 sm:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-12 flex flex-col justify-between gap-6 border-b-2 border-primary/20 pb-8 md:flex-row md:items-end sm:mb-16 sm:pb-10">
              <div><p className="mb-3 font-display text-xs font-black uppercase tracking-[.2em] text-accent">Services</p><h2 className="heading-2 text-primary">THE USEFUL BITS,<br />HANDLED PROPERLY.</h2></div>
              <p className="mb-1 max-w-sm text-sm font-bold uppercase leading-relaxed tracking-wide text-primary/75">From warranty questions to getting the car to your door, ask us plainly and we will give you a plain answer.</p>
            </div>
            <div className="grid gap-8 md:grid-cols-3">
              {dealerConfig.warranty?.enabled && (
                <article id="warranty" data-home-section className="flex flex-col border-2 border-primary bg-background p-7 shadow-[4px_4px_0px_hsl(var(--primary))] transition-transform hover:-translate-y-1 sm:p-8">
                  <h3 id="warranty-heading" tabIndex={-1} className="font-display text-2xl font-black uppercase tracking-tighter text-primary">{dealerConfig.warranty.title}</h3>
                  <p className="mt-5 flex-1 text-sm font-medium leading-relaxed text-primary/75">{dealerConfig.warranty.description}</p>
                  <Button asChild size="lg" data-testid="link-warranty-enquiry" className="mt-7 h-auto w-full rounded-none bg-primary py-3 font-display text-[13px] font-bold uppercase tracking-widest text-primary-foreground hover:bg-accent hover:text-accent-foreground"><a href={getContactHref('Warranty Enquiry')} onClick={(event) => event.preventDefault()}>{dealerConfig.warranty.ctaLabel}<ArrowRight className="ml-2 h-4 w-4" /></a></Button>
                </article>
              )}
              {dealerConfig.partExchange?.enabled && (
                <article id="part-exchange" data-home-section className="flex flex-col border-2 border-primary bg-background p-7 shadow-[4px_4px_0px_hsl(var(--primary))] transition-transform hover:-translate-y-1 sm:p-8">
                  <h3 id="part-exchange-heading" tabIndex={-1} className="font-display text-2xl font-black uppercase tracking-tighter text-primary">{dealerConfig.partExchange.title}</h3>
                  <p className="mt-5 flex-1 text-sm font-medium leading-relaxed text-primary/75">{dealerConfig.partExchange.description}</p>
                  <Button asChild size="lg" data-testid="link-px-enquiry" className="mt-7 h-auto w-full rounded-none bg-primary py-3 font-display text-[13px] font-bold uppercase tracking-widest text-primary-foreground hover:bg-accent hover:text-accent-foreground"><a href={getContactHref('Part Exchange Enquiry')} onClick={(event) => event.preventDefault()}>{dealerConfig.partExchange.ctaLabel}<ArrowRight className="ml-2 h-4 w-4" /></a></Button>
                </article>
              )}
              {dealerConfig.delivery?.enabled && (
                <article id="delivery" data-home-section className="flex flex-col border-2 border-primary bg-background p-7 shadow-[4px_4px_0px_hsl(var(--primary))] transition-transform hover:-translate-y-1 sm:p-8">
                  <h3 id="delivery-heading" tabIndex={-1} className="font-display text-2xl font-black uppercase tracking-tighter text-primary">{dealerConfig.delivery.title}</h3>
                  <p className="mt-5 flex-1 text-sm font-medium leading-relaxed text-primary/75">{dealerConfig.delivery.description}</p>
                  <Button asChild size="lg" data-testid="link-delivery-enquiry" className="mt-7 h-auto w-full rounded-none bg-primary py-3 font-display text-[13px] font-bold uppercase tracking-widest text-primary-foreground hover:bg-accent hover:text-accent-foreground"><a href={getContactHref('Delivery Enquiry')} onClick={(event) => event.preventDefault()}>{dealerConfig.delivery.ctaLabel}<ArrowRight className="ml-2 h-4 w-4" /></a></Button>
                </article>
              )}
            </div>
          </div>
        </section>
      </div>
    </Chrome>
  );
}