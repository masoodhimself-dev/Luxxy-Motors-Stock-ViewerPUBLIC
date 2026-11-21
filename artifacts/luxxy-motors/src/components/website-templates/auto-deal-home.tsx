import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'wouter';
import { customFetch } from '@workspace/api-client-react';
import { vehicleDetailPath, type MotHistory } from '@workspace/vehicle-meta';
import { ArrowLeft, ArrowRight, CalendarCheck2, Gauge, Pause, Play, ShieldCheck } from 'lucide-react';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { buyerInformation } from '@/lib/buyer-information';
import { deliveryPriceQualification } from '@/lib/delivery-estimate';
import { warrantySummary } from '@/lib/dealership-customer-copy';
import { responsiveVehicleImage, retryOriginalImage } from '@/lib/responsive-vehicle-image';
import { formatMileage, formatPrice, getThumbnailUrl, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';
import { vehicleContent } from '@/lib/vehicle-content';
import { vehicleEnquiryMot } from '@/lib/vehicle-enquiry-information';
import { vehiclePageInclusions } from '@/lib/vehicle-page-summary';
import './auto-deal-home.css';

const rotationDelay = 8_000;
const landscapeControlRatio = 4 / 3;

type Props = {
  cars: Car[];
  settings: Pick<DealerConfig, 'presentation' | 'warranty'>;
  headline: string;
  announcement?: string;
  description?: string;
  search: ReactNode;
  loading: boolean;
  error: string | null;
};

function includedCoverLabel(item: string): string | undefined {
  if (/^warranty(?: included)?\.?$/i.test(item)) return 'Warranty included';
  const duration = item.match(/^(\d{1,3}|six)[\s-]+(month|year)s?[\s-]+warranty(?: included)?\.?$/i);
  if (!duration) return undefined;
  const amount = duration[1].toLowerCase() === 'six' ? 6 : Number(duration[1]);
  const unit = duration[2].toLowerCase();
  return amount > 0 && amount <= (unit === 'year' ? 10 : 120) ? `${amount}-${unit} warranty included` : undefined;
}

function warrantyLabel(car: Car, settings: Props['settings']): string | undefined {
  if (settings.warranty?.enabled === false) return undefined;
  const supplied = buyerInformation(car).find(fact => fact.label === 'Warranty')?.value;
  const policy = [supplied, vehicleContent(car).description].filter(Boolean).join(' ');
  if (/\b(?:no|without)\s+(?:an?\s+)?warranty\b|\bwarranty\s+(?:(?:is|will be)\s+)?(?:not included|excluded|unavailable|at (?:an? )?extra cost)\b/iu.test(policy)) {
    return undefined;
  }

  const explicitCarCover = [
    ...vehiclePageInclusions(car),
    ...(supplied && /\bincluded\b/i.test(supplied) ? [supplied] : []),
  ].flatMap(item => item.split(' · ')).map(item => includedCoverLabel(item)).find(Boolean);
  const configuredCover = vehiclePageInclusions(car, settings.presentation)
    .map(item => includedCoverLabel(item)).find(Boolean);
  if (explicitCarCover && explicitCarCover !== 'Warranty included') return explicitCarCover;
  if (configuredCover || explicitCarCover) return configuredCover || explicitCarCover;

  // Older Multi Choice storefronts already publish the standard warranty in
  // the shared copy. Only use it while there's no explicit inclusions list.
  if (!settings.warranty?.enabled || (settings.presentation && Object.hasOwn(settings.presentation, 'includedItems'))) return undefined;
  const standard = warrantySummary(settings).match(/^Our cars come with an? ((?:\d{1,3}|six)[ -](?:month|year) warranty) as standard\b/i)?.[1];
  return standard ? includedCoverLabel(standard) : undefined;
}

export function AutoDealHomeHero({ cars, settings, headline, announcement, description, search, loading, error }: Props) {
  const [activeSlide, setActiveSlide] = useState<{ id: string; direction: 'previous' | 'next' }>();
  const [photoShape, setPhotoShape] = useState<{ photo: string; ratio: number }>();
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const [rotationPreference, setRotationPreference] = useState<boolean | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false));
  const [hovering, setHovering] = useState(false);
  const [pauseFocused, setPauseFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const [cachedHistories, setCachedHistories] = useState<Record<string, MotHistory | null>>({});
  const rotationControl = useRef<HTMLButtonElement>(null);

  const available = loading || error ? [] : cars.filter(car => {
    const photo = getThumbnailUrl(car);
    return String(car.inventoryStatus).toLowerCase() !== 'reserved' && photo && !failedImages.includes(photo);
  }).slice(0, 5);
  const index = Math.max(0, available.findIndex(car => car.id === activeSlide?.id));
  const car = available[index];
  const title = car ? vehicleDisplayTitle(car) : headline;
  const photo = car ? getThumbnailUrl(car) : '';
  const photoRatio = photoShape?.photo === photo ? photoShape.ratio : landscapeControlRatio;
  const photoScale = photoRatio < 1 ? 1 : 1.1;
  const photoFrameStyle = {
    '--ad-hero-photo-scale': photoScale,
    '--ad-hero-control-width': `${100 * Math.min(photoRatio, landscapeControlRatio) * photoScale}cqh`,
  } as CSSProperties;
  const price = car && car.price != null && car.price > 0 ? formatPrice(car.price, car.currency) : '';
  const basis = car && price ? deliveryPriceQualification(car.priceType) : null;
  const priceNote = basis ? basis.includes('excludes VAT') ? 'Excludes VAT' : 'Confirm the full price with us'
    : car?.priceType && price && /vat/i.test(car.priceType) ? car.priceType : null;

  const vehicleId = car?.id;
  const registration = car && vehicleRegistration(car);
  const lookupKey = vehicleId && registration ? `${vehicleId}:${registration}` : undefined;
  const cachedHistory = lookupKey ? cachedHistories[lookupKey] : undefined;
  const mot = car ? vehicleEnquiryMot(car, cachedHistory) : null;
  const warranty = car ? warrantyLabel(car, settings) : undefined;

  const rotationEnabled = rotationPreference ?? !reducedMotion;
  const nextId = available.length > 1 ? available[(index + 1) % available.length].id : undefined;
  const rotating = Boolean(nextId && rotationEnabled && !hovering && !pauseFocused && !pageHidden);

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const motionChanged = () => setReducedMotion(preference?.matches ?? false);
    preference?.addEventListener?.('change', motionChanged);
    const visibilityChanged = () => setPageHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      preference?.removeEventListener?.('change', motionChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);

  useEffect(() => {
    if (!rotating || !nextId) return;
    const timer = window.setTimeout(() => setActiveSlide({ id: nextId, direction: 'next' }), rotationDelay);
    return () => window.clearTimeout(timer);
  }, [rotating, vehicleId, nextId]);

  useEffect(() => {
    if (!lookupKey || !vehicleId || cachedHistory !== undefined) return;
    const controller = new AbortController();
    const remember = (history: MotHistory | null) => {
      if (!controller.signal.aborted) setCachedHistories(current => ({ ...current, [lookupKey]: history }));
    };
    // Look up the visible car's saved DVSA record once per visit. A cache miss
    // does not trigger a DVSA request or move the carousel.
    customFetch<{ status: string; history?: MotHistory }>(
      `/api/vehicles/${encodeURIComponent(vehicleId)}/mot-history?cacheOnly=true`,
      { signal: controller.signal },
    ).then(reply => remember(reply?.status === 'available' ? reply.history ?? null : null))
      .catch(() => remember(null));
    return () => controller.abort();
  }, [lookupKey, vehicleId, cachedHistory]);

  const openVehicle = () => trackEvent('vehicle_opened', { source: 'showroom', layout: 'hero' });
  const step = (direction: number) => {
    setRotationPreference(false);
    const next = available[(index + direction + available.length) % available.length];
    if (next) setActiveSlide({ id: next.id, direction: direction < 0 ? 'previous' : 'next' });
  };
  const vehicleCover = <ul className="ad-hero-cover" aria-label="MOT and warranty">
    {mot && <li><CalendarCheck2 size={17} aria-hidden="true" />{mot.label} {mot.value}</li>}
    {warranty && <li><ShieldCheck size={17} aria-hidden="true" />{warranty}</li>}
  </ul>;

  return <section className="ad-home-hero" aria-label="Find a used car" data-testid="autodeal-home-hero"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovering(true); }}
    onPointerLeave={() => setHovering(false)}
    onPointerDownCapture={event => {
      if (event.pointerType === 'touch' && !rotationControl.current?.contains(event.target as Node)) setRotationPreference(false);
    }}
    onFocusCapture={event => {
      if (rotationControl.current?.contains(event.target)) setPauseFocused(true);
      else setRotationPreference(false);
    }}
    onBlurCapture={event => { if (rotationControl.current?.contains(event.target)) setPauseFocused(false); }}
  >
    <div className={`ad-hero-showcase${car ? ' ad-hero-showcase--photo' : ''}`} style={photoFrameStyle}>
      {nextId && <div className="ad-hero-controls" role="group" aria-label="Featured car controls">
        <button type="button" ref={rotationControl} className="ad-hero-rotation"
          aria-label={rotationEnabled ? 'Pause featured cars' : 'Play featured cars'}
          onClick={() => { setRotationPreference(!rotationEnabled); setPauseFocused(false); }}>
          {rotationEnabled ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {rotationEnabled ? 'Pause' : 'Play'}
        </button>
        <div className="ad-hero-arrows">
          <button type="button" onClick={() => step(-1)} aria-label="Previous featured car"><ArrowLeft size={22} aria-hidden="true" /></button>
          <span className="ad-hero-count" aria-hidden="true">{index + 1} / {available.length}</span>
          <button type="button" onClick={() => step(1)} aria-label="Next featured car"><ArrowRight size={22} aria-hidden="true" /></button>
        </div>
      </div>}
      <div className="ad-hero-copy">
        {announcement && <p className="ad-hero-announcement">{announcement}</p>}
        <h1 id="home-heading" tabIndex={-1}>
          {car ? <><span className="ad-hero-desktop-title">{title}</span><span className="ad-hero-phone-title">{headline}</span></> : headline}
        </h1>
        {description && <p className="ad-hero-description">{description}</p>}
        {car && <div className="ad-hero-car-details">
          <ul className="ad-hero-car-pricing" aria-label="Featured car details">
            {car.mileage != null && <li><Gauge size={18} aria-hidden="true" />{formatMileage(car.mileage)}</li>}
            <li><strong>{price || 'Ask for price'}</strong>{priceNote && <small>{priceNote}</small>}</li>
          </ul>
          {vehicleCover}
          <Link href={vehicleDetailPath(car)} onClick={openVehicle} className="ad-hero-car-button">View car</Link>
        </div>}
      </div>
      {car && <Link href={vehicleDetailPath(car)} className="ad-hero-photo" data-direction={activeSlide?.direction} onClick={openVehicle} aria-label={`View ${title}`}>
        <img key={photo} src={photo} {...responsiveVehicleImage(photo, '(min-width: 768px) 100vw, calc(100vw - 36px)')}
          width={1200} height={900} alt={title} loading="eager" fetchPriority="high" decoding="async"
          onLoad={({ currentTarget: image }) => {
            if (image.naturalWidth && image.naturalHeight) setPhotoShape({ photo, ratio: image.naturalWidth / image.naturalHeight });
          }}
          onError={event => { if (!retryOriginalImage(event.currentTarget)) setFailedImages(current => [...current, photo]); }} />
      </Link>}
      {car && <div className="ad-hero-phone-summary">
        <Link href={vehicleDetailPath(car)} className="ad-hero-phone-caption" onClick={openVehicle}>
          <span>{car.year ? `${car.year} ` : ''}{title}</span>
          <span>{price || 'Ask for price'}{priceNote && <small>{priceNote}</small>}</span>
        </Link>
        {vehicleCover}
      </div>}
      {nextId && <span className="sr-only" aria-live={rotating ? 'off' : 'polite'} aria-atomic="true">
        {title}, {index + 1} of {available.length} featured cars
      </span>}
      <div className="ad-hero-dock">{search}</div>
    </div>
  </section>;
}
