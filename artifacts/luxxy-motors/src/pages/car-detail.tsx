import { useRoute } from 'wouter';
import { ArrowLeft, MessageCircle, Phone, Calendar } from 'lucide-react';
import { Link } from 'wouter';
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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-5 border-b border-border/40 py-3 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium text-primary" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export default function CarDetail() {
  const [, params] = useRoute('/vehicle/:id');
  const { stock, isLoading } = useStock();
  const { settings: dealerConfig } = useDealerSettings();
  const car = stock?.cars?.find((candidate) => candidate.id === params?.id);

  usePageMeta(car ? vehiclePageMeta(car, dealerConfig) : null);

  if (isLoading) {
    return (
      <div className="luxxy-shell min-h-[70vh]" aria-label="Loading vehicle" aria-busy="true">
        <div className="container mx-auto grid gap-8 px-4 py-12 sm:px-6 lg:grid-cols-3 lg:gap-10 lg:px-8">
          <div className="space-y-3 lg:col-span-2">
            <div className="aspect-video w-full animate-pulse bg-secondary" />
            <div className="h-[4.5rem] w-full animate-pulse bg-secondary" />
          </div>
          <div className="space-y-4">
            <div className="h-10 w-3/4 animate-pulse bg-secondary" />
            <div className="h-16 w-1/2 animate-pulse bg-secondary" />
            <div className="h-40 w-full animate-pulse bg-secondary" />
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
    { label: 'Registration Year', value: registrationYear, testId: 'text-registration-year' },
    { label: 'Mileage', value: car.mileage ? formatMileage(car.mileage) : (car.mileageText || 'Unknown') },
    {
      label: 'Fuel & Engine',
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
    <div className="luxxy-shell luxxy-grain min-h-screen pb-20 lg:pb-0">
      <div className="border-b border-border/60 bg-background/50 backdrop-blur-sm">
        <div className="container mx-auto max-w-[85rem] px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 py-5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to showroom
          </Link>
        </div>
      </div>

      <div className="container mx-auto max-w-[85rem] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="grid min-w-0 grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-14 xl:grid-cols-[minmax(0,1fr)_420px] xl:gap-20">
          
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <Gallery images={car.images || []} heroImage={car.heroImage} />
          </div>

          {/* Right Column: Key Details & CTA */}
          <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 flex flex-col pt-2 lg:pt-0">
            <div className="mb-7">
              <h1 className="font-display text-[2.25rem] font-medium leading-[1.08] tracking-[-.02em] text-primary sm:text-[2.5rem]">
                {vehicleLabel}
              </h1>
              {(car.variant || car.trim) && (
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                  {car.variant || car.trim}
                </p>
              )}
            </div>

            {registration && (
              <div className="mb-7 flex flex-wrap items-center gap-3">
                <UKNumberPlate
                  size="sm"
                  value={registration}
                  testId={`plate-vehicle-${car.id}`}
                  className="w-[132px] shrink-0"
                />
              </div>
            )}

            <div className="mb-9 flex items-end justify-between border-b border-border/60 pb-7">
              <div>
                <p className="mb-2 text-sm text-muted-foreground">Price</p>
                <p className="luxxy-price text-[2.75rem] leading-none text-primary">
                  {car.price ? formatPrice(car.price, car.currency) : 'POA'}
                </p>
              </div>
              {car.priceType && car.priceType.toLowerCase() !== 'cash' && (
                <span className="shrink-0 text-sm text-muted-foreground">
                  {car.priceType}
                </span>
              )}
            </div>

            <div className="mb-9">
              <h2 className="mb-2 font-display text-xl font-medium text-primary">At a glance</h2>
              <dl className="grid gap-1">
                <LedgerRow label="Photographs" value={photoCount > 0 ? `${photoCount} available` : 'To follow'} />
                {keyFacts.map((fact) => (
                  <LedgerRow key={fact.label} label={fact.label} value={fact.value} testId={fact.testId} />
                ))}
              </dl>
            </div>

            <div className="mb-9 hidden grid-cols-2 gap-3 sm:grid lg:grid">
              <Button asChild size="lg" className="col-span-2 h-14 bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                <a
                   href={bookingHref}
                   onClick={() => recordBookingIntent({ source: 'car_detail', vehicleContext: true })}
                   target={bookingHref.startsWith('https://') ? '_blank' : undefined}
                   rel={bookingHref.startsWith('https://') ? 'noopener noreferrer' : undefined}
                  data-vehicle-contact="booking"
                >
                  <Calendar className="mr-3 h-4 w-4" />
                  {dealerConfig.bookViewing.ctaLabel}
                </a>
              </Button>
              {phoneHref && (
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="h-14 border-border bg-transparent px-4 text-sm font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <a
                    href={phoneHref}
                    aria-label={`Call about ${vehicleLabel}`}
                    onClick={() => recordContactIntent({ channel: 'call', car, source: 'car-detail' })}
                    data-vehicle-contact="call"
                  >
                    <Phone className="mr-2 h-4 w-4 text-accent" />
                    Call
                  </a>
                </Button>
              )}
              {whatsappHref && (
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                   className="luxxy-contact h-14 border-border bg-transparent px-4 text-sm font-medium text-foreground transition-colors hover:border-[#1f7a4d]/40 hover:bg-[#1f7a4d]/5 hover:text-[#1f7a4d]"
                >
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`WhatsApp about ${vehicleLabel}`}
                    onClick={() => recordContactIntent({ channel: 'whatsapp', car, source: 'car-detail' })}
                    data-vehicle-contact="whatsapp"
                  >
                    <MessageCircle className="mr-2 h-4 w-4" />
                    WhatsApp
                  </a>
                </Button>
              )}
            </div>

            <div className="border-l-2 border-accent bg-secondary/25 px-5 py-4">
              <p className="text-sm leading-6 text-muted-foreground">
                This car is sold by <strong className="font-medium text-primary">{dealerConfig.identity.name || stock.dealerName || 'Independent Dealer'}</strong>. Viewings are by appointment.
              </p>
            </div>
          </div>

          <section
            className="border-t border-border/50 pt-7 lg:col-start-1 lg:row-start-2"
            aria-labelledby="vehicle-overview-heading"
          >
            <h2 id="vehicle-overview-heading" className="mb-3 font-display text-2xl font-medium text-primary">
              Vehicle details
            </h2>
            <dl className="grid gap-x-16 sm:grid-cols-2">
              {overviewSpecs.map((spec) => (
                <LedgerRow key={spec.label} label={spec.label} value={spec.value} />
              ))}
            </dl>
            {damageDisclosure && (
              <div className="mt-8 border-l-2 border-accent bg-secondary/25 px-5 py-4 text-sm leading-6 text-muted-foreground">
                <p className="font-medium text-primary">
                  Insurance history: {damageDisclosure.label}
                </p>
                <p className="mt-2 max-w-3xl">{damageDisclosure.explanation}</p>
              </div>
            )}
          </section>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-[1fr_auto] gap-2 border-t border-border bg-background p-3 lg:hidden" data-testid="mobile-conversion-bar">
          <Button asChild className="h-14 text-sm font-medium">
            <a href={bookingHref} onClick={() => recordBookingIntent({ source: 'car_detail_mobile', vehicleContext: true })}><Calendar className="mr-2 h-4 w-4" />{dealerConfig.bookViewing.ctaLabel}</a>
          </Button>
          {phoneHref && (
            <Button asChild variant="outline" size="icon" className="h-14 w-14 border-border text-accent hover:border-accent hover:text-accent">
              <a href={phoneHref} onClick={() => recordContactIntent({ channel: 'call', car, source: 'car-detail-mobile' })}><Phone className="h-4 w-4" /></a>
            </Button>
          )}
        </div>

        {similarCars.length > 0 && (
          <section className="mt-16 border-t border-border/60 pt-10 sm:mt-24 sm:pt-16" aria-labelledby="similar-cars-heading">
            <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Other cars worth a look</p>
                <h2
                  id="similar-cars-heading"
                  className="mt-5 font-display text-[2rem] font-medium leading-none tracking-[-.02em] text-primary"
                >
                  Similar cars
                </h2>
                <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                  A few other vehicles from our current stock that may suit what you&apos;re looking for.
                </p>
              </div>
              <Link
                href="/#stock"
                className="shrink-0 text-sm font-medium text-primary transition-colors hover:text-accent"
              >
                View all stock <span aria-hidden="true" className="ml-1 opacity-70">→</span>
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4 xl:gap-8">
              {similarCars.map((similarCar) => (
                <CarCard key={similarCar.id} car={similarCar} stretchedLink analyticsSource="similar_cars" />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
