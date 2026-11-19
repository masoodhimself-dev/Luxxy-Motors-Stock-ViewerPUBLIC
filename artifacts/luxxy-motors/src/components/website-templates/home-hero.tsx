import { useEffect, useRef, useState, type ReactNode } from 'react';
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

type Props = { template: CustomerWebsiteTemplate; settings: DealerConfig; cars: Car[]; search: ReactNode; headline: string; loading: boolean; error: string | null };

/** Presentation only. Search/PX controls and every link use the production flows. */
export function CustomerTemplateHomeHero({ template, settings, cars, search, headline, loading, error }: Props) {
  const [active, setActive] = useState(0), track = useRef<HTMLDivElement>(null);
  const shown = cars.filter(car => getThumbnailUrl(car)).slice(0, 5), first = shown[0], current = shown[Math.min(active, Math.max(0, shown.length - 1))];
  useEffect(() => { setActive(0); if (track.current) track.current.scrollLeft = 0; }, [first?.id]);
  const city = [settings.address?.city, settings.address?.region].filter(Boolean).join(', ');
  const introduction = <div className="ct-home-copy">{settings.hero.announcement?.trim() && <p className="ct-home-announcement">{settings.hero.announcement}</p>}{city && <p className="ct-home-location"><MapPin size={18}/>{city}</p>}<h1 id="home-heading" tabIndex={-1}>{headline}</h1>{settings.presentation?.showHeroDescription && settings.hero.subcopy && <p className="ct-home-description">{settings.hero.subcopy}</p>}<Link href="/stock" className="ct-home-link">Explore our cars<ArrowRight size={20}/></Link></div>;
  const photo = (car: Car, priority = false) => <Link href={vehicleDetailPath(car)} className="ct-home-car-photo" aria-label={`View ${vehicleDisplayTitle(car)}`}><ShowroomPhoto src={getThumbnailUrl(car)} alt={vehicleDisplayTitle(car)} priority={priority} fit="contain"/><span><Camera size={17}/>{car.imageCount || car.images?.length || 1} photos</span></Link>;
  const caption = (car: Car) => <figcaption><div><h2>{vehicleDisplayTitle(car)}</h2>{(car.variant || car.trim) && <p>{car.variant || car.trim}</p>}<span>{formatRegistrationPlate(vehicleRegistration(car))}{car.inventoryStatus === 'reserved' && ' · Reserved'}</span></div><Link href={vehicleDetailPath(car)}>{car.price ? formatPrice(car.price, car.currency) : 'Ask for price'}<ArrowRight size={21}/></Link></figcaption>;
  const unavailable = <div className="ct-home-stock-state" role="status">{loading ? 'Loading our current cars…' : error ? 'Stock is temporarily unavailable. Please contact us or try the stock page.' : 'Ask us about the cars coming into stock.'}<Link href="/stock">Browse stock<ArrowRight size={18}/></Link></div>;
  const searchDock = <div className="ct-home-search"><div><h2>Find your car</h2><p>Choose a make, a model or a budget.</p></div>{search}</div>;

  if (template === 'showroom') return <section className="ct-home ct-home-showroom" aria-labelledby="home-heading"><div className="ct-home-retail">{introduction}{first ? <figure>{photo(first, true)}{caption(first)}</figure> : unavailable}</div>{searchDock}</section>;
  if (template === 'grand-touring') return <section className="ct-home ct-home-collection" aria-labelledby="home-heading"><div className="ct-home-collection-heading">{introduction}<p>{settings.identity.name}{city && <><br/>{city}</>}</p></div>{first ? <div className="ct-home-spread"><figure>{photo(first, true)}{caption(first)}</figure>{shown[1] && <figure>{photo(shown[1])}{caption(shown[1])}</figure>}</div> : unavailable}{searchDock}</section>;
  if (template === 'forecourt') return <section className="ct-home ct-home-forecourt" aria-labelledby="home-heading"><div className="ct-home-desk-heading">{introduction}<Link href="/stock">See all {cars.length} cars<ArrowRight size={20}/></Link></div><div className="ct-home-desk-grid"><div className="ct-home-desk-search"><h2>What are you looking for?</h2><p>Choose a make, a model or a budget.</p>{search}{getPhoneHref(settings) && <a className="ct-home-desk-call" href={getPhoneHref(settings)!}><Phone size={19}/>{formatPhoneDisplay(settings.contact.phone!)}</a>}</div>{first ? <figure>{photo(first, true)}{caption(first)}</figure> : unavailable}</div><nav className="ct-home-shortcuts" aria-label="Shop by preference"><span>Go straight to</span><Link href="/stock?maxPrice=5000">£5,000 or less</Link><Link href="/stock?transmission=Automatic">Automatic cars</Link>{settings.partExchange?.enabled && <Link href="/enquire?type=part_exchange">Part exchange</Link>}</nav></section>;

  const move = (index: number) => { const item = track.current?.children[index] as HTMLElement | undefined; if (!track.current || !item) return; setActive(index); track.current.scrollTo({ left: item.offsetLeft, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
  return <section className="ct-home ct-home-panorama" aria-labelledby="home-heading">{shown.length ? <div className="ct-home-panorama-gallery"><div ref={track} className="ct-home-panorama-track" onScroll={event => { const element = event.currentTarget; let next = 0, closest = Infinity; [...element.children].forEach((child, index) => { const distance = Math.abs((child as HTMLElement).offsetLeft - element.scrollLeft); if (distance < closest) { next = index; closest = distance; } }); setActive(next); }}>{shown.map((car, index) => <div key={car.id}>{photo(car, index === 0)}</div>)}</div><div className="ct-home-panorama-controls"><button type="button" disabled={active === 0} aria-label="Previous featured car" onClick={() => move(active - 1)}><ChevronLeft size={23}/></button><span aria-live="polite">{active + 1} / {shown.length}</span><button type="button" disabled={active >= shown.length - 1} aria-label="Next featured car" onClick={() => move(active + 1)}><ChevronRight size={23}/></button></div></div> : unavailable}<div className="ct-home-panorama-caption">{introduction}{current && <figure>{caption(current)}</figure>}</div>{searchDock}</section>;
}
