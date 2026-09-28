import { VehicleReviews } from '@/components/vehicle-reviews';
import { VehicleWhatsApp } from '@/components/vehicle-whatsapp';
import { VehicleCall } from '@/components/vehicle-call';
import { EnquiryForm } from '@/components/enquiry-form';
import { VehiclePrint } from '@/components/vehicle-print';
import { rememberVehicle, vehicleAvailability } from '@/lib/customer-convenience';
import { VehicleHighlights, VehicleVisit } from '@/components/vehicle-buying-guide';
import { SiWhatsapp } from 'react-icons/si';
import { ReserveCar } from '@/components/reserve-car';
import { questionKeyForLabel } from "@/lib/vehicle-questions";
import { getSimilarCars } from "@/lib/similar-cars";
import { buyerInformation } from "@/lib/buyer-information";
import { useEffect, useRef, useState, type MouseEvent } from 'react';
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
  const purchasePanel = useRef<HTMLDivElement>(null);
  const [purchaseVisible, setPurchaseVisible] = useState(false);
  const enquiryPanel = useRef<HTMLElement>(null);
  const [enquiryVisible, setEnquiryVisible] = useState(false);
  const [, params] = useRoute('/vehicle/:id');
  const [location, setLocation] = useLocation();
  const { stock, isLoading, error } = useStock();
  const { settings: dealerConfig } = useDealerSettings();
  const car = stock?.cars?.find((candidate) => candidate.id === params?.id);

  useEffect(() => {
    if (!purchasePanel.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setPurchaseVisible(entry.intersectionRatio >= .45), {threshold: [0, .45, 1], rootMargin: '-90px 0px -80px 0px'});
    observer.observe(purchasePanel.current);
    return () => observer.disconnect();
  }, [car?.id]);

  useEffect(() => {
    if (!enquiryPanel.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setEnquiryVisible(entry.isIntersecting), { rootMargin: '-90px 0px -80px 0px' });
    observer.observe(enquiryPanel.current);
    return () => observer.disconnect();
  }, [car?.id]);

  useEffect(() => { if (car?.id) rememberVehicle(car.id); }, [car?.id]);

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

  if (!stock || !stock.cars) return <NotFound />;
  if (!car) return <div className="container mx-auto px-4 py-10"><h1 className="section-heading">This car isn’t in our current stock</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">It may have sold or been withdrawn. Browse the latest cars, or ask the team about this vehicle.</p><div className="mt-5 flex flex-wrap gap-3"><Button asChild><Link href="/stock">Browse current stock</Link></Button><Button asChild variant="outline"><Link href="/contact">Contact the showroom</Link></Button></div>{stock.cars.length>0 && <section className="mt-10" aria-label="Other cars to consider"><h2 className="section-heading">Other cars to consider</h2><div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{stock.cars.slice(0,3).map(item=><CarCard key={item.id} car={item} />)}</div></section>}</div>;

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
    { label: 'Engine', value: car.engineSize || (car.engineCC ? `${(car.engineCC / 1000).toFixed(1)}L` : 'Ask us') },
    { label: 'Body Type', value: car.bodyType || '-' },
    { label: 'Doors', value: car.doors ? String(car.doors) : '-' },
    { label: 'Seats', value: car.seats ? String(car.seats) : '-' },
    { label: 'Colour', value: car.colour || '-' },
    { label: 'Drivetrain', value: car.drivetrain || '-' },
    { label: 'Emissions', value: car.emissionClass || '-' },
  ];

  const keyFacts: { label: string; value: string; testId?: string }[] = [
    { label: 'Year / plate', value: registrationYear, testId: 'text-registration-year' },
    {
      label: "Mileage",
      value:
        car.mileage != null
          ? formatMileage(car.mileage)
          : car.mileageText || 'Unknown',
    },
    {
      label: 'Fuel',
      value: car.fuel || 'Ask us',
    },
    { label: 'Transmission', value: car.transmission || '-' },
    { label: 'Engine', value: car.engineSize || (car.engineCC ? String(car.engineCC) + ' cc' : 'Ask us') },
    { label: 'Body', value: car.bodyType || 'Ask us' },
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
          <Link href="/stock" className="text-link text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to Browse Stock
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <SaveCarButton
              car={car}
              variant="inline"
              className="border-transparent bg-transparent"
            />

            <span className="text-xs text-muted-foreground" role="status">
              {shareMessage}
            </span>
          </div>
        </div>
        <div className="grid min-w-0 items-start gap-6 vehicle-detail-grid lg:grid-cols-[minmax(0,1.4fr)_minmax(360px,1fr)] lg:gap-7">
          <div className="vehicle-detail-gallery min-w-0 lg:col-start-1 lg:row-start-1">
            <Gallery key={car.id} images={car.images || []} heroImage={car.heroImage} vehicleLabel={vehicleLabel} />
            <VehicleWhatsApp car={car} walkaround />
          </div>
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <div className="vehicle-summary min-w-0">
          <header className="min-w-0">
            <p className="luxxy-kicker mb-3">
              {vehicleAvailability(car.inventoryStatus)} · {dealerConfig.address?.city || dealerConfig.identity.name}
            </p>
            <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-primary">
              {vehicleLabel}
            </h1>
            {(car.variant || car.trim) && (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {car.variant || car.trim}
              </p>
            )}
            <div className="mt-3 border-b border-border pb-3 lg:mt-5 lg:pb-5">
              <p className="luxxy-price text-[2rem]">
                {car.price
                  ? formatPrice(car.price, car.currency)
                  : 'Price on application'}
              </p>
              {car.priceType && /^(?:\+\s*VAT|VAT (?:included|qualifying)|inc(?:lusive of)?\.? VAT|ex(?:cluding)?\.? VAT)$/i.test(car.priceType.trim()) && <p className="text-sm text-muted-foreground">{car.priceType}</p>}

            </div>
          </header>
          <aside className="min-w-0 pt-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 xl:grid-cols-3">
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
              {damageDisclosure && <div className="mt-3 flex flex-wrap items-center gap-x-3 text-xs leading-5 text-muted-foreground"><p>{damageDisclosure.label} recorded</p><a href="#vehicle-history" className="inline-flex min-h-11 items-center underline underline-offset-4">Insurance history</a></div>}
            <div className="vehicle-detail-actions" data-testid="desktop-purchase-panel">
            <div ref={purchasePanel} className="mt-4 flex flex-col gap-3 border-t border-border pt-5">

              <Button asChild size="lg" variant="outline">
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
              <a className="vehicle-enquiry-action" href="#vehicle-enquiry" onClick={() => document.getElementById('vehicle-enquiry-heading')?.focus()}>
                  Enquire about this car <ArrowRight className="h-4 w-4" />
              </a>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2"><ReserveCar key={car.id} car={car} className="min-h-12 w-full" />
              {dealerConfig.partExchange?.enabled && <a href={`/enquire?type=part_exchange&vehicleId=${encodeURIComponent(car.id)}`} className="vehicle-contact-action">Value my car <ArrowRight className="h-4 w-4" /></a>}</div>
              {dealerConfig.onlineReservation?.enabled && dealerConfig.onlineReservation.terms?.trim() && (!car.inventoryStatus || car.inventoryStatus === 'available') && (car.price ?? 0) * 100 >= dealerConfig.onlineReservation.depositPence && (!car.currency || car.currency === 'GBP') && <details className="border-b border-border pb-3 text-xs leading-5"><summary className="min-h-11 cursor-pointer py-3 font-medium">{formatPrice(dealerConfig.onlineReservation.depositPence / 100)} reservation deposit · How it works</summary><p className="mt-2">Review your details and the terms before confirming. The team follows up on your reservation; book a test drive separately.</p><p className="mt-2 font-medium">Payment is currently simulated. No money is taken.</p><h3 className="mt-3 font-semibold">Reservation & cancellation terms</h3><p className="mt-2 whitespace-pre-line text-muted-foreground">{dealerConfig.onlineReservation.terms}</p></details>}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
                <VehicleCall car={car} />
                <VehicleWhatsApp car={car} />
              </div>
            </div>
            {dealerConfig.presentation?.comparisonEnabled && <div className="mt-3 flex items-center justify-between">
              <CompareCarButton car={car} variant="compact" className="min-h-11" />
              <Link href="/compare" className="text-link text-xs text-muted-foreground">
                View comparison
              </Link>
            </div>}

            </div>
          </aside>
<div className="mt-5 flex flex-wrap items-center gap-x-5 border-t border-border pt-3"><VehiclePrint car={car} dealer={dealerConfig} features={features} description={description} /><Button variant="ghost" onClick={share} aria-label="Share this vehicle"><Share2 className="h-4 w-4" /> Share</Button></div>
            <VehicleReviews />
          </div>

          </div>
          <section ref={enquiryPanel} id="vehicle-enquiry" className="vehicle-inline-enquiry min-w-0 mt-6 lg:col-span-2" aria-labelledby="vehicle-enquiry-heading">
            <h2 id="vehicle-enquiry-heading" tabIndex={-1} className="section-heading mb-2">Enquire about this {vehicleLabel}</h2>
            <p className="mb-6 text-sm text-muted-foreground">Ask about the car or tell us how we can help.</p>
            <EnquiryForm key={car.id} vehicle={car} initialType="general" embedded />
          </section>
          <div className="vehicle-details-content min-w-0 pb-10 lg:col-span-2">
            <VehicleHighlights car={car} features={features} />
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
              <div id="vehicle-history" className="mt-7 scroll-mt-24 border-t border-border pt-4">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Insurance history: {damageDisclosure.label}
                </h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {damageDisclosure.explanation}
                </p>
              </div>
            )}

            <VehicleVisit car={car} />
          </div>


        </div>
      </div>
      {!purchaseVisible && !enquiryVisible && <div
        className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-border bg-card p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] lg:hidden"
        data-testid="mobile-conversion-bar"
      >
        <p className="luxxy-price shrink-0 px-1 text-lg">
          {car.price ? formatPrice(car.price, car.currency) : "POA"}
        </p>
        <Button asChild className="min-h-12 min-w-0 flex-1">
          <a
            href="#vehicle-enquiry"
            onClick={() => document.getElementById('vehicle-enquiry-heading')?.focus()}
          >
            Enquire
          </a>
        </Button>
        <VehicleWhatsApp car={car} compact />
        <VehicleCall car={car} compact />
      </div>}
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
                href="/stock"
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
