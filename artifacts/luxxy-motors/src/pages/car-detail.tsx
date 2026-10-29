import {VehicleQuickChecks} from '@/components/vehicle-quick-checks';

import { UKNumberPlate } from '@/components/uk-number-plate';
import './vehicle-redesign.css';
import { VehicleFactIcon } from '@/components/vehicle-fact-icon';
import { VehicleTerm } from '@/components/customer-help';
import { VehicleEquipmentList } from '@/components/vehicle-equipment-list';
import { VehicleSourceReport } from '@/components/vehicle-source-report';
import { readVehicleSourceReport } from '@/lib/vehicle-source-report';
import { VehicleSellingPoints } from '@/components/vehicle-selling-points';
import { browseReturnHref, requestBrowseRestore } from '@/lib/browse-session';
import { MobileActionDisclosure } from '@/components/mobile-action-disclosure';
import { prioritiseVehicleFeatures, vehicleContent, vehicleDescriptionParagraphs } from '@/lib/vehicle-content';
import { PriceReduction } from '@/components/price-reduction';
import { stockRegistrationYear } from '@/lib/stock-presentation';
import { websiteText } from "@/lib/website-content";
import { VehicleWhatsApp } from '@/components/vehicle-whatsapp';
import { VehicleCall } from '@/components/vehicle-call';
import { EnquiryForm } from '@/components/enquiry-form';
import { VehiclePrint } from '@/components/vehicle-print';
import { vehicleAvailability } from '@/lib/customer-convenience';
import { VehicleVisit } from '@/components/vehicle-buying-guide';
import { VehicleHistorySummary, VehicleRunningCosts, VehicleSpecificationDetails } from '@/components/vehicle-running-costs';
import { vehicleSpecificationGroups, vehicleRunningCosts as getVehicleRunningCosts } from '@/lib/vehicle-extra-facts';
import { getSimilarCars } from "@/lib/similar-cars";
import { buyerInformation } from "@/lib/buyer-information";
import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CustomerEnquiry,
  Share2,
} from '@/components/icons';
import { CarCard } from '@/components/car-card';
import { useStock, type Car } from '@/lib/stock-context';
import { SaveCarButton } from '@/components/saved-car-controls';
import { Gallery } from '@/components/gallery';
import {
  formatPrice,
  formatMileage,
  isUKNumberPlate,
  vehicleDisplayTitle,
  vehicleRegistration,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/page-ui';
import NotFound from '@/pages/not-found';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useDealerFeatures } from '@/lib/dealer-features';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useIsMobile } from '@/hooks/use-mobile';
import { vehiclePageMeta } from '@/lib/page-meta';
import {
  getVehicleBookingHref,
  getPhoneHref,
  getVehicleShareUrl,
  recordBookingIntent,
} from '@/lib/cta-helpers';
import { navigateToHomeTarget } from '@/lib/home-navigation';
import { vehicleInsuranceDisclosure } from '@/lib/vehicle-history';


function LedgerRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-3 border-b border-border">
      <dt className="flex items-center gap-2 font-display text-[13px] font-normal tracking-normal text-muted-foreground">
        <VehicleTerm label={label} value={value}><VehicleFactIcon label={label} value={value} />{label}</VehicleTerm>
      </dt>
      <dd className="font-medium text-[14px] text-primary text-right" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export default function CarDetail() {
  const [shareMessage, setShareMessage] = useState('');
  // Keep identity above the gallery until the two-column layout starts.
  const isCompactLayout = useIsMobile(1100);
  const [, params] = useRoute('/vehicle/:id');
  const [location, setLocation] = useLocation();
  const { stock, isLoading, error } = useStock();
  const { settings: dealerConfig } = useDealerSettings();
  const customerFeatures = useDealerFeatures();
  const car = stock?.cars?.find((candidate) => candidate.id === params?.id);

  useEffect(() => { setShareMessage(''); }, [car?.id]);

  useEffect(() => {
    if (!car?.id) return;
    const scrollToSection = () => {
      const id = window.location.hash.slice(1);
      if (['vehicle-description-heading', 'features-heading', 'vehicle-enquiry', 'vehicle-source-report-heading'].includes(id)) {
        const target = document.getElementById(id);
        target?.scrollIntoView({ block: 'start', behavior: 'instant' });
        if (id === 'vehicle-enquiry') document.getElementById('vehicle-enquiry-heading')?.focus({preventScroll: true});
      }
    };
    const frame = requestAnimationFrame(scrollToSection);
    window.addEventListener('hashchange', scrollToSection);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', scrollToSection); };
  }, [car?.id]);


  usePageMeta(!error && car && !['sold', 'archived', 'hidden'].includes(String(car.inventoryStatus)) ? vehiclePageMeta(car, dealerConfig) : isLoading ? null : {
    indexable: false,
    title: `${error ? 'Vehicle details unavailable' : 'Vehicle not in stock'} | ${dealerConfig.identity.name}`,
    description: error ? 'Please try again to check this vehicle’s current details.' : 'Browse our current used cars or ask us about this car.',
  });

  if (isLoading) {
    return (
      <div
        className="vehicle-page vehicle-redesigned luxxy-shell min-h-[70vh] bg-background"
        aria-label="Loading vehicle"
        aria-busy="true"
        role="status"
      >
        <span className="sr-only">Loading vehicle details…</span>
        <div className="container mx-auto grid gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px] lg:items-start lg:gap-14 lg:px-8">
          <div className="space-y-4 lg:col-start-1 lg:row-start-1">
            <div className="aspect-[4/3] w-full motion-safe:animate-pulse bg-muted border border-border" aria-hidden="true" />
            <div className="h-[4.5rem] w-full motion-safe:animate-pulse bg-muted border border-border" aria-hidden="true" />
          </div>
          <div className="space-y-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 border border-primary bg-background p-8 shadow-none">
            <div className="h-10 w-3/4 motion-safe:animate-pulse bg-muted" aria-hidden="true" />
            <div className="h-16 w-1/2 motion-safe:animate-pulse bg-muted" aria-hidden="true" />
            <div className="h-40 w-full motion-safe:animate-pulse bg-muted" aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="vehicle-page vehicle-redesigned luxxy-shell min-h-[70vh] px-5 py-16"><div className="mx-auto max-w-xl" role="alert">
      <PageHeading eyebrow="Vehicle details" title="Vehicle details could not be loaded" description="We couldn’t load this car’s details. Please try again, or browse our current cars." />
      <div className="flex flex-wrap gap-3"><Button onClick={() => window.location.reload()}>Try again</Button><Button asChild variant="outline"><Link href="/stock">Browse stock</Link></Button></div>
    </div></div>;
  }

  if (!stock || !stock.cars) return <NotFound />;
  if (!car || ['sold', 'archived', 'hidden'].includes(String(car.inventoryStatus))) return <div className="container mx-auto px-4 py-10 sm:px-6 lg:px-8"><PageHeading eyebrow="Vehicle details" title="This car isn’t in our current stock" description="This car is no longer in our online stock. Browse our current cars, or ask us about this one." /><div className="flex flex-wrap gap-3"><Button asChild><Link href="/stock">Browse current stock</Link></Button><Button asChild variant="outline"><Link href="/contact">Contact us</Link></Button></div>{stock.cars.some(item => item.id !== car?.id && (!item.inventoryStatus || item.inventoryStatus === 'available')) && <section className="mt-10" aria-label="Other cars to consider"><h2 className="section-heading">Other cars to consider</h2><div className="mt-5 grid gap-5 sm:grid-cols-2">{stock.cars.filter(item => item.id !== car?.id && (!item.inventoryStatus || item.inventoryStatus === 'available')).slice(0,3).map(item=><CarCard key={item.id} car={item} />)}</div></section>}</div>;

  const similarCars = getSimilarCars(car, stock.cars);
  const registration = vehicleRegistration(car);
  const registrationBand = [car.registrationBand, car.registration]
    .map((value) => value?.trim() || '')
    .find((value) => value && !isUKNumberPlate(value));
  const registrationYear = stockRegistrationYear({ ...car, registrationBand: registrationBand ?? null }) || registrationBand || 'Unknown';
  const bookingHref = getVehicleBookingHref(car);
  const vehicleLabel = vehicleDisplayTitle(car);
  const vehicleRunningCostFacts = getVehicleRunningCosts(car);
  const sourceReport = readVehicleSourceReport(car);

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
  const handoverFacts = buyerInformation(car).filter(item => item.value && !['Service history', 'Keys', 'Owners', 'Previous keepers'].includes(item.label));

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
    { label: 'Transmission', value: car.transmission?.trim() || 'Not specified' },
    { label: 'Engine', value: car.engineSize || (car.engineCC ? String(car.engineCC) + ' cc' : 'Ask us') },
    { label: 'Body', value: car.bodyType || 'Ask us' },
  ].filter(fact => !['-', 'Ask us', 'Unknown', ''].includes(fact.value));

  const damageDisclosure = vehicleInsuranceDisclosure(car, vehicleContent(car).description);

  const hasHandoverInformation = handoverFacts.length > 0 || Boolean(dealerConfig.presentation?.includedInformation?.trim()) || Boolean(damageDisclosure);
  const hasSecondaryActions = dealerConfig.partExchange?.enabled;
  const content = vehicleContent(car);
  const separateDescriptionNotes = car.sourceExtras?.vehicleDescriptionPlacement === 'separate' && typeof car.sourceExtras?.vehicleDescriptionBody === 'string' && Array.isArray(car.sourceExtras?.vehicleDescriptionDisclosures) && car.sourceExtras.vehicleDescriptionDisclosures.length > 0;
  const description = separateDescriptionNotes ? String(car.sourceExtras!.vehicleDescriptionBody) : content.description;
  const features = prioritiseVehicleFeatures(content.features);
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

  const openVehicleEnquiry = () => {
    document.getElementById('vehicle-enquiry')?.scrollIntoView({block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    document.getElementById('vehicle-enquiry-heading')?.focus({preventScroll: true});
  };
  const bookingAction = dealerConfig.testDriveBooking?.enabled && (!car.inventoryStatus || car.inventoryStatus === 'available') ? (
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
  const enquiryAction = customerFeatures.enabled('publicEnquiries') && (
    <a key="enquiry" className="vehicle-enquiry-action" href="#vehicle-enquiry" onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openVehicleEnquiry();
    }}>
      <CustomerEnquiry className="h-4 w-4" aria-hidden="true" /> Enquire About This Car
    </a>
  );

  const registrationDetails = registration && (
    <dl className="vehicle-registration">
      <dt>Registration</dt>
      <dd><UKNumberPlate value={registration} variant="front" size="sm" testId={`plate-vehicle-${car.id}`} /></dd>
    </dl>
  );
  return <VehicleQuickChecks key={car.id} vehicleId={car.id}>
    {({ motBadge, motAction, deliveryAction }) => {
  const vehicleIdentity = (
    <header className={`min-w-0${isCompactLayout ? ' vehicle-compact-identity' : ''}`} data-testid="vehicle-identity">
      <p className="vehicle-availability luxxy-kicker mb-3">
        {vehicleAvailability(car.inventoryStatus)} · {dealerConfig.address?.city || dealerConfig.identity.name}
      </p>
      <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-primary">{vehicleLabel}</h1>
      {isCompactLayout ? (
        <ul className="vehicle-compact-facts" aria-label="Vehicle details">{[
          registrationYear !== 'Unknown' ? registrationYear : null,
          car.mileage != null ? formatMileage(car.mileage) : car.mileageText,
          car.transmission,
          car.fuel,
        ].filter(Boolean).map((fact, index) => <li key={`${index}-${fact}`}>{fact}</li>)}</ul>
      ) : <>
        {(car.variant || car.trim) && <p className="vehicle-variant mt-3 text-sm leading-relaxed text-muted-foreground">{car.variant || car.trim}</p>}
        {registrationDetails}
      </>}
      <div className="vehicle-price-block mt-3 border-b border-border pb-3 lg:mt-5 lg:pb-5">
        <p className="luxxy-price text-[2rem]">{car.price ? formatPrice(car.price, car.currency) : 'Price on application'}</p>
        <PriceReduction car={car} showRecordedDate />
        {car.priceType && /^(?:\+\s*VAT|VAT (?:included|qualifying)|inc(?:lusive of)?\.? VAT|ex(?:cluding)?\.? VAT)$/i.test(car.priceType.trim()) && <p className="text-sm text-muted-foreground">{car.priceType}</p>}
        {damageDisclosure && <a href="#vehicle-history" className="vehicle-insurance-disclosure"><VehicleFactIcon label="Insurance history" /><span>{damageDisclosure.summary}</span><ArrowRight className="h-4 w-4" /></a>}
      </div>
    </header>
  );

  return (
    <div className="vehicle-page vehicle-redesigned vehicle-page-enter luxxy-shell min-h-screen">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="vehicle-browse-tools flex items-center">
          <Link href={browseReturnHref()} onClick={() => requestBrowseRestore()} className="vehicle-return-link text-link min-h-11 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to your results
          </Link>

        </div>
        <div className="vehicle-detail-grid min-w-0">
          {isCompactLayout && vehicleIdentity}
          <div className="vehicle-detail-gallery min-w-0">
            <Gallery key={car.id} car={car} images={car.images || []} heroImage={car.heroImage} vehicleLabel={vehicleLabel} customerView customerActions={{
              bookingHref: dealerConfig.testDriveBooking?.enabled && (!car.inventoryStatus || car.inventoryStatus === 'available') ? bookingHref : undefined,
              enquiryHref: customerFeatures.enabled('publicEnquiries') ? '#vehicle-enquiry' : undefined,
              onEnquiry: customerFeatures.enabled('publicEnquiries') ? openVehicleEnquiry : undefined,
              call: getPhoneHref(dealerConfig) ? <VehicleCall car={car} className="vehicle-gallery-interest-action" /> : undefined,
            }} />
          </div>
          <div className="vehicle-summary-column min-w-0">
          <div className="vehicle-summary min-w-0">
          {!isCompactLayout && vehicleIdentity}
          {isCompactLayout && <div className="vehicle-compact-detail">
            {(car.variant || car.trim) && <p className="vehicle-variant text-sm leading-relaxed text-muted-foreground">{car.variant || car.trim}</p>}
            {registrationDetails}
          </div>}
          <div className="vehicle-primary-actions vehicle-summary-main-actions">{bookingAction}{enquiryAction}</div>
            <div className="vehicle-direct-contact" aria-label="Talk to us about this car">
              <VehicleCall car={car} />
              <VehicleWhatsApp car={car} />
            </div>
          <VehicleSellingPoints car={car} motBadge={motBadge} />
          <aside className="min-w-0 pt-5">
            <dl className="vehicle-key-facts grid grid-cols-2 gap-x-4 gap-y-4">
              {keyFacts.map((fact) => (
                <div key={fact.label}>
                  <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                    <VehicleTerm label={fact.label} value={fact.value}><VehicleFactIcon label={fact.label} value={fact.value} />{fact.label}</VehicleTerm>
                  </dt>
                  <dd className="mt-1 text-sm font-medium" data-testid={fact.testId}>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="vehicle-detail-actions" data-testid="desktop-purchase-panel">


            {hasSecondaryActions && <MobileActionDisclosure label="More options" testId="vehicle-secondary-actions" className="vehicle-secondary-actions mt-3 border-t border-border md:mt-0 md:border-0">
              <div className="vehicle-contact-options">
              <div className="vehicle-secondary-grid">
              {dealerConfig.partExchange?.enabled && <a href={`/enquire?type=part_exchange&vehicleId=${encodeURIComponent(car.id)}`} className="vehicle-contact-action">Value my car <ArrowRight className="h-4 w-4" /></a>}</div>
              </div>


            </MobileActionDisclosure>}
              <div className="vehicle-utility-actions" role="group" aria-label="Vehicle tools">
                <VehiclePrint car={car} dealer={dealerConfig} features={features} description={description} />
                <Button variant="ghost" onClick={share} aria-label="Share this vehicle"><Share2 className="h-4 w-4" /> Share</Button>
                <SaveCarButton car={car} variant="inline" className="vehicle-save-control border-transparent bg-transparent" />
                {shareMessage && <span className="text-xs text-muted-foreground" role="status">{shareMessage}</span>}
              </div>
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
            <a href="#vehicle-records-heading">History & information</a>
            {deliveryAction && <a href="#vehicle-delivery-heading">Delivery</a>}
            {sourceReport && <a href="#vehicle-source-report-heading">Vehicle checks</a>}
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
                <VehicleEquipmentList features={features} />
              </section>
            )}
            {description && <section
              className="vehicle-description-section mt-8 border-t border-border pt-7"
              aria-labelledby="vehicle-description-heading"
            >
              <h2 id="vehicle-description-heading" className="section-heading scroll-mt-28">
                {websiteText(dealerConfig, "vehicleDescriptionHeading")}
              </h2>
              <div className="vehicle-description-copy mt-4 space-y-4 text-base leading-7 text-foreground">
                {vehicleDescriptionParagraphs(description).map((paragraph, index) => <p key={index} className="whitespace-pre-line">{paragraph}</p>)}
                {separateDescriptionNotes && <aside className="rounded-lg border border-border bg-muted/40 p-4 text-sm leading-6" aria-label="Vehicle history and important information"><h3 className="mb-2 font-semibold text-foreground">Vehicle history & important information</h3>{(car.sourceExtras!.vehicleDescriptionDisclosures as unknown[]).filter((note): note is string => typeof note === 'string').map(note => <p key={note} className="whitespace-pre-line">{note}</p>)}</aside>}
                {typeof car.sourceExtras?.vehicleDescriptionTax === 'string' && <aside className="rounded-lg border border-border p-4 text-sm leading-6" aria-label="Verified vehicle tax"><h3 className="mb-2 font-semibold">Vehicle tax</h3><p>{car.sourceExtras.vehicleDescriptionTax}</p><a href="https://www.gov.uk/vehicle-tax-direct-debit/setting-up" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">About DVLA Direct Debit payments</a></aside>}
                {Array.isArray(car.sourceExtras?.originalAdvertDescriptions) && <details className="border-t border-border pt-4 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Original advert information</summary>{car.sourceExtras.originalAdvertDescriptions.filter((value): value is string => typeof value === 'string').map((value, index) => <p key={index} className="whitespace-pre-line py-2">{value}</p>)}</details>}
              </div>

            </section>}
          </div>}
          {(hasSpecifications || vehicleRunningCostFacts.length > 0) && <div className="vehicle-information-row vehicle-technical-row">
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
            {vehicleRunningCostFacts.length > 0 && <div className="vehicle-costs-panel">
              <VehicleRunningCosts car={car} />
            </div>}
            </div>}
            <div className="vehicle-information-row vehicle-records-row">
            <VehicleHistorySummary car={car} motAction={motAction} />
            {hasHandoverInformation && <section
              className="mt-8 border-t border-border pt-7"
              aria-labelledby="buyer-information-heading"
            >
              <h2 id="buyer-information-heading" tabIndex={-1} className="section-heading scroll-mt-28">
                {websiteText(dealerConfig, "vehicleInformationHeading")}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                The supplied documents and recorded history for this car.
              </p>
              <dl className="mt-4 divide-y divide-border">
                {handoverFacts.map((item) => (
                  <div
                    key={item.label}
                    className="grid grid-cols-[.8fr_1.2fr] gap-5 py-3 text-sm"
                  >
                    <dt className="flex items-start gap-2 text-muted-foreground"><VehicleTerm label={item.label} value={item.value ?? undefined}><VehicleFactIcon label={item.label} value={item.value} />{item.label}</VehicleTerm></dt>
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
                Ask us about these details <ArrowRight className="h-4 w-4" />
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
            <a className="vehicle-service-record-request" href={`/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}&question=service`}><VehicleFactIcon label="Service history" /><span>Request service records<span className="vehicle-service-record-note">Ask us to email the available service-book photos and records.</span></span><ArrowRight className="h-4 w-4" /></a>
          </div>
          {sourceReport && <VehicleSourceReport car={car} />}

        </div>
          <div className="vehicle-enquiry-visit-row">
          {customerFeatures.enabled('publicEnquiries') && <section id="vehicle-enquiry" className="vehicle-inline-enquiry min-w-0" aria-labelledby="vehicle-enquiry-heading">
            <h2 id="vehicle-enquiry-heading" tabIndex={-1} className="section-heading mb-2">Enquire about this {vehicleLabel}</h2>
            <p className="mb-6 text-sm text-muted-foreground">Ask us about this car or tell us how we can help.</p>
            <EnquiryForm key={car.id} vehicle={car} initialType="general" embedded />
          </section>}
          <div className="vehicle-visit-delivery-stack min-w-0">
            <VehicleVisit car={car} />
            {deliveryAction && <section aria-labelledby="vehicle-delivery-heading" className="mt-8 border-t border-border pt-7">
              <h2 id="vehicle-delivery-heading" className="section-heading scroll-mt-28">{dealerConfig.delivery?.title || "Delivery to your door"}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{dealerConfig.delivery?.description || "Enter your postcode for an estimated delivery cost, based on the driving distance from our showroom."}</p>
              {deliveryAction}
            </section>}
          </div>
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
    }}
  </VehicleQuickChecks>;
}
