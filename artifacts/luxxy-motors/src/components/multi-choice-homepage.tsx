import { useEffect, useId, useRef, useState, type Dispatch, type FormEvent, type SetStateAction, type PointerEvent, type TouchEvent, type MouseEvent } from 'react';
import { Link, useLocation } from 'wouter';
import type { DealerSettings } from '@workspace/api-client-react';
import type { DealerConfig } from '@/config/dealer';
import type { Car as StockCar } from '@/lib/stock-context';
import type { FilterState } from './filters';
import { MultiBodyShape } from './multi-body-shape';
import { MakeLogo } from './make-logo';
import { AiCarFinder } from './ai-car-finder';
import { DeliveryEstimator } from './delivery-estimator';
import { ShowroomPhoto } from './showroom-photo';
import { UKNumberPlate } from './uk-number-plate';
import { VehicleSellingPoints } from './vehicle-selling-points';
import { ArrowRight, ArrowUpRight, Calendar, Car, ChevronDown, ChevronLeft, ChevronRight, Handshake, MapPin, Mail, Phone, Search, ShieldCheck, Smile, Tag, CircleCheck, Truck } from 'lucide-react';
import { SiWhatsapp } from './icons';
import { MultiHomeReviews } from './multi-home-reviews';
import { MultiHomeVisit } from './multi-home-visit';
import { getPhoneHref, getWhatsAppHref, recordContactIntent } from '@/lib/cta-helpers';
import { dealershipLocation } from '@/lib/dealership-location';
import { stockBodyTypes } from '@/lib/body-types';
import { stockBudgetOptions } from '@/lib/stock-budget-options';
import { homepageFeaturedCars } from '@/lib/homepage-featured-cars';
import { formatMileage, formatPhoneDisplay, formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { editableShowroomWeek, settingsWeekdays } from '@/lib/settings-simplification';
import { responsiveVehicleImage, retryOriginalImage } from '@/lib/responsive-vehicle-image';
import { trackEvent } from '@/lib/analytics';
import { deliveryPriceQualification } from '@/lib/delivery-estimate';
import { clearHomepagePartExchangeLookup, homepagePartExchangeIntentVersion, prepareHomepagePartExchange, retainHomepagePartExchangeLookup } from '@/lib/homepage-part-exchange';
import { lookupPartExchangeCar } from '@/lib/part-exchange-lookup';
import { normaliseExchangeRegistration } from '@/lib/part-exchange-autofill';
import { multiChoiceHomeSections, multiChoiceReviews, multiChoiceReviewsUrl } from '@/lib/multi-choice-home-sections';
import { customerDefaultCopy, websiteText } from '@/lib/website-content';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import './multi-choice-homepage.css';

type HomeSettings = DealerConfig & Partial<Pick<DealerSettings, 'testDriveBooking'>>;
type Props = { settings: HomeSettings; cars: StockCar[]; isLoading: boolean; error: string | null; publicEnquiriesEnabled: boolean; filters: FilterState; setFilters: Dispatch<SetStateAction<FilterState>>; onSearch: (filters: FilterState) => void };

function PartExchangeStart({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [registration, setRegistration] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [lookupFailed, setLookupFailed] = useState(false);
  const currentPlate = useRef(''), request = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cancel() { request.current?.abort(); request.current = null; clearTimeout(timer.current); }
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
      const showError = active();
      cancel(); setBusy(false);
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
  return <form className="mh-px-form" aria-label={id === 'hero' ? 'Start part exchange' : 'Part-exchange valuation'} aria-busy={busy} onSubmit={submit}>
    <label><span>Your registration</span><UKNumberPlate value={registration} editable showFlag onChange={value => { cancel(); currentPlate.current = normaliseExchangeRegistration(value); clearHomepagePartExchangeLookup(); setRegistration(value); setError(''); setBusy(false); setLookupFailed(false); }} testId={`homepage-px-plate-${id}`} inputTestId={`homepage-px-registration-${id}`} /></label>
    <button className="mh-button" type="submit" disabled={busy}>{busy ? 'Finding your car…' : 'Find my car'}<ArrowRight size={17} /></button>
    {(busy || error) && <div className="mh-px-feedback" aria-live="polite" aria-atomic="true">{busy && <p role="status">Checking your car…</p>}{error && <p role="alert">{error}</p>}{lookupFailed && <button className="mh-text-link" type="button" onClick={() => { cancel(); clearHomepagePartExchangeLookup(); if (prepareHomepagePartExchange(registration)) navigate('/enquire?type=part_exchange&manual=true'); }}>Enter details manually<ArrowRight size={16} /></button>}</div>}
  </form>;
}

function StockSearch({ cars, isLoading, error, filters, setFilters, onSearch }: Pick<Props, 'cars' | 'isLoading' | 'error' | 'filters' | 'setFilters' | 'onSearch'>) {
  const choices = (field: 'make' | 'model') => [...new Set(cars.filter(car => field !== 'model' || car.make === filters.make).map(car => car[field]).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
  const makes = choices('make'), models = choices('model');
  const orphanModel = Boolean(filters.model && !filters.make), modelHelpId = useId();
  const savedLabel = isLoading || error ? 'saved choice' : 'not in current stock';
  const matches = cars.filter(car => (!filters.make || car.make === filters.make) && (!filters.model || car.model === filters.model) && (!filters.maxPrice || (car.price != null && car.price > 0 && car.price <= Number(filters.maxPrice)))).length;
  const update = (field: 'make' | 'model' | 'maxPrice', value: string) => setFilters(current => ({ ...current, [field]: value, ...(field === 'make' ? { model: '' } : {}) }));
  return <form className="mh-buy-form" aria-label="Search used cars" onSubmit={event => { event.preventDefault(); if (orphanModel) return; onSearch({ ...filters, make: filters.make, model: filters.model, maxPrice: filters.maxPrice, minPrice: '', fuel: '', transmission: '', bodyType: '', search: '', ulez: false, sort: '' }); }}>
    <div className="mh-search-fields"><label><span className="sr-only">Make</span><select value={filters.make} onChange={event => update('make', event.target.value)} disabled={isLoading}><option value="">Any make</option>{filters.make && !makes.includes(filters.make) && <option value={filters.make}>{filters.make} ({savedLabel})</option>}{makes.map(value => <option key={value}>{value}</option>)}</select></label>
    <label><span className="sr-only">Model</span><select value={filters.model} onChange={event => update('model', event.target.value)} disabled={isLoading || (!filters.make && !filters.model)} aria-describedby={orphanModel || !filters.make ? modelHelpId : undefined}><option value="">Any model</option>{filters.model && !models.includes(filters.model) && <option value={filters.model}>{filters.model} ({orphanModel ? 'choose a make' : savedLabel})</option>}{models.map(value => <option key={value}>{value}</option>)}</select></label>
    <label className="mh-search-budget"><span className="sr-only">Maximum price</span><select value={filters.maxPrice} onChange={event => update('maxPrice', event.target.value)} disabled={isLoading}><option value="">Any price</option>{stockBudgetOptions(cars, filters.maxPrice).map(price => <option key={price} value={price}>{formatPrice(price)}</option>)}</select></label></div>
    <button className="mh-button" type="submit" disabled={isLoading || orphanModel}><Search size={18} />{isLoading ? 'Loading cars…' : error ? 'Browse stock' : `Search ${matches} ${matches === 1 ? 'car' : 'cars'}`}</button>
    {!filters.make && !orphanModel && <span id={modelHelpId} className="sr-only">Choose a make to select a model.</span>}
    {orphanModel && <p className="mh-small" id={modelHelpId} role="status">Choose a make or clear the saved model before searching.</p>}
    {error && <p className="mh-small" role="status">Stock couldn’t load. Open our stock page to try again.</p>}
    <Link href="/stock" className="mh-search-more">More search options</Link>
  </form>;
}

function FeaturedCard({ car }: { car: StockCar }) {
  const photo = getThumbnailUrl(car), [failedSrc, setFailedSrc] = useState('');
  const href = `/vehicle/${encodeURIComponent(car.id)}`;
  const opened = () => trackEvent('vehicle_opened', { source: 'showroom', layout: 'card' });
  const price = typeof car.price === 'number' && Number.isFinite(car.price) && car.price > 0 ? formatPrice(car.price, car.currency) : 'Price on request';
  const priceQualification = price === 'Price on request' ? null : deliveryPriceQualification(car.priceType);
  const priceNote = priceQualification ? priceQualification.includes('excludes VAT') ? 'Excludes VAT' : 'Confirm the full price with us' : car.priceType && /vat/i.test(car.priceType) ? car.priceType : null;
  return <article className="mh-car-card" aria-label={vehicleDisplayTitle(car)}>
    <Link className="mh-car-photo" href={href} onClick={opened} aria-label={`View ${vehicleDisplayTitle(car)}`}>{photo && failedSrc !== photo ? <img src={photo} {...responsiveVehicleImage(photo, '(min-width: 1280px) 300px, (min-width: 640px) 45vw, 85vw')} width={640} height={480} loading="lazy" decoding="async" referrerPolicy="no-referrer" alt={vehicleDisplayTitle(car)} onError={event => { if (!retryOriginalImage(event.currentTarget)) setFailedSrc(photo); }} /> : <span><Car size={40} />Photograph unavailable</span>}</Link>
    <div className="mh-car-copy"><h3><Link href={href} onClick={opened}>{vehicleDisplayTitle(car)}</Link></h3>{(car.variant || car.trim) && <p className="mh-car-variant">{car.variant || car.trim}</p>}
      <ul className="mh-car-specs" aria-label="Vehicle details">{[car.year, car.mileage != null ? formatMileage(car.mileage) : null, car.transmission, car.fuel].filter(Boolean).map((fact, index) => <li key={index}>{fact}</li>)}</ul>
      <VehicleSellingPoints car={car} compact omitMileage />
      <div className="mh-car-price"><strong>{price}</strong>{priceNote && <span>{priceNote}</span>}{car.inventoryStatus === 'reserved' && <span>Reserved</span>}</div>
    </div>
    <Link className="mh-car-link" href={href} onClick={opened}>View car<ArrowRight size={17} /></Link>
  </article>;
}

/** A swipe scrolls the rail; only a deliberate tap opens a vehicle. */
function useRailLinkGuard() {
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const touch = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressUntil = useRef(0);
  const move = (gesture: typeof pointer.current, x: number, y: number) => { if (gesture && Math.hypot(x - gesture.x, y - gesture.y) >= 10) gesture.moved = true; };
  const finish = (gesture: typeof pointer.current) => { if (gesture?.moved) suppressUntil.current = Date.now() + 800; };
  const finishPointer = (event: PointerEvent<HTMLDivElement>) => { if (pointer.current?.id !== event.pointerId) return; move(pointer.current, event.clientX, event.clientY); finish(pointer.current); pointer.current = null; };
  const finishTouch = (event: TouchEvent<HTMLDivElement>) => {
    const end = Array.from(event.changedTouches).find(item => item.identifier === touch.current?.id);
    if (end) move(touch.current, end.clientX, end.clientY);
    if (event.touches.length) return;
    finish(touch.current); touch.current = null;
  };
  return {
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => { suppressUntil.current = 0; if (event.pointerType === 'touch' && touch.current) return; pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; },
    onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => { if (pointer.current?.id === event.pointerId) move(pointer.current, event.clientX, event.clientY); },
    onPointerUpCapture: finishPointer,
    onPointerCancelCapture: (event: PointerEvent<HTMLDivElement>) => { if (pointer.current?.id === event.pointerId) pointer.current.moved = true; finishPointer(event); },
    onTouchStartCapture: (event: TouchEvent<HTMLDivElement>) => { suppressUntil.current = 0; pointer.current = null; if (touch.current && event.touches.length > 1) { touch.current.moved = true; return; } const first = event.touches[0]; if (first) touch.current = { id: first.identifier, x: first.clientX, y: first.clientY, moved: event.touches.length > 1 }; },
    onTouchMoveCapture: (event: TouchEvent<HTMLDivElement>) => { if (touch.current && event.touches.length !== 1) touch.current.moved = true; const current = Array.from(event.touches).find(item => item.identifier === touch.current?.id); if (current) move(touch.current, current.clientX, current.clientY); },
    onTouchEndCapture: finishTouch,
    onTouchCancelCapture: (event: TouchEvent<HTMLDivElement>) => { if (touch.current) touch.current.moved = true; finishTouch(event); },
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => { if (event.detail !== 0 && Date.now() < suppressUntil.current) { event.preventDefault(); event.stopPropagation(); } },
  };
}

function FeaturedStock({ cars, isLoading, error, enabled, heading }: { cars: StockCar[]; isLoading: boolean; error: string | null; enabled: boolean; heading: string }) {
  const rail = useRef<HTMLDivElement>(null), gesture = useRailLinkGuard();
  if (!enabled) return null;
  const scroll = (direction: number) => {
    const element = rail.current;
    if (element) element.scrollBy({ left: direction * (element.querySelector('article')?.getBoundingClientRect().width || element.clientWidth), behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return <section className="mh-section mh-featured" aria-labelledby="mh-featured-heading"><div className="mh-section-title"><div><h2 id="mh-featured-heading">{heading}</h2><p>A closer look at our current stock.</p></div><Link href="/stock" className="mh-text-link">View all cars<ArrowRight size={18} /></Link></div>
    {isLoading ? <p role="status" className="mh-empty">Loading featured cars…</p> : error ? <div role="status" className="mh-empty"><h3>Stock is temporarily unavailable</h3><p>Please try the stock page again, or contact us about a car.</p><Link href="/stock" className="mh-text-link">Browse stock</Link></div> : cars.length ? <><div className="mh-stock-rail" role="group" ref={rail} {...gesture} tabIndex={0} aria-label="Featured cars; scroll for more">{cars.map(car => <FeaturedCard key={car.id} car={car} />)}</div>{cars.length > 1 && <div className="mh-carousel-controls"><button type="button" onClick={() => scroll(-1)} aria-label="Previous featured cars"><ChevronLeft size={20} /></button><span>Scroll to see more cars</span><button type="button" onClick={() => scroll(1)} aria-label="Next featured cars"><ChevronRight size={20} /></button></div>}</> : <div className="mh-empty"><h3>No featured cars to show right now</h3><p>Ask us what’s coming into stock.</p><Link href="/contact" className="mh-text-link">Contact the showroom</Link></div>}
  </section>;
}

function OpeningTimes({ settings }: { settings: HomeSettings }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const update = () => setNow(new Date()); const timer = window.setInterval(update, 60_000); window.addEventListener('focus', update); return () => { window.clearInterval(timer); window.removeEventListener('focus', update); }; }, []);
  const week = editableShowroomWeek(settings.hours ?? []);
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long' }).format(now);
  return <section className="mh-section mh-hours" aria-labelledby="mh-hours-heading"><h2 id="mh-hours-heading">Opening times</h2><p>Please confirm your visit before travelling on bank holidays.</p>{week ? <dl className="mh-hours-grid">{[1, 2, 3, 4, 5, 6, 0].map(day => { const entry = week[day], name = settingsWeekdays[day]; return <div key={day} data-today={today === name || undefined}><dt>{name}{today === name && <span className="sr-only"> (today)</span>}</dt><dd>{entry.state === 'closed' ? 'Closed' : entry.state === 'open' ? `${entry.open} – ${entry.close}` : 'Please confirm'}</dd></div>; })}</dl> : settings.hours?.length ? <dl className="mh-hours-grid">{settings.hours.map(row => <div key={row.days}><dt>{row.days}</dt><dd>{row.times}</dd></div>)}</dl> : <p>Please contact us to confirm our opening hours.</p>}</section>;
}

/** Shared public homepage; every dealership supplies its own published content. */
export function DealershipHomepage({ settings, cars: suppliedCars, isLoading, error, publicEnquiriesEnabled, filters, setFilters, onSearch }: Props) {
  const multiChoice = isMultiChoiceWebsite();
  const cars = suppliedCars.filter(car => !['sold', 'archived', 'hidden', 'withdrawn'].includes(String(car.inventoryStatus).toLowerCase()));
  const sections = multiChoiceHomeSections(settings);
  const [tab, setTab] = useState<'buy' | 'px'>('buy');
  const reasonRail = useRef<HTMLDivElement>(null), [reasonIndex, setReasonIndex] = useState(0);
  const tabId = useId(), tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const deliveryFaq = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const revealDelivery = () => { if (window.location.hash === '#delivery' && deliveryFaq.current) deliveryFaq.current.open = true; };
    revealDelivery();
    window.addEventListener('hashchange', revealDelivery);
    return () => window.removeEventListener('hashchange', revealDelivery);
  }, [sections.delivery]);
  useEffect(() => { if (!sections.partExchange) setTab('buy'); }, [sections.partExchange]);
  const featured = homepageFeaturedCars(cars, settings.featuredVehicleIds);
  const configuredPhoto = settings.presentation?.heroImageUrl;
  // Replace only the existing Multi-Choice forecourt artwork; later staff-selected photos stay authoritative.
  const cutout = multiChoice && Boolean(configuredPhoto?.includes('/api/website-assets/12f86896-51f9-4e38-be24-b8ab5d243c9c'));
  const photo = cutout ? '/brand/multi-choice-motors/hero-cars-1200.webp' : configuredPhoto || getThumbnailUrl(featured.find(car => getThumbnailUrl(car)) || cars.find(car => getThumbnailUrl(car)));
  const headline = customerDefaultCopy(settings.hero.copy, 'Find your next car.', ['Find Your Next Car']);
  const lastWord = headline.lastIndexOf(' ');
  const types = stockBodyTypes(cars), makes = [...new Set(cars.map(car => car.make).filter((make): make is string => Boolean(make)))].sort((a, b) => a.localeCompare(b));
  const reviews = multiChoiceReviews(settings), reviewsUrl = multiChoiceReviewsUrl(settings);
  const phone = getPhoneHref(settings), whatsapp = getWhatsAppHref(undefined, settings);
  const location = dealershipLocation(settings.address);
  const canBook = settings.testDriveBooking?.enabled === true;
  const enquiry = publicEnquiriesEnabled ? '/enquire?type=general' : '/contact';
  // Dealer-approved homepage wording; published Settings content still takes precedence.
  const defaultReasons = multiChoice ? [
    { title: 'Service You Can Trust', text: 'Experience a seamless car-buying journey backed by our expert customer care team.', Icon: Smile },
    { title: '6 month warranty', text: 'Our cars come with a 6-month warranty as standard, with options to extend up to 36 months for added peace of mind.', Icon: ShieldCheck },
    { title: 'Same day drive away', text: 'Complete your purchase on the same day, no need for multiple visits.', Icon: Truck },
    { title: 'Competitive prices', text: 'Our cars are price-checked daily to ensure great value.', Icon: Tag },
    { title: 'Multipoint inspection', text: 'Quality matters. That’s why we triple-check everything.', Icon: CircleCheck },
    { title: 'Hassle & haggle-free', text: 'No awkward haggling, no high mark-ups, and no pressure to buy.', Icon: Handshake },
  ] : [
    { title: 'Browse our current stock', text: 'Explore the cars available and compare the ones that interest you.', Icon: Car },
    { title: 'The details in one place', text: 'Check each car’s price, mileage and specification before you decide.', Icon: CircleCheck },
    { title: 'Ask us about a car', text: 'Contact our team with questions about the car you have in mind.', Icon: Smile },
    { title: 'Plan your visit', text: 'Confirm the showroom address and opening times before travelling.', Icon: MapPin },
    { title: 'Talk through the next steps', text: 'Ask us about payment, paperwork and collection arrangements.', Icon: Handshake },
    { title: 'Keep your favourites', text: 'Save cars while you browse so you can find them again.', Icon: Tag },
  ];
  const reasonIcon = (text: string) => /warrant|cover|protect/i.test(text) ? ShieldCheck : /deliver|transport/i.test(text) ? Truck : /price|value|budget/i.test(text) ? Tag : /inspect|check|prepar/i.test(text) ? CircleCheck : /exchange|trade|hagg/i.test(text) ? Handshake : /visit|location|hayes/i.test(text) ? MapPin : /test drive|appointment/i.test(text) ? Calendar : Smile;
  const providedReasons = (settings.whyBuy ?? []).filter(reason => reason.title.trim() && reason.description.trim()).slice(0, 6).map(reason => ({ title: reason.title, text: reason.description, Icon: reasonIcon(`${reason.title} ${reason.description}`), href: '/contact' }));
  const trustItems = !providedReasons.length ? (settings.trustItems ?? []).filter(item => item.trim()) : [];
  const reasons = [...providedReasons, ...defaultReasons.filter(reason => !providedReasons.some(provided => provided.title.toLowerCase() === reason.title.toLowerCase()))].slice(0, 6);
  const selectReason = (index: number) => {
    const rail = reasonRail.current, target = rail?.children[index] as HTMLElement | undefined;
    if (rail && target) rail.scrollTo({ left: target.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  // TODO(copy): Dealer review of fallback answers; no unconfirmed warranty or inspection promises.
  const faqs: Array<{ question: string; answer: string; href: string; label: string; id?: 'delivery' }> = [
    { question: 'How do I find the right car?', answer: 'Choose a make and budget above, or browse all our cars to filter by gearbox, fuel and body type.', href: '/stock', label: 'Browse our cars' },
    ...(sections.partExchange ? [{ question: 'Can I part-exchange my current car?', answer: 'Start with your registration, check your car’s details and tell us which of our cars interests you. Our team will confirm the valuation and whether we can accept your car.', href: '/enquire?type=part_exchange', label: 'Start a part-exchange enquiry' }] : []),
    ...(canBook ? [{ question: 'Can I arrange a test drive?', answer: 'Choose an available date and time, then enter your contact details. Follow the booking confirmation instructions before travelling.', href: '/enquire?type=viewing', label: 'Choose a test-drive time' }] : []),
    ...(sections.warranty ? [{ question: 'What warranty is available?', answer: 'Please confirm the cover, duration, cost and exclusions for your chosen car with our team.', href: '/warranty', label: 'Warranty information' }] : []),
    ...(sections.delivery ? [{ id: 'delivery' as const, question: 'Can you deliver my car?', answer: settings.delivery?.description?.trim() || 'Ask our team to confirm delivery availability, cost and arrangements for your postcode.', href: enquiry, label: 'Ask about delivery' }] : []),
    { question: 'Where can I see the car?', answer: location.isSample || !location.lines.length ? 'Contact us to confirm the showroom address and arrange your visit.' : `${settings.identity.name} is at ${location.lines.join(', ')}. Check our opening times and confirm your visit before travelling.`, href: sections.visit ? '#find-us' : '/contact', label: 'Plan your visit' },
  ];
  return <div className="multi-home" data-testid="multi-choice-homepage" data-dealership-homepage>
    <section className="mh-hero" aria-labelledby="home-heading"><div className="mh-container mh-hero-grid"><div className="mh-hero-introduction">{settings.hero.announcement?.trim() && <p className="mh-announcement">{settings.hero.announcement}</p>}<h1 id="home-heading" tabIndex={-1}>{lastWord > 0 ? <>{headline.slice(0, lastWord)} <em>{headline.slice(lastWord + 1)}</em></> : headline}</h1>{settings.presentation?.showHeroDescription && settings.hero.subcopy && <p>{settings.hero.subcopy}</p>}{photo && <ShowroomPhoto src={photo} alt={settings.presentation?.heroImageAlt || `${settings.identity.name} cars`} priority fit={cutout ? 'contain' : 'cover'} position={settings.presentation?.heroImagePosition} className={`mh-hero-photo${cutout ? ' mh-hero-photo--cutout' : ''}`} />}</div>
      <div className="mh-search-card"><a className="mh-hero-badge" href="/stock">Explore<br />our cars</a><div role="tablist" aria-label="Find your next car" className="mh-search-tabs" onKeyDown={event => { if (!sections.partExchange || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : tab === 'buy' ? 1 : 0; setTab(index ? 'px' : 'buy'); tabs.current[index]?.focus(); }}>
        <button type="button" ref={element => { tabs.current[0] = element; }} id={`${tabId}-buy-tab`} role="tab" aria-selected={tab === 'buy'} aria-controls={`${tabId}-buy`} tabIndex={tab === 'buy' ? 0 : -1} onClick={() => setTab('buy')}>Buy a car</button>
        {sections.partExchange && <button type="button" ref={element => { tabs.current[1] = element; }} id={`${tabId}-px-tab`} role="tab" aria-selected={tab === 'px'} aria-controls={`${tabId}-px`} tabIndex={tab === 'px' ? 0 : -1} onClick={() => setTab('px')}>Part exchange</button>}
      </div><div role="tabpanel" id={`${tabId}-buy`} aria-labelledby={`${tabId}-buy-tab`} hidden={tab !== 'buy'}><StockSearch cars={cars} isLoading={isLoading} error={error} filters={filters} setFilters={setFilters} onSearch={onSearch} /></div>{sections.partExchange && <div role="tabpanel" id={`${tabId}-px`} aria-labelledby={`${tabId}-px-tab`} hidden={tab !== 'px'}><PartExchangeStart id="hero" /></div>}</div>
    </div></section>
    <div className="mh-container">
      {!error && makes.length > 0 && <section className="mh-section mh-makes" aria-labelledby="mh-makes-heading"><h2 id="mh-makes-heading">Find by Make</h2><div>{makes.map(make => <Link key={make} href={`/stock?make=${encodeURIComponent(make)}`} aria-label={`Used ${make}`}><MakeLogo make={make} size={24} className="mh-make-logo" /><span>{make}</span></Link>)}</div></section>}
      <section id="about" className="mh-section mh-reasons" aria-labelledby="home-reassurance-heading"><h2 id="home-reassurance-heading" tabIndex={-1}>Just a few reasons why to buy your next car from us</h2><div className="mh-reasons-grid" role="group" ref={reasonRail} tabIndex={0} aria-label="Reasons to choose us; scroll for more" onScroll={event => { const rail = event.currentTarget, first = rail.firstElementChild; if (first) setReasonIndex(Math.min(reasons.length - 1, Math.round(rail.scrollLeft / (first.getBoundingClientRect().width + 14)))); }}>{reasons.map(({ title, text, Icon }) => <article key={title}><Icon size={60} strokeWidth={2} aria-hidden="true" /><h3>{title}</h3><p>{text}</p></article>)}</div><div className="mh-reason-dots" role="group" aria-label="Choose a reason">{reasons.map((reason, index) => <button key={reason.title} type="button" aria-label={`Show reason ${index + 1}: ${reason.title}`} aria-pressed={reasonIndex === index} onClick={() => selectReason(index)}><span /></button>)}</div><Link className="mh-button mh-pill" href="/stock">Explore our cars</Link>{trustItems.length > 0 && <ul className="mh-trust-items">{trustItems.map(item => <li key={item}><CircleCheck size={18} aria-hidden="true" />{item}</li>)}</ul>}</section>
      {sections.reviews && <MultiHomeReviews reviews={reviews} reviewsUrl={reviewsUrl} heading={settings.presentation?.websiteCopy?.reviewsHeading?.trim() || 'What our customers say'} />}
    </div>
    {sections.partExchange && <section id="part-exchange" className="mh-px-strip"><div className="mh-container"><h2 id="part-exchange-heading" tabIndex={-1}>Ready for your next car?</h2><p>Put your current car towards it. Start with your registration.</p><PartExchangeStart id="strip" /></div></section>}
    <div className="mh-container">
      {!error && types.length > 0 && <section className="mh-section mh-body-types" aria-labelledby="mh-body-heading"><h2 id="mh-body-heading">Browse by body type</h2><div className="mh-body-grid">{types.map(type => <Link key={type.label} href={`/stock?bodyType=${encodeURIComponent(type.label)}`} aria-label={`${type.label} ${type.count} ${type.count === 1 ? 'car' : 'cars'}`}><MultiBodyShape type={type.label} /><span>{type.label}</span><small>{type.count} {type.count === 1 ? 'car' : 'cars'}</small></Link>)}</div></section>}
      <FeaturedStock cars={featured} isLoading={isLoading} error={error} enabled={settings.presentation?.featuredEnabled !== false} heading={websiteText(settings, 'featuredHeading')} />
      <details className="mh-ai-search"><summary>Want a hand finding a car? Describe what you need<Search size={18} /></summary><AiCarFinder cars={cars} /></details>
      <section className="mh-section mh-faqs" aria-labelledby="mh-faq-heading"><h2 id="mh-faq-heading">A few things you might want to know</h2>{faqs.map(faq => <details key={faq.question} id={faq.id} ref={faq.id === 'delivery' ? deliveryFaq : undefined}><summary>{faq.question}<ChevronDown size={20} aria-hidden="true" /></summary><div><p>{faq.answer}</p>{faq.id === 'delivery' && settings.deliveryPricing?.enabled && <DeliveryEstimator expanded />}<a href={faq.href} className="mh-text-link">{faq.label}<ArrowRight size={16} /></a></div></details>)}</section>
      {sections.visit && <MultiHomeVisit settings={settings} />}
      <section id="contact" className="mh-section mh-contact" aria-labelledby="mh-contact-heading"><h2 id="mh-contact-heading">Let’s talk about your next car</h2><div className="mh-contact-grid">{phone && <a href={phone} onClick={() => recordContactIntent({ channel: 'call', source: 'homepage' })}><Phone size={32} /><span>Call the showroom</span><strong>{formatPhoneDisplay(settings.contact.phone!)}</strong></a>}{settings.contact.email && <a href={`mailto:${settings.contact.email}`}><Mail size={32} /><span>Email us</span><strong>{settings.contact.email}</strong></a>}{whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => recordContactIntent({ channel: 'whatsapp', source: 'homepage' })}><SiWhatsapp size={32} /><span>Message us on WhatsApp</span><strong>Start a chat</strong></a>}{!phone && !settings.contact.email && !whatsapp && <Link className="mh-button" href="/contact">Contact the dealership</Link>}</div></section>
      {sections.visit && <OpeningTimes settings={settings} />}
    </div>
    {whatsapp && <a className="mh-whatsapp-float" href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label="Chat with us on WhatsApp" onClick={() => recordContactIntent({ channel: 'whatsapp', source: 'homepage' })}><SiWhatsapp size={27} /></a>}
  </div>;
}

/** Compatibility export for existing imports of the approved layout. */
export const MultiChoiceHomepage = DealershipHomepage;
