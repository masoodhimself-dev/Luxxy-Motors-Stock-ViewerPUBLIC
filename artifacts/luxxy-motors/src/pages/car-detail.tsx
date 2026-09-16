import type { MouseEvent } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { ArrowLeft, ArrowRight, MessageCircle, Phone, Calendar, Info } from 'lucide-react';
import { CarCard } from '@/components/car-card';
import { useStock, type Car } from '@/lib/stock-context';
import { Gallery } from '@/components/gallery';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { formatPrice, formatMileage, isUKNumberPlate, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import NotFound from '@/pages/not-found';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';
import { vehiclePageMeta } from '@/lib/page-meta';
import { getPhoneHref, getVehicleBookingHref, getVehicleWhatsAppHref, recordBookingIntent, recordContactIntent } from '@/lib/cta-helpers';
import { navigateToHomeTarget } from '@/lib/home-navigation';

function getSimilarCars(currentCar: Car, cars: Car[]) {
  const priceRange = currentCar.price ? Math.max(2500, currentCar.price * 0.25) : null;

  return cars
    .filter((candidate) => candidate.id !== currentCar.id)
    .map((candidate) => {
      let score = 0;
      const priceDistance =
        currentCar.price != null && candidate.price != null
          ? Math.abs(currentCar.price - candidate.price)
          : Number.MAX_SAFE_INTEGER;

      if (currentCar.make && candidate.make === currentCar.make) score += 5;
      if (currentCar.model && candidate.model === currentCar.model) score += 5;
      if (currentCar.bodyType && candidate.bodyType === currentCar.bodyType) score += 3;
      if (currentCar.fuel && candidate.fuel === currentCar.fuel) score += 2;
      if (currentCar.transmission && candidate.transmission === currentCar.transmission) score += 2;
      if (currentCar.year != null && candidate.year != null && Math.abs(currentCar.year - candidate.year) <= 2) score += 1;
      if (priceRange != null && candidate.price != null && priceDistance <= priceRange) score += 2;

      return { candidate, score, priceDistance };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.priceDistance - right.priceDistance;
    })
    .slice(0, 4)
    .map(({ candidate }) => candidate);
}

function LedgerRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-4 border-b-2 border-primary/10">
      <dt className="font-display text-[12px] font-bold uppercase tracking-widest text-primary/60">{label}</dt>
      <dd className="font-bold text-[14px] text-primary text-right" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export default function CarDetail() {
  const [, params] = useRoute('/vehicle/:id');
  const [location, setLocation] = useLocation();
  const { stock, isLoading } = useStock();
  const { settings: dealerConfig } = useDealerSettings();
  const car = stock?.cars?.find((candidate) => candidate.id === params?.id);

  usePageMeta(car ? vehiclePageMeta(car, dealerConfig) : null);

  if (isLoading) {
    return (
      <div className="luxxy-shell min-h-[70vh] bg-background" aria-label="Loading vehicle" aria-busy="true">
        <div className="container mx-auto grid gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px] lg:items-start lg:gap-14 lg:px-8">
          <div className="space-y-4 lg:col-start-1 lg:row-start-1">
            <div className="aspect-video w-full animate-pulse bg-primary/10 border-4 border-primary" />
            <div className="h-[4.5rem] w-full animate-pulse bg-primary/10 border-4 border-primary" />
          </div>
          <div className="space-y-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 border-4 border-primary bg-background p-8 shadow-[8px_8px_0px_hsl(var(--primary))]">
            <div className="h-10 w-3/4 animate-pulse bg-primary/10" />
            <div className="h-16 w-1/2 animate-pulse bg-primary/10" />
            <div className="h-40 w-full animate-pulse bg-primary/10" />
          </div>
        </div>
      </div>
    );
  }

  if (!stock || !stock.cars || !car) return <NotFound />;

  const similarCars = getSimilarCars(car, stock.cars);
  const registration = vehicleRegistration(car);
  const registrationBand = [car.registrationBand, car.registration]
    .map((value) => value?.trim() || '')
    .find((value) => value && !isUKNumberPlate(value));
  const registrationYear = registrationBand || (car.year ? String(car.year) : 'Unknown');
  const bookingHref = getVehicleBookingHref(car);
  const phoneHref = getPhoneHref(dealerConfig);
  const whatsappHref = getVehicleWhatsAppHref(car, 'get more information about this vehicle', dealerConfig);
  const vehicleLabel = vehicleDisplayTitle(car);
  const photoCount = car.imageCount || car.images?.length || (car.heroImage ? 1 : 0);

  const overviewSpecs = [
    { label: 'Body Type', value: car.bodyType || '-' },
    { label: 'Doors', value: car.doors ? String(car.doors) : '-' },
    { label: 'Seats', value: car.seats ? String(car.seats) : '-' },
    { label: 'Colour', value: car.colour || '-' },
    { label: 'Drivetrain', value: car.drivetrain || '-' },
    { label: 'Emissions', value: car.emissionClass || '-' },
  ];

  const keyFacts: { label: string; value: string; testId?: string }[] = [
    { label: 'Reg Year', value: registrationYear, testId: 'text-registration-year' },
    { label: 'Mileage', value: car.mileage ? formatMileage(car.mileage) : (car.mileageText || 'Unknown') },
    {
      label: 'Fuel/Engine',
      value: `${car.fuel || '-'} • ${car.engineSize || (car.engineCC ? `${(car.engineCC / 1000).toFixed(1)}L` : '-')}`,
    },
    { label: 'Transmission', value: car.transmission || '-' },
  ];

  const damageDisclosure = (() => {
    const category = (car.writeOffCategory || '').toUpperCase();
    if (category.includes('S')) {
      return {
        label: 'Category S',
        explanation:
          'This vehicle previously had structural damage recorded by an insurer and has since been repaired. Ask us for the available repair and inspection details.',
      };
    }
    if (category.includes('N')) {
      return {
        label: 'Category N',
        explanation:
          'This vehicle previously had non-structural damage recorded by an insurer and has since been repaired. Ask us for the available repair and inspection details.',
      };
    }
    return null;
  })();

  return (
    <div className="luxxy-shell min-h-screen pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0 bg-background">
       <div className="sticky top-[calc(var(--site-header-height))] z-40 border-b border-primary/10 bg-background/85 backdrop-blur-xl">
        <div className="container mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-8">
          <Link
            href="/#stock"
             className="inline-flex items-center gap-3 py-4 font-display text-[12px] font-semibold text-primary transition-colors hover:text-accent group sm:py-5"
          >
            <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
            Back to showroom
          </Link>
        </div>
      </div>

      <div className="container mx-auto max-w-[90rem] px-4 py-5 sm:px-6 sm:py-8 lg:px-8 lg:py-12">
        <div className="grid min-w-0 grid-cols-1 gap-5 sm:gap-8 lg:grid-cols-[minmax(0,1.2fr)_400px] xl:grid-cols-[minmax(0,1.4fr)_460px] lg:items-start lg:gap-14 xl:gap-20">
          
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
             <div className="rounded-2xl border border-primary/10 bg-card p-2 shadow-[0_18px_42px_hsl(var(--primary)/.1)]">
               <Gallery images={car.images || []} heroImage={car.heroImage} />
            </div>
          </div>

          {/* Right Column: Key Details & CTA */}
           <div className="min-w-0 rounded-2xl border border-primary/10 bg-card p-6 shadow-[0_18px_42px_hsl(var(--primary)/.09)] sm:p-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:p-10">
             <div className="mb-5 border-b border-primary/10 pb-5 sm:mb-8 sm:pb-8">
               <h1 className="font-display text-[clamp(1.75rem,7vw,2.25rem)] font-semibold leading-[1.05] tracking-[-.05em] text-primary sm:text-5xl">
                {vehicleLabel}
              </h1>
              {(car.variant || car.trim) && (
                 <p className="mt-4 text-sm font-medium text-primary/65">
                  {car.variant || car.trim}
                </p>
              )}
            </div>

             <div className="mb-6 flex flex-wrap items-baseline gap-3 border-b border-primary/15 pb-5 sm:mb-10 sm:gap-4 sm:pb-8">
               <p className="font-display text-[clamp(2.25rem,10vw,3.5rem)] font-semibold leading-none tracking-[-.06em] text-primary sm:text-[4.5rem]">
                {car.price ? formatPrice(car.price, car.currency) : 'POA'}
              </p>
              {car.priceType && car.priceType.toLowerCase() !== 'cash' && (
                <span className="font-display text-sm font-bold uppercase tracking-widest text-primary/50">
                  {car.priceType}
                </span>
              )}
            </div>

            {registration && (
              <div className="mb-10">
                <UKNumberPlate
                  size="sm"
                  value={registration}
                  testId={`plate-vehicle-${car.id}`}
                  className="w-[140px]"
                />
              </div>
            )}

            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                 <div className="h-1.5 w-8 rounded-full bg-accent" />
                 <h3 className="font-display text-[15px] font-semibold text-primary">Overview</h3>
              </div>
              <dl className="grid gap-y-0">
                <LedgerRow label="Photos" value={photoCount > 0 ? `${photoCount} available` : 'To follow'} />
                {keyFacts.map((fact) => (
                  <LedgerRow key={fact.label} label={fact.label} value={fact.value} testId={fact.testId} />
                ))}
              </dl>
            </div>

            <div className="mb-10 hidden flex-col gap-4 sm:flex lg:flex">
              <Button asChild size="lg" className="h-16 rounded-none bg-primary font-display text-[15px] font-bold uppercase tracking-[0.15em] text-primary-foreground shadow-[6px_6px_0px_hsl(var(--accent))] transition-all hover:bg-accent hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_hsl(var(--accent))] active:shadow-none">
                <a
                   href={bookingHref}
                   onClick={() => recordBookingIntent({ source: 'car_detail', vehicleContext: true })}
                   target={bookingHref.startsWith('https://') ? '_blank' : undefined}
                   rel={bookingHref.startsWith('https://') ? 'noopener noreferrer' : undefined}
                  data-vehicle-contact="booking"
                >
                  <Calendar className="mr-3 h-5 w-5" />
                  {dealerConfig.bookViewing.ctaLabel}
                </a>
              </Button>
              <div className="grid grid-cols-2 gap-4">
                {phoneHref && (
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-16 rounded-none border-2 border-primary bg-background font-display text-[13px] font-bold uppercase tracking-widest text-primary shadow-[4px_4px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[1px_1px_0px_hsl(var(--primary))]"
                  >
                    <a
                      href={phoneHref}
                      aria-label={`Call about ${vehicleLabel}`}
                      onClick={() => recordContactIntent({ channel: 'call', car, source: 'car-detail' })}
                      data-vehicle-contact="call"
                    >
                      <Phone className="mr-3 h-4 w-4 text-accent" />
                      Call
                    </a>
                  </Button>
                )}
                {whatsappHref && (
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                     className="h-16 rounded-none border-2 border-[#25D366] bg-background font-display text-[13px] font-bold uppercase tracking-widest text-[#25D366] shadow-[4px_4px_0px_#25D366] transition-all hover:bg-[#25D366] hover:text-white hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[1px_1px_0px_#25D366]"
                  >
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`WhatsApp about ${vehicleLabel}`}
                      onClick={() => recordContactIntent({ channel: 'whatsapp', car, source: 'car-detail' })}
                      data-vehicle-contact="whatsapp"
                    >
                      <MessageCircle className="mr-3 h-5 w-5" />
                      Msg
                    </a>
                  </Button>
                )}
              </div>
            </div>

             <div className="mt-auto border-t border-primary/10 pt-8 font-display text-[11px] font-medium leading-relaxed text-primary/50">
              <p>
                SOLD BY <strong className="font-black text-primary">{dealerConfig.identity.name || stock.dealerName || 'Independent Dealer'}</strong>. VIEWINGS BY APPOINTMENT.
              </p>
            </div>
          </div>

          <section
            className="border-t-4 border-primary pt-12 lg:col-start-1 lg:row-start-2 mt-8"
            aria-labelledby="vehicle-overview-heading"
          >
            <div className="flex items-center gap-4 mb-10">
              <div className="h-3 w-12 bg-accent" />
              <h2 id="vehicle-overview-heading" className="font-display text-3xl font-black uppercase tracking-tighter text-primary">
                Technical Data
              </h2>
            </div>
            <dl className="grid gap-x-16 sm:grid-cols-2 bg-background border-2 border-primary p-8 shadow-[4px_4px_0px_hsl(var(--primary))]">
              {overviewSpecs.map((spec) => (
                <LedgerRow key={spec.label} label={spec.label} value={spec.value} />
              ))}
            </dl>
            {damageDisclosure && (
              <div className="mt-12 border-4 border-accent p-6 bg-accent/5">
                <div className="flex items-center gap-3 mb-4">
                  <Info className="h-6 w-6 text-accent" />
                  <p className="font-display text-lg font-black uppercase tracking-wider text-primary">
                    Insurance Note: {damageDisclosure.label}
                  </p>
                </div>
                <p className="text-sm font-bold leading-relaxed text-primary/80 uppercase tracking-wide">
                  {damageDisclosure.explanation}
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-primary/15 bg-background/95 p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden" data-testid="mobile-conversion-bar">
          <Button asChild className="h-auto min-h-12 min-w-0 flex-1 whitespace-normal rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground shadow-none hover:bg-accent hover:text-accent-foreground">
            <a href={bookingHref} onClick={() => recordBookingIntent({ source: 'car_detail_mobile', vehicleContext: true })}><Calendar className="mr-2 h-4 w-4" />{dealerConfig.bookViewing.ctaLabel}</a>
          </Button>
          {phoneHref && (
            <Button asChild variant="outline" size="icon" className="h-12 w-12 shrink-0 rounded-xl border border-primary/20 bg-background text-primary shadow-none hover:bg-primary hover:text-primary-foreground">
              <a href={phoneHref} aria-label="Call about this vehicle" onClick={() => recordContactIntent({ channel: 'call', car, source: 'car-detail-mobile' })}><Phone className="h-5 w-5" /></a>
            </Button>
          )}
        </div>
      </div>

      {similarCars.length > 0 && (
        <section className="bg-primary py-24 text-primary-foreground border-t-8 border-accent relative overflow-hidden" aria-labelledby="similar-cars-heading">
          <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
             <span className="font-display text-[20rem] font-black leading-none">MORE</span>
          </div>
          <div className="container mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="mb-16 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between border-b-2 border-primary-foreground/20 pb-10">
              <div>
                <p className="font-display text-sm font-black uppercase tracking-[0.2em] text-accent mb-4">Alternatives</p>
                <h2
                  id="similar-cars-heading"
                  className="heading-2 text-primary-foreground"
                >
                  SIMILAR VEHICLES
                </h2>
                <p className="mt-6 max-w-xl font-bold uppercase tracking-wide text-primary-foreground/70">
                  A few other vehicles from our current stock that may suit what you're looking for.
                </p>
              </div>
              <Link
                href="/#stock"
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  navigateToHomeTarget('stock', location, setLocation);
                }}
                className="shrink-0 font-display text-[13px] font-bold uppercase tracking-[0.2em] text-accent transition-colors hover:text-primary-foreground pb-1 flex items-center gap-2 group"
              >
                View all stock <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4 xl:gap-10">
              {similarCars.map((similarCar) => (
                <CarCard key={similarCar.id} car={similarCar} stretchedLink analyticsSource="similar_cars" />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}