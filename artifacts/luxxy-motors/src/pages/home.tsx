import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useStock } from '@/lib/stock-context';
import { CarCard } from '@/components/car-card';
import { Filters, type FilterState } from '@/components/filters';
import { cn, formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { getContactHref } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { flushPendingHomeTarget, scrollToHomeTarget } from '@/lib/home-navigation';
import { usePageMeta } from '@/hooks/use-page-meta';
import { showroomPageMeta } from '@/lib/page-meta';
import { ArrowRight, Banknote, Calendar, CheckCircle2, Clock, Gauge, Grid2X2, List, Mail, MapPin, MessageCircle, Phone, Search, Settings2, ShieldCheck, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  const [stockView, setStockView] = useState<'cards' | 'compact'>('cards');

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

  const locationLabel = [dealerConfig.address?.city, dealerConfig.address?.region].filter(Boolean).join(', ');
  const makes = useMemo(
    () => Array.from(new Set((stock?.cars || []).map(car => car.make).filter(Boolean) as string[])).sort(),
    [stock?.cars],
  );
  const stockCount = stock?.count ?? stock?.cars.length ?? 0;
  const featuredCar = stock?.cars.find((car) => Boolean(getThumbnailUrl(car)));
  const featuredImage = featuredCar ? getThumbnailUrl(featuredCar) : '';
  const heroHeadline = dealerConfig.hero.copy.trim().toLowerCase() === 'find your next car'
    ? 'Carefully chosen cars.'
    : dealerConfig.hero.copy;
  const heroPrimaryLabel = dealerConfig.hero.primaryCta.trim().toLowerCase() === 'see all cars'
    ? 'Browse cars'
    : dealerConfig.hero.primaryCta;
  const oldSecondaryLabels = ['get a part-exchange valuation', 'part exchange'];
  const heroSecondaryLabel = oldSecondaryLabels.includes(dealerConfig.hero.secondaryCta.trim().toLowerCase())
    ? 'Find my car'
    : dealerConfig.hero.secondaryCta;

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
      <section className="relative overflow-hidden border-b border-border bg-background text-foreground">
        <div className="container mx-auto px-4 pt-[calc(var(--site-header-height,4.5rem)+1.5rem)] sm:px-6 lg:px-8 lg:pt-[calc(var(--site-header-height,4.5rem)+2rem)]">
          <div className="grid border-x border-t border-border lg:min-h-[32rem] lg:grid-cols-[0.92fr_1.08fr]">
            <div className="relative z-10 flex flex-col justify-center px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16">
              <p className="luxxy-reveal luxxy-kicker text-accent">
                {dealerConfig.hero.announcement || 'Independent cars, carefully chosen'}
              </p>
              <h1 className="luxxy-reveal luxxy-reveal-1 mt-6 max-w-2xl font-display text-[3.25rem] leading-[0.94] tracking-[-0.045em] text-primary sm:text-6xl lg:text-[4.75rem]">
                {heroHeadline}
              </h1>
              <p className="luxxy-reveal luxxy-reveal-2 mt-6 max-w-lg text-base leading-7 text-muted-foreground">
                {dealerConfig.hero.subcopy}
              </p>
              <p className="luxxy-label mt-6 text-primary">
                {stockCount} cars available · {locationLabel || 'Harrow, London'}
              </p>
              <div className="luxxy-reveal luxxy-reveal-3 mt-8 grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  size="lg"
                  onClick={revealResults}
                  data-testid="button-hero-primary"
                  className="h-14 justify-between bg-primary px-6 text-[14px] font-bold text-primary-foreground hover:bg-primary/90"
                >
                  {heroPrimaryLabel}
                  <ArrowRight className="h-5 w-5" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  data-testid="link-hero-find-my-car"
                  className="h-14 justify-between border-primary/35 bg-transparent px-6 text-[14px] font-bold text-primary hover:border-primary hover:bg-secondary"
                >
                  <Link href="/find-my-car">
                    {heroSecondaryLabel}
                    <ArrowRight className="h-5 w-5" />
                  </Link>
                </Button>
              </div>
            </div>

            <div className="relative min-h-[20rem] overflow-hidden border-t border-border bg-primary lg:min-h-full lg:border-l lg:border-t-0">
              {featuredCar && featuredImage ? (
                <Link
                  href={`/vehicle/${featuredCar.id}`}
                  aria-label={`View ${vehicleDisplayTitle(featuredCar)}`}
                  className="group absolute inset-0 block"
                >
                  <img
                    src={featuredImage}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.025]"
                  />
                  <span className="absolute inset-0 bg-gradient-to-t from-primary/80 via-transparent to-transparent" aria-hidden="true" />
                  <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-6 text-primary-foreground sm:p-8">
                    <span>
                      <span className="luxxy-label block text-primary-foreground/70">Featured on the forecourt</span>
                      <span className="mt-2 block font-display text-2xl font-semibold">{vehicleDisplayTitle(featuredCar)}</span>
                    </span>
                    <span className="luxxy-price text-2xl">
                      {featuredCar.price ? formatPrice(featuredCar.price, featuredCar.currency) : 'POA'}
                    </span>
                  </span>
                </Link>
              ) : (
                <div className="absolute inset-0 grid place-items-center px-8 text-center">
                  <p className="font-display text-3xl text-primary-foreground">Fresh stock arriving regularly.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {dealerConfig.trustItems?.length > 0 && (
          <div className="container mx-auto px-4 sm:px-6 lg:px-8" aria-label={`${dealerConfig.identity.name} promises`}>
            <div className="grid border-x border-t border-border bg-card sm:grid-cols-2 lg:grid-cols-4">
              {dealerConfig.trustItems.slice(0, 4).map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 border-b border-border/70 px-5 py-4 last:border-b-0 sm:border-r sm:last:border-r-0 lg:border-b-0"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                <p className="text-[10px] font-bold uppercase leading-4 tracking-[.12em] text-primary">{item}</p>
              </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Stock */}
      <div id="stock" data-home-section className="bg-muted/30 px-0 pb-2 pt-10 md:pt-12">
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

            <div className="mt-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div className="flex flex-wrap items-center gap-2">
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
              <div className="grid grid-cols-2 border border-border bg-card p-1" aria-label="Vehicle display">
                <button
                  type="button"
                  aria-pressed={stockView === 'cards'}
                  onClick={() => setStockView('cards')}
                  data-testid="button-stock-view-cards"
                  className={cn('inline-flex h-9 items-center justify-center gap-2 px-3 text-[12px] font-bold transition-colors', stockView === 'cards' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary')}
                >
                  <Grid2X2 className="h-3.5 w-3.5" /> Cards
                </button>
                <button
                  type="button"
                  aria-pressed={stockView === 'compact'}
                  onClick={() => setStockView('compact')}
                  data-testid="button-stock-view-compact"
                  className={cn('inline-flex h-9 items-center justify-center gap-2 px-3 text-[12px] font-bold transition-colors', stockView === 'compact' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary')}
                >
                  <List className="h-4 w-4" /> Compact
                </button>
              </div>
            </div>
          </div>

          {filteredCars.length > 0 ? (
            <>
              <div className={cn('grid', stockView === 'compact' ? 'gap-3 lg:grid-cols-2' : 'gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4')}>
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
