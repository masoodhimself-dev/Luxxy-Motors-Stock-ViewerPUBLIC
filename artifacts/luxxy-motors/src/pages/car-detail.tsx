import { useState, type MouseEvent } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import {
  ArrowLeft,
  ArrowRight,
  MessageCircle,
  Phone,
  Calendar,
  Info,
  Share2,
  Check,
} from 'lucide-react';
import { CarCard } from '@/components/car-card';
import { useStock, type Car } from '@/lib/stock-context';
import { SaveCarButton, CompareCarButton } from '@/components/saved-car-controls';
import { Gallery } from '@/components/gallery';
import { UKNumberPlate } from '@/components/uk-number-plate';
import {
  formatPrice,
  formatMileage,
  isUKNumberPlate,
  vehicleDisplayTitle,
  vehicleRegistration,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import NotFound from '@/pages/not-found';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';
import { vehiclePageMeta } from '@/lib/page-meta';
import {
  getPhoneHref,
  getVehicleBookingHref,
  getVehicleWhatsAppHref,
  recordBookingIntent,
  recordContactIntent,
} from '@/lib/cta-helpers';
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
      if (
        currentCar.year != null &&
        candidate.year != null &&
        Math.abs(currentCar.year - candidate.year) <= 2
      )
        score += 1;
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
    <div className="flex justify-between items-baseline gap-4 py-3 border-b border-border">
      <dt className="font-display text-[13px] font-normal tracking-normal text-primary/60">
        {label}
      </dt>
      <dd className="font-medium text-[14px] text-primary text-right" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export default function CarDetail() {
  const [shareMessage, setShareMessage] = useState('');
  const [, params] = useRoute('/vehicle/:id');
  const [location, setLocation] = useLocation();
  const { stock, isLoading } = useStock();
  const { settings: dealerConfig } = useDealerSettings();
  const car = stock?.cars?.find((candidate) => candidate.id === params?.id);

  usePageMeta(car ? vehiclePageMeta(car, dealerConfig) : null);

  if (isLoading) {
    return (
      <div
        className="luxxy-shell min-h-[70vh] bg-background"
        aria-label="Loading vehicle"
        aria-busy="true"
      >
        <div className="container mx-auto grid gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px] lg:items-start lg:gap-14 lg:px-8">
          <div className="space-y-4 lg:col-start-1 lg:row-start-1">
            <div className="aspect-video w-full animate-pulse bg-primary/10 border border-primary" />
            <div className="h-[4.5rem] w-full animate-pulse bg-primary/10 border border-primary" />
          </div>
          <div className="space-y-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 border border-primary bg-background p-8 shadow-none">
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
  const whatsappHref = getVehicleWhatsAppHref(
    car,
    'get more information about this vehicle',
    dealerConfig,
  );
  const vehicleLabel = vehicleDisplayTitle(car);

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
    {
      label: 'Mileage',
      value: car.mileage ? formatMileage(car.mileage) : car.mileageText || 'Unknown',
    },
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

  const description = [
    car.description,
    car.specifications?.description,
    car.sourceExtras?.description,
  ].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  const rawFeatures = car.features ?? car.specifications?.features ?? car.sourceExtras?.features;
  const features = Array.isArray(rawFeatures)
    ? rawFeatures.filter((value): value is string => typeof value === 'string')
    : [];
  const share = async () => {
    try {
      const url = window.location.href;
      if (navigator.share) await navigator.share({ title: vehicleLabel, url });
      else {
        await navigator.clipboard.writeText(url);
        setShareMessage('Link copied');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        setShareMessage('Copy this page’s address to share the vehicle.');
    }
  };

  return (
    <div className="luxxy-shell min-h-screen pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2 py-4">
          <Link href="/#stock" className="text-link text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to showroom
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <SaveCarButton
              car={car}
              variant="inline"
              className="border-transparent bg-transparent"
            />
            <Button variant="ghost" onClick={share} aria-label="Share this vehicle">
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">Share</span>
            </Button>
            <span className="text-xs text-muted-foreground" role="status">
              {shareMessage}
            </span>
          </div>
        </div>
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)] lg:gap-10">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <Gallery key={car.id} images={car.images || []} heroImage={car.heroImage} />
          </div>
          <aside className="min-w-0 border-y border-border bg-card px-5 py-6 sm:rounded-md sm:border sm:p-7 lg:col-start-2 lg:row-start-1 lg:row-span-2">
            <p className="luxxy-kicker mb-3">
              {car.registrationBand || car.year || 'Available now'}
            </p>
            <h1 className="font-display text-[1.9rem] font-semibold leading-tight tracking-tight text-primary">
              {vehicleLabel}
            </h1>
            {(car.variant || car.trim) && (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {car.variant || car.trim}
              </p>
            )}
            <div className="my-5 border-b border-border pb-5">
              <p className="luxxy-price text-[2rem]">
                {car.price ? formatPrice(car.price, car.currency) : 'Price on application'}
              </p>
              {car.priceType && car.priceType.toLowerCase() !== 'cash' && (
                <p className="mt-1 text-xs text-muted-foreground">{car.priceType}</p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
              {keyFacts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                  <dd className="mt-1 text-sm font-medium" data-testid={fact.testId}>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
            {registration && (
              <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">Registration</span>
                <UKNumberPlate
                  size="sm"
                  value={registration}
                  testId={`plate-vehicle-${car.id}`}
                  className="w-[120px]"
                />
              </div>
            )}
            <div className="mt-6 flex flex-col gap-3">
              <Button asChild size="lg">
                <a
                  href={bookingHref}
                  onClick={() =>
                    recordBookingIntent({ source: 'car_detail', vehicleContext: true })
                  }
                  data-vehicle-contact="booking"
                >
                  <Calendar className="h-4 w-4" />
                  {dealerConfig.bookViewing.ctaLabel}
                </a>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href={`/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}`}>
                  Enquire about this car
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <div className="grid grid-cols-2 gap-2">
                {phoneHref && (
                  <a
                    href={phoneHref}
                    className="text-link justify-center text-sm"
                    aria-label={`Call about ${vehicleLabel}`}
                    onClick={() =>
                      recordContactIntent({ channel: 'call', car, source: 'car-detail' })
                    }
                    data-vehicle-contact="call"
                  >
                    <Phone className="h-4 w-4" />
                    Call us
                  </a>
                )}
                {whatsappHref && (
                  <a
                    href={whatsappHref}
                    className="text-link justify-center text-sm text-[hsl(var(--contact))]"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`WhatsApp about ${vehicleLabel}`}
                    onClick={() =>
                      recordContactIntent({ channel: 'whatsapp', car, source: 'car-detail' })
                    }
                    data-vehicle-contact="whatsapp"
                  >
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp
                  </a>
                )}
              </div>
            </div>
            <p className="mt-4 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
              {dealerConfig.identity.name || stock.dealerName} · Viewings by appointment. Take your
              time with the car and ask us anything.
            </p>
            <div className="mt-3 flex items-center justify-between">
              <CompareCarButton car={car} variant="compact" className="min-h-11" />
              <Link href="/compare" className="text-link text-xs text-muted-foreground">
                View comparison
              </Link>
            </div>
          </aside>
          <div className="min-w-0 pb-10 lg:col-start-1 lg:row-start-2">
            <section
              aria-labelledby="vehicle-overview-heading"
              className="border-t border-border pt-7"
            >
              <h2 id="vehicle-overview-heading" className="section-heading">
                Vehicle specification
              </h2>
              <dl className="mt-5 grid gap-x-8 sm:grid-cols-2">
                {overviewSpecs.map((spec) => (
                  <LedgerRow key={spec.label} label={spec.label} value={spec.value} />
                ))}
              </dl>
            </section>
            <section
              className="mt-8 border-t border-border pt-7"
              aria-labelledby="vehicle-description-heading"
            >
              <h2 id="vehicle-description-heading" className="section-heading">
                About this vehicle
              </h2>
              <p className="mt-4 whitespace-pre-line text-sm leading-7 text-muted-foreground">
                {description ||
                  'Speak to our team for the full vehicle description, service history and preparation details. We’ll be happy to answer your questions before you visit.'}
              </p>
            </section>
            {features.length > 0 && (
              <section
                className="mt-8 border-t border-border pt-7"
                aria-labelledby="features-heading"
              >
                <h2 id="features-heading" className="section-heading">
                  Features & equipment
                </h2>
                <ul className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {damageDisclosure && (
              <div className="mt-7 rounded-md border border-amber-700/30 bg-amber-50 p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                  <Info className="h-5 w-5" />
                  Insurance history: {damageDisclosure.label}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-amber-950">
                  {damageDisclosure.explanation}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      <div
        className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-border bg-card p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] lg:hidden"
        data-testid="mobile-conversion-bar"
      >
        <p className="luxxy-price hidden shrink-0 px-1 min-[375px]:block">
          {car.price ? formatPrice(car.price, car.currency) : 'POA'}
        </p>
        <Button asChild className="min-h-12 min-w-0 flex-1">
          <a
            href={bookingHref}
            onClick={() =>
              recordBookingIntent({ source: 'car_detail_mobile', vehicleContext: true })
            }
          >
            <Calendar className="h-4 w-4 shrink-0" />
            {dealerConfig.bookViewing.ctaLabel}
          </a>
        </Button>
        {phoneHref && (
          <Button asChild variant="outline" size="icon" className="h-12 w-12">
            <a
              href={phoneHref}
              aria-label="Call about this vehicle"
              onClick={() =>
                recordContactIntent({ channel: 'call', car, source: 'car-detail-mobile' })
              }
            >
              <Phone className="h-5 w-5" />
            </a>
          </Button>
        )}
      </div>
      {similarCars.length > 0 && (
        <section
          className="section-space border-t border-border bg-secondary/40"
          aria-labelledby="similar-cars-heading"
        >
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2 id="similar-cars-heading" className="section-heading">
                You may also like
              </h2>
              <Link
                href="/#stock"
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  navigateToHomeTarget('stock', location, setLocation);
                }}
                className="text-link"
              >
                View all stock
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {similarCars.map((similarCar) => (
                <CarCard
                  key={similarCar.id}
                  car={similarCar}
                  stretchedLink
                  analyticsSource="similar_cars"
                />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
