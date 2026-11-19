import { useEffect, useId, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Link, useLocation } from 'wouter';
import type { DealerSettings } from '@workspace/api-client-react';
import type { DealerConfig } from '@/config/dealer';
import type { Car as StockCar } from '@/lib/stock-context';
import type { FilterState } from '@/components/filters';
import { Mail } from '@/components/icons';
import { MultiBodyShape } from '@/components/multi-body-shape';
import { MultiHomeReviews } from '@/components/multi-home-reviews';
import { ShowroomPhoto } from '@/components/showroom-photo';
import { AiCarFinder } from '@/components/ai-car-finder';
import { DeliveryEstimator } from '@/components/delivery-estimator';
import { GraphiteCarCard } from '@/components/graphite/graphite-car-card';
import { dealershipLocation } from '@/lib/dealership-location';
import { appointmentVisitNote, customerOpeningHours, warrantySummary } from '@/lib/dealership-customer-copy';
import { getEnquiryHref, getPhoneHref, getWhatsAppHref, recordContactIntent } from '@/lib/cta-helpers';
import { homepageFeaturedCars } from '@/lib/homepage-featured-cars';
import { stockBudgetOptions } from '@/lib/stock-budget-options';
import { stockBodyTypes } from '@/lib/body-types';
import { multiChoiceHomeSections, multiChoiceReviews, multiChoiceReviewsUrl } from '@/lib/multi-choice-home-sections';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { customerDefaultCopy, websiteText } from '@/lib/website-content';
import { formatPhoneDisplay, formatPrice } from '@/lib/utils';
import { clearHomepagePartExchangeLookup, homepagePartExchangeIntentVersion, prepareHomepagePartExchange, retainHomepagePartExchangeLookup } from '@/lib/homepage-part-exchange';
import { lookupPartExchangeCar } from '@/lib/part-exchange-lookup';
import { normaliseExchangeRegistration } from '@/lib/part-exchange-autofill';
import { trackEvent } from '@/lib/analytics';
import './graphite-home.css';

function HomeIcon({ name }: { name: 'arrow-right' | 'calendar' | 'chevron-down' | 'shield-check' }) {
  return <img src={`/brand/graphite/icon-${name}.svg`} width={24} height={24} alt="" aria-hidden="true" />;
}

type HomeSettings = DealerConfig & Partial<Pick<DealerSettings, 'testDriveBooking'>>;
export type GraphiteHomepageProps = {
  settings: HomeSettings;
  cars: StockCar[];
  isLoading: boolean;
  error: string | null;
  publicEnquiriesEnabled: boolean;
  filters: FilterState;
  setFilters: Dispatch<SetStateAction<FilterState>>;
  onSearch: (filters: FilterState) => void;
};

function GraphiteHomeSearch({ cars, isLoading, error, filters, setFilters, onSearch }: Pick<GraphiteHomepageProps, 'cars' | 'isLoading' | 'error' | 'filters' | 'setFilters' | 'onSearch'>) {
  const helpId = useId();
  const choices = (field: 'make' | 'model') => [...new Set(cars.filter(car => field !== 'model' || car.make === filters.make).map(car => car[field]).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
  const makes = choices('make'), models = choices('model');
  const orphanModel = Boolean(filters.model && !filters.make);
  const matches = cars.filter(car => (!filters.make || car.make === filters.make) && (!filters.model || car.model === filters.model) && (!filters.maxPrice || (car.price != null && car.price > 0 && car.price <= Number(filters.maxPrice)))).length;
  const update = (field: 'make' | 'model' | 'maxPrice', value: string) => setFilters(current => ({ ...current, [field]: value, ...(field === 'make' ? { model: '' } : {}) }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isLoading || orphanModel) return;
    onSearch({ ...filters, minPrice: '', fuel: '', transmission: '', bodyType: '', search: '', ulez: false, sort: '' });
  };
  return <form className="gr-home-search" aria-label="Search used cars" onSubmit={submit}>
    <div className="gr-home-search-fields">
      <label><span>Make</span><span className="gr-home-select"><select value={filters.make} disabled={isLoading} onChange={event => update('make', event.target.value)}><option value="">Any make</option>{filters.make && !makes.includes(filters.make) && <option value={filters.make}>{filters.make} (saved choice)</option>}{makes.map(make => <option key={make}>{make}</option>)}</select><HomeIcon name="chevron-down" /></span></label>
      <label><span>Model</span><span className="gr-home-select"><select value={filters.model} disabled={isLoading || (!filters.make && !filters.model)} aria-describedby={!filters.make ? helpId : undefined} onChange={event => update('model', event.target.value)}><option value="">Any model</option>{filters.model && !models.includes(filters.model) && <option value={filters.model}>{filters.model} (saved choice)</option>}{models.map(model => <option key={model}>{model}</option>)}</select><HomeIcon name="chevron-down" /></span></label>
      <label><span>Maximum price</span><span className="gr-home-select"><select value={filters.maxPrice} disabled={isLoading} onChange={event => update('maxPrice', event.target.value)}><option value="">Any price</option>{stockBudgetOptions(cars, filters.maxPrice).map(price => <option key={price} value={price}>{formatPrice(price)}</option>)}</select><HomeIcon name="chevron-down" /></span></label>
      <button type="submit" className="gr-button" disabled={isLoading || orphanModel}>{isLoading ? 'Loading cars…' : error ? 'Browse stock' : `See ${matches} ${matches === 1 ? 'car' : 'cars'}`}</button>
    </div>
    {!filters.make && <p id={helpId} className={orphanModel ? 'gr-home-feedback' : 'sr-only'} role={orphanModel ? 'status' : undefined}>{orphanModel ? 'Choose a make or clear the saved model before searching.' : 'Choose a make to select a model.'}</p>}
    {error && <p className="gr-home-feedback" role="status">Stock couldn’t load. Open our stock page to try again.</p>}
  </form>;
}

function GraphitePartExchangeStart() {
  const [, navigate] = useLocation();
  const [registration, setRegistration] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [lookupFailed, setLookupFailed] = useState(false);
  const currentPlate = useRef(''), request = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const errorId = useId();
  const cancel = () => { request.current?.abort(); request.current = null; clearTimeout(timer.current); };
  useEffect(() => cancel, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (request.current) return;
    clearHomepagePartExchangeLookup();
    if (!prepareHomepagePartExchange(registration)) { setError('Enter your complete UK registration to continue.'); return; }
    const plate = normaliseExchangeRegistration(registration), controller = new AbortController(), intent = homepagePartExchangeIntentVersion();
    request.current = controller;
    setError(''); setLookupFailed(false); setBusy(true);
    const active = () => request.current === controller && !controller.signal.aborted && currentPlate.current === plate && homepagePartExchangeIntentVersion() === intent;
    timer.current = setTimeout(() => {
      if (request.current !== controller) return;
      const showError = active(); cancel(); setBusy(false);
      if (showError) { setLookupFailed(true); setError('We couldn’t find your car. Try again or enter the details manually.'); }
    }, 12_000);
    try {
      const details = await lookupPartExchangeCar(plate, controller.signal);
      if (!active()) return;
      retainHomepagePartExchangeLookup(details);
      trackEvent('showroom_filter_applied', { source: 'homepage_part_exchange', preset: 'part_exchange', filter_count: 0 });
      navigate('/enquire?type=part_exchange');
    } catch {
      if (active()) { setLookupFailed(true); setError('We couldn’t find your car. Try again or enter the details manually.'); }
    } finally {
      if (request.current === controller) { clearTimeout(timer.current); request.current = null; setBusy(false); }
    }
  }
  return <form className="gr-home-px-form" aria-label="Start part exchange" aria-busy={busy} onSubmit={submit}>
    <label><span>Your registration</span><input value={registration} placeholder="AB12 CDE" autoCapitalize="characters" autoComplete="off" maxLength={20} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} onChange={event => { cancel(); const value = event.target.value.toUpperCase(); currentPlate.current = normaliseExchangeRegistration(value); clearHomepagePartExchangeLookup(); setRegistration(value); setError(''); setBusy(false); setLookupFailed(false); }} /></label>
    <button className="gr-button" type="submit" disabled={busy}>{busy ? 'Finding your car…' : 'Find my car'}</button>
    {busy && <p className="gr-home-feedback" role="status">Checking your car…</p>}
    {error && <p id={errorId} className="gr-home-feedback" role="alert">{error}</p>}
    {lookupFailed && <button className="gr-home-link" type="button" onClick={() => { cancel(); clearHomepagePartExchangeLookup(); if (prepareHomepagePartExchange(registration)) navigate('/enquire?type=part_exchange&manual=true'); }}>Enter details manually<HomeIcon name="arrow-right" /></button>}
  </form>;
}

const published = (value?: string) => { const text = value?.trim() || ''; return /^(sample|example|placeholder)\b|replace this|tell customers/i.test(text) ? '' : text; };

function GraphiteHomeVisit({ settings }: { settings: HomeSettings }) {
  const location = dealershipLocation(settings.address), presentation = settings.presentation;
  const phone = getPhoneHref(settings), whatsapp = getWhatsAppHref(undefined, settings);
  const query = !location.isSample && settings.address?.street?.trim() && (settings.address.city?.trim() || settings.address.postcode?.trim()) ? location.lines.join(', ') : '';
  const [loadedFor, setLoadedFor] = useState('');
  const hours = customerOpeningHours(settings.hours), instructions = published(presentation?.visitInstructions), parking = published(presentation?.parkingInstructions), team = published(presentation?.teamIntroduction);
  return <section id="find-us" className="gr-home-visit gr-home-section gr-container" aria-labelledby="gr-home-visit-heading">
    <h2 id="gr-home-visit-heading" tabIndex={-1}>{customerDefaultCopy(presentation?.websiteCopy?.visitHeading, 'Come and take a look.', ['Plan your visit'])}</h2>
    {!location.isSample && location.lines.length ? <address>{location.lines.join(', ')}</address> : <p>Contact us to confirm our showroom address before travelling.</p>}
    {isMultiChoiceWebsite() && <p className="gr-home-muted">{appointmentVisitNote}</p>}
    <div className="gr-home-visit-actions">{location.directions && <a className="gr-button gr-button--secondary" href={location.directions} target="_blank" rel="noopener noreferrer">Get directions</a>}{phone ? <a className="gr-button" href={phone} onClick={() => recordContactIntent({ channel: 'call', source: 'homepage' })}>{formatPhoneDisplay(settings.contact.phone!)}</a> : <Link className="gr-button" href="/contact">Contact the team</Link>}</div>
    <details className="gr-home-visit-details"><summary>Opening hours and visit details<HomeIcon name="chevron-down" /></summary><div className="gr-home-visit-detail-content">
      <section aria-labelledby="gr-home-hours-heading"><h3 id="gr-home-hours-heading">Opening hours</h3>{hours.length ? <dl className="gr-home-hours">{hours.map((row, index) => <div key={index}><dt>{row.days}</dt><dd>{row.times}</dd></div>)}</dl> : <p>Contact us to confirm opening hours.</p>}</section>
      {instructions && <div><h3>{websiteText(settings, 'contactBeforeHeading')}</h3><p>{instructions}</p></div>}
      {parking && parking !== instructions && <div><h3>{websiteText(settings, 'contactParkingHeading')}</h3><p>{parking}</p></div>}
      {presentation?.teamImageUrl && team && <div className="gr-home-team"><ShowroomPhoto src={presentation.teamImageUrl} alt={presentation.teamImageAlt || 'Our team'} /><div><h3>{websiteText(settings, 'teamHeading')}</h3><p>{team}</p></div></div>}
      {query && <div><button className="gr-home-link" type="button" aria-expanded={loadedFor === query} onClick={() => setLoadedFor(loadedFor === query ? '' : query)}>{loadedFor === query ? 'Hide map' : 'Show map'}</button>{loadedFor === query && <iframe className="gr-home-map" title="Dealership location" src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />}</div>}
    </div></details>
    {(settings.contact.email || whatsapp) && <div className="gr-home-contact-links">{settings.contact.email && <a href={`mailto:${settings.contact.email}`}><Mail size={24} aria-hidden="true" />{settings.contact.email}</a>}{whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => recordContactIntent({ channel: 'whatsapp', source: 'homepage' })}>Message us on WhatsApp<HomeIcon name="arrow-right" /></a>}</div>}
  </section>;
}

/** Figma's graphite composition; shared stock, settings and handoff helpers remain authoritative. */
export function GraphiteHomepage({ settings, cars: suppliedCars, isLoading, error, publicEnquiriesEnabled, filters, setFilters, onSearch }: GraphiteHomepageProps) {
  const cars = suppliedCars.filter(car => !['sold', 'archived', 'hidden', 'withdrawn', 'unavailable'].includes(String(car.inventoryStatus).trim().toLowerCase()));
  const featured = homepageFeaturedCars(cars, settings.featuredVehicleIds).slice(0, 3);
  const sections = multiChoiceHomeSections(settings), multiChoice = isMultiChoiceWebsite(), location = dealershipLocation(settings.address);
  const city = !location.isSample && settings.address?.city?.trim();
  const title = customerDefaultCopy(settings.hero.copy, city ? `Used cars in ${city}` : 'Used cars for sale', ['Find Your Next Car', 'Find your next car.', 'Find your next car', 'Used cars for sale']);
  const makes = [...new Set(cars.map(car => car.make).filter((make): make is string => Boolean(make)))].sort((a, b) => a.localeCompare(b));
  const [allMakes, setAllMakes] = useState(false);
  const bodyTypes = stockBodyTypes(cars), warranty = warrantySummary(settings, multiChoice), canBook = settings.testDriveBooking?.enabled === true;
  const providedReasons = (settings.whyBuy ?? []).filter(reason => reason.title.trim() && reason.description.trim() && (sections.warranty || !/warranty/i.test(reason.title))).slice(0, 6);
  const reasons = providedReasons.length ? providedReasons.map(reason => ({ title: reason.title, description: /warranty/i.test(reason.title) ? warranty : reason.description, warranty: /warranty/i.test(reason.title) })) : [
    ...(sections.warranty ? [{ title: 'Warranty information', description: warranty, warranty: true }] : []),
    ...(multiChoice ? [{ title: 'View by appointment', description: 'Choose a time and take a closer look.', warranty: false }] : canBook ? [{ title: 'Arrange a test drive', description: 'Request a time to see and drive the car.', warranty: false }] : []),
  ];
  const trust = !providedReasons.length ? (settings.trustItems ?? []).filter(item => item.trim()) : [];
  useEffect(() => {
    const reveal = () => { if (window.location.hash !== '#delivery') return; const target = document.getElementById('delivery'); if (target instanceof HTMLDetailsElement) target.open = true; };
    reveal(); window.addEventListener('hashchange', reveal); return () => window.removeEventListener('hashchange', reveal);
  }, []);
  const enquiryHref = publicEnquiriesEnabled ? getEnquiryHref('general', undefined, 'Could you confirm delivery availability and cost for my postcode?') : '/contact';
  return <div className="gr-home" data-testid="graphite-homepage" data-dealership-homepage>
    <section className="gr-home-intro" aria-labelledby="gr-home-heading"><div className="gr-container gr-home-intro-inner">
      <h1 id="gr-home-heading" tabIndex={-1}>{title}</h1>
      <p className="gr-home-welcome">{settings.presentation?.showHeroDescription && settings.hero.subcopy ? settings.hero.subcopy : 'Browse our stock, then arrange a time to see the car you like.'}</p>
      {settings.hero.announcement?.trim() && <p className="gr-home-announcement">{settings.hero.announcement.trim()}</p>}
      <GraphiteHomeSearch cars={cars} isLoading={isLoading} error={error} filters={filters} setFilters={setFilters} onSearch={onSearch} />
    </div></section>

    {settings.presentation?.featuredEnabled !== false && <section className="gr-home-stock gr-home-section gr-container" aria-labelledby="gr-home-stock-heading">
      <div className="gr-home-section-heading"><h2 id="gr-home-stock-heading">{customerDefaultCopy(settings.presentation?.websiteCopy?.featuredHeading, 'On the forecourt', ['Explore our cars'])}</h2><Link className="gr-home-link" href="/stock">View all cars<HomeIcon name="arrow-right" /></Link></div>
      {isLoading ? <p role="status">Loading cars…</p> : error ? <div role="status"><p>We couldn’t load the cars. Open the stock page to try again.</p><Link className="gr-home-link" href="/stock">Browse stock<HomeIcon name="arrow-right" /></Link></div> : featured.length ? <div className="gr-home-stock-grid">{featured.map((car, index) => <GraphiteCarCard key={car.id} car={car} source="showroom" priority={index === 0} photoControls={false} />)}</div> : <div className="gr-home-empty"><h3>Ask us what’s coming in</h3><p>Contact the team for our latest arrivals.</p><Link className="gr-home-link" href="/contact">Contact us<HomeIcon name="arrow-right" /></Link></div>}
    </section>}

    {!error && makes.length > 0 && <section className="gr-home-makes" aria-labelledby="gr-home-makes-heading"><div className="gr-container gr-home-section"><h2 id="gr-home-makes-heading">Find by make</h2><ul>{(allMakes ? makes : makes.slice(0, 12)).map(make => <li key={make}><Link href={`/stock?make=${encodeURIComponent(make)}`} aria-label={`Used ${make}`}>{make}</Link></li>)}</ul>{makes.length > 12 && <button className="gr-home-link" type="button" aria-expanded={allMakes} onClick={() => setAllMakes(value => !value)}>{allMakes ? 'Show fewer makes' : 'Show all makes'}<HomeIcon name="chevron-down" /></button>}</div></section>}

    {sections.partExchange && <section id="part-exchange" className="gr-home-px gr-home-section gr-container" aria-labelledby="gr-home-px-heading"><div><h2 id="gr-home-px-heading"><span className="gr-home-px-desktop">Your current car.<br />Your next car.</span><span className="gr-home-px-phone">Have a car to part exchange?</span></h2><p className="gr-home-muted">{customerDefaultCopy(settings.partExchange?.description, 'Tell us about your part exchange. Start with the registration and current mileage.', ['Give us your registration and mileage and we’ll help you understand what your current car could be worth.'])}</p></div>{publicEnquiriesEnabled ? <GraphitePartExchangeStart /> : <Link href="/contact" className="gr-button">Ask about part exchange</Link>}</section>}

    {(reasons.length > 0 || trust.length > 0) && <section id="about" className="gr-home-about" aria-labelledby="gr-home-about-heading"><div className="gr-home-section gr-container"><h2 id="gr-home-about-heading">Buying from {settings.identity.name}</h2><ul className="gr-home-reasons">{reasons.map(reason => <li key={reason.title}>{reason.warranty ? <HomeIcon name="shield-check" /> : <HomeIcon name="calendar" />}<div><h3>{reason.title}</h3><p>{reason.description}</p>{reason.warranty && <Link className="gr-home-link" href="/warranty">Warranty information<HomeIcon name="arrow-right" /></Link>}</div></li>)}</ul>{trust.length > 0 && <ul className="gr-home-trust" aria-label="Dealership details">{trust.map(item => <li key={item}>{item}</li>)}</ul>}</div></section>}

    {sections.reviews && <div className="gr-home-reviews gr-home-section gr-container"><MultiHomeReviews reviews={multiChoiceReviews(settings)} reviewsUrl={multiChoiceReviewsUrl(settings)} heading={settings.presentation?.websiteCopy?.reviewsHeading?.trim() || 'What our customers say'} /></div>}
    {sections.visit && <GraphiteHomeVisit settings={settings} />}

    <section className="gr-home-more gr-home-section gr-container" aria-labelledby="gr-home-more-heading"><h2 id="gr-home-more-heading">Buying and visiting</h2>
      {!error && bodyTypes.length > 0 && <details><summary>Browse by body type<HomeIcon name="chevron-down" /></summary><div className="gr-home-body-types">{bodyTypes.map(type => <Link key={type.label} href={`/stock?bodyType=${encodeURIComponent(type.label)}`}><MultiBodyShape type={type.label} /><span>{type.label}</span></Link>)}</div></details>}
      {sections.partExchange && <details><summary>Can I part-exchange my current car?<HomeIcon name="chevron-down" /></summary><div><p>Tell us about your car and its current mileage. You can choose your next car later.</p><Link className="gr-home-link" href={publicEnquiriesEnabled ? '/enquire?type=part_exchange' : '/contact'}>Ask about part exchange<HomeIcon name="arrow-right" /></Link></div></details>}
      {canBook && <details><summary>Can I arrange a test drive?<HomeIcon name="chevron-down" /></summary><div><p>Request a time and wait for us to confirm it before travelling.</p><Link className="gr-home-link" href={publicEnquiriesEnabled ? '/enquire?type=viewing' : '/contact'}>Arrange a visit<HomeIcon name="arrow-right" /></Link></div></details>}
      {sections.delivery && <details id="delivery"><summary>Can you deliver my car?<HomeIcon name="chevron-down" /></summary><div><p>{customerDefaultCopy(settings.delivery?.description, settings.deliveryPricing?.enabled ? 'Enter your postcode for a delivery estimate.' : 'Ask us for a delivery quote for your postcode.', ['Customers may be able to have their vehicle delivered.'])}</p>{settings.deliveryPricing?.enabled && <DeliveryEstimator expanded customerEnquiries={publicEnquiriesEnabled} />}<Link className="gr-home-link" href={enquiryHref}>Ask about delivery<HomeIcon name="arrow-right" /></Link></div></details>}
      {sections.warranty && <details><summary>What warranty is available?<HomeIcon name="chevron-down" /></summary><div><p>{warranty}</p><Link className="gr-home-link" href="/warranty">Warranty information<HomeIcon name="arrow-right" /></Link></div></details>}
      <AiCarFinder cars={cars} collapsible />
      {!sections.visit && <Link className="gr-home-link" href="/contact">Contact the team<HomeIcon name="arrow-right" /></Link>}
    </section>
  </div>;
}
