import { useEffect, useMemo, useState } from 'react';
import { Calendar, Camera, Check, Heart, MessageCircle, Phone, Scale } from 'lucide-react';
import { Button } from './button';
import { MockLink } from './Link';
import { Plate } from './Plate';
import {
  Car,
  cn,
  dealerConfig,
  formatMileage,
  formatPrice,
  getPhoneHref,
  getSafeImageUrl,
  getThumbnailUrl,
  getVehicleBookingHref,
  getVehicleWhatsAppHref,
  recordBookingIntent,
  recordContactIntent,
  trackEvent,
  vehicleDisplayTitle,
  vehicleRegistration,
} from '../_data';

const MAX_PREVIEW_IMAGES = 6;

function SaveCarButton({ car, className }: { car: Car; className?: string }) {
  const [saved, setSaved] = useState(false);
  const label = vehicleDisplayTitle(car);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        setSaved((current) => !current);
      }}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${label} from your saved cars` : `Save ${label} to your saved cars`}
      className={cn(
        'inline-flex items-center justify-center gap-2 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        saved ? 'border-accent bg-accent text-accent-foreground' : 'border-border/60 bg-background/90 hover:border-primary/50',
        className,
      )}
    >
      <Heart className={cn('h-4 w-4', saved && 'fill-current', !saved && 'text-accent')} />
    </button>
  );
}

function CompareCarButton({ car, className, variant = 'default' }: { car: Car; className?: string; variant?: 'default' | 'compact' }) {
  const [comparing, setComparing] = useState(false);
  const label = vehicleDisplayTitle(car);
  const compact = variant === 'compact';
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        setComparing((current) => !current);
      }}
      aria-pressed={comparing}
      aria-label={comparing ? `Remove ${label} from your comparison` : `Add ${label} to your comparison`}
      className={cn(
        'inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        compact ? 'text-[11px] font-bold uppercase tracking-wider' : 'h-11 border px-4 text-[13px] font-bold',
        comparing ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {comparing ? <Check className="h-4 w-4 text-primary" /> : <Scale className="h-4 w-4 text-accent" />}
      {compact && (comparing ? 'Comparing' : 'Compare')}
    </button>
  );
}

export function CarCard({
  car,
  layout = 'card',
  stretchedLink = false,
  badges = [],
  analyticsSource = 'showroom',
}: {
  car: Car;
  layout?: 'row' | 'card' | 'compact';
  stretchedLink?: boolean;
  badges?: string[];
  analyticsSource?: 'showroom' | 'similar_cars' | 'saved_cars';
}) {
  const isRow = layout === 'row';
  const isCompact = layout === 'compact';
  const imageUrls = useMemo(() => {
    const urls: string[] = [];
    const addImage = (image: Car['images'][number] | null | undefined) => {
      const url = getSafeImageUrl(image);
      if (url && !urls.includes(url)) urls.push(url);
    };
    addImage(getThumbnailUrl(car));
    car.images?.forEach(addImage);
    addImage(car.heroImage);
    return urls;
  }, [car]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const visibleImageUrls = imageUrls;
  const galleryUrls = visibleImageUrls.slice(0, MAX_PREVIEW_IMAGES);
  const activeIndex = galleryUrls.length > 0 ? activeImageIndex % galleryUrls.length : 0;
  const photoCount = car.imageCount || car.images?.length || visibleImageUrls.length;
  const vehicleLabel = vehicleDisplayTitle(car);
  const registration = vehicleRegistration(car);
  const detailHref = `/vehicle/${car.id}`;
  const phoneHref = getPhoneHref();
  const whatsappHref = getVehicleWhatsAppHref(car, 'get more information about this vehicle');
  const bookingHref = getVehicleBookingHref(car);
  const recordVehicleOpen = () => trackEvent('vehicle_opened', { source: analyticsSource, layout });

  useEffect(() => {
    setActiveImageIndex(0);
    setIsPreviewing(false);
  }, [car.id, imageUrls.join('|')]);

  useEffect(() => {
    if (!isPreviewing || galleryUrls.length < 2) return;
    const timer = window.setInterval(() => setActiveImageIndex((current) => (current + 1) % galleryUrls.length), 2200);
    return () => window.clearInterval(timer);
  }, [isPreviewing, galleryUrls.length]);

  const specs = [
    car.year ? { label: 'Year', value: String(car.year) } : null,
    car.mileage ? { label: 'Mileage', value: formatMileage(car.mileage) } : car.mileageText ? { label: 'Mileage', value: car.mileageText } : null,
    car.fuel ? { label: 'Fuel', value: car.fuel } : null,
    car.transmission ? { label: 'Trans', value: car.transmission } : null,
    car.engineSize ? { label: 'Engine', value: car.engineSize } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  const visibleSpecs = isCompact ? specs.slice(0, 3) : specs.slice(0, 4);

  const imageBlock = (
    <div
      className="relative isolate overflow-hidden bg-muted group-hover:shadow-[4px_4px_0px_hsl(var(--primary))] transition-shadow duration-300 border-2 border-primary aspect-[4/3] w-full"
      onMouseEnter={() => setIsPreviewing(true)}
      onMouseLeave={() => { setIsPreviewing(false); setActiveImageIndex(0); }}
    >
      {stretchedLink && (
        <MockLink href={detailHref} onClick={recordVehicleOpen} className="absolute inset-0 z-20" aria-label={`View full details for ${vehicleLabel}`}>
          <span className="sr-only">View vehicle</span>
        </MockLink>
      )}
      <SaveCarButton car={car} className="absolute top-3 right-3 z-30 h-10 w-10 bg-background text-primary border-2 border-primary hover:bg-accent hover:text-accent-foreground hover:border-accent transition-colors shadow-[2px_2px_0px_hsl(var(--primary))]" />
      <div className="absolute top-3 left-3 z-30 flex flex-col items-start gap-2">
        {photoCount > 0 && <div className="inline-flex h-8 items-center gap-1.5 bg-background border-2 border-primary px-2 text-[11px] font-bold text-primary shadow-[2px_2px_0px_hsl(var(--primary))]"><Camera className="h-3.5 w-3.5" />{photoCount}</div>}
        {badges.map((badge, index) => <div key={index} className="inline-flex h-8 items-center bg-accent border-2 border-primary px-2 text-[11px] font-bold uppercase tracking-widest text-accent-foreground shadow-[2px_2px_0px_hsl(var(--primary))]">{badge}</div>)}
      </div>
      {galleryUrls.length > 0 ? galleryUrls.map((url, index) => (
        <img key={url} src={url} alt="" loading={index === 0 ? 'eager' : 'lazy'} className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-300', index === activeIndex ? 'opacity-100' : 'opacity-0')} />
      )) : <div className="flex h-full w-full items-center justify-center bg-secondary"><Camera className="h-8 w-8 text-primary/20" /></div>}
      {galleryUrls.length > 1 && isPreviewing && <div className="absolute bottom-3 left-3 right-3 z-30 flex gap-1">{galleryUrls.map((_, index) => <div key={index} className={cn('h-1.5 flex-1 transition-colors border border-primary/50', index === activeIndex ? 'bg-accent' : 'bg-background/80')} />)}</div>}
    </div>
  );

  const wrappedImageBlock = !stretchedLink ? (
    <MockLink href={detailHref} onClick={recordVehicleOpen} className="block relative h-full w-full outline-none focus-visible:ring-4 focus-visible:ring-accent group/imagelink">{imageBlock}</MockLink>
  ) : imageBlock;
  const title = <h3 className="font-display text-xl lg:text-2xl font-black uppercase tracking-tighter text-primary leading-[1.1] mb-1 group-hover:text-accent transition-colors"><MockLink href={detailHref} onClick={recordVehicleOpen} className="outline-none hover:underline">{vehicleLabel}</MockLink></h3>;
  const subtitle = (car.variant || car.trim) && <p className="text-[13px] font-bold text-primary/70 line-clamp-1 uppercase tracking-wider">{car.variant || car.trim}</p>;
  const priceBlock = <div className="flex flex-col items-end"><div className="font-display text-2xl lg:text-3xl font-black tracking-tighter text-primary">{car.price ? formatPrice(car.price, car.currency) : 'POA'}</div>{car.priceType && car.priceType.toLowerCase() !== 'cash' && <div className="text-[10px] font-bold uppercase tracking-widest text-primary/60 mt-0.5">{car.priceType}</div>}</div>;
  const bookingAction = <Button asChild className="relative z-10 w-full rounded-none bg-primary text-[13px] font-bold uppercase tracking-widest text-primary-foreground shadow-[3px_3px_0px_hsl(var(--accent))] transition-all hover:bg-accent hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[1px_1px_0px_hsl(var(--accent))] active:shadow-none whitespace-normal h-auto py-3 text-center"><a href={bookingHref} onClick={(event) => { event.preventDefault(); recordBookingIntent({ source: 'car_card', vehicleContext: true }); }}><Calendar className="mr-2 h-4 w-4 shrink-0" />{dealerConfig.bookViewing.ctaLabel}</a></Button>;
  const callAction = <Button asChild variant="outline" className="relative z-10 flex-1 h-12 px-2 sm:px-6 rounded-none border-2 border-primary bg-background text-[13px] font-bold uppercase tracking-widest text-primary shadow-[3px_3px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground"><a href={phoneHref} onClick={(event) => { event.preventDefault(); recordContactIntent({ channel: 'call', car, source: 'car-card' }); }}><Phone className="mr-2 h-4 w-4 shrink-0" />Call</a></Button>;
  const whatsappAction = <Button asChild variant="outline" className="relative z-10 flex-1 h-12 px-2 sm:px-6 rounded-none border-2 border-[#25D366] bg-background text-[13px] font-bold uppercase tracking-widest text-[#25D366] shadow-[3px_3px_0px_#25D366] transition-all hover:bg-[#25D366] hover:text-white"><a href={whatsappHref} onClick={(event) => { event.preventDefault(); recordContactIntent({ channel: 'whatsapp', car, source: 'car-card' }); }}><MessageCircle className="mr-2 h-4 w-4 shrink-0" />Msg</a></Button>;

  if (isCompact) {
    return <article className="group flex flex-col sm:flex-row gap-4 sm:gap-6 border-b-2 border-primary/10 py-6 first:pt-4" data-testid={`compact-vehicle-${car.id}`}><div className="w-full sm:w-[200px] shrink-0">{wrappedImageBlock}</div><div className="flex flex-col flex-1 min-w-0 py-1"><div className="flex justify-between items-start gap-4"><div className="min-w-0">{title}{subtitle}</div>{priceBlock}</div><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">{visibleSpecs.map((spec) => <span key={spec.label} className="text-[12px] font-bold uppercase tracking-wider text-primary/70 bg-primary/5 px-2 py-1">{spec.value}</span>)}</div><div className="mt-auto pt-4 flex gap-3 grid-cols-1"><a href={bookingHref} onClick={(event) => { event.preventDefault(); recordBookingIntent({ source: 'car_card', vehicleContext: true }); }} className="inline-flex h-11 flex-1 items-center justify-center border-2 border-primary bg-primary text-[12px] font-bold uppercase tracking-widest text-primary-foreground transition-all shadow-[2px_2px_0px_hsl(var(--accent))] hover:bg-accent"><Calendar className="mr-2 h-4 w-4 shrink-0" /><span>Book</span></a><CompareCarButton car={car} variant="compact" className="h-11 w-11 justify-center border-2 border-primary bg-background text-primary shadow-[2px_2px_0px_hsl(var(--primary))]" /></div></div></article>;
  }

  if (isRow) {
    return <article className="group grid border-b-2 border-primary/10 transition-colors md:grid-cols-[minmax(0,40%)_minmax(0,1fr)] py-8 first:pt-4" data-testid={`row-vehicle-${car.id}`}>{wrappedImageBlock}<div className="flex min-w-0 flex-col gap-6 pt-5 md:pt-0 md:pl-10"><div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3"><div className="min-w-0 flex-1">{title}{subtitle}</div>{registration && <Plate size="sm" value={registration} testId={`plate-vehicle-${car.id}`} className="w-[122px] shrink-0" />}</div><div className="flex flex-wrap gap-2 text-[12px] font-bold uppercase tracking-wider text-primary/80">{visibleSpecs.map((spec) => <span key={spec.label} className="bg-primary/5 border border-primary/10 px-2.5 py-1.5">{spec.value}</span>)}</div><div className="mt-auto flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between border-t-2 border-primary/5 pt-6">{priceBlock}<div className="flex flex-wrap items-center gap-3 w-full lg:w-auto"><div className="flex-1 lg:flex-none min-w-[140px]">{bookingAction}</div>{callAction}{whatsappAction}<CompareCarButton car={car} className="h-12 w-12 flex-none border-2 border-primary bg-background text-primary shadow-[3px_3px_0px_hsl(var(--primary))]" /></div></div></div></article>;
  }

  return <article className={cn('group relative flex h-full flex-col transition-all bg-background border-2 border-primary p-4 shadow-[4px_4px_0px_hsl(var(--primary))] hover:shadow-[6px_6px_0px_hsl(var(--primary))] hover:-translate-y-1', stretchedLink && 'cursor-pointer')} data-testid={`card-vehicle-${car.id}`}>{wrappedImageBlock}<div className="flex flex-1 flex-col pt-5 pb-1"><div className="flex justify-between items-start gap-4"><div className="min-w-0">{title}{subtitle}</div></div><div className="mt-4 mb-4">{priceBlock}</div><div className="flex flex-wrap gap-2 mb-6 mt-auto">{visibleSpecs.map((spec) => <span key={spec.label} className="text-[11px] font-bold uppercase tracking-widest text-primary/70 bg-primary/5 px-2 py-1">{spec.value}</span>)}</div>{registration && <div className="mb-6"><Plate size="sm" value={registration} testId={`plate-vehicle-${car.id}`} className="w-[104px]" /></div>}<div className="mt-auto flex flex-col gap-3"><div className="w-full">{bookingAction}</div><div className="flex gap-3">{callAction}{whatsappAction}<CompareCarButton car={car} className="relative z-10 h-12 w-12 flex-none justify-center border-2 border-primary bg-background text-primary shadow-[3px_3px_0px_hsl(var(--primary))]" /></div></div></div></article>;
}