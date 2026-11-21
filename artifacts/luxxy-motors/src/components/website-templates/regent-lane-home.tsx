import { useId, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { vehicleDetailPath } from '@workspace/vehicle-meta';
import type { Car } from '@/lib/stock-context';
import { ArrowRight, ChevronLeft, ChevronRight } from '@/components/icons';
import { ShowroomPhoto } from '@/components/showroom-photo';
import { getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import './regent-lane-home.css';

type HeroPhoto = {
  src: string;
  alt: string;
  cutout?: boolean;
  position?: 'center' | 'left' | 'right' | 'top' | 'bottom';
};

export function RegentLaneHero({ headline, place, description, photo, cars, search }: {
  headline: string;
  place?: string;
  description?: string;
  photo?: HeroPhoto;
  cars: readonly Car[];
  search: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const imageId = useId();
  const photos: (HeroPhoto & { car?: Car })[] = photo ? [photo] : [];
  for (const car of cars) {
    if (photos.length >= 3) break;
    const src = getThumbnailUrl(car);
    if (src && !photos.some(item => item.src === src)) photos.push({ src, alt: vehicleDisplayTitle(car), car });
  }
  const activeIndex = Math.min(index, Math.max(0, photos.length - 1));
  const active = photos[activeIndex];
  const words = headline.trim().split(/\s+/);
  const accent = words.length > 2 ? words.pop() : '';
  const wordmark = active?.car?.make || 'Motors';

  return <section className="regent-hero" aria-labelledby="home-heading">
    <div className="regent-hero-stage mh-container" data-has-photo={Boolean(active)}>
      {active && <span className="regent-hero-watermark" aria-hidden="true">{wordmark}</span>}
      <div className="regent-hero-copy">
        <h1 id="home-heading" tabIndex={-1}>{words.join(' ')}{accent && <> <em>{accent}</em></>}</h1>
        {place && <p className="regent-hero-place">{place}</p>}
        {description && <p className="regent-hero-description">{description}</p>}
        <Link className="regent-primary-link" href="/stock">Browse cars<ArrowRight size={17} aria-hidden="true" /></Link>
      </div>
      {active && <div className="regent-hero-media">
        <div id={imageId} className="regent-hero-image" data-cutout={Boolean(active.cutout)}>
          <ShowroomPhoto key={active.src} src={active.src} alt={active.alt} priority={activeIndex === 0}
            fit={active.cutout ? 'contain' : 'cover'} position={active.position} />
        </div>
        <div className="regent-hero-caption">
          <div aria-live="polite">
            {active.car && <Link href={vehicleDetailPath(active.car)}>{vehicleDisplayTitle(active.car)}<ArrowRight size={15} aria-hidden="true" /></Link>}
          </div>
          {photos.length > 1 && <div className="regent-hero-arrows" role="group" aria-label="Showroom photographs">
            <button type="button" aria-controls={imageId} aria-label="Previous showroom photograph" disabled={activeIndex === 0} onClick={() => setIndex(activeIndex - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
            <button type="button" aria-controls={imageId} aria-label="Next showroom photograph" disabled={activeIndex >= photos.length - 1} onClick={() => setIndex(activeIndex + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
          </div>}
        </div>
        {photos.length > 1 && <div className="regent-hero-index" role="group" aria-label="Choose a showroom photograph">
          {photos.map((item, i) => <button type="button" key={item.src} aria-controls={imageId}
            aria-label={item.car ? `Show ${vehicleDisplayTitle(item.car)}` : 'Show showroom photograph'} aria-pressed={activeIndex === i}
            onClick={() => setIndex(i)}><span /></button>)}
        </div>}
      </div>}
    </div>
    <div className="regent-search-wrap">{search}</div>
  </section>;
}

export function RegentLaneVisitFeature({ car, canBook }: { car?: Car; canBook: boolean }) {
  const photo = car ? getThumbnailUrl(car) : '';
  if (!car || !photo) return null;
  return <section className="regent-visit-feature mh-container" aria-labelledby="regent-visit-heading">
    <Link className="regent-visit-photo" href={vehicleDetailPath(car)} aria-label={`View ${vehicleDisplayTitle(car)}`}>
      <ShowroomPhoto src={photo} alt={vehicleDisplayTitle(car)} />
    </Link>
    <div className="regent-visit-copy">
      <h2 id="regent-visit-heading">{canBook ? 'See it in person' : 'Visit the showroom'}</h2>
      <p>{canBook ? 'Choose a car and arrange a test drive with the showroom.' : 'Get directions and check when you can visit.'}</p>
      <Link href={canBook ? '/enquire?type=viewing' : '/contact'} className="regent-primary-link">
        {canBook ? 'Book a test drive' : 'Plan your visit'}<ArrowRight size={17} aria-hidden="true" />
      </Link>
    </div>
  </section>;
}
