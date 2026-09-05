import { useRoute } from 'wouter';
import { ArrowLeft, Activity, MessageCircle, Phone, Calendar, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { CarCard } from '@/components/car-card';
import { useStock, type Car } from '@/lib/stock-context';
import { Gallery } from '@/components/gallery';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { formatPrice, formatMileage, isUKNumberPlate, vehicleRegistration } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import NotFound from '@/pages/not-found';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';
import { vehiclePageMeta } from '@/lib/page-meta';
import { getPhoneHref, getVehicleBookingHref, getVehicleWhatsAppHref, recordContactIntent } from '@/lib/cta-helpers';

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
    <div className="flex items-baseline gap-2">
      <dt className="luxxy-label shrink-0 text-muted-foreground">{label}</dt>
      <span className="luxxy-leader" aria-hidden="true" />
      <dd className="shrink-0 font-mono text-[13px] font-bold text-foreground" data-testid={testId}>
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

  // Title, description and link-preview tags for this vehicle; the showroom
  // defaults come back when the page unmounts.
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
  // Only an authoritative plate earns plate styling; a registration band such as
  // "2009 (59 reg)" is year metadata, so it reads as an ordinary ledger value.
  const registrationBand = [car.registrationBand, car.registration]
    .map((value) => value?.trim() || '')
    .find((value) => value && !isUKNumberPlate(value));
  const registrationYear = registrationBand || (car.year ? String(car.year) : 'Unknown');
  const bookingHref = getVehicleBookingHref(car);
  const phoneHref = getPhoneHref(dealerConfig);
  const whatsappHref = getVehicleWhatsAppHref(car, 'get more information about this vehicle', dealerConfig);
  const vehicleLabel = car.title || `${car.make || ''} ${car.model || ''}`.trim();
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
    <div className="luxxy-shell luxxy-grain min-h-screen">
      <div className="border-b border-border bg-background">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="luxxy-label inline-flex items-center gap-2 py-5 text-muted-foreground transition-colors hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Showroom
          </Link>
        </div>
      </div>

      <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        {/* Explicit placement keeps the purchase panel ahead of the spec ledger on
            narrow screens, while both stay beside the gallery on desktop. */}
        <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">

          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <Gallery images={car.images || []} heroImage={car.heroImage} />
          </div>

          {/* Right Column: Key Details & CTA */}
          <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="sticky top-[calc(var(--site-header-height,5rem)+1.5rem)] border border-border bg-card">
              <div className="border-b border-border/70 p-6 sm:p-8">
                <h1 className="font-display text-[1.9rem] font-semibold leading-[1.08] tracking-tight text-primary">
                  {car.title || `${car.make} ${car.model}`}
                </h1>

                {(car.variant || car.trim) && (
                  <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
                    {car.variant || car.trim}
                  </p>
                )}

                {registration && (
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <UKNumberPlate
                      size="sm"
                      value={registration}
                      testId={`plate-vehicle-${car.id}`}
                      className="w-[132px] shrink-0"
                    />
                  </div>
                )}

                <dl className="mt-5 grid grid-cols-2 border border-border/70 bg-background">
                  <div className="border-r border-border/70 px-3 py-2.5">
                    <dt className="luxxy-label text-muted-foreground">Photographs</dt>
                    <dd className="mt-1 text-[13px] font-bold text-foreground">
                      {photoCount > 0 ? `${photoCount} available` : 'To follow'}
                    </dd>
                  </div>
                  <div className="px-3 py-2.5">
                    <dt className="luxxy-label text-muted-foreground">Mileage</dt>
                    <dd className="mt-1 text-[13px] font-bold text-foreground">
                      {car.mileage ? formatMileage(car.mileage) : (car.mileageText || 'Unknown')}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="flex items-end justify-between gap-4 border-b border-border/70 p-6 sm:p-8">
                <div>
                  <p className="luxxy-label text-muted-foreground">Price</p>
                  <p className="luxxy-price mt-2 text-[2.5rem] leading-none text-primary">
                    {car.price ? formatPrice(car.price, car.currency) : 'POA'}
                  </p>
                </div>
                {car.priceType && car.priceType.toLowerCase() !== 'cash' && (
                  <span className="luxxy-label shrink-0 border border-border bg-background px-2.5 py-1.5 text-muted-foreground">
                    {car.priceType}
                  </span>
                )}
              </div>

              <dl className="grid gap-3.5 border-b border-border/70 p-6 sm:p-8 bg-background">
                {keyFacts.map((fact) => (
                  <LedgerRow key={fact.label} label={fact.label} value={fact.value} testId={fact.testId} />
                ))}
              </dl>

              <div className="grid grid-cols-2 gap-2 p-6 sm:p-8">
                <Button asChild size="lg" className="col-span-2 h-12 text-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground">
                  <a
                     href={bookingHref}
                     target={bookingHref.startsWith('https://') ? '_blank' : undefined}
                     rel={bookingHref.startsWith('https://') ? 'noopener noreferrer' : undefined}
                    data-vehicle-contact="booking"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {dealerConfig.bookViewing.ctaLabel}
                  </a>
                </Button>
                {phoneHref && (
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-12 border-border bg-background px-4 text-[13px] font-bold text-foreground hover:border-primary/45 hover:bg-secondary hover:text-foreground"
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
                    className="h-12 border-[#1f7a4d]/30 bg-[#1f7a4d]/10 px-4 text-[13px] font-bold text-[#1b6543] hover:bg-[#1f7a4d]/20 hover:text-[#1b6543]"
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

              <div className="flex gap-3 border-t border-border/70 bg-secondary/25 px-6 sm:px-8 py-5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <p className="text-[13px] leading-6 text-muted-foreground">
                  Sold by {dealerConfig.identity.name || stock.dealerName || 'Independent Dealer'}. Viewings by appointment only.
                </p>
              </div>
            </div>
          </div>

          <section
            className="border border-border bg-card lg:col-start-1 lg:row-start-2"
            aria-labelledby="vehicle-overview-heading"
          >
            <div className="flex items-center gap-3 border-b border-border/70 px-6 py-4 sm:px-8 bg-secondary/15">
              <Activity className="h-4 w-4 shrink-0 text-accent" />
              <h2 id="vehicle-overview-heading" className="luxxy-label text-primary">
                Vehicle Overview
              </h2>
            </div>
            <dl className="grid gap-x-12 gap-y-3.5 px-6 sm:px-8 py-6 sm:grid-cols-2 bg-background">
              {overviewSpecs.map((spec) => (
                <LedgerRow key={spec.label} label={spec.label} value={spec.value} />
              ))}
            </dl>
            {damageDisclosure && (
              <div className="border-t border-border/70 bg-secondary/20 px-6 py-5 text-[13px] leading-6 text-muted-foreground sm:px-8">
                <p className="luxxy-label text-foreground">
                  Insurance history · {damageDisclosure.label}
                </p>
                <p className="mt-2 max-w-3xl">{damageDisclosure.explanation}</p>
              </div>
            )}
          </section>

        </div>

        {similarCars.length > 0 && (
          <section className="mt-16 border-t border-border pt-10" aria-labelledby="similar-cars-heading">
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="luxxy-kicker text-accent">Keep exploring</p>
                <h2
                  id="similar-cars-heading"
                  className="mt-4 font-display text-4xl font-semibold leading-none tracking-[-.03em] text-primary"
                >
                  Similar cars
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
                  A few other vehicles from our current stock that may suit what you&apos;re looking for.
                </p>
              </div>
              <Link
                href="/#stock"
                className="luxxy-label shrink-0 text-primary transition-colors hover:text-accent"
              >
                View all stock <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
              {similarCars.map((similarCar) => (
                <CarCard key={similarCar.id} car={similarCar} stretchedLink />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
