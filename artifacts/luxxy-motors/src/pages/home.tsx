import { useEffect, useMemo, useState } from 'react';
import { useStock } from '@/lib/stock-context';
import { CarCard } from '@/components/car-card';
import { Filters, type FilterState } from '@/components/filters';
import { getThumbnailUrl } from '@/lib/utils';
import { getContactHref } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { flushPendingHomeTarget, scrollToHomeTarget } from '@/lib/home-navigation';
import { ArrowRight, Banknote, Car, CheckCircle2, Clock, Gauge, Mail, MapPin, MessageCircle, Phone, Search, Settings2, ShieldCheck, Truck, RefreshCcw, Calendar, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

export default function Home() {
  const { stock, isLoading } = useStock();
  const { settings: dealerConfig } = useDealerSettings();
  const [showAll, setShowAll] = useState(false);

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

  // Pick a nice hero car with an image
  const heroCar = stock?.cars?.find(c => Boolean(getThumbnailUrl(c)));
  const heroImage = heroCar ? getThumbnailUrl(heroCar) : null;
  const locationLabel = [dealerConfig.address?.city, dealerConfig.address?.region].filter(Boolean).join(', ');
  const makes = useMemo(
    () => Array.from(new Set((stock?.cars || []).map(car => car.make).filter(Boolean) as string[])).sort(),
    [stock?.cars],
  );
  const revealResults = () => {
    setShowAll(true);
    requestAnimationFrame(() => scrollToHomeTarget('vehicle-results'));
  };

  const applyQuickFilter = (nextFilters: Partial<FilterState>) => {
    setFilters({ ...defaultFilters, ...nextFilters });
    revealResults();
  };

  if (isLoading) {
    return (
      <div className="min-h-[70vh] bg-background" aria-label="Loading showroom" aria-busy="true">
        <div className="container mx-auto grid min-h-[70vh] items-center gap-10 px-4 md:grid-cols-2">
          <div className="space-y-5">
            <div className="h-3 w-40 animate-pulse bg-secondary" />
            <div className="h-24 w-full max-w-xl animate-pulse bg-secondary" />
            <div className="h-5 w-3/4 animate-pulse bg-secondary" />
            <div className="h-14 w-44 animate-pulse bg-secondary" />
          </div>
          <div className="h-[360px] animate-pulse bg-secondary md:h-[520px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="luxxy-shell luxxy-grain flex min-h-screen flex-col overflow-hidden">
      <section className="relative isolate overflow-hidden bg-primary text-primary-foreground">
        <div className="container relative mx-auto grid min-h-[720px] items-end gap-10 px-4 pb-10 pt-12 sm:px-6 md:min-h-[700px] md:grid-cols-[minmax(0,.9fr)_minmax(360px,1.1fr)] md:items-center md:gap-0 md:pb-24 md:pt-20 lg:px-8">
          <div className="relative z-10 max-w-2xl md:pr-8">
            <div className="luxxy-reveal luxxy-kicker mb-7 text-accent">
              {dealerConfig.hero.announcement || 'Independent cars, carefully chosen'}
            </div>
            <h1 className="luxxy-reveal luxxy-reveal-1 max-w-2xl font-display text-[clamp(3.5rem,9vw,7.7rem)] leading-[.86] tracking-[-.055em] text-primary-foreground">
              {dealerConfig.hero.copy}
            </h1>
            <p className="luxxy-reveal luxxy-reveal-2 mt-7 max-w-lg text-base leading-7 text-primary-foreground/75 sm:text-lg md:mt-9">
              {dealerConfig.hero.subcopy}
            </p>
            <div className="luxxy-reveal luxxy-reveal-3 mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button type="button" size="lg" onClick={revealResults} data-testid="button-hero-primary" className="h-14 justify-between bg-accent px-5 text-base font-extrabold text-accent-foreground shadow-xl shadow-black/20 hover:-translate-y-0.5 hover:bg-accent/90 sm:min-w-48">
                {dealerConfig.hero.primaryCta}
                <ArrowRight className="ml-5 h-5 w-5" />
              </Button>
              {dealerConfig.partExchange?.enabled && (
                <Button size="lg" variant="outline" asChild data-testid="link-hero-part-exchange" className="h-14 justify-between border-primary-foreground/25 bg-primary-foreground/5 px-5 text-base font-extrabold text-primary-foreground backdrop-blur-sm hover:bg-primary-foreground hover:text-primary sm:min-w-60">
                  <a href={getContactHref('Part Exchange Enquiry')}>
                    {dealerConfig.hero.secondaryCta}
                    <RefreshCcw className="ml-5 h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
            <div className="luxxy-reveal luxxy-reveal-4 mt-8 border border-primary-foreground/15 bg-primary-foreground/[.07] p-3 backdrop-blur-md sm:p-4" data-testid="hero-search">
              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-primary-foreground/70">Search the showroom</p>
                {stock && (
                  <span className="shrink-0 font-mono text-[10px] text-accent" data-testid="text-hero-stock-count">
                    {stock.count ?? stock.cars.length} vehicles available
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
                  <Input
                    aria-label="Search showroom stock"
                    placeholder="Make, model or registration"
                    value={filters.search}
                    onChange={(event) => setFilters(current => ({ ...current, search: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        revealResults();
                      }
                    }}
                    className="h-12 rounded-none border-primary-foreground/15 bg-primary-foreground/10 pl-10 text-sm font-semibold text-primary-foreground shadow-none placeholder:text-primary-foreground/45 focus-visible:border-accent focus-visible:ring-accent/30"
                    data-testid="input-hero-search"
                  />
                </div>
                <select
                  aria-label="Filter by make"
                  value={filters.make}
                  onChange={(event) => setFilters(current => ({ ...current, make: event.target.value, model: '' }))}
                  className="h-12 rounded-none border border-primary-foreground/15 bg-primary-foreground/10 px-3 text-sm font-bold text-primary-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:w-36"
                  data-testid="select-hero-make"
                >
                  <option value="" className="text-foreground">Any make</option>
                  {makes.map(make => <option key={make} value={make} className="text-foreground">{make}</option>)}
                </select>
                <Button type="button" onClick={revealResults} size="lg" data-testid="button-hero-search" className="h-12 rounded-none bg-accent px-5 font-extrabold text-accent-foreground hover:bg-accent/90">
                  Search <ArrowRight className="ml-3 h-4 w-4" />
                </Button>
              </div>
              <p className="mt-2 px-1 text-[10px] text-primary-foreground/50">Try a make, model or registration.</p>
            </div>
          </div>

          <div className="relative z-0 -mx-4 h-[310px] overflow-hidden sm:-mx-6 sm:h-[390px] md:mx-0 md:h-[580px]">
            {heroImage ? (
              <img
                src={heroImage}
                alt={heroCar?.title || `${heroCar?.make || ''} ${heroCar?.model || ''}`.trim() || `${dealerConfig.identity.name} vehicle`}
                fetchPriority="high"
                loading="eager"
                className="luxxy-hero-image absolute inset-0 h-full w-full object-cover object-center md:rounded-[2rem] md:rounded-bl-[7rem]"
              />
            ) : (
              <div className="absolute inset-0 bg-secondary/20 md:rounded-[2rem] md:rounded-bl-[7rem]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/15 to-transparent md:rounded-[2rem] md:bg-gradient-to-r md:from-primary/30 md:via-transparent md:to-transparent" />
            <div className="absolute bottom-5 left-5 flex items-center gap-3 rounded-full border border-primary-foreground/20 bg-primary/70 px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-primary-foreground backdrop-blur-md md:bottom-7 md:left-7">
              <span className="h-2 w-2 rounded-full bg-accent" />
              {locationLabel || 'Harrow, London'}
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-primary-foreground/15 bg-primary/90 backdrop-blur-md">
          <div className="container mx-auto grid grid-cols-2 divide-x divide-primary-foreground/15 sm:grid-cols-4">
            {[
              ['01', 'Clear pricing'],
              ['02', 'Genuine stock'],
              ['03', 'Real people'],
              ['04', 'No hard sell'],
            ].map(([number, label]) => (
              <div key={number} className="flex items-center gap-3 px-4 py-4 sm:px-5 md:py-5">
                <span className="font-mono text-[10px] text-accent">{number}</span>
                <span className="text-[10px] font-bold uppercase tracking-[.12em] text-primary-foreground/75 sm:text-xs">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-20 -mt-1 bg-background py-8 md:py-12" aria-label={`${dealerConfig.identity.name} benefits`}>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {dealerConfig.trustItems.map((item, index) => (
              <div key={item} className="flex items-start gap-4 border-b border-border pb-5 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-5 last:border-0">
                <span className="font-display text-3xl leading-none text-accent">0{index + 1}</span>
                <div>
                  <CheckCircle2 className="mb-2 h-4 w-4 text-primary" />
                  <p className="text-xs font-extrabold uppercase leading-5 tracking-[.1em] text-foreground">{item}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-secondary/40 py-8" aria-labelledby="quick-search-heading">
        <div className="container mx-auto flex flex-col gap-5 px-4 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <p className="luxxy-kicker text-primary">Start somewhere</p>
            <h2 id="quick-search-heading" className="mt-2 font-display text-3xl leading-none tracking-[-.03em] text-primary">Your kind of car?</h2>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button type="button" onClick={() => applyQuickFilter({ transmission: 'Automatic' })} className="group inline-flex items-center justify-center gap-2 border border-border bg-background px-4 py-3 text-xs font-extrabold text-foreground transition hover:border-primary hover:bg-primary hover:text-primary-foreground" data-testid="button-quick-automatic">
              <Settings2 className="h-4 w-4 text-accent group-hover:text-accent" /> Automatic
            </button>
            <button type="button" onClick={() => applyQuickFilter({ maxPrice: '5000' })} className="group inline-flex items-center justify-center gap-2 border border-border bg-background px-4 py-3 text-xs font-extrabold text-foreground transition hover:border-primary hover:bg-primary hover:text-primary-foreground" data-testid="button-quick-under-5000">
              <Banknote className="h-4 w-4 text-accent" /> Under £5,000
            </button>
            <button type="button" onClick={() => applyQuickFilter({ sort: 'mileage-asc' })} className="group col-span-2 inline-flex items-center justify-center gap-2 border border-border bg-background px-4 py-3 text-xs font-extrabold text-foreground transition hover:border-primary hover:bg-primary hover:text-primary-foreground sm:col-span-1" data-testid="button-quick-low-mileage">
              <Gauge className="h-4 w-4 text-accent" /> Low mileage
            </button>
          </div>
        </div>
      </section>

      <div id="stock" data-home-section className="bg-muted/35 px-0 pb-2 pt-10 md:pt-16">
        <Filters
          cars={stock?.cars || []}
          filters={filters}
          setFilters={setFilters}
          onSearch={() => {
            setShowAll(true);
            requestAnimationFrame(() => scrollToHomeTarget('vehicle-results'));
          }}
          vehicleCount={stock?.count ?? stock?.cars.length ?? 0}
        />
      </div>

      <section id="vehicle-results" data-home-section className="bg-muted/35 pb-24 pt-10 md:pt-14">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-9 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="luxxy-kicker text-primary">The current edit</p>
              <h2 className="mt-3 font-display text-5xl leading-none tracking-[-.04em] text-primary md:text-6xl">{showAll ? 'All vehicles' : 'Fresh to the forecourt'}</h2>
              {!showAll && <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Browse the latest vehicles in the showroom, with the details and pricing up front.</p>}
            </div>
            {stock && (
              <div className="flex items-center gap-3 text-sm font-extrabold text-primary" data-testid="text-filtered-stock-count">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-accent"><CarCardIcon className="h-4 w-4" /></span>
                {filteredCars.length} {filteredCars.length === 1 ? 'vehicle' : 'vehicles'} available
              </div>
            )}
          </div>

          {filteredCars.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
                {displayedCars.map(car => <CarCard key={car.id} car={car} />)}
              </div>
              {filteredCars.length > 4 && !showAll && (
                <div className="mt-14 flex justify-center">
                  <Button onClick={() => { setShowAll(true); requestAnimationFrame(() => scrollToHomeTarget('vehicle-results')); }} size="lg" data-testid="button-view-all-vehicles" className="group h-14 rounded-none bg-primary px-8 font-extrabold shadow-lg shadow-primary/15 hover:-translate-y-0.5 hover:bg-primary/90">
                    View all {filteredCars.length} vehicles <ArrowRight className="ml-5 h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="luxxy-surface mx-auto max-w-2xl border border-dashed border-border bg-card px-6 py-20 text-center">
              <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full bg-secondary"><Search className="h-7 w-7 text-primary" /></div>
              <h3 className="font-display text-4xl tracking-[-.03em] text-primary">Nothing in that corner of the showroom</h3>
              <p className="mx-auto mb-8 mt-3 max-w-md text-base leading-6 text-muted-foreground">Try adjusting your filters or clearing your search query.</p>
              <Button size="lg" onClick={() => { setFilters(defaultFilters); setShowAll(false); }} data-testid="button-clear-filters" className="h-12 rounded-none px-7 font-extrabold">Clear all filters</Button>
            </div>
          )}
        </div>
      </section>

      {dealerConfig.whyBuy && dealerConfig.whyBuy.length > 0 && (
        <section id="about" data-home-section className="bg-background py-24 md:py-32">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:gap-20">
              <div className="max-w-md">
                <p className="luxxy-kicker text-primary">The Luxxy way</p>
                <h2 className="mt-5 font-display text-6xl leading-[.9] tracking-[-.05em] text-primary md:text-7xl">Good cars.<br /><em>Good sense.</em></h2>
                <p className="mt-7 text-base leading-7 text-muted-foreground">A used-car showroom should make choosing feel clearer, not louder. That is the standard we bring to every vehicle and every conversation.</p>
              </div>
              <div className="grid gap-x-8 sm:grid-cols-2">
                {dealerConfig.whyBuy.map((item, idx) => (
                  <article key={idx} className="group border-t border-border py-6 first:border-t-0 sm:first:border-t">
                    <div className="mb-7 flex items-center justify-between">
                      <span className="font-mono text-xs text-accent">0{idx + 1}</span>
                      <CheckCircle2 className="h-5 w-5 text-primary transition-transform group-hover:rotate-12" />
                    </div>
                    <h3 className="text-xl font-extrabold tracking-tight text-primary">{item.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="border-y border-border bg-secondary/40 py-20 md:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="luxxy-kicker text-primary">Once you have found it</p>
              <h2 className="mt-4 max-w-xl font-display text-5xl leading-[.92] tracking-[-.04em] text-primary md:text-6xl">The useful bits,<br />handled properly.</h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">From warranty questions to getting the car to your door, ask us plainly and we will give you a plain answer.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {dealerConfig.warranty?.enabled && (
              <article id="warranty" data-home-section className="luxxy-surface group relative overflow-hidden bg-card p-7 transition-transform hover:-translate-y-1 sm:p-10">
                <ShieldCheck className="h-9 w-9 text-accent" />
                <h3 className="mt-12 font-display text-4xl tracking-[-.03em] text-primary">{dealerConfig.warranty.title}</h3>
                <p className="mt-4 max-w-md text-base leading-7 text-muted-foreground">{dealerConfig.warranty.description}</p>
                <Button asChild variant="outline" size="lg" data-testid="link-warranty-enquiry" className="mt-8 h-12 rounded-none border-primary px-5 font-extrabold text-primary hover:bg-primary hover:text-primary-foreground">
                  <a href={getContactHref('Warranty Enquiry')}>{dealerConfig.warranty.ctaLabel}<ArrowRight className="ml-5 h-4 w-4" /></a>
                </Button>
                <div className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full border-[28px] border-accent/10 transition-transform duration-500 group-hover:scale-110" />
              </article>
            )}
            {dealerConfig.delivery?.enabled && (
              <article id="delivery" data-home-section className="group relative overflow-hidden bg-primary p-7 text-primary-foreground transition-transform hover:-translate-y-1 sm:p-10">
                <Truck className="h-9 w-9 text-accent" />
                <h3 className="mt-12 font-display text-4xl tracking-[-.03em]">{dealerConfig.delivery.title}</h3>
                <p className="mt-4 max-w-md text-base leading-7 text-primary-foreground/70">{dealerConfig.delivery.description}</p>
                <Button asChild variant="secondary" size="lg" data-testid="link-delivery-enquiry" className="mt-8 h-12 rounded-none bg-accent px-5 font-extrabold text-accent-foreground hover:bg-accent/90">
                  <a href={getContactHref('Delivery Enquiry')}>{dealerConfig.delivery.ctaLabel}<ArrowRight className="ml-5 h-4 w-4" /></a>
                </Button>
                <div className="pointer-events-none absolute -right-8 -top-16 h-64 w-64 rounded-full border-[36px] border-primary-foreground/10 transition-transform duration-500 group-hover:scale-110" />
              </article>
            )}
          </div>
        </div>
      </section>

      {dealerConfig.partExchange?.enabled && (
        <section id="part-exchange" data-home-section className="relative overflow-hidden bg-primary py-24 text-primary-foreground md:py-32">
          {heroImage && <img src={heroImage} alt="" loading="lazy" aria-hidden="true" className="absolute inset-y-0 right-0 hidden w-1/2 object-cover opacity-15 mix-blend-luminosity lg:block" />}
          <div className="absolute inset-0 bg-gradient-to-r from-primary via-primary/98 to-primary/80" />
          <div className="container relative z-10 mx-auto grid gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_.8fr] lg:items-center lg:gap-20 lg:px-8">
            <div className="max-w-xl">
              <p className="luxxy-kicker text-accent"><RefreshCcw className="h-4 w-4" /> Part exchange</p>
              <h2 className="mt-6 font-display text-5xl leading-[.92] tracking-[-.04em] md:text-7xl">{dealerConfig.partExchange.title}</h2>
              <p className="mt-7 text-lg leading-8 text-primary-foreground/70">{dealerConfig.partExchange.description}</p>
              <div className="mt-10 grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
                {[
                  ['01', 'Tell us your car', 'Registration and mileage are all we need to start.'],
                  ['02', 'We review the details', 'Our team checks the car and your next-car options.'],
                  ['03', 'Choose your next move', 'Get a clear guide and decide when you are ready.'],
                ].map(([number, title, description]) => (
                  <div key={number} className="border-l border-accent/60 pl-4">
                    <p className="font-mono text-xs text-accent">{number}</p>
                    <p className="mt-1 font-extrabold">{title}</p>
                    <p className="mt-1 text-sm leading-5 text-primary-foreground/55">{description}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[#f5f0e4] p-6 text-primary shadow-2xl shadow-black/20 sm:p-8">
              <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#9a741d]">Start with your current car</p>
              <h3 className="mt-3 font-display text-4xl leading-none tracking-[-.03em] text-[#19383b]">See what it could unlock</h3>
              <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="bg-white/70 p-4"><div className="flex items-center gap-2 text-xs font-extrabold text-[#19383b]"><Car className="h-4 w-4 text-[#a97925]" /> Registration</div><p className="mt-3 text-sm font-semibold text-[#6c7770]">Your number plate</p></div>
                <div className="bg-white/70 p-4"><div className="flex items-center gap-2 text-xs font-extrabold text-[#19383b]"><Gauge className="h-4 w-4 text-[#a97925]" /> Mileage</div><p className="mt-3 text-sm font-semibold text-[#6c7770]">Your current miles</p></div>
              </div>
              <p className="mt-4 bg-[#ece6d8] px-4 py-3 text-xs leading-5 text-[#65716b]"><span className="font-extrabold text-[#19383b]">A sensible starting point.</span> We will talk through the final figure with you — no pressure to proceed.</p>
              <Button size="lg" asChild data-testid="link-part-exchange-valuation" className="mt-5 h-14 w-full rounded-none bg-accent text-base font-extrabold text-accent-foreground hover:bg-accent/90">
                <a href={getContactHref('Part Exchange Valuation')}>{dealerConfig.partExchange.ctaLabel}<ChevronRight className="ml-auto h-5 w-5" /></a>
              </Button>
              <p className="mt-3 text-center text-xs text-[#7b8178]">Start online, then speak to a real Luxxy Motors team member.</p>
            </div>
          </div>
        </section>
      )}

      <section id="book-viewing" data-home-section className="relative overflow-hidden bg-background py-24 md:py-32">
        <div className="container relative z-10 mx-auto grid gap-8 px-4 sm:px-6 md:grid-cols-[.8fr_1.2fr] md:items-center lg:px-8">
          <div className="flex items-center gap-5">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground"><Calendar className="h-7 w-7" /></span>
            <div><p className="luxxy-kicker text-primary">Come and see it</p><p className="mt-2 text-sm font-bold text-muted-foreground">Viewings at a time that suits you.</p></div>
          </div>
          <div className="flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
            <h2 className="max-w-xl font-display text-5xl leading-[.9] tracking-[-.04em] text-primary md:text-6xl">{dealerConfig.bookViewing.title}</h2>
            <Button size="lg" asChild data-testid="link-book-viewing" className="h-14 shrink-0 rounded-none bg-primary px-6 font-extrabold text-primary-foreground hover:bg-primary/90">
              <a href={getContactHref('Book a Viewing')}>{dealerConfig.bookViewing.ctaLabel}<ArrowRight className="ml-5 h-4 w-4" /></a>
            </Button>
          </div>
          <p className="text-base leading-7 text-muted-foreground md:col-start-2 md:max-w-xl">{dealerConfig.bookViewing.description}</p>
        </div>
      </section>

      {dealerConfig.address && locationLabel && (
        <section id="visit" data-home-section className="border-t border-border bg-card py-20 md:py-24">
          <div className="container mx-auto grid gap-12 px-4 sm:px-6 lg:grid-cols-[.8fr_1.2fr] lg:gap-20 lg:px-8">
            <div>
              <p className="luxxy-kicker text-primary"><MapPin className="h-4 w-4" /> Visit the showroom</p>
              <h2 className="mt-6 font-display text-6xl leading-[.88] tracking-[-.05em] text-primary">{locationLabel}</h2>
              <address className="mt-8 border-l-2 border-accent pl-5 text-base not-italic leading-7 text-muted-foreground">
                {dealerConfig.address.street && <p className="font-bold text-foreground">{dealerConfig.address.street}</p>}
                {dealerConfig.address.postcode && <p>{dealerConfig.address.postcode}</p>}
              </address>
              {dealerConfig.address.mapsUrl && <Button asChild size="lg" data-testid="link-get-directions" className="mt-8 h-12 rounded-none px-6 font-extrabold"><a href={dealerConfig.address.mapsUrl} target="_blank" rel="noopener noreferrer">Get directions<ArrowRight className="ml-5 h-4 w-4" /></a></Button>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {dealerConfig.contact.phone && (
                <a data-testid="link-contact-phone" className="group border border-border bg-background p-6 transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg" href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}>
                  <Phone className="h-6 w-6 text-accent" /><span className="mt-8 block text-[10px] font-extrabold uppercase tracking-[.16em] text-muted-foreground">Call us</span><span className="mt-1 block text-lg font-extrabold text-primary">{dealerConfig.contact.phone}</span>
                </a>
              )}
              {dealerConfig.contact.whatsapp && (
                <a data-testid="link-contact-whatsapp" className="group border border-border bg-background p-6 transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg" href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-6 w-6 text-accent" /><span className="mt-8 block text-[10px] font-extrabold uppercase tracking-[.16em] text-muted-foreground">Message us</span><span className="mt-1 block text-lg font-extrabold text-primary">WhatsApp</span>
                </a>
              )}
              {dealerConfig.contact.email && (
                <a data-testid="link-contact-email" className="group border border-border bg-background p-6 transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg sm:col-span-2" href={`mailto:${dealerConfig.contact.email}`}>
                  <Mail className="h-6 w-6 text-accent" /><span className="mt-8 block text-[10px] font-extrabold uppercase tracking-[.16em] text-muted-foreground">Email us</span><span className="mt-1 block text-lg font-extrabold text-primary">{dealerConfig.contact.email}</span>
                </a>
              )}
              {dealerConfig.hours && dealerConfig.hours.length > 0 && (
                <div className="border border-border bg-secondary/45 p-6 sm:col-span-2">
                  <div className="flex items-center gap-3 border-b border-border pb-4"><Clock className="h-5 w-5 text-accent" /><h3 className="text-sm font-extrabold uppercase tracking-[.13em] text-primary">Opening hours</h3></div>
                  <div className="mt-4 space-y-3">{dealerConfig.hours.map(item => <div key={`${item.days}-${item.times}`} className="flex items-center justify-between gap-4 border-b border-border/60 pb-3 text-sm last:border-0 last:pb-0"><span className="text-muted-foreground">{item.days}</span><span className="font-extrabold text-primary">{item.times}</span></div>)}</div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// Internal icon for stock badge
function CarCardIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}
