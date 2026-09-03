import { useEffect, useMemo, useState } from 'react';
import { useStock } from '@/lib/stock-context';
import { CarCard } from '@/components/car-card';
import { Filters, type FilterState } from '@/components/filters';
import { formatPrice, getThumbnailUrl } from '@/lib/utils';
import { getContactHref } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { flushPendingHomeTarget, scrollToHomeTarget } from '@/lib/home-navigation';
import { usePageMeta } from '@/hooks/use-page-meta';
import { showroomPageMeta } from '@/lib/page-meta';
import { ArrowRight, Banknote, Calendar, CheckCircle2, Clock, Gauge, Mail, MapPin, MessageCircle, Phone, RefreshCcw, RotateCcw, Search, Settings2, ShieldCheck, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

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

  // Pick a nice hero car with an image
  const heroCar = stock?.cars?.find(c => Boolean(getThumbnailUrl(c)));
  const heroImage = heroCar ? getThumbnailUrl(heroCar) : null;
  const secondaryHeroCar = stock?.cars?.find(c => c.id !== heroCar?.id && Boolean(getThumbnailUrl(c))) ?? heroCar;
  const secondaryHeroImage = secondaryHeroCar ? getThumbnailUrl(secondaryHeroCar) : null;
  const locationLabel = [dealerConfig.address?.city, dealerConfig.address?.region].filter(Boolean).join(', ');
  const makes = useMemo(
    () => Array.from(new Set((stock?.cars || []).map(car => car.make).filter(Boolean) as string[])).sort(),
    [stock?.cars],
  );
  const stockCount = stock?.count ?? stock?.cars.length ?? 0;

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

  const quickFilterClass = 'inline-flex items-center justify-center gap-2 border border-border bg-background px-4 py-2.5 text-[12px] font-bold uppercase tracking-[.08em] text-foreground transition-colors hover:border-primary/50 hover:bg-primary hover:text-primary-foreground';

  return (
    <div className="luxxy-shell luxxy-grain flex min-h-screen flex-col">
      {/* Forecourt hero */}
      <section className="relative overflow-hidden border-b border-border bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative grid items-center gap-10 pb-12 pt-[calc(var(--site-header-height,4.5rem)+2rem)] lg:min-h-[34rem] lg:grid-cols-2 lg:gap-16 lg:py-24">
            <div className="relative z-10 max-w-xl">
              <p className="luxxy-reveal luxxy-kicker text-accent">
                {dealerConfig.hero.announcement || 'Independent cars, carefully chosen'}
              </p>
              <div className="luxxy-reveal luxxy-reveal-1 mt-7 h-[220px] overflow-hidden border border-border sm:h-[280px]">
                {secondaryHeroImage ? (
                  <img
                    src={secondaryHeroImage}
                    alt={secondaryHeroCar?.title || `${secondaryHeroCar?.make || ''} ${secondaryHeroCar?.model || ''}`.trim() || `${dealerConfig.identity.name} vehicle`}
                    loading="eager"
                    className="h-full w-full object-cover object-center grayscale-[20%] contrast-125"
                  />
                ) : (
                  <div className="h-full w-full bg-secondary" aria-label={`${dealerConfig.identity.name} vehicle`} />
                )}
              </div>
              <div className="luxxy-reveal luxxy-reveal-3 mt-9 flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  size="lg"
                  onClick={revealResults}
                  data-testid="button-hero-primary"
                  className="h-14 bg-primary px-8 text-base font-bold text-primary-foreground hover:bg-primary/90"
                >
                  {dealerConfig.hero.primaryCta}
                  <ArrowRight className="ml-4 h-5 w-5" />
                </Button>
                {dealerConfig.partExchange?.enabled && (
                  <Button
                    size="lg"
                    variant="outline"
                    asChild
                    data-testid="link-hero-part-exchange"
                    className="h-14 border-border bg-card px-8 text-base font-bold text-primary hover:border-primary hover:bg-secondary hover:text-primary"
                  >
                    <a href={getContactHref('Part Exchange Enquiry')}>
                      {dealerConfig.hero.secondaryCta}
                      <RotateCcw className="ml-4 h-5 w-5" />
                    </a>
                  </Button>
                )}
              </div>
            </div>

            <div className="relative -mx-4 h-[300px] overflow-hidden sm:-mx-6 sm:h-[400px] lg:absolute lg:inset-y-10 lg:left-[52%] lg:right-[calc(50%-50vw)] lg:mx-0 lg:h-auto border-l border-y border-border">
              {heroImage ? (
                <img
                  src={heroImage}
                  alt={heroCar?.title || `${heroCar?.make || ''} ${heroCar?.model || ''}`.trim() || `${dealerConfig.identity.name} vehicle`}
                  fetchPriority="high"
                  loading="eager"
                  className="luxxy-hero-image absolute inset-0 h-full w-full object-cover object-center grayscale-[20%] contrast-125"
                />
              ) : (
                <div className="absolute inset-0 bg-secondary" />
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-primary/40 via-transparent to-transparent lg:bg-gradient-to-r lg:from-background lg:via-transparent lg:to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* Search board */}
      <section className="border-b border-border bg-card text-foreground" aria-label="Search the showroom" data-testid="hero-search">
        <div className="container mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-9">
            <div className="flex items-baseline justify-between gap-4 lg:w-48 lg:shrink-0 lg:flex-col lg:items-start lg:gap-2">
              <p className="luxxy-label text-muted-foreground">Search the showroom</p>
              {stock && (
                <span className="font-mono text-[11px] font-bold text-accent" data-testid="text-hero-stock-count">
                  {stockCount} vehicles available
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
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
                  className="h-12 border-border bg-background pl-10 text-foreground placeholder:font-normal focus-visible:border-accent"
                  data-testid="input-hero-search"
                />
              </div>
              <NativeSelect
                aria-label="Filter by make"
                value={filters.make}
                onChange={(event) => setFilters(current => ({ ...current, make: event.target.value, model: '' }))}
                className="h-12 border-border bg-background font-bold text-foreground focus:ring-accent/30 sm:w-40"
                data-testid="select-hero-make"
              >
                <option value="" className="text-foreground">Any make</option>
                {makes.map(make => <option key={make} value={make} className="text-foreground">{make}</option>)}
              </NativeSelect>
            </div>
          </div>
        </div>
      </section>

      {/* What you can expect */}
      {dealerConfig.trustItems?.length > 0 && (
        <section className="border-b border-border bg-card" aria-label={`${dealerConfig.identity.name} promises`}>
          <div className="container mx-auto grid px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
            {dealerConfig.trustItems.map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 border-b border-border/70 py-6 last:border-b-0 sm:border-b-0 sm:border-r sm:pr-6 sm:last:border-r-0"
              >
                <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" />
                <p className="text-xs font-bold uppercase leading-5 tracking-widest text-primary">{item}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Stock */}
      <div id="stock" data-home-section className="bg-muted/30 px-0 pb-2 pt-12 md:pt-16">
        <Filters
          cars={stock?.cars || []}
          filters={filters}
          setFilters={setFilters}
          onSearch={() => {
            setShowAll(true);
            requestAnimationFrame(() => scrollToHomeTarget('vehicle-results'));
          }}
          vehicleCount={stockCount}
        />
      </div>

      <section id="vehicle-results" data-home-section className="bg-muted/30 pb-24 pt-8 md:pt-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8 border-b border-border pb-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="luxxy-kicker text-accent">{showAll ? 'Full stock list' : 'On the forecourt'}</p>
                <h2 className="mt-4 font-display text-4xl font-semibold leading-none tracking-[-.03em] text-primary md:text-5xl">
                  {showAll ? 'Every car on site' : 'Latest cars in stock'}
                </h2>
              </div>
              {stock && (
                <p className="font-mono text-[13px] font-bold text-primary" data-testid="text-filtered-stock-count">
                  {filteredCars.length} {filteredCars.length === 1 ? 'vehicle' : 'vehicles'} available
                </p>
              )}
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-2">
              <span className="luxxy-label mr-1 text-muted-foreground">Shortcuts</span>
              <button type="button" onClick={() => applyQuickFilter({ transmission: 'Automatic' })} className={quickFilterClass} data-testid="button-quick-automatic">
                <Settings2 className="h-3.5 w-3.5 text-accent" /> Automatic
              </button>
              <button type="button" onClick={() => applyQuickFilter({ maxPrice: '5000' })} className={quickFilterClass} data-testid="button-quick-under-5000">
                <Banknote className="h-3.5 w-3.5 text-accent" /> Under £5,000
              </button>
              <button type="button" onClick={() => applyQuickFilter({ sort: 'mileage-asc' })} className={quickFilterClass} data-testid="button-quick-low-mileage">
                <Gauge className="h-3.5 w-3.5 text-accent" /> Low mileage
              </button>
            </div>
          </div>

          {filteredCars.length > 0 ? (
            <>
              <div className="flex flex-col gap-5">
                {displayedCars.map(car => <CarCard key={car.id} car={car} layout="row" />)}
              </div>
              {filteredCars.length > 4 && !showAll && (
                <div className="mt-12 flex justify-center">
                  <Button
                    onClick={() => { setShowAll(true); requestAnimationFrame(() => scrollToHomeTarget('vehicle-results')); }}
                    size="lg"
                    data-testid="button-view-all-vehicles"
                    className="group h-[3.25rem] bg-primary px-8 font-bold hover:bg-primary/90"
                  >
                    View all {filteredCars.length} vehicles
                    <ArrowRight className="ml-5 h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="mx-auto max-w-2xl border border-dashed border-border bg-card px-6 py-20 text-center">
              <span className="mx-auto mb-6 grid h-14 w-14 place-items-center border border-border bg-secondary text-accent">
                <Search className="h-6 w-6" />
              </span>
              <p className="font-display text-3xl font-semibold tracking-[-.02em] text-primary">Nothing matches that search</p>
              <p className="mx-auto mb-8 mt-3 max-w-md text-base leading-7 text-muted-foreground">
                Try widening your budget or clearing the filters to see the full stock list.
              </p>
              <Button size="lg" onClick={() => { setFilters(defaultFilters); setShowAll(false); }} data-testid="button-clear-filters" className="h-12 px-7 font-bold">
                Clear all filters
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* How we work */}
      {dealerConfig.whyBuy && dealerConfig.whyBuy.length > 0 && (
        <section id="about" data-home-section className="border-t border-border bg-background py-20 md:py-28">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-[.75fr_1.25fr] lg:gap-20">
              <div className="max-w-md">
                <p className="luxxy-kicker text-accent">The Luxxy way</p>
                <h2 className="mt-6 font-display text-5xl font-semibold leading-[.98] tracking-[-.04em] text-primary md:text-6xl">
                  Good cars.<br /><em className="font-normal">Good sense.</em>
                </h2>
                <p className="mt-7 text-base leading-7 text-muted-foreground">
                  A used-car showroom should make choosing feel clearer, not louder. That is the standard we bring to every vehicle and every conversation.
                </p>
              </div>
              <div className="grid gap-x-12 sm:grid-cols-2">
                {dealerConfig.whyBuy.map((item, idx) => (
                  <article key={idx} className="border-t border-border py-7 first:border-t-0 sm:first:border-t">
                    <div className="flex items-center gap-3">
                      <span className="h-1.5 w-1.5 rotate-45 bg-accent" aria-hidden="true" />
                      <h3 className="text-lg font-bold tracking-tight text-primary">{item.title}</h3>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Services */}
      <section className="border-y border-border bg-card py-20 md:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="luxxy-kicker text-accent">Once you have found it</p>
              <h2 className="mt-4 max-w-xl font-display text-4xl font-semibold leading-[1] tracking-tight text-primary md:text-5xl">
                The useful bits,<br />handled properly.
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-7 text-muted-foreground">
              From warranty questions to getting the car to your door, ask us plainly and we will give you a plain answer.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {dealerConfig.warranty?.enabled && (
              <article id="warranty" data-home-section className="flex flex-col border border-border bg-background p-7 sm:p-9">
                <ShieldCheck className="h-8 w-8 text-accent" />
                <h3 className="mt-10 font-display text-3xl font-semibold tracking-tight text-primary">{dealerConfig.warranty.title}</h3>
                <p className="mt-4 max-w-md flex-1 text-base leading-7 text-muted-foreground">{dealerConfig.warranty.description}</p>
                <Button asChild variant="outline" size="lg" data-testid="link-warranty-enquiry" className="mt-8 h-12 w-fit border-border bg-card px-5 font-bold text-primary hover:border-primary hover:bg-secondary">
                  <a href={getContactHref('Warranty Enquiry')}>{dealerConfig.warranty.ctaLabel}<ArrowRight className="ml-4 h-4 w-4" /></a>
                </Button>
              </article>
            )}
            {dealerConfig.delivery?.enabled && (
              <article id="delivery" data-home-section className="flex flex-col border border-border bg-primary p-7 text-primary-foreground sm:p-9">
                <Truck className="h-8 w-8 text-accent" />
                <h3 className="mt-10 font-display text-3xl font-semibold tracking-tight">{dealerConfig.delivery.title}</h3>
                <p className="mt-4 max-w-md flex-1 text-base leading-7 text-primary-foreground/70">{dealerConfig.delivery.description}</p>
                <Button asChild size="lg" data-testid="link-delivery-enquiry" className="mt-8 h-12 w-fit bg-accent px-5 font-bold text-accent-foreground hover:bg-accent/90">
                  <a href={getContactHref('Delivery Enquiry')}>{dealerConfig.delivery.ctaLabel}<ArrowRight className="ml-4 h-4 w-4" /></a>
                </Button>
              </article>
            )}
          </div>
        </div>
      </section>

      {/* Book a viewing */}
      <section id="book-viewing" data-home-section className="bg-primary text-primary-foreground py-20 md:py-28">
        <div className="container mx-auto grid gap-8 px-4 sm:px-6 md:grid-cols-[.75fr_1.25fr] md:items-center lg:px-8">
          <div className="flex items-center gap-5">
            <span className="grid h-14 w-14 shrink-0 place-items-center bg-accent text-accent-foreground"><Calendar className="h-6 w-6" /></span>
            <div>
              <p className="luxxy-label text-accent">Come and see it</p>
              <p className="mt-2 text-sm font-semibold text-primary-foreground/70">Viewings at a time that suits you.</p>
            </div>
          </div>
          <div className="flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
            <h2 className="max-w-xl font-display text-4xl font-semibold leading-[1] tracking-tight md:text-5xl">{dealerConfig.bookViewing.title}</h2>
            <Button size="lg" asChild data-testid="link-book-viewing" className="h-[3.25rem] shrink-0 bg-accent px-6 font-bold text-accent-foreground hover:bg-accent/90">
              <a href={getContactHref('Book a Viewing')}>{dealerConfig.bookViewing.ctaLabel}<ArrowRight className="ml-4 h-4 w-4" /></a>
            </Button>
          </div>
          <p className="text-base leading-7 text-primary-foreground/70 md:col-start-2 md:max-w-xl">{dealerConfig.bookViewing.description}</p>
        </div>
      </section>

      {/* Visit us */}
      {dealerConfig.address && locationLabel && (
        <section id="visit" data-home-section className="border-t border-border bg-background py-20 md:py-24">
          <div className="container mx-auto grid gap-12 px-4 sm:px-6 lg:grid-cols-[.8fr_1.2fr] lg:gap-20 lg:px-8">
            <div>
              <p className="luxxy-label text-accent"><MapPin className="mr-2 inline h-4 w-4 -translate-y-0.5" /> Visit the showroom</p>
              <h2 className="mt-6 font-display text-5xl font-semibold leading-[.95] tracking-tight text-primary">{locationLabel}</h2>
              <address className="mt-8 border-l-2 border-accent pl-5 text-base not-italic leading-7 text-muted-foreground">
                {dealerConfig.address.street && <p className="font-bold text-foreground">{dealerConfig.address.street}</p>}
                {dealerConfig.address.postcode && <p>{dealerConfig.address.postcode}</p>}
              </address>
              {dealerConfig.address.mapsUrl && (
                <Button asChild size="lg" variant="outline" data-testid="link-get-directions" className="mt-8 h-12 px-6 font-bold border-primary text-primary hover:bg-primary hover:text-primary-foreground">
                  <a href={dealerConfig.address.mapsUrl} target="_blank" rel="noopener noreferrer">Get directions<ArrowRight className="ml-4 h-4 w-4" /></a>
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {dealerConfig.contact.phone && (
                <a data-testid="link-contact-phone" className="group border border-border bg-card p-6 transition-colors hover:border-accent" href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}>
                  <Phone className="h-5 w-5 text-accent" />
                  <span className="luxxy-label mt-8 block text-muted-foreground">Call us</span>
                  <span className="mt-1.5 block text-lg font-bold text-primary group-hover:text-accent">{dealerConfig.contact.phone}</span>
                </a>
              )}
              {dealerConfig.contact.whatsapp && (
                <a data-testid="link-contact-whatsapp" className="group border border-[#1f7a4d]/30 bg-[#1f7a4d]/5 p-6 transition-colors hover:border-[#1f7a4d]" href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-5 w-5 text-[#1f7a4d]" />
                  <span className="luxxy-label mt-8 block text-[#1b6543]/70">Message us</span>
                  <span className="mt-1.5 block text-lg font-bold text-[#1b6543]">WhatsApp</span>
                </a>
              )}
              {dealerConfig.contact.email && (
                <a data-testid="link-contact-email" className="group border border-border bg-card p-6 transition-colors hover:border-accent sm:col-span-2" href={`mailto:${dealerConfig.contact.email}`}>
                  <Mail className="h-5 w-5 text-accent" />
                  <span className="luxxy-label mt-8 block text-muted-foreground">Email us</span>
                  <span className="mt-1.5 block text-lg font-bold text-primary group-hover:text-accent">{dealerConfig.contact.email}</span>
                </a>
              )}
              {dealerConfig.hours && dealerConfig.hours.length > 0 && (
                <div className="border border-border bg-secondary/15 p-6 sm:col-span-2">
                  <div className="flex items-center gap-3 border-b border-border pb-4">
                    <Clock className="h-4 w-4 text-accent" />
                    <h3 className="luxxy-label text-primary">Opening hours</h3>
                  </div>
                  <div className="mt-4 space-y-3">
                    {dealerConfig.hours.map(item => (
                      <div key={`${item.days}-${item.times}`} className="flex items-baseline gap-2 text-sm">
                        <span className="shrink-0 text-muted-foreground">{item.days}</span>
                        <span className="luxxy-leader" aria-hidden="true" />
                        <span className="shrink-0 font-mono text-[13px] font-bold text-primary">{item.times}</span>
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
