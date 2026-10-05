import './vehicle-redesign.css';
import { VehicleFactIcon } from '@/components/vehicle-fact-icon';
import { VehicleFeature, VehicleTerm } from '@/components/customer-help';
import { VehicleSellingPoints } from '@/components/vehicle-selling-points';
import { browseReturnHref, requestBrowseRestore } from '@/lib/browse-session';
import { MobileActionDisclosure } from '@/components/mobile-action-disclosure';
import { vehicleContent } from '@/lib/vehicle-content';
import { PriceReduction } from '@/components/price-reduction';
import { stockRegistrationYear } from '@/lib/stock-presentation';
import { websiteText } from "@/lib/website-content";
import { VehicleReviews } from '@/components/vehicle-reviews';
import { VehicleWhatsApp } from '@/components/vehicle-whatsapp';
import { VehicleCall } from '@/components/vehicle-call';
import { EnquiryForm } from '@/components/enquiry-form';
import { VehiclePrint } from '@/components/vehicle-print';
import { rememberVehicle, vehicleAvailability } from '@/lib/customer-convenience';
import { VehicleVisit } from '@/components/vehicle-buying-guide';
import { VehicleHistorySummary, VehicleListingHighlights, VehicleRunningCosts, VehicleSpecificationDetails } from '@/components/vehicle-running-costs';
import { vehicleHistoryFacts, vehicleListingHighlights, vehicleSpecificationGroups, vehicleRunningCosts as getVehicleRunningCosts } from '@/lib/vehicle-extra-facts';
import { ReserveCar } from '@/components/reserve-car';
import { getSimilarCars } from "@/lib/similar-cars";
import { buyerInformation } from "@/lib/buyer-information";
import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Share2,
  Check,
} from 'lucide-react';
import { CarCard } from '@/components/car-card';
import { useStock, type Car } from '@/lib/stock-context';
import { SaveCarButton, CompareCarButton, CompareSelectionLink } from '@/components/saved-car-controls';
import { Gallery } from '@/components/gallery';
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
  getVehicleBookingHref,
  getVehicleShareUrl,
  recordBookingIntent,
} from '@/lib/cta-helpers';
import { navigateToHomeTarget } from '@/lib/home-navigation';
import { recordedWriteOffCategory } from '@/lib/vehicle-history';


function LedgerRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-3 border-b border-border">
      <dt className="flex items-center gap-2 font-display text-[13px] font-normal tracking-normal text-muted-foreground">
        <VehicleTerm label={label} value={value}><VehicleFactIcon label={label} />{label}</VehicleTerm>
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

  useEffect(() => { if (car?.id) rememberVehicle(car.id); }, [car?.id]);

  useEffect(() => {
    if (!car?.id) return;
    const scrollToSection = () => {
      const id = window.location.hash.slice(1);
      if (['vehicle-description-heading', 'features-heading'].includes(id)) {
        document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    };
    const frame = requestAnimationFrame(scrollToSection);
    window.addEventListener('hashchange', scrollToSection);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', scrollToSection); };
  }, [car?.id]);


  usePageMeta(car ? vehiclePageMeta(car, dealerConfig) : isLoading ? null : {
    title: `${error ? 'Vehicle details unavailable' : 'Vehicle not in stock'} | ${dealerConfig.identity.name}`,
    description: error ? 'Please try again to check this vehicle’s current details.' : 'Browse our current used cars or contact the showroom about this vehicle.',
  });

  if (isLoading) {
    return (
      <div
        className="vehicle-page vehicle-redesigned luxxy-shell min-h-[70vh] bg-background"
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
    return <div className="vehicle-page vehicle-redesigned luxxy-shell min-h-[70vh] px-5 py-16"><div className="mx-auto max-w-xl" role="alert">
      <p className="luxxy-kicker">Vehicle details</p>
      <h1 className="mt-4 font-display text-3xl font-semibold">Vehicle details could not be loaded</h1>
      <p className="mt-4 text-muted-foreground">We could not check this vehicle’s current details. Please try again.</p>
      <Button className="mt-6" onClick={() => window.location.reload()}>Try again</Button>
    </div></div>;
  }

  if (!stock || !stock.cars) return <NotFound />;
  if (!car || ['sold', 'archived', 'hidden'].includes(String(car.inventoryStatus))) return <div className="container mx-auto px-4 py-10"><h1 className="section-heading">This car isn’t in our current stock</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">It may have sold or been withdrawn. Browse the latest cars, or ask the team about this vehicle.</p><div className="mt-5 flex flex-wrap gap-3"><Button asChild><Link href="/stock">Browse current stock</Link></Button><Button asChild variant="outline"><Link href="/contact">Contact the showroom</Link></Button></div>{stock.cars.length>0 && <section className="mt-10" aria-label="Other cars to consider"><h2 className="section-heading">Other cars to consider</h2><div className="mt-5 grid gap-5 sm:grid-cols-2">{stock.cars.filter(item => item.id !== car?.id && (!item.inventoryStatus || item.inventoryStatus === 'available')).slice(0,3).map(item=><CarCard key={item.id} car={item} />)}</div></section>}</div>;

  const similarCars = getSimilarCars(car, stock.cars);
  const registration = vehicleRegistration(car);
  const registrationBand = [car.registrationBand, car.registration]
    .map((value) => value?.trim() || '')
    .find((value) => value && !isUKNumberPlate(value));
  const registrationYear = stockRegistrationYear({ ...car, registrationBand: registrationBand ?? null }) || registrationBand || 'Unknown';
  const bookingHref = getVehicleBookingHref(car);
  const vehicleLabel = vehicleDisplayTitle(car);
  const vehicleRunningCostFacts = getVehicleRunningCosts(car);
  const vehicleHistoryRecordFacts = vehicleHistoryFacts(car);
  const listingHighlights = vehicleListingHighlights(car);

  const overviewSpecs = [
    { label: 'Engine', value: car.engineSize || (car.engineCC ? `${(car.engineCC / 1000).toFixed(1)}L` : 'Ask us') },
    { label: 'Body Type', value: car.bodyType || '-' },
    { label: 'Doors', value: car.doors ? String(car.doors) : '-' },
    { label: 'Seats', value: car.seats ? String(car.seats) : '-' },
    { label: 'Colour', value: car.colour || '-' },
    { label: 'Drivetrain', value: car.drivetrain || '-' },
    { label: 'Emissions', value: car.emissionClass || '-' },
  ].filter(fact => !['-', 'Ask us', 'Unknown', ''].includes(fact.value));

  const hasSpecifications = overviewSpecs.length > 0 || vehicleSpecificationGroups(car).length > 0;
  const handoverFacts = buyerInformation(car).filter(item => item.value && !['Service history', 'Keys', 'Previous keepers'].includes(item.label));

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
  ].filter(fact => !['-', 'Ask us', 'Unknown', ''].includes(fact.value));

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

  const hasHandoverInformation = handoverFacts.length > 0 || Boolean(dealerConfig.presentation?.includedInformation?.trim()) || Boolean(damageDisclosure);
  const { description, features } = vehicleContent(car);
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

  const bookingAction = (!car.inventoryStatus || car.inventoryStatus === 'available') ? (
    <Button asChild size="lg" key="booking" className="vehicle-booking-action">
      <a
        href={bookingHref}
        onClick={() => recordBookingIntent({ source: 'car_detail', vehicleContext: true })}
        data-vehicle-contact="booking"
      >
        <Calendar className="h-4 w-4" />
        {dealerConfig.bookViewing.ctaLabel}
      </a>
    </Button>
  ) : null;
  const enquiryAction = (
    <a key="enquiry" className="vehicle-enquiry-action" href="#vehicle-enquiry" onClick={() => document.getElementById('vehicle-enquiry-heading')?.focus()}>
      Enquire about this car <ArrowRight className="h-4 w-4" />
    </a>
  );

  return (
    <div className="vehicle-page vehicle-redesigned luxxy-shell min-h-screen">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="vehicle-browse-tools flex flex-wrap items-center justify-between gap-2 py-4">
          <Link href={browseReturnHref()} onClick={() => requestBrowseRestore()} className="vehicle-return-link text-link min-h-11 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to your results
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <SaveCarButton
              car={car}
              variant="inline"
              className="vehicle-save-control border-transparent bg-transparent"
            />

            <span className="text-xs text-muted-foreground" role="status">
              {shareMessage}
            </span>
          </div>
        </div>
        <div className="vehicle-detail-grid min-w-0">
          <div className="vehicle-detail-gallery min-w-0">
            <Gallery key={car.id} car={car} images={car.images || []} heroImage={car.heroImage} vehicleLabel={vehicleLabel} customerView />
            <div className="vehicle-gallery-help"><span>Explore the photographs</span><VehicleWhatsApp car={car} walkaround /></div>
          </div>
          <div className="vehicle-summary-column min-w-0">
          <div className="vehicle-summary min-w-0">
          <header className="min-w-0">
            <p className="vehicle-availability luxxy-kicker mb-3">
              {vehicleAvailability(car.inventoryStatus)} · {dealerConfig.address?.city || dealerConfig.identity.name}
            </p>
            <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-primary">
              {vehicleLabel}
            </h1>
            {(car.variant || car.trim) && (
              <p className="vehicle-variant mt-3 text-sm leading-relaxed text-muted-foreground">
                {car.variant || car.trim}
              </p>
            )}
            {registration && (
              <dl className="vehicle-registration">
                <dt>Registration</dt>
                <dd data-testid={`plate-vehicle-${car.id}`}>{registration}</dd>
              </dl>
            )}
            <div className="vehicle-price-block mt-3 border-b border-border pb-3 lg:mt-5 lg:pb-5">
              <p className="luxxy-price text-[2rem]">
                {car.price
                  ? formatPrice(car.price, car.currency)
                  : 'Price on application'}
              </p>
              <PriceReduction car={car} />
              {car.priceType && /^(?:\+\s*VAT|VAT (?:included|qualifying)|inc(?:lusive of)?\.? VAT|ex(?:cluding)?\.? VAT)$/i.test(car.priceType.trim()) && <p className="text-sm text-muted-foreground">{car.priceType}</p>}

            </div>
          </header>
          <VehicleSellingPoints car={car} />
          <aside className="min-w-0 pt-5">
            <dl className="vehicle-key-facts grid grid-cols-2 gap-x-4 gap-y-4">
              {keyFacts.map((fact) => (
                <div key={fact.label}>
                  <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                    <VehicleTerm label={fact.label} value={fact.value}><VehicleFactIcon label={fact.label} />{fact.label}</VehicleTerm>
                  </dt>
                  <dd className="mt-1 text-sm font-medium" data-testid={fact.testId}>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
              {damageDisclosure && <div className="mt-3 flex flex-wrap items-center gap-x-3 text-xs leading-5 text-muted-foreground"><p>{damageDisclosure.label} recorded</p><a href="#vehicle-history" className="inline-flex min-h-11 items-center underline underline-offset-4">Insurance history</a></div>}
            <div className="vehicle-detail-actions" data-testid="desktop-purchase-panel">
            <div className="vehicle-primary-actions">
              {bookingAction}{enquiryAction}
            </div>
            <div className="vehicle-direct-contact" aria-label="Contact the showroom about this vehicle">
              <VehicleCall car={car} />
              <VehicleWhatsApp car={car} />
            </div>
            <MobileActionDisclosure label="More options" testId="vehicle-secondary-actions" className="vehicle-secondary-actions mt-3 border-t border-border md:mt-0 md:border-0">
              <div className="vehicle-contact-options">
              <div className="vehicle-secondary-grid"><ReserveCar key={car.id} car={car} className="min-h-12 w-full" />
              {dealerConfig.partExchange?.enabled && <a href={`/enquire?type=part_exchange&vehicleId=${encodeURIComponent(car.id)}`} className="vehicle-contact-action">Value my car <ArrowRight className="h-4 w-4" /></a>}</div>
              {dealerConfig.onlineReservation?.enabled && dealerConfig.onlineReservation.terms?.trim() && (!car.inventoryStatus || car.inventoryStatus === 'available') && (car.price ?? 0) * 100 >= dealerConfig.onlineReservation.depositPence && (!car.currency || car.currency === 'GBP') && <details className="border-b border-border pb-3 text-xs leading-5"><summary className="min-h-11 cursor-pointer py-3 font-medium">{formatPrice(dealerConfig.onlineReservation.depositPence / 100)} reservation deposit · How it works</summary><p className="mt-2">Review your details and the terms before confirming. The team follows up on your reservation; book a test drive separately.</p><p className="mt-2 font-medium">Payment is currently simulated. No money is taken.</p><h3 className="mt-3 font-semibold">Reservation & cancellation terms</h3><p className="mt-2 whitespace-pre-line text-muted-foreground">{dealerConfig.onlineReservation.terms}</p></details>}
              </div>
            {dealerConfig.presentation?.comparisonEnabled && <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <CompareCarButton car={car} variant="compact" className="min-h-11" /><CompareSelectionLink />

            </div>}

              <div className="vehicle-utility-actions"><VehiclePrint car={car} dealer={dealerConfig} features={features} description={description} /><Button variant="ghost" onClick={share} aria-label="Share this vehicle"><Share2 className="h-4 w-4" /> Share</Button></div>
            </MobileActionDisclosure>
            </div>
          </aside>
          </div>
          </div>
        </div>
        <div className="vehicle-details-content min-w-0">
          <nav aria-label="Vehicle information sections" className="vehicle-section-nav">
            {features.length > 0 && <a href="#features-heading">Features & equipment</a>}
            {description && <a href="#vehicle-description-heading">Description</a>}
            {hasSpecifications && <a href="#vehicle-overview-heading">Specifications</a>}
            {vehicleRunningCostFacts.length > 0 && <a href="#vehicle-running-costs-heading">Running costs</a>}
            {(vehicleHistoryRecordFacts.length > 0 || hasHandoverInformation) && <a href={vehicleHistoryRecordFacts.length > 0 ? '#vehicle-records-heading' : '#buyer-information-heading'}>History & handover</a>}
          </nav>
          {(description || features.length > 0) && <div className="vehicle-information-row vehicle-editorial-overview">
            {features.length > 0 && (
              <section
                className="vehicle-features-section mt-8 border-t border-border pt-7 lg:col-span-2"
                aria-labelledby="features-heading"
              >
                <h2 id="features-heading" className="section-heading scroll-mt-28">
                  {websiteText(dealerConfig, "vehicleFeaturesHeading")}
                </h2>
                <ul className="vehicle-equipment-list mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  {features.slice(0, 8).map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <VehicleFeature feature={feature} />
                    </li>
                  ))}
                </ul>
                {features.length > 8 && <details className="vehicle-equipment-more mt-5">
                  <summary className="cursor-pointer py-3 text-sm font-semibold underline underline-offset-4">View all {features.length} features</summary>
                  <ul className="vehicle-equipment-list mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    {features.slice(8).map(feature => <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><VehicleFeature feature={feature} /></li>)}
                  </ul>
                </details>}
              </section>
            )}
            {description && <section
              className="vehicle-description-section mt-8 border-t border-border pt-7"
              aria-labelledby="vehicle-description-heading"
            >
              <h2 id="vehicle-description-heading" className="section-heading scroll-mt-28">
                {websiteText(dealerConfig, "vehicleDescriptionHeading")}
              </h2>
              <p className="mt-4 whitespace-pre-line text-base leading-7 text-foreground">
                {description}
              </p>

            </section>}
          </div>}
          {(hasSpecifications || vehicleRunningCostFacts.length > 0 || listingHighlights.length > 0) && <div className="vehicle-information-row vehicle-technical-row">
            {hasSpecifications && <section
              aria-labelledby="vehicle-overview-heading"
              className="vehicle-specification-section border-t border-border pt-7"
            >
              <h2 id="vehicle-overview-heading" className="section-heading scroll-mt-28">
                {websiteText(dealerConfig, "vehicleSpecificationHeading")}
              </h2>
              <dl className="vehicle-specification-ledger mt-5 grid gap-x-8 sm:grid-cols-2">
                {overviewSpecs.map((spec) => (
                  <LedgerRow key={spec.label} label={spec.label} value={spec.value} />
                ))}
              </dl>
              <VehicleSpecificationDetails car={car} />
            </section>}
            {(vehicleRunningCostFacts.length > 0 || listingHighlights.length > 0) && <div className="vehicle-costs-panel">
              <VehicleRunningCosts car={car} />
              {listingHighlights.length > 0 && <details className="vehicle-source-comparisons"><summary>How this car compares</summary><VehicleListingHighlights car={car} /></details>}
            </div>}
            </div>}
            {(vehicleHistoryRecordFacts.length > 0 || hasHandoverInformation) && <div className="vehicle-information-row vehicle-records-row">
            <VehicleHistorySummary car={car} />
            {hasHandoverInformation && <section
              className="mt-8 border-t border-border pt-7"
              aria-labelledby="buyer-information-heading"
            >
              <h2 id="buyer-information-heading" tabIndex={-1} className="section-heading scroll-mt-28">
                {websiteText(dealerConfig, "vehicleInformationHeading")}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Available history and handover information. Ask us about anything else you need to know.
              </p>
              <dl className="mt-4 divide-y divide-border">
                {handoverFacts.map((item) => (
                  <div
                    key={item.label}
                    className="grid grid-cols-[.8fr_1.2fr] gap-5 py-3 text-sm"
                  >
                    <dt className="flex items-start gap-2 text-muted-foreground"><VehicleTerm label={item.label} value={item.value ?? undefined}><VehicleFactIcon label={item.label} />{item.label}</VehicleTerm></dt>
                    <dd
                      className={
                        item.value
                          ? "whitespace-pre-line"
                          : "text-muted-foreground"
                      }
                    >
                      {item.value}
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
            </section>}
          </div>}
        </div>
        <div className="vehicle-review-strip"><VehicleReviews /></div>
        <div className="vehicle-enquiry-visit-row">
          <section id="vehicle-enquiry" className="vehicle-inline-enquiry min-w-0" aria-labelledby="vehicle-enquiry-heading">
            <h2 id="vehicle-enquiry-heading" tabIndex={-1} className="section-heading mb-2">Enquire about this {vehicleLabel}</h2>
            <p className="mb-6 text-sm text-muted-foreground">Ask about the car or tell us how we can help.</p>
            <EnquiryForm key={car.id} vehicle={car} initialType="general" embedded />
          </section>
          <VehicleVisit car={car} />
        </div>
      </div>
      {similarCars.length > 0 && (
        <section
          className="vehicle-similar-stock section-space border-t border-border bg-secondary/40"
          aria-labelledby="similar-cars-heading"
        >
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2 id="similar-cars-heading" className="section-heading">
                {websiteText(dealerConfig, "vehicleSimilarHeading")}
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
