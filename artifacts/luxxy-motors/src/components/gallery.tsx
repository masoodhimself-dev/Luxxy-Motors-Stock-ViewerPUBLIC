import { VehicleCall } from '@/components/vehicle-call';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { responsiveVehicleImage, retryOriginalImage } from "@/lib/responsive-vehicle-image";
import { orderVehiclePhotos, photoGroup } from "@/lib/vehicle-photography";
import { useState, useMemo, useRef, useEffect } from 'react';
import { Camera, ChevronLeft, ChevronRight, Maximize2, Mail } from 'lucide-react';
import { getSafeImageUrl, cn } from '@/lib/utils';
import { type Car, type CarImage } from '@/lib/stock-context';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface GalleryProps {
  car?: Car;
  images: CarImage[];
  heroImage?: string | null;
  vehicleLabel?: string;
}
function imageCaption(image: CarImage | string | undefined) {
  return image && typeof image === 'object' ? image.caption || '' : '';
}

export function Gallery({ car, images, heroImage, vehicleLabel = 'Vehicle' }: GalleryProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const messageRequested = useRef(false);
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const allImages = useMemo(
    () => orderVehiclePhotos(images, heroImage).filter(image => !failedImages.has(getSafeImageUrl(image))),
    [images, heroImage, failedImages],
  );
  const index = Math.min(activeIndex, Math.max(0, allImages.length - 1));
  const [loadedUrl, setLoadedUrl] = useState('');
  const activeUrl = getSafeImageUrl(allImages[index]);
  useEffect(() => {
    // Only warm neighbours after the main photograph has finished loading.
    if (!activeUrl || loadedUrl !== activeUrl || allImages.length < 2) return;
    const neighbours = [...new Set([(index + 1) % allImages.length, (index + allImages.length - 1) % allImages.length])];
    const requests = neighbours.map(i => {
      const image = new Image();
      image.decoding = 'async';
      image.fetchPriority = 'low';
      image.referrerPolicy = 'no-referrer';
      image.src = getSafeImageUrl(allImages[i]);
      return image;
    });
    return () => { requests.forEach(image => { image.onload = null; image.onerror = null; }); };
  }, [activeUrl, loadedUrl, allImages, index]);
  useEffect(() => {
    const button = thumbnailRefs.current[index];
    const row = button?.parentElement;
    if (!button || !row) return;
    // Move the strip without unexpectedly scrolling the customer down the page.
    const left = button.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (left + button.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + button.offsetWidth - row.clientWidth;
  }, [index]);
  const previous = () => setActiveIndex((index + allImages.length - 1) % allImages.length);
  const next = () => setActiveIndex((index + 1) % allImages.length);
  const touchHandlers = {
    onTouchStart: (event: React.TouchEvent) => {
      if (event.touches.length !== 1) { touchStart.current = null; return; }
      touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      swiped.current = false;
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const start = touchStart.current;
      if (start) {
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2 && allImages.length > 1) {
          swiped.current = true;
          if (dx < 0) next(); else previous();
        }
      }
      touchStart.current = null;
    },
    onTouchCancel: () => { touchStart.current = null; swiped.current = false; },
  };
  const groups = (["Exterior", "Interior", "Details", "Other"] as const)
    .filter(group => allImages.some(image => photoGroup(image) === group));
  const groupNavigation = (fullscreen = false) => groups.length > 1 && (
    <div className="mt-3 flex flex-wrap gap-1 border-b border-border" aria-label="Photograph sections">
      {groups.map(group => <button type="button" key={group} aria-label={group === "Other" ? "More photos" : group} aria-pressed={photoGroup(allImages[index]) === group}
        onClick={() => {
          const target = allImages.findIndex(image => photoGroup(image) === group);
          setActiveIndex(target);
          if (!fullscreen) thumbnailRefs.current[target]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }}
        className={cn('min-h-11 border-b-2 px-3 text-xs', photoGroup(allImages[index]) === group ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')}>
        {group === "Other" ? "More photos" : group} ({allImages.filter(image => photoGroup(image) === group).length})
      </button>)}
    </div>
  );
  const renderImage = (
    imageIndex: number,
    className: string,
    eager = false,
  ) => {
    const url = getSafeImageUrl(allImages[imageIndex]);
    const ImageElement = eager ? motion.img : 'img';
    const content = failedImages.has(url) ? (
      <div
        className={cn(
          'flex items-center justify-center gap-3 bg-muted text-muted-foreground',
          className,
        )}
      >
        <Camera className="h-7 w-7" />
        <span className="text-xs">Photograph unavailable</span>
      </div>
    ) : (
      <ImageElement
        {...(eager ? { initial: { opacity: reduceMotion ? 1 : 0, scale: reduceMotion ? 1 : 1.025 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 1 }, transition: { duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } } : {})}
        key={url}
        src={url}
        {...responsiveVehicleImage(url, eager ? "(max-width: 1023px) 100vw, 900px" : "120px")}
        decoding="async"
        fetchPriority={eager ? "high" : "low"}
        alt={imageCaption(allImages[imageIndex]) || `${vehicleLabel} — photograph ${imageIndex + 1}`}
        className={className}
        loading={eager ? 'eager' : 'lazy'}
        referrerPolicy="no-referrer"
        onLoad={eager ? () => setLoadedUrl(url) : undefined}
        onError={(event) => {if (!retryOriginalImage(event.currentTarget)) {
          const removedIndex = allImages.findIndex(image => getSafeImageUrl(image) === url);
          setActiveIndex(current => removedIndex < current ? Math.max(0, current - 1) : current);
          setFailedImages((prev) => new Set(prev).add(url));
        }}}
      />
    );
    return eager ? <AnimatePresence initial={false} mode="popLayout">{content}</AnimatePresence> : content;
  };
  const arrowClass =
    'grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/30 bg-white text-black shadow-sm hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  if (!allImages.length)
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-muted text-muted-foreground">
        <Camera className="h-8 w-8" />
        <p className="text-sm">Photographs to follow</p>
      </div>
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="min-w-0">
        <div className="vehicle-gallery-frame">
        <div
          className="relative aspect-[4/3] overflow-hidden rounded-sm bg-muted touch-pan-y"
          {...touchHandlers}
        >
          {renderImage(
            index,
            "gallery-photo absolute inset-0 h-full w-full object-contain",
            true,
          )}
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="View gallery fullscreen"
              onClick={(event) => { if (swiped.current) { event.preventDefault(); swiped.current = false; } }}
              className="absolute inset-0 cursor-zoom-in focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="absolute bottom-3 right-3 flex items-center gap-2 rounded-sm bg-black/70 px-3 py-2 text-xs text-white">
                <Maximize2 className="h-4 w-4" />
                View all {allImages.length} photos
              </span>
            </button>
          </DialogTrigger>
          {allImages.length > 1 && (
            <>
              <button
                type="button"
                onClick={previous}
                aria-label="Previous photograph"
                className={cn(arrowClass, 'absolute left-3 top-1/2 -translate-y-1/2')}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="Next photograph"
                className={cn(arrowClass, 'absolute right-3 top-1/2 -translate-y-1/2')}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
        </div>
        <div
          className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>{imageCaption(allImages[index]) || 'Vehicle gallery'}</span>
          <span>
            {index + 1} / {allImages.length} photographs
          </span>
        </div>
        {groupNavigation()}
        {allImages.length > 1 && (
          <div
            className="vehicle-thumbnail-grid mt-3 flex gap-2"
            aria-label="Choose photograph"
          >
            {allImages.map((image, i) => {
              return (
              <button
                key={getSafeImageUrl(image)}
                type="button"
                aria-label={`Show photograph ${i + 1} of ${allImages.length}`}
                aria-current={i === index}
                ref={(element) => { thumbnailRefs.current[i] = element; }}
                tabIndex={i === index ? 0 : -1}
                onKeyDown={(event) => {
                  const target = event.key === 'ArrowRight' ? (i + 1) % allImages.length
                    : event.key === 'ArrowLeft' ? (i + allImages.length - 1) % allImages.length
                    : event.key === 'Home' ? 0 : event.key === 'End' ? allImages.length - 1 : null;
                  if (target === null) return;
                  event.preventDefault();
                  setActiveIndex(target);
                  requestAnimationFrame(() => {
                    thumbnailRefs.current[target]?.focus({ preventScroll: true });
                    thumbnailRefs.current[target]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                  });
                }}
                onClick={() => setActiveIndex(i)}
                className={cn(
                  'aspect-[4/3] bg-muted overflow-hidden rounded-sm border-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  i === index ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100',
                )}
              >
                {renderImage(i, 'h-full w-full object-contain')}
              </button>
            ); })}
          </div>
        )}
      </div>
      <DialogContent
        className="vehicle-lightbox"
        onCloseAutoFocus={event => {
          if (!messageRequested.current) return;
          event.preventDefault();
          messageRequested.current = false;
          requestAnimationFrame(() => {
            const heading = document.getElementById('vehicle-enquiry-heading');
            heading?.focus({ preventScroll: true });
            document.getElementById('vehicle-enquiry')?.scrollIntoView({ block: 'start', behavior: 'instant' });
          });
        }}
        aria-describedby={undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            next();
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            previous();
          }
        }}
      >
        <DialogTitle className="sr-only">Vehicle image gallery</DialogTitle>
        {groupNavigation(true)}
        <div className="vehicle-lightbox-photo flex min-w-0 items-center justify-center touch-pan-y" {...touchHandlers}>
          {renderImage(index, 'h-full max-h-full w-full object-contain', true)}
        </div>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={previous}
            aria-label="Previous photograph"
            className={arrowClass}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="text-center text-sm" aria-live="polite">
            {index + 1} / {allImages.length}
            <span className="ml-3 text-muted-foreground">
              {imageCaption(allImages[index])}
            </span>
          </p>
          <button type="button" onClick={next} aria-label="Next photograph" className={arrowClass}>
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        {car && <div className="vehicle-lightbox-contact" aria-label="Contact about this vehicle">
          <VehicleCall car={car} buttonLabel="Show phone number" className="vehicle-lightbox-contact-button" />
          <button type="button" className="vehicle-lightbox-contact-button" onClick={() => { messageRequested.current = true; setOpen(false); }}>
            <Mail className="h-5 w-5" /> Message
          </button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
