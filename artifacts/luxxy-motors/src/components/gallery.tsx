import { orderVehiclePhotos, photoGroup } from "@/lib/vehicle-photography";
import { useState, useMemo, useRef } from 'react';
import { Camera, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { getSafeImageUrl, cn } from '@/lib/utils';
import { type CarImage } from '@/lib/stock-context';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface GalleryProps {
  images: CarImage[];
  heroImage?: string | null;
}
function imageCaption(image: CarImage | string | undefined) {
  return image && typeof image === 'object' ? image.caption || '' : '';
}

export function Gallery({ images, heroImage }: GalleryProps) {
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const allImages = useMemo(
    () => orderVehiclePhotos(images, heroImage),
    [images, heroImage],
  );
  const index = Math.min(activeIndex, Math.max(0, allImages.length - 1));
  const previous = () => setActiveIndex((index + allImages.length - 1) % allImages.length);
  const next = () => setActiveIndex((index + 1) % allImages.length);
  const touchHandlers = {
    onTouchStart: (e: React.TouchEvent) => setTouchStart(e.touches[0].clientX),
    onTouchEnd: (e: React.TouchEvent) => {
      if (touchStart !== null && Math.abs(touchStart - e.changedTouches[0].clientX) > 50) {
        if (touchStart > e.changedTouches[0].clientX) next();
        else previous();
      }
      setTouchStart(null);
    },
  };
  const renderImage = (
    imageIndex: number,
    className: string,
    eager = false,
  ) => {
    const url = getSafeImageUrl(allImages[imageIndex]);
    return failedImages.has(url) ? (
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
      <img
        key={url}
        src={url}
        decoding="async"
        fetchPriority={eager ? "high" : "auto"}
        alt={imageCaption(allImages[imageIndex]) || `Vehicle photograph ${imageIndex + 1}`}
        className={className}
        loading={eager ? 'eager' : 'lazy'}
        referrerPolicy="no-referrer"
        onError={() => setFailedImages((prev) => new Set(prev).add(url))}
      />
    );
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
    <Dialog>
      <div className="min-w-0">
        <div
          className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted"
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
              className="absolute inset-0 cursor-zoom-in focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="absolute bottom-3 right-3 flex items-center gap-2 rounded-sm bg-black/70 px-3 py-2 text-xs text-white">
                <Maximize2 className="h-4 w-4" />
                View gallery
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
        {new Set(allImages.map(photoGroup)).size > 1 && (
          <div
            className="mt-3 flex flex-wrap gap-1 border-b border-border"
            aria-label="Photograph sections"
          >
            {(["Exterior", "Interior", "Details", "Other"] as const)
              .filter((group) =>
                allImages.some((image) => photoGroup(image) === group),
              )
              .map((group) => (
                <button
                  type="button"
                  key={group}
                  aria-pressed={photoGroup(allImages[index]) === group}
                  onClick={() => {
                    const target = allImages.findIndex(
                      (image) => photoGroup(image) === group,
                    );
                    setActiveIndex(target);
                    thumbnailRefs.current[target]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                  }}
                  className={cn(
                    "min-h-11 border-b-2 px-3 text-xs",
                    photoGroup(allImages[index]) === group
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground",
                  )}
                >
                  {group}
                </button>
              ))}
          </div>
        )}
        {allImages.length > 1 && (
          <div
            className="mt-3 flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-2"
            aria-label="Choose photograph"
          >
            {allImages.map((image, i) => (
              <button
                key={`${getSafeImageUrl(image)}-${i}`}
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
                  thumbnailRefs.current[target]?.focus({ preventScroll: true });
                  thumbnailRefs.current[target]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }}
                onClick={() => setActiveIndex(i)}
                className={cn(
                  'h-16 w-24 shrink-0 overflow-hidden rounded-sm border-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  i === index ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100',
                )}
              >
                {renderImage(i, 'h-full w-full object-cover')}
              </button>
            ))}
          </div>
        )}
      </div>
      <DialogContent
        className="max-w-[min(1200px,calc(100vw-2rem))] border-0 bg-background p-4 pt-16 sm:p-6 sm:pt-16"
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
        <div className="flex min-w-0 items-center justify-center" {...touchHandlers}>
          {renderImage(index, 'max-h-[65dvh] w-full object-contain', true)}
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
      </DialogContent>
    </Dialog>
  );
}
