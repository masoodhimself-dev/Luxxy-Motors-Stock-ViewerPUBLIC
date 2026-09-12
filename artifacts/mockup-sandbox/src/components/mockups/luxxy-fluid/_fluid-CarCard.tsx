import { useEffect, useMemo, useState } from 'react';
import { Camera, Heart, Scale, ChevronRight } from 'lucide-react';
import { FluidButton } from './_fluid-Button';
import { MockLink } from './_shared/Link';
import {
  Car,
  cn,
  formatMileage,
  formatPrice,
  getSafeImageUrl,
  getThumbnailUrl,
  vehicleDisplayTitle,
} from './_data';

export function FluidCarCard({
  car,
  layout = 'card',
}: {
  car: Car;
  layout?: 'row' | 'card' | 'compact';
}) {
  const isCompact = layout === 'compact';
  const isRow = layout === 'row';
  
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
  const galleryUrls = imageUrls.slice(0, 6);
  const activeIndex = galleryUrls.length > 0 ? activeImageIndex % galleryUrls.length : 0;
  
  useEffect(() => {
    if (!isPreviewing || galleryUrls.length < 2) return;
    const timer = window.setInterval(() => setActiveImageIndex((current) => (current + 1) % galleryUrls.length), 2000);
    return () => window.clearInterval(timer);
  }, [isPreviewing, galleryUrls.length]);

  const vehicleLabel = vehicleDisplayTitle(car);
  const detailHref = `/vehicle/${car.id}`;
  
  const specs = [
    car.year ? String(car.year) : null,
    car.mileage ? formatMileage(car.mileage) : car.mileageText,
    car.fuel,
    car.transmission,
  ].filter(Boolean) as string[];

  const [saved, setSaved] = useState(false);
  const [comparing, setComparing] = useState(false);

  const imageBlock = (
    <div 
      className="relative w-full aspect-[4/3] sm:aspect-[16/10] overflow-hidden bg-secondary rounded-t-2xl sm:rounded-2xl transition-all duration-300 isolate"
      onMouseEnter={() => setIsPreviewing(true)}
      onMouseLeave={() => { setIsPreviewing(false); setActiveImageIndex(0); }}
    >
      <MockLink href={detailHref} className="absolute inset-0 z-20 outline-none focus-ring">
        <span className="sr-only">View {vehicleLabel}</span>
      </MockLink>
      
      <button 
        onClick={(e) => { e.preventDefault(); setSaved(!saved); }}
        className={cn("absolute top-3 right-3 z-30 p-2.5 rounded-full backdrop-blur-md transition-all shadow-sm focus-ring", saved ? "bg-accent text-accent-foreground hover:bg-accent/90" : "bg-background/80 text-foreground hover:bg-background hover:text-accent hover:scale-105")} 
        aria-label="Save car"
      >
        <Heart className={cn("w-4 h-4", saved && "fill-current")} />
      </button>

      {galleryUrls.length > 0 ? galleryUrls.map((url, index) => (
        <img 
          key={url} 
          src={url} 
          alt="" 
          loading={index === 0 ? 'eager' : 'lazy'} 
          className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-500', index === activeIndex ? 'opacity-100' : 'opacity-0')} 
        />
      )) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Camera className="w-8 h-8 opacity-20" /></div>
      )}
      
      {galleryUrls.length > 1 && isPreviewing && (
        <div className="absolute bottom-3 left-3 right-3 z-30 flex gap-1.5">
          {galleryUrls.map((_, index) => (
            <div key={index} className={cn('h-1 flex-1 rounded-full transition-all duration-300', index === activeIndex ? 'bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)]' : 'bg-white/40')} />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <article className="group flex flex-col bg-background rounded-2xl soft-shadow soft-shadow-hover border border-border/50 h-full transition-all">
      <div className="p-1 sm:p-2">
        {imageBlock}
      </div>
      <div className="flex flex-col flex-1 p-5 pt-3">
        <div className="flex justify-between items-start gap-4 mb-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-lg leading-tight truncate text-foreground group-hover:text-accent transition-colors">
              <MockLink href={detailHref} className="outline-none focus-ring rounded-sm">{vehicleLabel}</MockLink>
            </h3>
            {(car.variant || car.trim) && (
              <p className="text-sm text-muted-foreground truncate mt-1">{car.variant || car.trim}</p>
            )}
          </div>
        </div>
        
        <div className="mt-1 mb-4 text-xl font-bold tracking-tight text-foreground">
          {car.price ? formatPrice(car.price, car.currency) : 'POA'}
        </div>
        
        <div className="flex flex-wrap gap-x-3 gap-y-2 text-[13px] text-muted-foreground mb-6 mt-auto">
          {specs.map((spec, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span className="w-1 h-1 rounded-full bg-border" />}
              {spec}
            </span>
          ))}
        </div>
        
        <div className="mt-auto border-t border-border/50 pt-4 flex items-center justify-between">
          <button 
            onClick={(e) => { e.preventDefault(); setComparing(!comparing); }}
            className={cn("text-[13px] font-medium flex items-center gap-1.5 transition-colors focus-ring rounded p-1 -ml-1", comparing ? "text-accent" : "text-foreground hover:text-accent")}
          >
            <Scale className="w-4 h-4 text-muted-foreground" /> {comparing ? 'Comparing' : 'Compare'}
          </button>
          <MockLink href={detailHref} className="text-sm font-semibold text-accent hover:text-accent/80 flex items-center gap-1 focus-ring rounded p-1 -mr-1 transition-colors">
            View Details <ChevronRight className="w-4 h-4" />
          </MockLink>
        </div>
      </div>
    </article>
  );
}
