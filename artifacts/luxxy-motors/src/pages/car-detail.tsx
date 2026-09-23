import { questionKeyForLabel } from "@/lib/vehicle-questions";
import { getSimilarCars } from "@/lib/similar-cars";
import { buyerInformation } from "@/lib/buyer-information";
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
  FileText,
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
  getVehicleShareUrl,
  recordBookingIntent,
  recordContactIntent,
} from '@/lib/cta-helpers';
import { navigateToHomeTarget } from '@/lib/home-navigation';
import { recordedWriteOffCategory } from '@/lib/vehicle-history';


function LedgerRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-3 border-b border-border">
      <dt className="font-display text-[13px] font-normal tracking-normal text-muted-foreground">
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
  const { stock, isLoading, error } = useStock();
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

  if (error) {
    return <div className="luxxy-shell min-h-[70vh] px-5 py-16"><div className="mx-auto max-w-xl" role="alert">
      <p className="luxxy-kicker">Vehicle details</p>
      <h1 className="mt-4 font-display text-3xl font-semibold">Vehicle details could not be loaded</h1>
      <p className="mt-4 text-muted-foreground">We could not check this vehicle’s current details. Please try again.</p>
      <Button className="mt-6" onClick={() => window.location.reload()}>Try again</Button>
    </div></div>;
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
      label: "Mileage",
      value:
        car.mileage != null
          ? formatMileage(car.mileage)
          : car.mileageText || 'Unknown',
    },
    {
      label: 'Fuel/Engine',
      value: `${car.fuel || '-'} • ${car.engineSize || (car.engineCC ? `${(car.engineCC / 1000).toFixed(1)}L` : '-')}`,
    },
    { label: 'Transmission', value: car.transmission || '-' },
  ];

  const damageDisclosure = (() => {
    const category = recordedWriteOffCategory(car.writeOffCategory);
    if (category === 'S') {
      return {
        label: 'Category S',
        explanation:
          'This vehicle previously had structural damage recorded by an insurer. Ask us for the available repair and inspection records before deciding to buy.',
      };
    }
    if (category === 'N') {
      return {
        label: 'Category N',
        explanation:
          'This vehicle previously had non-structural damage recorded by an insurer. Ask us for the available repair and inspection records before deciding to buy.',
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
      const url = getVehicleShareUrl(car);
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
          <Link href="/" className="text-link text-muted-foreground">
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
          <aside className="min-w-0 border-t border-border py-6 lg:border-t-0 lg:py-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-stretch">
            <p className="luxxy-kicker mb-3">
              {car.registrationBand || car.year || 'Available now'}
            </p>
            <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-primary">
              {vehicleLabel}
            </h1>
            {(car.variant || car.trim) && (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {car.variant || car.trim}
              </p>
            )}
            <div className="my-5 border-b border-border pb-5">
              <p className="luxxy-price text-[2rem]">
                {car.price
                  ? formatPrice(car.price, car.currency)
                  : 'Price on application'}
              </p>
              {car.priceType && car.priceType.toLowerCase() !== 'cash' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {car.priceType}
                </p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
              {keyFacts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-xs text-muted-foreground">
                    {fact.label}
                  </dt>
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
            <a href="#buyer-information-heading" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4" onClick={() => document.getElementById('buyer-information-heading')?.focus()}>History, MOT, keys & warranty <ArrowRight className="h-4 w-4" /></a>
            {damageDisclosure && (
              <a href="#vehicle-history" className="mt-5 inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4">
                {damageDisclosure.label} recorded · Read vehicle history</a>
            )}
            <div className="lg:sticky lg:top-[calc(var(--site-header-height,5rem)+1rem)]" data-testid="desktop-purchase-panel">
            <div className="mt-6 flex flex-col gap-3 border-y border-border bg-card px-4 py-5">
              <p className="hidden lg:block text-sm font-semibold">{car.price ? formatPrice(car.price, car.currency) : "Price on application"} · Arrange a viewing</p>
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
                  Ask a question
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
            <div className="mt-3 flex flex-wrap items-center gap-x-4">
              <a
                href={`/api/vehicles/${encodeURIComponent(car.id)}/brochure.pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link min-h-11 text-sm"
                aria-label={`View PDF details and photographs for ${vehicleLabel} (opens in a new tab)`}
                data-testid="link-vehicle-pdf"
              >
                <FileText className="h-4 w-4" />
                View vehicle PDF
              </a>
              <a
                href={`/api/vehicles/${encodeURIComponent(car.id)}/brochure.pdf`}
                download
                className="text-link min-h-11 text-xs font-normal text-muted-foreground"
                aria-label={`Download PDF details and photographs for ${vehicleLabel}`}
                data-testid="link-download-vehicle-pdf"
              >
                Download
              </a>
            </div>
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
              <p className="mt-4 text-sm font-medium leading-7">{[vehicleLabel, car.year, car.mileage != null ? formatMileage(car.mileage) : car.mileageText, car.fuel, car.transmission].filter(Boolean).join(' · ')}</p>
              {features.length > 0 && <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2" aria-label="Supplied vehicle highlights">{features.slice(0, 4).map(feature => <li key={feature} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{feature}</li>)}</ul>}
              <p className="mt-4 whitespace-pre-line text-sm leading-7 text-muted-foreground">
                {description ||
                  'Speak to our team for the full vehicle description, service history and preparation details. We’ll be happy to answer your questions before you visit.'}
              </p>
            </section>
            <section
              className="mt-8 border-t border-border pt-7"
              aria-labelledby="buyer-information-heading"
            >
              <h2 id="buyer-information-heading" tabIndex={-1} className="section-heading scroll-mt-28">
                What to know about this car
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                History, condition and what comes with the car. Ask our team
                about any details still to be confirmed.
              </p>
              <dl className="mt-4 divide-y divide-border">
                {buyerInformation(car).map((item) => (
                  <div
                    key={item.label}
                    className="grid grid-cols-[.8fr_1.2fr] gap-5 py-3 text-sm"
                  >
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd
                      className={
                        item.value
                          ? "whitespace-pre-line"
                          : "text-muted-foreground"
                      }
                    >
                      {item.value || <><span className="block">Not supplied — please ask our team</span><Link className="text-link min-h-11 text-sm" href={`/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}&question=${questionKeyForLabel(item.label) || ''}`}>Ask about {item.label.toLowerCase()} <ArrowRight className="h-3.5 w-3.5" /></Link></>}
                    </dd>
                  </div>
                ))}
              </dl>
              {dealerConfig.presentation?.includedInformation && (
                <p className="mt-4 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                  {dealerConfig.presentation.includedInformation}
                </p>
              )}
              <Link
                href={`/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}`}
                className="text-link mt-3"
              >
                Ask about these details <ArrowRight className="h-4 w-4" />
              </Link>
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
              <div id="vehicle-history" className="mt-7 scroll-mt-24 rounded-md border border-amber-700/30 bg-amber-50 p-5">
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
          {car.price ? formatPrice(car.price, car.currency) : "POA"}
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
            <div className="grid grid-flow-col auto-cols-[85%] gap-4 overflow-x-auto overscroll-x-contain pb-3 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
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
