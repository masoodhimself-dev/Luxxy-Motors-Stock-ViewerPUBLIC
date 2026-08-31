import { useEffect, useMemo, useState } from 'react';
import { useStock } from '@/lib/stock-context';
import { CarCard } from '@/components/car-card';
import { Filters, type FilterState } from '@/components/filters';
import { dealerConfig } from '@/config/dealer';
import { getThumbnailUrl } from '@/lib/utils';
import { getContactHref } from '@/lib/cta-helpers';
import { ArrowRight, CheckCircle2, Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Home() {
  const { stock, isLoading } = useStock();
  const [showAll, setShowAll] = useState(false);

  const [filters, setFilters] = useState<FilterState>({
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
    sort: ''
  });

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

  const displayedCars = showAll ? filteredCars : filteredCars.slice(0, 4);

  const heroCar = stock?.cars?.find(c => Boolean(getThumbnailUrl(c)));
  const heroImage = heroCar ? getThumbnailUrl(heroCar) : null;
  const locationLabel = [dealerConfig.address?.city, dealerConfig.address?.region].filter(Boolean).join(', ');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-primary/20 mb-4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative h-[70vh] min-h-[500px] w-full bg-primary overflow-hidden flex items-center">
        {heroImage ? (
          <img
            src={heroImage}
            alt={heroCar?.title || `${heroCar?.make || ''} ${heroCar?.model || ''}`.trim() || 'Luxxy Motors vehicle'}
            fetchPriority="high"
            loading="eager"
            className="absolute inset-0 w-full h-full object-cover opacity-50 mix-blend-overlay"
          />
        ) : (
          <div className="absolute inset-0 w-full h-full bg-gradient-to-tr from-primary to-primary/80" />
        )}
        <div className="absolute inset-0 bg-black/40" />

        <div className="container relative mx-auto px-4 z-10 text-white text-center">
          {dealerConfig.hero.announcement && (
            <div className="inline-block px-4 py-1.5 bg-white/20 backdrop-blur-md rounded-full text-sm font-semibold mb-6">
              {dealerConfig.hero.announcement}
            </div>
          )}
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-4">
            {dealerConfig.hero.copy}
          </h1>
          <p className="text-lg md:text-xl font-medium max-w-2xl mx-auto mb-8">
            {dealerConfig.hero.subcopy}
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button size="lg" onClick={() => {
              document.getElementById('stock')?.scrollIntoView({ behavior: 'smooth' });
            }} className="font-semibold px-8 h-12 text-base bg-white text-black hover:bg-white/90">
              {dealerConfig.hero.primaryCta}
            </Button>
            {dealerConfig.partExchange?.enabled && (
              <Button size="lg" variant="outline" asChild className="font-semibold px-8 h-12 text-base border-white !bg-transparent !text-white hover:!bg-white hover:!text-primary">
                <a href={getContactHref('Part Exchange Enquiry')}>{dealerConfig.hero.secondaryCta}</a>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Trust Strip */}
      <div className="bg-muted py-6 border-b">
        <div className="container mx-auto px-4">
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-4 text-sm font-medium text-muted-foreground">
            {dealerConfig.trustItems.map(item => (
              <span key={item} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Search & Filter */}
      <div id="stock">
        <Filters
          cars={stock?.cars || []}
          filters={filters}
          setFilters={setFilters}
          onSearch={() => setShowAll(true)}
          vehicleCount={stock?.count ?? stock?.cars.length ?? 0}
        />
      </div>

      {/* Stock Grid */}
      <section className="container mx-auto px-4 py-12">
        <div className="mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <h2 className="text-3xl font-bold tracking-tight">
             {showAll ? 'All Vehicles' : 'Latest Vehicles'}
          </h2>
          {stock && (
            <p className="text-muted-foreground font-medium">
              {filteredCars.length} {filteredCars.length === 1 ? 'vehicle' : 'vehicles'} available
            </p>
          )}
        </div>

        {filteredCars.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {displayedCars.map(car => (
                <CarCard key={car.id} car={car} />
              ))}
            </div>

            {filteredCars.length > 4 && !showAll && (
              <div className="mt-12 flex justify-center">
                <Button
                  onClick={() => setShowAll(true)}
                  size="lg"
                  className="font-semibold px-8"
                >
                  View All Stock <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20 bg-card rounded-xl border border-dashed">
            <h3 className="text-xl font-semibold mb-2">No vehicles match your search</h3>
            <p className="text-muted-foreground mb-6">Try adjusting your filters or clearing your search query.</p>
            <Button
              variant="outline"
              onClick={() => {
                setFilters({ search: '', make: '', model: '', minPrice: '', maxPrice: '', fuel: '', transmission: '', catS: false, catN: false, noWriteOff: false, sort: '' });
                setShowAll(false);
              }}
            >
              Clear all filters
            </Button>
          </div>
        )}
      </section>

      {/* Why Buy Section */}
      {dealerConfig.whyBuy && dealerConfig.whyBuy.length > 0 && (
        <section className="bg-muted/50 py-20 border-y">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold tracking-tight text-center mb-12">Why Buy From {dealerConfig.identity.name}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {dealerConfig.whyBuy.map((item, idx) => (
                <div key={idx} className="bg-background p-6 rounded-xl border shadow-sm">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-bold text-lg mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Promos */}
      <section className="container mx-auto px-4 py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {dealerConfig.warranty?.enabled && (
            <div id="warranty" className="bg-card border p-8 rounded-xl flex flex-col justify-between items-start">
              <div>
                <h3 className="text-2xl font-bold mb-4">{dealerConfig.warranty.title}</h3>
                <p className="text-muted-foreground mb-6 max-w-md">{dealerConfig.warranty.description}</p>
              </div>
              <Button asChild variant="outline">
                <a href={getContactHref('Warranty Enquiry')}>{dealerConfig.warranty.ctaLabel}</a>
              </Button>
            </div>
          )}
          {dealerConfig.delivery?.enabled && (
            <div id="delivery" className="bg-primary text-primary-foreground p-8 rounded-xl flex flex-col justify-between items-start">
              <div>
                <h3 className="text-2xl font-bold mb-4">{dealerConfig.delivery.title}</h3>
                <p className="text-primary-foreground/80 mb-6 max-w-md">{dealerConfig.delivery.description}</p>
              </div>
              <Button asChild variant="secondary">
                <a href={getContactHref('Delivery Enquiry')}>{dealerConfig.delivery.ctaLabel}</a>
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Part Exchange Full Width */}
      {dealerConfig.partExchange?.enabled && (
        <section id="part-exchange" className="bg-card border-y py-20">
          <div className="container mx-auto px-4 text-center max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight mb-4">{dealerConfig.partExchange.title}</h2>
            <p className="text-muted-foreground text-lg mb-8">{dealerConfig.partExchange.description}</p>
            <Button size="lg" asChild className="px-8 h-12 text-base font-semibold">
              <a href={getContactHref('Part Exchange Valuation')}>{dealerConfig.partExchange.ctaLabel}</a>
            </Button>
          </div>
        </section>
      )}

      {/* Book Viewing CTA Block */}
      <section id="book-viewing" className="py-20 text-center container mx-auto px-4 max-w-2xl">
        <h2 className="text-3xl font-bold tracking-tight mb-4">{dealerConfig.bookViewing.title}</h2>
        <p className="text-muted-foreground mb-8 text-lg">{dealerConfig.bookViewing.description}</p>
        <Button size="lg" asChild className="px-10 h-14 text-lg font-semibold w-full sm:w-auto">
          <a href={getContactHref('Book a Viewing')}>{dealerConfig.bookViewing.ctaLabel}</a>
        </Button>
      </section>

      {dealerConfig.address && locationLabel && (
        <section id="visit" className="bg-muted/50 border-y py-20">
          <div className="container mx-auto px-4">
            <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary mb-3">Visit Us</p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">{locationLabel}</h2>
                <address className="not-italic text-muted-foreground space-y-1">
                  {dealerConfig.address.street && <p>{dealerConfig.address.street}</p>}
                  {dealerConfig.address.postcode && <p>{dealerConfig.address.postcode}</p>}
                </address>
                {dealerConfig.address.mapsUrl && (
                  <Button asChild variant="outline" className="mt-6">
                    <a href={dealerConfig.address.mapsUrl} target="_blank" rel="noopener noreferrer">
                      <MapPin className="w-4 h-4 mr-2" /> Get Directions
                    </a>
                  </Button>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                {dealerConfig.contact.phone && (
                  <a className="rounded-xl border bg-background p-5 hover:border-primary/40" href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}>
                    <Phone className="w-5 h-5 text-primary mb-3" />{dealerConfig.contact.phone}
                  </a>
                )}
                {dealerConfig.contact.whatsapp && (
                  <a className="rounded-xl border bg-background p-5 hover:border-primary/40" href={`https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="w-5 h-5 text-primary mb-3" />WhatsApp
                  </a>
                )}
                {dealerConfig.contact.email && (
                  <a className="rounded-xl border bg-background p-5 hover:border-primary/40" href={`mailto:${dealerConfig.contact.email}`}>
                    <Mail className="w-5 h-5 text-primary mb-3" />{dealerConfig.contact.email}
                  </a>
                )}
                {dealerConfig.hours && dealerConfig.hours.length > 0 && (
                  <div className="rounded-xl border bg-background p-5 sm:col-span-2">
                    <Clock className="w-5 h-5 text-primary mb-3" />
                    <div className="space-y-2">
                      {dealerConfig.hours.map(item => (
                        <p key={`${item.days}-${item.times}`} className="flex justify-between gap-4">
                          <span>{item.days}</span><span>{item.times}</span>
                        </p>
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
