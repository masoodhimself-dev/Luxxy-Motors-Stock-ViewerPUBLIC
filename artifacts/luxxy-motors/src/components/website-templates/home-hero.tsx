import { useEffect, useId, useRef, useState, type ReactNode, type PointerEvent, type TouchEvent, type MouseEvent } from 'react';
import { Link } from 'wouter';
import { vehicleDetailPath } from '@workspace/vehicle-meta';
import { ArrowRight, Camera, ChevronLeft, ChevronRight, MapPin, Phone } from '@/components/icons';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import type { CustomerWebsiteTemplate } from '@/lib/website-template';
import { getPhoneHref } from '@/lib/cta-helpers';
import { formatPrice, formatPhoneDisplay, getThumbnailUrl, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { formatRegistrationPlate } from '@/lib/registration-display';
import { ShowroomPhoto } from '@/components/showroom-photo';
import { orderVehiclePhotos } from '@/lib/vehicle-photography';
import { deliveryPriceQualification } from '@/lib/delivery-estimate';

type Props = { template: CustomerWebsiteTemplate; settings: DealerConfig; cars: Car[]; search: ReactNode; headline: string; loading: boolean; error: string | null; publicEnquiriesEnabled?: boolean };

function useRailLinkGuard() {
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null), touch = useRef<{ x: number; y: number; moved: boolean } | null>(null), suppressUntil = useRef(0);
  const move = (gesture: { x: number; y: number; moved: boolean } | null, x: number, y: number) => { if (gesture && Math.hypot(x - gesture.x, y - gesture.y) >= 10) gesture.moved = true; };
  const finish = (gesture: { moved: boolean } | null) => { if (gesture?.moved) suppressUntil.current = Date.now() + 800; };
  return {
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => { suppressUntil.current = 0; if (event.pointerType === 'touch' && touch.current) return; pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; },
    onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => { if (pointer.current?.id === event.pointerId) move(pointer.current, event.clientX, event.clientY); },
    onPointerUpCapture: (event: PointerEvent<HTMLDivElement>) => { if (pointer.current?.id !== event.pointerId) return; move(pointer.current, event.clientX, event.clientY); finish(pointer.current); pointer.current = null; },
    onPointerCancelCapture: () => { if (pointer.current) pointer.current.moved = true; finish(pointer.current); pointer.current = null; },
    onTouchStartCapture: (event: TouchEvent<HTMLDivElement>) => { suppressUntil.current = 0; pointer.current = null; const first = event.touches[0]; if (first) touch.current = { x: first.clientX, y: first.clientY, moved: event.touches.length > 1 }; },
    onTouchMoveCapture: (event: TouchEvent<HTMLDivElement>) => { const first = event.touches[0]; if (touch.current && event.touches.length !== 1) touch.current.moved = true; if (first) move(touch.current, first.clientX, first.clientY); },
    onTouchEndCapture: () => { finish(touch.current); touch.current = null; },
    onTouchCancelCapture: () => { if (touch.current) touch.current.moved = true; finish(touch.current); touch.current = null; },
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => { if (event.detail !== 0 && Date.now() < suppressUntil.current) { event.preventDefault(); event.stopPropagation(); } },
  };
}

/** Presentation only. Search/PX controls and every link use the production flows. */
export function CustomerTemplateHomeHero({ template, settings, cars, search, headline, loading, error, publicEnquiriesEnabled = true }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null), track = useRef<HTMLDivElement>(null), activeRef = useRef<string | null>(null), railId = useId(), gesture = useRailLinkGuard();
  const eligible = cars.filter(car => !['sold', 'archived', 'hidden', 'withdrawn', 'unavailable'].includes(String(car.inventoryStatus).trim().toLowerCase()));
  const shown = loading || error ? [] : eligible.slice(0, 5), active = Math.max(0, shown.findIndex(car => car.id === activeId)), first = shown[0], current = shown[active];
  const dataKey = JSON.stringify(shown.map(car => car.id));
  const select = (index: number) => { const id = shown[index]?.id ?? null; activeRef.current = id; setActiveId(id); };
  const align = (index: number, behavior: ScrollBehavior) => {
    const element = track.current, item = element?.children[index] as HTMLElement | undefined, firstItem = element?.children[0] as HTMLElement | undefined;
    if (!element || !item || !firstItem) return;
    // Keep the rail's leading gutter when aligning a different car.
    const left = item.offsetLeft - firstItem.offsetLeft;
    if (typeof element.scrollTo === 'function') element.scrollTo({ left, behavior });
    else element.scrollLeft = left;
  };
  const move = (index: number) => { if (index < 0 || index >= shown.length) return; select(index); align(index, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'); };
  useEffect(() => {
    const index = Math.max(0, shown.findIndex(car => car.id === activeRef.current));
    select(index); align(index, 'auto');
  }, [dataKey, template]);
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const resize = () => align(Math.max(0, shown.findIndex(car => car.id === activeRef.current)), 'auto');
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(element); window.addEventListener('resize', resize);
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); };
  }, [dataKey, template]);
  const city = [settings.address?.city, settings.address?.region].filter(Boolean).join(', ');
  const introduction = <div className="ct-home-copy">{settings.hero.announcement?.trim() && <p className="ct-home-announcement">{settings.hero.announcement}</p>}{city && <p className="ct-home-location"><MapPin size={18}/>{city}</p>}<h1 id="home-heading" tabIndex={-1}>{headline}</h1>{settings.presentation?.showHeroDescription && settings.hero.subcopy && <p className="ct-home-description">{settings.hero.subcopy}</p>}<Link href="/stock" className="ct-home-link">Explore our cars<ArrowRight size={20}/></Link></div>;
  const photo = (car: Car, priority = false) => {
    const image = getThumbnailUrl(car), count = orderVehiclePhotos(car.images || [], car.heroImage).length;
    return <Link href={vehicleDetailPath(car)} className="ct-home-car-photo" aria-label={`View ${vehicleDisplayTitle(car)}`} draggable={false} onDragStart={event => event.preventDefault()}>{image ? <ShowroomPhoto src={image} alt={vehicleDisplayTitle(car)} priority={priority} fit="contain"/> : <div className="ct-home-photo-placeholder" role="img" aria-label={`Photographs coming soon for ${vehicleDisplayTitle(car)}`}><Camera size={35}/><p>Photographs coming soon</p></div>}{count > 0 && <span><Camera size={17}/>{count} {count === 1 ? 'photo' : 'photos'}</span>}</Link>;
  };
  const caption = (car: Car) => {
    const hasPrice = typeof car.price === 'number' && Number.isFinite(car.price) && car.price > 0;
    const basis = hasPrice ? deliveryPriceQualification(car.priceType) : null;
    const priceNote = basis ? basis.includes('excludes VAT') ? 'Excludes VAT' : 'Confirm the full price with us' : hasPrice && car.priceType && /vat/i.test(car.priceType) ? car.priceType : null;
    return <figcaption><div><h2>{vehicleDisplayTitle(car)}</h2>{(car.variant || car.trim) && <p>{car.variant || car.trim}</p>}<span>{formatRegistrationPlate(vehicleRegistration(car))}{String(car.inventoryStatus).trim().toLowerCase() === 'reserved' && ' · Reserved'}</span>{priceNote && <p className="ct-home-price-note">{priceNote}</p>}</div><Link href={vehicleDetailPath(car)}>{hasPrice ? formatPrice(car.price!, car.currency) : 'Ask for price'}<ArrowRight size={21}/></Link></figcaption>;
  };
  const unavailable = <div className="ct-home-stock-state" role="status">{loading ? 'Loading our current cars…' : error ? 'Stock is temporarily unavailable. Please contact us or try the stock page.' : 'Ask us about the cars coming into stock.'}<Link href="/stock">Browse stock<ArrowRight size={18}/></Link></div>;
  const searchDock = <div className="ct-home-search"><div><h2>Find your car</h2><p>Choose a make, a model or a budget.</p></div>{search}</div>;

  if (template === 'showroom') return <section className="ct-home ct-home-showroom" aria-labelledby="home-heading"><div className="ct-home-retail">{introduction}{first ? <figure>{photo(first, true)}{caption(first)}</figure> : unavailable}</div>{searchDock}</section>;
  if (template === 'grand-touring') return <section className="ct-home ct-home-collection" aria-labelledby="home-heading"><div className="ct-home-collection-heading">{introduction}<p>{settings.identity.name}{city && <><br/>{city}</>}</p></div>{first ? <div className="ct-home-spread"><figure>{photo(first, true)}{caption(first)}</figure>{shown[1] && <figure>{photo(shown[1])}{caption(shown[1])}</figure>}</div> : unavailable}{searchDock}</section>;
  if (template === 'forecourt') return <section className="ct-home ct-home-forecourt" aria-labelledby="home-heading"><div className="ct-home-desk-heading">{introduction}<Link href="/stock">{loading || error ? 'Browse our cars' : `See all ${eligible.length} ${eligible.length === 1 ? 'car' : 'cars'}`}<ArrowRight size={20}/></Link></div><div className="ct-home-desk-grid"><div className="ct-home-desk-search"><h2>What are you looking for?</h2><p>Choose a make, a model or a budget.</p>{search}{getPhoneHref(settings) && <a className="ct-home-desk-call" href={getPhoneHref(settings)!}><Phone size={19}/>{formatPhoneDisplay(settings.contact.phone!)}</a>}</div>{first ? <figure>{photo(first, true)}{caption(first)}</figure> : unavailable}</div><nav className="ct-home-shortcuts" aria-label="Shop by preference"><span>Go straight to</span><Link href="/stock?maxPrice=5000">£5,000 or less</Link><Link href="/stock?transmission=Automatic">Automatic cars</Link>{settings.partExchange?.enabled && <Link href={publicEnquiriesEnabled ? '/enquire?type=part_exchange' : '/contact'}>Part exchange</Link>}</nav></section>;

  return <section className="ct-home ct-home-panorama" aria-labelledby="home-heading">{shown.length ? <div className="ct-home-panorama-gallery"><div id={railId} ref={track} className="ct-home-panorama-track" role="region" aria-label="Featured cars" tabIndex={0} {...gesture} onKeyDown={event => { if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); move(event.key === 'Home' ? 0 : event.key === 'End' ? shown.length - 1 : active + (event.key === 'ArrowLeft' ? -1 : 1)); }} onScroll={event => { const element = event.currentTarget, firstItem = element.children[0] as HTMLElement | undefined; let next = 0, closest = Infinity; [...element.children].forEach((child, index) => { const distance = Math.abs((child as HTMLElement).offsetLeft - (firstItem?.offsetLeft || 0) - element.scrollLeft); if (distance < closest) { next = index; closest = distance; } }); select(next); }}>{shown.map((car, index) => <div key={car.id}>{photo(car, index === 0)}</div>)}</div><div className="ct-home-panorama-controls"><button type="button" disabled={active === 0} aria-label="Previous featured car" aria-controls={railId} onClick={() => move(active - 1)}><ChevronLeft size={23}/></button><span aria-live="polite">{active + 1} / {shown.length}</span><button type="button" disabled={active >= shown.length - 1} aria-label="Next featured car" aria-controls={railId} onClick={() => move(active + 1)}><ChevronRight size={23}/></button></div></div> : unavailable}<div className="ct-home-panorama-caption">{introduction}{current && <figure>{caption(current)}</figure>}</div>{searchDock}</section>;
}
