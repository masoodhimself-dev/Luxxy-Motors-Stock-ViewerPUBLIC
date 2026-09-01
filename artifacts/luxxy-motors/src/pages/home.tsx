import { useEffect, useMemo, useState } from 'react';
import { useStock } from '@/lib/stock-context';
import { ConciergeCarCard } from '@/components/concierge-car-card';
import { Filters, type FilterState } from '@/components/filters';
import { dealerConfig } from '@/config/dealer';
import { getThumbnailUrl } from '@/lib/utils';
import { getContactHref } from '@/lib/cta-helpers';
import { flushPendingHomeTarget, scrollToHomeTarget } from '@/lib/home-navigation';
import { ArrowRight, Banknote, Car, CheckCircle2, Clock, Gauge, Heart, Mail, MapPin, MessageCircle, Phone, Search, Settings2, ShieldCheck, Truck, RefreshCcw, Calendar, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useShortlist } from '@/lib/use-shortlist';

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
  const { stock, isLoading, error } = useStock();
  const [showAll, setShowAll] = useState(false);

  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [priority, setPriority] = useState<'automatic' | 'budget' | 'mileage' | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const { savedIds, savedCount, toggle } = useShortlist();

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

    // This concierge-only predicate is intentionally separate from FilterState.
    if (priority === 'mileage') {
      result = result.filter(c => typeof c.mileage === 'number' && c.mileage <= 35000);
    }
    if (showSaved) {
      result = result.filter(c => savedIds.includes(c.id));
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
  }, [stock, filters, priority, savedIds, showSaved]);

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
  const revealResults = () => {
    setShowAll(true);
    requestAnimationFrame(() => scrollToHomeTarget('vehicle-results'));
  };

  const applyQuickFilter = (nextFilters: Partial<FilterState>) => {
    setFilters({ ...defaultFilters, ...nextFilters });
    setPriority(null);
    setShowSaved(false);
    revealResults();
  };

  const choosePriority = (next: 'automatic' | 'budget' | 'mileage') => {
    setPriority(next);
    setShowSaved(false);
    setFilters({
      ...defaultFilters,
      ...(next === 'automatic' ? { transmission: 'Automatic' } : next === 'budget' ? { maxPrice: '20000' } : {}),
    });
    requestAnimationFrame(() => scrollToHomeTarget('vehicle-results'));
    setShowAll(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[70vh] bg-background">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 mb-6 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="text-muted-foreground font-medium uppercase tracking-widest text-sm">Loading Showroom...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-3xl border border-destructive/30 bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-black text-primary">The showroom is unavailable</h1>
          <p className="mt-3 text-muted-foreground">We could not load current stock. Please refresh or contact us directly.</p>
          {dealerConfig.contact.phone && <a href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`} className="mt-6 inline-block font-bold text-primary underline">Call {dealerConfig.contact.phone}</a>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative flex h-[85vh] min-h-[600px] w-full items-center overflow-hidden bg-primary">
        {heroImage ? (
          <img
            src={heroImage}
            alt={heroCar?.title || `${heroCar?.make || ''} ${heroCar?.model || ''}`.trim() || 'Luxxy Motors vehicle'}
            fetchPriority="high"
            loading="eager"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover scale-105"
          />
        ) : (
          <div className="absolute inset-0 w-full h-full bg-gradient-to-tr from-primary to-primary/60" />
        )}

        {/* Stronger overlay for better text contrast */}
        <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/80 to-black/40 mix-blend-multiply" />
        <div className="absolute inset-0 bg-black/30" />

        {/* subtle decorative pattern overlay */}
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent pointer-events-none mix-blend-overlay"></div>

        <div className="container relative z-10 mx-auto mt-16 px-4 text-white md:mt-0">
          <div className="max-w-3xl">
            {stock && (
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold tracking-wide shadow-lg backdrop-blur-md">
                <Car className="h-4 w-4 text-accent" />
                {stock.count ?? stock.cars.length} vehicles available
              </div>
            )}
            {dealerConfig.hero.announcement && (
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold tracking-wide shadow-lg backdrop-blur-md animate-in slide-in-from-bottom-4 duration-500">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
                {dealerConfig.hero.announcement}
              </div>
            )}
            <h1 className="mb-6 text-5xl font-black leading-[1.1] tracking-tighter animate-in slide-in-from-bottom-8 duration-700 md:text-7xl lg:text-8xl">
              {dealerConfig.hero.copy}
            </h1>
            <p className="mb-10 max-w-2xl text-lg font-medium leading-relaxed text-white/90 animate-in slide-in-from-bottom-10 duration-700 delay-100 md:text-2xl">
              {dealerConfig.hero.subcopy}
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-4 animate-in slide-in-from-bottom-12 duration-700 delay-200">
              <Button size="lg" onClick={() => scrollToHomeTarget('stock')} className="h-14 px-10 text-lg font-bold bg-accent text-accent-foreground shadow-xl shadow-accent/20 hover:bg-accent/90">
                {dealerConfig.hero.primaryCta} <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
              {dealerConfig.partExchange?.enabled && (
                <Button size="lg" variant="outline" asChild className="h-14 px-10 text-lg font-bold border-white/30 bg-black/20 text-white backdrop-blur-sm transition-all hover:bg-white hover:text-primary">
                  <a href={getContactHref('Part Exchange Enquiry')}>{dealerConfig.hero.secondaryCta}</a>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Compact trust strip overlapping bottom of hero */}
        <div className="absolute bottom-0 left-0 right-0 hidden md:block bg-gradient-to-t from-background to-transparent h-32 pointer-events-none"></div>
      </section>

      {/* Trust Strip */}
      <div className="relative z-20 border-b border-border/50 bg-background" aria-label="Luxxy Motors benefits">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 items-center gap-x-5 gap-y-4 py-5 text-xs font-bold uppercase tracking-wide text-muted-foreground sm:flex sm:justify-center sm:gap-x-8 md:justify-between md:py-6 md:text-sm">
            {dealerConfig.trustItems.map(item => (
              <span key={item} className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-accent" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Quick search shortcuts */}
      <section className="border-b border-border/50 bg-background py-6" aria-labelledby="quick-search-heading">
        <div className="container mx-auto px-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Shop your way</p>
              <h2 id="quick-search-heading" className="mt-1 text-lg font-black tracking-tight text-foreground">Quick searches</h2>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <button type="button" onClick={() => choosePriority('automatic')} className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:border-primary/50 hover:text-primary" data-testid="button-quick-automatic">
                <Settings2 className="h-4 w-4 text-primary" /> Automatic
              </button>
              <button type="button" onClick={() => choosePriority('budget')} className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:border-primary/50 hover:text-primary" data-testid="button-quick-under-20000">
                <Banknote className="h-4 w-4 text-primary" /> Under £20,000
              </button>
              <button type="button" onClick={() => choosePriority('mileage')} className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:border-primary/50 hover:text-primary" data-testid="button-quick-low-mileage">
                <Gauge className="h-4 w-4 text-primary" /> Low mileage
              </button>
              <button type="button" onClick={() => applyQuickFilter({ noWriteOff: true })} className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:border-primary/50 hover:text-primary" data-testid="button-quick-hpi-clear">
                <ShieldCheck className="h-4 w-4 text-primary" /> HPI clear
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Search & Filter - Pulled up to overlap hero slightly */}
      <div id="stock" data-home-section className="bg-muted/30">
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

      {/* Stock Grid */}
      <section id="vehicle-results" data-home-section className="bg-muted/30 pb-24 pt-12">
        <div className="container mx-auto px-4">
          <div className="mb-10 flex flex-col md:flex-row items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-primary mb-2">Showroom</p>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight text-foreground">
                 {showSaved ? 'Your Saved Vehicles' : showAll ? 'All Vehicles' : 'Considered Options'}
              </h2>
              {!showAll && !showSaved && <p className="mt-2 max-w-xl text-sm text-muted-foreground">Real vehicles, selected around the priorities you set. Vehicle history categories are disclosed on each relevant listing.</p>}
            </div>
            {stock && (
              <div className="flex items-center gap-2">
              <button type="button" onClick={() => { setShowSaved(current => !current); setShowAll(true); }} data-testid="button-show-saved" className={`rounded-full border px-4 py-2 text-sm font-bold transition-colors ${showSaved ? 'border-accent bg-accent/20 text-primary' : 'border-border bg-background text-foreground'}`}><Heart className={`mr-1.5 inline h-4 w-4 ${savedCount ? 'fill-current text-accent' : ''}`} />Saved {savedCount}</button>
              <div className="bg-background px-4 py-2 rounded-full border border-border shadow-sm flex items-center gap-2">
                <CarCardIcon className="w-4 h-4 text-primary" />
                <span className="font-bold text-sm">
                  {filteredCars.length} {filteredCars.length === 1 ? 'vehicle' : 'vehicles'} available
                </span>
              </div>
              </div>
            )}
          </div>

          {filteredCars.length > 0 ? (
            <>
              <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5">
                {displayedCars.map(car => (
                  <ConciergeCarCard key={car.id} car={car} saved={savedIds.includes(car.id)} onToggle={() => toggle(car.id)} />
                ))}
              </div>
              {savedCount > 0 && !showSaved && (
                <div className="mx-auto mt-5 flex max-w-6xl flex-col items-start justify-between gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 sm:flex-row sm:items-center">
                  <p className="text-sm font-bold text-primary"><Heart className="mr-1.5 inline h-4 w-4 fill-accent text-accent" />{savedCount} saved for your next visit.</p>
                  <button type="button" onClick={() => { setShowSaved(true); setShowAll(true); }} data-testid="button-review-shortlist" className="text-sm font-extrabold text-primary hover:text-accent">Review saved vehicles <ArrowRight className="ml-1 inline h-4 w-4" /></button>
                </div>
              )}

              {filteredCars.length > 6 && !showAll && (
                <div className="mt-16 flex justify-center">
                  <Button
                    onClick={() => {
                      setShowAll(true);
                      requestAnimationFrame(() => scrollToHomeTarget('vehicle-results'));
                    }}
                    size="lg"
                    className="font-bold px-10 h-14 rounded-full shadow-lg shadow-primary/10 group"
                  >
                    View All {filteredCars.length} Vehicles
                    <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-24 bg-card rounded-2xl border border-dashed shadow-sm max-w-2xl mx-auto">
              <div className="w-16 h-16 rounded-full bg-secondary mx-auto flex items-center justify-center mb-6">
                <Search className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-2xl font-bold mb-3">No vehicles match your search</h3>
               <p className="text-muted-foreground mb-8 text-lg">{showSaved ? 'Saved vehicles stay only on this browser and device.' : 'Try adjusting your filters or clearing your search query.'}</p>
              <Button
                size="lg"
                onClick={() => {
                   setFilters(defaultFilters);
                  setPriority(null);
                  setShowSaved(false);
                  setShowAll(false);
                }}
                className="font-bold"
              >
                Clear all filters
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Why Buy Section */}
      {dealerConfig.whyBuy && dealerConfig.whyBuy.length > 0 && (
        <section id="about" data-home-section className="bg-background py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16 max-w-2xl mx-auto">
              <p className="text-sm font-bold uppercase tracking-widest text-primary mb-3">The Luxxy Difference</p>
              <h2 className="text-3xl md:text-5xl font-black tracking-tight">Why Buy From {dealerConfig.identity.name}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {dealerConfig.whyBuy.map((item, idx) => (
                <div key={idx} className="bg-secondary/50 p-8 rounded-2xl border border-border/50 hover:bg-secondary hover:border-primary/20 transition-all group">
                  <div className="w-14 h-14 bg-primary text-primary-foreground rounded-xl flex items-center justify-center mb-6 shadow-md group-hover:scale-110 transition-transform">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <h3 className="font-bold text-xl mb-3">{item.title}</h3>
                  <p className="text-muted-foreground leading-relaxed font-medium">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Services: Warranty & Delivery */}
      <section className="bg-muted/30 py-24 border-y">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {dealerConfig.warranty?.enabled && (
              <div id="warranty" data-home-section className="bg-card border shadow-sm p-10 rounded-3xl flex flex-col justify-between items-start relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 group-hover:bg-primary/10 transition-colors"></div>
                <div className="relative z-10">
                  <div className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-6">
                    <ShieldCheck className="w-7 h-7" />
                  </div>
                  <h3 className="text-3xl font-black mb-4">{dealerConfig.warranty.title}</h3>
                  <p className="text-muted-foreground text-lg mb-8 max-w-md">{dealerConfig.warranty.description}</p>
                </div>
                <Button asChild variant="outline" size="lg" className="font-bold border-2 relative z-10 hover:bg-primary hover:text-primary-foreground">
                  <a href={getContactHref('Warranty Enquiry')}>{dealerConfig.warranty.ctaLabel}</a>
                </Button>
              </div>
            )}

            {dealerConfig.delivery?.enabled && (
              <div id="delivery" data-home-section className="bg-primary text-primary-foreground p-10 rounded-3xl flex flex-col justify-between items-start relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-64 h-64 bg-accent/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 group-hover:bg-accent/30 transition-colors"></div>
                <div className="relative z-10">
                  <div className="w-14 h-14 bg-white/10 text-accent rounded-2xl flex items-center justify-center mb-6 backdrop-blur-sm">
                    <Truck className="w-7 h-7" />
                  </div>
                  <h3 className="text-3xl font-black mb-4">{dealerConfig.delivery.title}</h3>
                  <p className="text-primary-foreground/80 text-lg mb-8 max-w-md">{dealerConfig.delivery.description}</p>
                </div>
                <Button asChild variant="secondary" size="lg" className="font-bold border-none bg-accent text-accent-foreground hover:bg-accent/90 relative z-10">
                  <a href={getContactHref('Delivery Enquiry')}>{dealerConfig.delivery.ctaLabel}</a>
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Part Exchange Full Width */}
      {dealerConfig.partExchange?.enabled && (
        <section id="part-exchange" data-home-section className="relative py-32 bg-primary overflow-hidden">
          {heroImage && (
            <div className="absolute inset-0 opacity-10 mix-blend-luminosity">
              <img src={heroImage} alt="" loading="lazy" aria-hidden="true" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-primary via-primary/95 to-primary/80"></div>

          <div className="container relative mx-auto px-4 z-10">
            <div className="max-w-2xl">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/20 text-accent mb-6">
                <RefreshCcw className="w-8 h-8" />
              </div>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-6 text-white leading-tight">
                {dealerConfig.partExchange.title}
              </h2>
              <p className="text-primary-foreground/80 text-xl mb-10 max-w-lg leading-relaxed">
                {dealerConfig.partExchange.description}
              </p>
              <Button size="lg" asChild className="px-10 h-14 text-lg font-bold bg-accent text-accent-foreground hover:bg-accent/90 shadow-xl shadow-accent/20">
                <a href={getContactHref('Part Exchange Valuation')}>{dealerConfig.partExchange.ctaLabel} <ChevronRight className="w-5 h-5 ml-2" /></a>
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Book Viewing CTA Block */}
      <section id="book-viewing" data-home-section className="py-32 bg-background relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="container mx-auto px-4 relative z-10 text-center max-w-3xl">
          <div className="w-20 h-20 bg-card shadow-xl rounded-2xl flex items-center justify-center mx-auto mb-8 border border-border/50">
            <Calendar className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-6">{dealerConfig.bookViewing.title}</h2>
          <p className="text-muted-foreground mb-10 text-xl">{dealerConfig.bookViewing.description}</p>
          <Button size="lg" asChild className="px-12 h-16 text-lg font-bold rounded-full shadow-lg shadow-primary/20 hover:scale-105 transition-transform w-full sm:w-auto">
            <a href={getContactHref('Book a Viewing')}>{dealerConfig.bookViewing.ctaLabel}</a>
          </Button>
        </div>
      </section>

      {/* Visit Us */}
      {dealerConfig.address && locationLabel && (
        <section id="visit" data-home-section className="bg-card py-24 border-t border-border/50">
          <div className="container mx-auto px-4">
            <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                  <MapPin className="w-4 h-4" /> Visit Our Showroom
                </p>
                <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-8 leading-tight">{locationLabel}</h2>
                <address className="not-italic text-muted-foreground text-lg space-y-2 mb-10 p-6 bg-secondary/50 rounded-2xl border border-border/50 inline-block w-full max-w-md">
                  {dealerConfig.address.street && <p className="font-medium text-foreground">{dealerConfig.address.street}</p>}
                  {dealerConfig.address.postcode && <p>{dealerConfig.address.postcode}</p>}
                </address>
                {dealerConfig.address.mapsUrl && (
                  <Button asChild size="lg" className="font-bold">
                    <a href={dealerConfig.address.mapsUrl} target="_blank" rel="noopener noreferrer">
                       Get Directions <ArrowRight className="w-4 h-4 ml-2" />
                    </a>
                  </Button>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-4 text-sm font-semibold">
                {dealerConfig.contact.phone && (
                  <a className="rounded-2xl border border-border/50 bg-background p-6 hover:border-primary/40 hover:shadow-lg transition-all group flex flex-col items-start" href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}>
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary transition-colors">
                      <Phone className="w-6 h-6 text-primary group-hover:text-primary-foreground transition-colors" />
                    </div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Call Us</span>
                    <span className="text-lg text-foreground">{dealerConfig.contact.phone}</span>
                  </a>
                )}
                {dealerConfig.contact.whatsapp && (
                  <a className="rounded-2xl border border-border/50 bg-background p-6 hover:border-green-500/40 hover:shadow-lg transition-all group flex flex-col items-start" href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener noreferrer">
                    <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mb-4 group-hover:bg-green-500 transition-colors">
                      <MessageCircle className="w-6 h-6 text-green-600 group-hover:text-white transition-colors" />
                    </div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Message</span>
                    <span className="text-lg text-foreground">WhatsApp</span>
                  </a>
                )}
                {dealerConfig.contact.email && (
                  <a className="rounded-2xl border border-border/50 bg-background p-6 hover:border-primary/40 hover:shadow-lg transition-all group flex flex-col items-start sm:col-span-2" href={`mailto:${dealerConfig.contact.email}`}>
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary transition-colors">
                      <Mail className="w-6 h-6 text-primary group-hover:text-primary-foreground transition-colors" />
                    </div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Email Us</span>
                    <span className="text-lg text-foreground">{dealerConfig.contact.email}</span>
                  </a>
                )}

                {dealerConfig.hours && dealerConfig.hours.length > 0 && (
                  <div className="rounded-2xl border border-border/50 bg-secondary/30 p-6 sm:col-span-2 mt-4">
                    <div className="flex items-center gap-3 mb-6">
                      <Clock className="w-6 h-6 text-primary" />
                      <h3 className="text-lg font-bold">Opening Hours</h3>
                    </div>
                    <div className="space-y-3">
                      {dealerConfig.hours.map(item => (
                        <div key={`${item.days}-${item.times}`} className="flex justify-between items-center pb-3 border-b border-border/50 last:border-0 last:pb-0">
                          <span className="text-muted-foreground">{item.days}</span>
                          <span className="font-bold text-foreground">{item.times}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
