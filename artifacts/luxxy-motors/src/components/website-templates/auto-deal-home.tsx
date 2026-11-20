import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { vehicleDetailPath } from '@workspace/vehicle-meta';
import { ArrowLeft, ArrowRight, CarFront, Gauge } from 'lucide-react';
import type { Car } from '@/lib/stock-context';
import { deliveryPriceQualification } from '@/lib/delivery-estimate';
import { responsiveVehicleImage, retryOriginalImage } from '@/lib/responsive-vehicle-image';
import { formatMileage, formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';
import './auto-deal-home.css';

type Props = {
  cars: Car[];
  headline: string;
  announcement?: string;
  description?: string;
  search: ReactNode;
  loading: boolean;
  error: string | null;
};

export function AutoDealHomeHero({ cars, headline, announcement, description, search, loading, error }: Props) {
  const [activeId, setActiveId] = useState<string>();
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const available = loading || error ? [] : cars.filter(car => {
    const photo = getThumbnailUrl(car);
    return String(car.inventoryStatus).toLowerCase() !== 'reserved' && photo && !failedImages.includes(photo);
  }).slice(0, 5);
  const index = Math.max(0, available.findIndex(car => car.id === activeId));
  const car = available[index];
  const title = car ? vehicleDisplayTitle(car) : headline;
  const photo = car ? getThumbnailUrl(car) : '';
  const price = car && car.price != null && car.price > 0 ? formatPrice(car.price, car.currency) : '';
  const basis = car && price ? deliveryPriceQualification(car.priceType) : null;
  const priceNote = basis ? basis.includes('excludes VAT') ? 'Excludes VAT' : 'Confirm the full price with us'
    : car?.priceType && price && /vat/i.test(car.priceType) ? car.priceType : null;
  const openVehicle = () => trackEvent('vehicle_opened', { source: 'showroom', layout: 'hero' });
  const step = (direction: number) => setActiveId(available[(index + direction + available.length) % available.length]?.id);

  return <section className="ad-home-hero" aria-label="Find a used car" data-testid="autodeal-home-hero">
    <div className={`ad-hero-showcase${car ? ' ad-hero-showcase--photo' : ''}`}>
      <div className="ad-hero-copy" aria-live="polite">
        {announcement && <p className="ad-hero-announcement">{announcement}</p>}
        <h1 id="home-heading" tabIndex={-1}>
          {car ? <><span className="ad-hero-desktop-title">{title}</span><span className="ad-hero-phone-title">{headline}</span></> : headline}
        </h1>
        {description && <p className="ad-hero-description">{description}</p>}
        {car && <div className="ad-hero-car-details">
          <ul aria-label="Featured car details">
            <li><CarFront size={18} aria-hidden="true" />Used car</li>
            {car.mileage != null && <li><Gauge size={18} aria-hidden="true" />{formatMileage(car.mileage)}</li>}
            <li><strong>{price || 'Ask for price'}</strong>{priceNote && <small>{priceNote}</small>}</li>
          </ul>
          <Link href={vehicleDetailPath(car)} onClick={openVehicle} className="ad-hero-car-button">View car</Link>
        </div>}
      </div>
      {car && <Link href={vehicleDetailPath(car)} className="ad-hero-photo" onClick={openVehicle} aria-label={`View ${title}`}>
        <img key={photo} src={photo} {...responsiveVehicleImage(photo, '(min-width: 768px) 100vw, calc(100vw - 36px)')}
          width={1200} height={900} alt={title} loading="eager" fetchPriority="high" decoding="async"
          onError={event => { if (!retryOriginalImage(event.currentTarget)) setFailedImages(current => [...current, photo]); }} />
      </Link>}
      {car && <Link href={vehicleDetailPath(car)} className="ad-hero-phone-caption" onClick={openVehicle}>
        <span>{car.year ? `${car.year} ` : ''}{title}</span>
        <span>{price || 'Ask for price'}{priceNote && <small>{priceNote}</small>}</span>
      </Link>}
      {available.length > 1 && <div className="ad-hero-arrows" aria-label="Featured car controls">
        <button type="button" onClick={() => step(-1)} aria-label="Previous featured car"><ArrowLeft size={23} aria-hidden="true" /></button>
        <button type="button" onClick={() => step(1)} aria-label="Next featured car"><ArrowRight size={23} aria-hidden="true" /></button>
      </div>}
      <div className="ad-hero-dock">{search}</div>
    </div>
  </section>;
}
