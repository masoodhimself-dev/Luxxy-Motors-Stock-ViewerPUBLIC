import { VehicleAnswers } from '@/components/vehicle-answers';
import { VehicleQualityChecks } from '@/components/vehicle-quality-checks';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { privateWebsitePreviewBase } from '@/lib/private-website-preview';
import { vehicleEnquiryMot } from '@/lib/vehicle-enquiry-information';
import { VehiclePhotoRequest } from '@/components/vehicle-photo-request';
import {VehicleQuickChecks} from '@/components/vehicle-quick-checks';

import { UKNumberPlate } from '@/components/uk-number-plate';
import './vehicle-redesign.css';
import './vehicle-streamlined.css';
import { VehicleFactIcon } from '@/components/vehicle-fact-icon';
import { VehicleTerm } from '@/components/customer-help';
import { VehicleEquipmentList } from '@/components/vehicle-equipment-list';
import { VehicleSourceReport } from '@/components/vehicle-source-report';
import { readVehicleSourceReport } from '@/lib/vehicle-source-report';
import { VehicleDescription } from '@/components/vehicle-description';
import { VehicleSellingPoints } from '@/components/vehicle-selling-points';
import { browseReturnHref, requestBrowseRestore } from '@/lib/browse-session';
import { trackJourneyStage } from '@/lib/analytics';
import { prioritiseVehicleFeatures, vehicleContent, vehicleDescriptionParagraphs } from '@/lib/vehicle-content';
import { vehiclePageSummary, vehiclePageInclusions } from '@/lib/vehicle-page-summary';
import { PriceReduction } from '@/components/price-reduction';
import { stockRegistrationYear } from '@/lib/stock-presentation';
import { websiteText } from "@/lib/website-content";
import { VehicleWhatsApp } from '@/components/vehicle-whatsapp';
import { VehicleCall } from '@/components/vehicle-call';
import { EnquiryForm } from '@/components/enquiry-form';
import { VehicleEnquiryInformation } from '@/components/vehicle-enquiry-information';
import { VehicleShare } from '@/components/vehicle-share';
import { ReserveCar } from '@/components/reserve-car';
import { vehicleDetailPath } from '@workspace/vehicle-meta';
import './vehicle-actions.css';
import { vehicleAvailability } from '@/lib/customer-convenience';
import { VehicleVisit } from '@/components/vehicle-buying-guide';
import { VehicleHistorySummary, VehicleRunningCosts, VehicleSpecificationDetails } from '@/components/vehicle-running-costs';
import { vehicleSpecificationGroups, vehicleRunningCosts as getVehicleRunningCosts } from '@/lib/vehicle-extra-facts';
import { getSimilarCars } from "@/lib/similar-cars";
import { buyerInformation } from "@/lib/buyer-information";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CustomerEnquiry,
  ChevronDown,
} from '@/components/icons';
import { CarCard } from '@/components/car-card';
import { CarComparison } from '@/components/car-comparison';
import { useComparisonSelection, useShortlistShare } from '@/components/car-comparison-tray';
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
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { isModernShowroom, selectedWebsiteTemplate } from '@/lib/website-template';
import { CustomerTemplateVehicle } from '@/components/website-templates/vehicle-template';
import { AutoDealVehicle } from '@/components/website-templates/autodeal-vehicle';
import { GrandTouringVehicleContent } from '@/components/website-templates/grand-touring-vehicle';
import { GraphiteVehicle, GraphiteVehicleContent, GraphiteVehicleHistory } from '@/components/graphite/graphite-vehicle';
import { ModernShowroomVehicle, ModernShowroomVehicleContent } from '@/components/modern-showroom/modern-showroom-vehicle';
import { GraphiteIcon } from '@/components/graphite/graphite-icon';
import { useDealerFeatures } from '@/lib/dealer-features';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useIsMobile } from '@/hooks/use-mobile';
import { vehiclePageMeta } from '@/lib/page-meta';
import {
  getVehicleBookingHref,
  getPhoneHref,
  recordBookingIntent,
} from '@/lib/cta-helpers';
import { navigateToHomeTarget } from '@/lib/home-navigation';
import { vehicleInsuranceDisclosure } from '@/lib/vehicle-history';
import { MakeLogo } from '@/components/make-logo';
import { getMakeLogoSrc } from '@/lib/make-logo';
import { dealershipLocation } from '@/lib/dealership-location';
import { formatRegistrationPlate } from '@/lib/registration-display';
import '@/components/public-vehicle-make-logo.css';


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

function suppliedVehicleDetail(value: string | null | undefined) {
  const text = value?.trim();
  return text && !/^(?:[-–—]+|unknown|not specified|not available|n\/?a|ask us|null|undefined)$/i.test(text) ? text : '';
}

function VehicleSectionDisclosure({ disclosure, title, id, className, children }: { disclosure: boolean; title: string; id?: string; className: string; children: ReactNode }) {
  return disclosure
    ? <details open id={id} className={`${className} gr-vehicle-disclosure`}><summary>{title}<ChevronDown size={20} aria-hidden="true" /></summary><div className="gr-vehicle-disclosure-body">{children}</div></details>
    : <div id={id} className={className}>{children}</div>;
}

function UnavailableAlternatives({ car, cars }: { car?: Car | null; cars: Car[] }) {
  const alternatives = car ? getSimilarCars(car, cars) : cars.filter(item =>
    (!item.inventoryStatus || item.inventoryStatus === 'available') && (!item.sourceStatus || item.sourceStatus === 'live'),
  ).slice(0, 3);
  if (!alternatives.length) return null;
  return <section className="mt-10" aria-label="Other cars to consider">
    <h2 className="section-heading">Other cars to consider</h2>
    <div className="mt-5 grid gap-5 sm:grid-cols-2">
      {alternatives.map(item => <CarCard key={item.id} car={item} />)}
    </div>
  </section>;
}

export default function CarDetail() {
  const [enquiryExpanded, setEnquiryExpanded] = useState(false);
  const [messageRequest, setMessageRequest] = useState<{id: number; text: string; vehicleId: string}>();
  const messageSequence = useRef(0);
  const enquiryFocusFrame = useRef<number | null>(null);
  const [location, setLocation] = useLocation();
  const { stock, vehicle: car, isVehicleLoading: isLoading, vehicleError: error, retryVehicle } = useStock();
  const { settings: dealerConfig, isLoading: settingsLoading, isError: settingsError } = useDealerSettings();
  const customerFeatures = useDealerFeatures();
  const websiteTemplate = selectedWebsiteTemplate(dealerConfig.presentation);
  const isGraphite = websiteTemplate === null;
  const modernShowroom = isModernShowroom(dealerConfig.presentation);
  const vehiclePhoneLayout = useIsMobile(761);
  const grandTouring = websiteTemplate === 'grand-touring';
  const autoDeal = websiteTemplate === 'autodeal';
  const quietVehicle = isGraphite || grandTouring || autoDeal;
  const comparisonEnabled = modernShowroom && dealerConfig.presentation?.comparisonEnabled === true;
  const comparison = useComparisonSelection(stock?.cars ?? (car ? [car] : []), comparisonEnabled);
  const comparisonShare = useShortlistShare();
  const [comparisonNotice, setComparisonNotice] = useState('');
  const browseSource = new URLSearchParams(window.location.search).get('from');
  const fromStock = browseSource === 'stock';
  const fromSaved = browseSource === 'saved';

  useEffect(() => {
    if (car && !isLoading && !error && !['sold', 'archived', 'hidden'].includes(String(car.inventoryStatus))) {
      trackJourneyStage('vehicle');
    }
  }, [car, isLoading, error]);

  useEffect(() => {
    if (!car) return;
    const canonical = vehicleDetailPath(car);
    if (location !== canonical) setLocation(`${canonical}${window.location.search}${window.location.hash}`, { replace: true });
  }, [car, location, setLocation]);

  useEffect(() => {
    setEnquiryExpanded(false); setMessageRequest(undefined);
    setComparisonNotice('');
    return () => { cancelAnimationFrame(enquiryFocusFrame.current ?? 0); };
  }, [car?.id]);

  useEffect(() => {
    if (!car?.id) return;
    const scrollToSection = () => {
      const id = window.location.hash.slice(1);
      if (['vehicle-description-heading', 'features-heading', 'vehicle-overview-heading', 'vehicle-running-costs-heading', 'vehicle-records-heading', 'buyer-information-heading', 'vehicle-history', 'vehicle-overview-section', 'vehicle-questions', 'vehicle-history-section', 'vehicle-visit-delivery', 'vehicle-delivery-heading', 'vehicle-enquiry', 'vehicle-source-report-heading', 'vehicle-quality-checks'].includes(id)) {
        if (id === 'vehicle-enquiry') setEnquiryExpanded(true);
        const target = document.getElementById(id);
        if (target instanceof HTMLDetailsElement) target.open = true;
        for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        target?.scrollIntoView({ block: 'start', behavior: 'instant' });
        if (id === 'vehicle-enquiry') document.getElementById('vehicle-enquiry-heading')?.focus({preventScroll: true});
      }
    };
    const frame = requestAnimationFrame(scrollToSection);
    window.addEventListener('hashchange', scrollToSection);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', scrollToSection); };
  }, [car?.id]);


  usePageMeta(!error && car && !['sold', 'archived', 'hidden', 'unavailable', 'withdrawn'].includes(String(car.inventoryStatus)) ? vehiclePageMeta(car, dealerConfig) : isLoading ? null : {
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
      <PageHeading title="Couldn’t load this car" description="Try again or browse the cars we have in stock." />
      <div className="flex flex-wrap gap-3"><Button onClick={retryVehicle}>Try again</Button><Button asChild variant="outline"><Link href="/stock">Browse stock</Link></Button></div>
    </div></div>;
  }

  const stockCars = stock?.cars ?? [];
  if (!car || ['sold', 'archived', 'hidden', 'unavailable', 'withdrawn'].includes(String(car.inventoryStatus))) return <div className="container mx-auto px-4 py-10 sm:px-6 lg:px-8"><PageHeading eyebrow="Vehicle details" title={car ? `${vehicleDisplayTitle(car)} is no longer available` : "This car isn’t in our current stock"} description="This car is no longer in our online stock. Browse our current cars, or ask us about this one." /><div className="flex flex-wrap gap-3"><Button asChild><Link href="/stock">Browse current stock</Link></Button><Button asChild variant="outline"><Link href="/contact">Contact us</Link></Button></div><UnavailableAlternatives car={car} cars={stockCars} /></div>;

  const similarCars = getSimilarCars(car, stockCars);
  const registration = vehicleRegistration(car);
  const registrationBand = [car.registrationBand, car.registration]
    .map((value) => value?.trim() || '')
    .find((value) => value && !isUKNumberPlate(value));
  const registrationYear = stockRegistrationYear({ ...car, registrationBand: registrationBand ?? null }) || registrationBand || 'Unknown';
  const bookingHref = getVehicleBookingHref(car);
  const vehicleLabel = vehicleDisplayTitle(car);
  const vehicleTrim = suppliedVehicleDetail(car.variant) || suppliedVehicleDetail(car.trim);
  const stockStatus = vehicleAvailability(car.inventoryStatus);
  const showMakeLogo = !autoDeal && Boolean(getMakeLogoSrc(car.make));
  const vehicleRunningCostFacts = getVehicleRunningCosts(car);
  const sourceReport = readVehicleSourceReport(car);
  const originalAdvertDescriptions = Array.isArray(car.sourceExtras?.originalAdvertDescriptions)
    ? car.sourceExtras.originalAdvertDescriptions.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean)
    : [];

  const overviewSpecs = [
    { label: 'Engine', value: car.engineSize || (car.engineCC ? `${(car.engineCC / 1000).toFixed(1)}L` : 'Ask us') },
    { label: 'Body type', value: car.bodyType || '-' },
    { label: 'Doors', value: car.doors ? String(car.doors) : '-' },
    { label: 'Seats', value: car.seats ? String(car.seats) : '-' },
    { label: 'Colour', value: car.colour || '-' },
    { label: 'Drivetrain', value: car.drivetrain || '-' },
    { label: 'Emissions', value: car.emissionClass || '-' },
  ].map(fact => ({ ...fact, value: suppliedVehicleDetail(fact.value) })).filter(fact => fact.value);

  const hasSpecifications = overviewSpecs.length > 0 || vehicleSpecificationGroups(car).length > 0;
  const handoverFacts = buyerInformation(car).filter(item => item.value && !['Service history', 'Keys', 'Owners', 'Previous keepers'].includes(item.label));

  const keyFacts: { label: string; value: string; testId?: string }[] = [
    { label: 'Year', value: registrationYear, testId: 'text-registration-year' },
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
  ].map(fact => ({ ...fact, value: suppliedVehicleDetail(fact.value) })).filter(fact => fact.value);
  const sparseSummary = keyFacts.length < 4;
  const privatePreview = Boolean(privateWebsitePreviewBase());
  const dealerLocation = [dealerConfig.address?.city?.trim(), dealerConfig.address?.region?.trim()].filter(Boolean).join(', ');

  const damageDisclosure = vehicleInsuranceDisclosure(car, vehicleContent(car).description);

  const hasHandoverInformation = handoverFacts.length > 0 || Boolean(dealerConfig.presentation?.includedInformation?.trim()) || Boolean(damageDisclosure);
  const content = vehicleContent(car);
  const separateDescriptionNotes = car.sourceExtras?.vehicleDescriptionPlacement === 'separate' && typeof car.sourceExtras?.vehicleDescriptionBody === 'string' && Array.isArray(car.sourceExtras?.vehicleDescriptionDisclosures) && car.sourceExtras.vehicleDescriptionDisclosures.length > 0;
  const description = separateDescriptionNotes ? String(car.sourceExtras!.vehicleDescriptionBody) : content.description;
  const features = prioritiseVehicleFeatures(content.features);
  const summaryFacts = vehiclePageSummary(car);
  const includedItems = vehiclePageInclusions(car, settingsLoading || settingsError ? undefined : dealerConfig.presentation);
  const hasOverview = Boolean(description?.trim()) || includedItems.length > 0 || hasSpecifications || vehicleRunningCostFacts.length > 0;
  const repeatedBadgeLabels = summaryFacts.flatMap(fact => fact.id === 'owners' ? ['Owners', 'Previous keepers'] : fact.id === 'service' ? ['Service history'] : []);
  const openVehicleEnquiry = (message?: string) => {
    const requestedMessage = message?.trim();
    if (requestedMessage) setMessageRequest({id: ++messageSequence.current, text: requestedMessage, vehicleId: car.id});
    setEnquiryExpanded(true);
    cancelAnimationFrame(enquiryFocusFrame.current ?? 0);
    enquiryFocusFrame.current = requestAnimationFrame(() => {
      enquiryFocusFrame.current = null;
      const enquiry = document.getElementById('vehicle-enquiry');
      const messageField = requestedMessage && enquiry?.querySelector<HTMLTextAreaElement>('[data-testid="textarea-enquiry-message"]');
      const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
      if (messageField) {
        messageField.focus({preventScroll: true});
        messageField.scrollIntoView({block: 'center', behavior});
      } else {
        enquiry?.scrollIntoView({block: 'start', behavior});
        document.getElementById('vehicle-enquiry-heading')?.focus({preventScroll: true});
      }
    });
  };
  const bookingAction = !settingsLoading && !settingsError && customerFeatures.enabled('testDriveBookings') && dealerConfig.testDriveBooking?.enabled !== false && (!car.inventoryStatus || car.inventoryStatus === 'available') ? (
      <a
        key="booking"
        className={`vehicle-booking-action${isGraphite ? ' gr-button gr-button--secondary' : ''}`}
        href={bookingHref}
        onClick={() => recordBookingIntent({ source: 'car_detail', vehicleContext: true })}
        data-vehicle-contact="booking"
      >
        <CalendarDays size={18} aria-hidden="true" />
        {dealerConfig.bookViewing.ctaLabel}
      </a>
  ) : null;
  const enquiriesEnabled = customerFeatures.enabled('publicEnquiries');
  const enquiryAction = enquiriesEnabled && (
    <a key="enquiry" className={`vehicle-enquiry-action${isGraphite ? ' gr-button' : ''}`} href="#vehicle-enquiry" onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); openVehicleEnquiry();
    }}>{quietVehicle ? 'Ask about this car' : 'Message'}</a>
  );

  const registrationDetails = registration && (
    <dl className="vehicle-registration">
      <dt>Registration</dt>
      <dd>{autoDeal ? formatRegistrationPlate(registration) : <UKNumberPlate value={registration} variant="front" size="sm" testId={`plate-vehicle-${car.id}`} />}</dd>
    </dl>
  );
  return <VehicleQuickChecks key={car.id} vehicleId={car.id} vehiclePrice={car.price} currency={car.currency} priceType={car.priceType} onEnquire={enquiriesEnabled ? openVehicleEnquiry : undefined}>
    {({ motAction, deliveryAction, motHistory, requestMotHistory, openMotHistory }) => {
  const motSummary = vehicleEnquiryMot(car, motHistory);
  const showQualityChecks = !privatePreview || Boolean(motSummary || sourceReport?.history?.checks?.length);
  const coveredAnswerTopics = [
    'history', 'price', 'mileage', 'specification', 'dealer-hours', 'dealer-location', 'dealer-contact',
    ...summaryFacts.map(fact => fact.id),
    ...(features.length ? ['equipment'] : []),
    ...(vehicleRunningCostFacts.length ? ['costs'] : []),
    ...(includedItems.length ? ['included'] : []),
    ...(includedItems.some(item => /\bwarrant(?:y|ies)\b/i.test(item)) ? ['warranty'] : []),
    ...(deliveryAction ? ['delivery'] : []),
    ...(motAction && motSummary ? ['mot'] : []),
  ];

  const templateIdentity = <header className="vehicle-detail-heading" data-testid="vehicle-identity">
            <h1 className={showMakeLogo ? 'make-logo-vehicle-heading' : undefined}>
              {showMakeLogo ? <><MakeLogo make={car.make} size={28} /><span>{vehicleLabel}</span></> : vehicleLabel}
            </h1>
            {vehicleTrim && <p>{vehicleTrim}</p>}
          </header>;
  const templateGallery = <div className="vehicle-detail-gallery min-w-0">
            <Gallery key={car.id} car={car} images={car.images || []} heroImage={car.heroImage} vehicleLabel={vehicleLabel} customerView hideInlineThumbnails inlinePresentation={autoDeal ? 'autodeal' : modernShowroom ? 'showroom-rail' : quietVehicle ? 'showroom' : 'standard'} customerActions={{
              enquiryHref: customerFeatures.enabled('publicEnquiries') ? '#vehicle-enquiry' : undefined,
              onEnquiry: customerFeatures.enabled('publicEnquiries') ? () => openVehicleEnquiry() : undefined,
            }} />
          </div>;
  const templatePrice = <div className="vehicle-price-block">
              {stockStatus !== 'Available' && (
                <p className="vehicle-stock-status">{stockStatus}</p>
              )}
              {!autoDeal && <p className="vehicle-price-caption">Vehicle price</p>}
              <p className={`luxxy-price${car.price ? '' : ' is-price-on-application'}`}>{car.price ? formatPrice(car.price, car.currency) : 'Price on application'}</p>
              {car.priceType && /^(?:\+\s*VAT|VAT (?:included|qualifying)|inc(?:lusive of)?\.? VAT|ex(?:cluding)?\.? VAT)$/i.test(car.priceType.trim()) && <p className="text-sm text-muted-foreground">{car.priceType}</p>}
              <PriceReduction car={car} showRecordedDate />
              {damageDisclosure && <a href="#vehicle-history" className="vehicle-insurance-disclosure"><VehicleFactIcon label="Insurance history" /><span>{damageDisclosure.summary}</span><ArrowRight className="h-4 w-4" /></a>}
            </div>;
  const templateFacts = keyFacts.length > 0 && <dl className="vehicle-key-facts grid grid-cols-2 gap-x-4 gap-y-4" aria-label="Vehicle details">
              {keyFacts.map((fact) => (
                <div key={fact.label}>
                  <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                    {quietVehicle ? fact.label : <VehicleTerm label={fact.label} value={fact.value}><VehicleFactIcon label={fact.label} value={fact.value} />{fact.label}</VehicleTerm>}
                  </dt>
                  <dd className="mt-1 text-sm font-medium" data-testid={fact.testId}>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>;
  const templateMot = motSummary && <button type="button" className="vehicle-mot-expiry vehicle-mot-fact" onClick={event => openMotHistory(event.currentTarget)} aria-label={`${motSummary.label} ${motSummary.value}. View MOT history`}>
              <VehicleFactIcon label="MOT" /><span>{motSummary.label} <strong>{motSummary.value}</strong></span>
            </button>;
  const graphiteTools = <div className="vehicle-action-tools" aria-label="Save, share and compare">
    <SaveCarButton car={car} variant="inline" className="vehicle-save-control border-transparent bg-transparent" />
    <VehicleShare key={car.id} car={car} />
    {comparisonEnabled && <button type="button" aria-pressed={comparison.selectedIds.includes(car.id)} onClick={() => {
      if (comparison.selectedIds.includes(car.id) && comparison.comparedCars.length >= 2) { comparisonShare.reset(); comparison.setOpen(true); return; }
      const selected = comparison.selectedIds.includes(car.id);
      comparison.toggle(car.id);
      setComparisonNotice(selected ? 'Removed from comparison.' : comparison.selectedIds.length >= 3 ? 'You can compare up to 3 cars. Change your selection on the stock page.' : 'Added to comparison. Choose another car from our stock.');
    }}>Compare</button>}
    {comparisonNotice && <p className="gr-vehicle-comparison-notice" role="status">{comparisonNotice} <Link href="/stock">View stock</Link></p>}
  </div>;
  const autoDealAddress = autoDeal ? dealershipLocation(dealerConfig.address) : undefined;
  const templateActions = <div className="vehicle-action-area" data-testid="desktop-purchase-panel">
            {autoDeal && <div className="ad-vehicle__seller">
              <h2>{dealerConfig.identity.name}</h2>
              {autoDealAddress && !autoDealAddress.isSample && autoDealAddress.lines.length > 0 && <p>{autoDealAddress.lines.join(', ')}</p>}
            </div>}
            {!quietVehicle && bookingAction}
            {modernShowroom && <><h2>Interested in this car?</h2><p>Ask a question or arrange a time to see it.</p>{enquiriesEnabled && <button type="button" className="gr-button gr-vehicle-contact-enquire" onClick={() => openVehicleEnquiry()}>Enquire about this car</button>}</>}
            {autoDeal ? (enquiryAction || bookingAction) && <div className="ad-vehicle__primary-actions">{enquiryAction}{bookingAction}</div> : !modernShowroom && enquiryAction && <div className="vehicle-primary-actions vehicle-summary-main-actions">{enquiryAction}</div>}
            {quietVehicle && !modernShowroom && !autoDeal && bookingAction}
            {modernShowroom && !vehiclePhoneLayout && bookingAction}
            <div className="vehicle-action-tools" aria-label="Contact and share">
              <VehicleCall car={car} buttonLabel="Call" />
              <VehicleWhatsApp car={car} />
              {!modernShowroom && <>
                {!autoDeal && <VehicleShare key={car.id} car={car} />}
                <SaveCarButton car={car} variant="inline" className="vehicle-save-control border-transparent bg-transparent" />
                {autoDeal && <VehicleShare key={car.id} car={car} />}
              </>}
            </div>
            {(dealerConfig.partExchange?.enabled || deliveryAction) && <details open={modernShowroom || undefined} className="vehicle-buying-options">
              <summary>{dealerConfig.partExchange?.enabled ? deliveryAction ? 'Part exchange & delivery' : 'Part exchange' : 'Delivery'}<ChevronDown size={17} /></summary>
              <div>
                {dealerConfig.partExchange?.enabled && <a href={customerFeatures.enabled('publicEnquiries') ? `/enquire?type=part_exchange&vehicleId=${encodeURIComponent(car.id)}` : '/contact'} className="vehicle-part-exchange-link">Part exchange your car <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>}
                {deliveryAction}
              </div>
            </details>}
            {!autoDeal && dealerConfig.identity.name?.trim() && <div className="vehicle-seller">
              <strong>{dealerConfig.identity.name}</strong>
              {dealerLocation && <span>{dealerLocation}</span>}
              <a href="#vehicle-visit-delivery">Showroom details <ArrowRight size={15} aria-hidden="true" /></a>
            </div>}
          </div>;
  const templateHighlights = <>{summaryFacts.length > 0 && <ul className="vehicle-specific-facts" aria-label="About this car">{summaryFacts.map(fact => <li key={fact.id}>{fact.text}</li>)}</ul>}<VehicleSellingPoints car={car} omitMileage omitLabels={repeatedBadgeLabels}/></>;

  const informationNavigation = (
          <nav aria-label="Vehicle information sections" className="vehicle-section-nav">
            {hasOverview && <a href="#vehicle-overview-section">Overview</a>}
            {autoDeal && hasSpecifications && <a href="#vehicle-overview-heading">Specifications</a>}
            {features.length > 0 && <a href="#features-heading">Equipment</a>}
            {showQualityChecks && !modernShowroom && <a href="#vehicle-quality-checks">Checks</a>}
            <a href="#vehicle-history-section">{isGraphite ? 'MOT & history' : 'History'}</a>
            <a href="#vehicle-visit-delivery">Visit &amp; delivery</a>
            {modernShowroom && enquiriesEnabled && <a href="#vehicle-enquiry" onClick={event => { event.preventDefault(); openVehicleEnquiry(); }}>Enquiry</a>}
          </nav>
  );
  const informationSections = <>

          {hasOverview && <div id="vehicle-overview-section" className="vehicle-page-chapter vehicle-overview-chapter">
            {description && <section
              className="vehicle-description-section mt-8 border-t border-border pt-7"
              aria-labelledby="vehicle-description-heading"
            >
              <h2 id="vehicle-description-heading" className="section-heading scroll-mt-28">
                {websiteText(dealerConfig, "vehicleDescriptionHeading")}
              </h2>
              <div className="vehicle-description-copy mt-4 space-y-4 text-base leading-7 text-foreground">
                <VehicleDescription expandedByDefault={modernShowroom || autoDeal} key={car.id} paragraphs={vehicleDescriptionParagraphs(description)} />
                {separateDescriptionNotes && <aside className="rounded-lg border border-border bg-muted/40 p-4 text-sm leading-6" aria-label="Vehicle history and important information"><h3 className="mb-2 font-semibold text-foreground">Vehicle history & important information</h3>{(car.sourceExtras!.vehicleDescriptionDisclosures as unknown[]).filter((note): note is string => typeof note === 'string').map(note => <p key={note} className="whitespace-pre-line">{note}</p>)}</aside>}
                {typeof car.sourceExtras?.vehicleDescriptionTax === 'string' && <aside className="rounded-lg border border-border p-4 text-sm leading-6" aria-label="Vehicle tax information"><h3 className="mb-2 font-semibold">Vehicle tax</h3><p>{car.sourceExtras.vehicleDescriptionTax}</p><a href="https://www.gov.uk/vehicle-tax-direct-debit/setting-up" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">About DVLA Direct Debit payments</a></aside>}

              </div>

            </section>}

            {includedItems.length > 0 && <section aria-labelledby="vehicle-included-heading" className="vehicle-included">
              <h2 id="vehicle-included-heading" className="section-heading">What’s included</h2>
              <ul>{includedItems.map(item => <li key={item}>{item}</li>)}</ul>
            </section>}
            {(hasSpecifications || vehicleRunningCostFacts.length > 0) && <details open={modernShowroom || autoDeal || undefined} className="vehicle-technical-disclosure">
              <summary>Specifications &amp; running costs</summary>
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
              <VehicleSpecificationDetails expandedByDefault={modernShowroom} car={car} />
            </section>}
            {vehicleRunningCostFacts.length > 0 && <div className="vehicle-costs-panel">
              <VehicleRunningCosts car={car} />
            </div>}
            </div>}

            </details>}
          </div>}
          <VehicleSectionDisclosure disclosure={modernShowroom} key={`equipment-${car.id}`} title="Features and equipment" className="vehicle-page-chapter vehicle-equipment-chapter">
            {features.length > 0 && (
              <section
                className="vehicle-features-section mt-8 border-t border-border pt-7 lg:col-span-2"
                aria-labelledby="features-heading"
              >
                <h2 id="features-heading" className="section-heading scroll-mt-28">
                  {websiteText(dealerConfig, "vehicleFeaturesHeading")}
                </h2>
                <VehicleEquipmentList key={car.id} expandedByDefault={modernShowroom} features={features} />
              </section>
            )}

          </VehicleSectionDisclosure>
          {showQualityChecks && !modernShowroom && <VehicleQualityChecks car={car} motHistory={motHistory} dealerConfirmed={isMultiChoiceWebsite()} hideUnknown={privatePreview} onAskTeam={enquiriesEnabled ? openVehicleEnquiry : undefined} />}
          <VehicleSectionDisclosure disclosure={modernShowroom} key={`history-${car.id}`} title="Service and vehicle history" id="vehicle-history-section" className="vehicle-page-chapter vehicle-history-chapter">
            <div className="vehicle-information-row vehicle-records-row">
            {isGraphite ? <GraphiteVehicleHistory car={car} mot={motSummary} motAction={motAction} /> : <VehicleHistorySummary car={car} motAction={motAction} />}
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
                href={customerFeatures.enabled('publicEnquiries') ? `/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}` : '/contact'}
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
            {enquiriesEnabled ? <button type="button" className="vehicle-service-record-request" onClick={() => openVehicleEnquiry('Please send the available service-book photos and service records for this car.')}><span>Request service records<span className="vehicle-service-record-note">Ask for the available service-book photos and records.</span></span><ArrowRight className="h-4 w-4" aria-hidden="true" /></button> : <Link href="/contact" className="vehicle-service-record-request">Contact the showroom about service records</Link>}
          </div>
          {sourceReport && <details open={modernShowroom || undefined} className="vehicle-full-records"><summary>Vehicle checks</summary><VehicleSourceReport expandedByDefault={modernShowroom} car={car} /></details>}
          {originalAdvertDescriptions.length > 0 && <details open={modernShowroom || undefined} className="vehicle-original-advert border-t border-border pt-4 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Original advert information</summary>{originalAdvertDescriptions.map((value, index) => <p key={index} className="whitespace-pre-line py-2">{value}</p>)}</details>}

            {showQualityChecks && modernShowroom && <VehicleQualityChecks car={car} motHistory={motHistory} dealerConfirmed={isMultiChoiceWebsite()} hideUnknown={privatePreview} onAskTeam={enquiriesEnabled ? openVehicleEnquiry : undefined} />}
          </VehicleSectionDisclosure>
          <VehicleSectionDisclosure disclosure={modernShowroom} key={`visit-${car.id}`} title="Delivery and visiting" id="vehicle-visit-delivery" className="vehicle-page-chapter vehicle-visit-delivery-chapter">
            {isGraphite && <h2 className="gr-vehicle-visit-title">Visit &amp; delivery</h2>}
            {isGraphite ? <div className="gr-vehicle-visit-card"><GraphiteIcon name="map-pin" className="gr-vehicle-visit-icon" /><VehicleVisit car={car} /></div> : <VehicleVisit car={car} />}
            {deliveryAction && <section aria-labelledby="vehicle-delivery-heading" className="vehicle-delivery-information">
              <h2 id="vehicle-delivery-heading" tabIndex={-1} className="section-heading scroll-mt-28">{isGraphite && <GraphiteIcon name="car" />}Delivery to your door</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Enter your postcode to see the delivery cost and total price.</p>
              {deliveryAction}
            </section>}
          </VehicleSectionDisclosure>
          {enquiriesEnabled && <VehicleAnswers expandedByDefault={modernShowroom} key={car.id} car={car} motHistory={motHistory} coveredTopics={coveredAnswerTopics} onAskTeam={openVehicleEnquiry} />}

  </>;

  const enquiryInformation = enquiryExpanded && <VehicleEnquiryInformation
    key={`information-${car.id}`}
    car={car}
    motHistory={motHistory}
    requestMotHistory={requestMotHistory}
    dealer={settingsLoading || settingsError ? undefined : dealerConfig}
    includedItems={includedItems}
    compact={modernShowroom || autoDeal}
    registrationInSummary={autoDeal}
  />;

  const GraphiteFamilyVehicle = modernShowroom ? ModernShowroomVehicle : GraphiteVehicle;
  const vehicleContainer = autoDeal ? 'ad-container' : isGraphite ? 'gr-container' : grandTouring ? 'gt-vehicle-container' : 'container mx-auto px-4 sm:px-6 lg:px-8';
  return (
    <div className={autoDeal ? 'vehicle-page ad-vehicle-page min-h-screen' : isGraphite ? 'vehicle-page gr-vehicle-page min-h-screen' : grandTouring ? 'vehicle-page gt-vehicle-page min-h-screen' : 'vehicle-page vehicle-redesigned vehicle-page-streamlined vehicle-page-enter luxxy-shell min-h-screen'}>
      <div className={vehicleContainer}>
        <div className="vehicle-browse-tools flex items-center">
          <Link href={fromStock ? browseReturnHref() : fromSaved ? '/saved' : '/stock'} onClick={event => {
            if (fromStock && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) requestBrowseRestore();
          }} className="vehicle-return-link text-link min-h-11 text-muted-foreground">
            {isGraphite ? <GraphiteIcon name="arrow-left" /> : <ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            {fromStock ? 'Back to your results' : fromSaved ? 'Back to saved cars' : 'Back to stock'}
          </Link>
        </div>
        {autoDeal ? <AutoDealVehicle
          identity={templateIdentity}
          keyDetails={keyFacts.filter(fact => ['Year', 'Mileage', 'Fuel', 'Transmission'].includes(fact.label)).map(fact => fact.value)}
          facts={templateFacts}
          gallery={templateGallery}
          price={templatePrice}
          registration={registrationDetails}
          mot={templateMot}
          actions={templateActions}
          reservation={<ReserveCar key={car.id} car={car} />}
          navigation={informationNavigation}
          photoRequest={enquiriesEnabled && <VehiclePhotoRequest key={`photos-${car.id}`} onRequest={openVehicleEnquiry} />}
        >{informationSections}</AutoDealVehicle> : websiteTemplate ? <CustomerTemplateVehicle template={websiteTemplate} car={car} identity={templateIdentity} gallery={templateGallery} price={templatePrice} registration={registrationDetails} facts={templateFacts} mot={templateMot} actions={templateActions} highlights={templateHighlights} reservation={<ReserveCar key={car.id} car={car}/>} photoRequest={enquiriesEnabled && <VehiclePhotoRequest key={`photos-${car.id}`} onRequest={openVehicleEnquiry}/>} onEnquiry={enquiriesEnabled ? openVehicleEnquiry : undefined}/> : <GraphiteFamilyVehicle identity={templateIdentity} gallery={templateGallery} price={templatePrice} tools={graphiteTools} primaryAction={enquiryAction} bookingAction={vehiclePhoneLayout ? bookingAction : null} registration={registrationDetails} facts={templateFacts} mot={templateMot} actions={templateActions} highlights={templateHighlights} sparse={sparseSummary} reservation={<ReserveCar key={car.id} car={car}/>} photoRequest={enquiriesEnabled && <VehiclePhotoRequest key={`photos-${car.id}`} onRequest={openVehicleEnquiry}/>}/> }
        {!autoDeal && (modernShowroom ? <ModernShowroomVehicleContent navigation={informationNavigation} contact={templateActions}>{informationSections}</ModernShowroomVehicleContent> : isGraphite ? <GraphiteVehicleContent navigation={informationNavigation}>{informationSections}</GraphiteVehicleContent> : grandTouring ? <GrandTouringVehicleContent navigation={informationNavigation}>{informationSections}</GrandTouringVehicleContent> : <div className="vehicle-details-content min-w-0">{informationNavigation}{informationSections}</div>)}
        {enquiriesEnabled && <details id="vehicle-enquiry" className="vehicle-inline-enquiry vehicle-message-disclosure" open={enquiryExpanded} onToggle={event => setEnquiryExpanded(event.currentTarget.open)}>
          <summary><h2 id="vehicle-enquiry-heading" tabIndex={-1} className="section-heading">{autoDeal ? 'Message the dealership' : quietVehicle ? 'Ask about this car' : 'Message the showroom'}</h2>{!modernShowroom && !autoDeal && <span className="vehicle-enquiry-intro">Ask a question about this {vehicleLabel}</span>}{(modernShowroom || autoDeal) && <span className="gr-vehicle-enquiry-toggle">{enquiryExpanded ? 'Close message' : 'Write a message'}<GraphiteIcon name="chevron-down" /></span>}</summary>
          <div className="vehicle-message-body">
            {(modernShowroom || autoDeal) && enquiryInformation}
            <EnquiryForm key={car.id} vehicle={car} initialType="general" embedded compact={modernShowroom || autoDeal} messageRequest={messageRequest?.vehicleId === car.id ? messageRequest : undefined} />
            {!modernShowroom && !autoDeal && enquiryInformation}
          </div>
        </details>}
      </div>
      {comparisonEnabled && <CarComparison cars={comparison.comparedCars} open={comparison.open && comparison.comparedCars.length >= 2} onOpenChange={comparison.setOpen} onShare={ids => void comparisonShare.share(ids)} shareStatus={comparisonShare.shareStatus} copyLink={comparisonShare.copyLink} returnSource="stock" />}
      {similarCars.length > 0 && (
        <section
          className="vehicle-similar-stock section-space border-t border-border bg-secondary/40"
          aria-labelledby="similar-cars-heading"
        >
          <div className={vehicleContainer}>
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
                  photoControls={false}
                  recommendationDetails
                  recommendationInclusions={vehiclePageInclusions(similarCar, settingsLoading || settingsError ? undefined : dealerConfig.presentation)}
                  stretchedLink
                  analyticsSource="similar_cars"
                />
              ))}
            </div>
          </div>
        </section>
      )}
      {!autoDeal && (getPhoneHref(dealerConfig) || enquiryAction) && <nav className="vehicle-mobile-actions" aria-label="Contact about this vehicle">
        {getPhoneHref(dealerConfig) && <VehicleCall car={car} buttonLabel="Call" />}
        {enquiryAction && <a href="#vehicle-enquiry" onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openVehicleEnquiry(); }}><CustomerEnquiry className="h-4 w-4" aria-hidden="true" />{quietVehicle ? 'Ask about this car' : 'Message'}</a>}
      </nav>}
    </div>
  );
    }}
  </VehicleQuickChecks>;
}
