import { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getSafeImageUrl } from '@/lib/utils';
import { type CarImage } from '@/lib/stock-context';
import { cn } from '@/lib/utils';

interface GalleryProps {
  images: CarImage[];
  heroImage?: string | null;
}

function imageCaption(image: CarImage | string | undefined) {
  return image && typeof image === 'object' ? image.caption || '' : '';
}

export function Gallery({ images, heroImage }: GalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());

  // Consolidate images: put hero first if it's not already in the array
  const allImages = [...images];
  if (heroImage && !allImages.find(img => getSafeImageUrl(img) === heroImage)) {
    allImages.unshift(heroImage);
  }

  const handleNext = useCallback(() => {
    setActiveIndex((prev) => (prev === allImages.length - 1 ? 0 : prev + 1));
  }, [allImages.length]);

  const handlePrev = useCallback(() => {
    setActiveIndex((prev) => (prev === 0 ? allImages.length - 1 : prev - 1));
  }, [allImages.length]);

  const [touchStart, setTouchStart] = useState<number | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;

    if (Math.abs(diff) > 50) {
      if (diff > 0) handleNext();
      else handlePrev();
    }
    setTouchStart(null);
  };

  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'Escape') {
        setIsFullscreen(false);
        openerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Focus close button on mount
    closeButtonRef.current?.focus();

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, isFullscreen]);

  if (allImages.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full max-w-[900px] flex-col items-center justify-center gap-4 rounded-2xl border border-primary/10 bg-primary/5 text-primary sm:aspect-[16/10] lg:aspect-[16/9]">
        <Camera className="h-10 w-10 opacity-40" />
        <span className="font-display text-[13px] font-black uppercase tracking-[0.2em]">No images available</span>
      </div>
    );
  }

  const currentImg = allImages[activeIndex];
  const url = getSafeImageUrl(currentImg);
  const caption = imageCaption(currentImg);

  const arrowButton =
    'absolute top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-primary/90 text-primary-foreground opacity-0 shadow-none backdrop-blur transition-all hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-0 group-hover:opacity-100';

  const renderImage = (imgUrl: string, idx: number, className: string = '') => (
    failedImages.has(idx) ? (
      <div className={cn('flex h-full w-full flex-col items-center justify-center gap-3 bg-primary/5 border-4 border-primary text-primary shadow-[8px_8px_0px_hsl(var(--primary))]', className)}>
        <Camera className="h-8 w-8 opacity-20" />
        <span className="font-display text-[11px] font-black uppercase tracking-[0.2em] opacity-50">Image missing</span>
      </div>
    ) : (
      <img
        src={imgUrl}
        alt={imageCaption(allImages[idx]) || `Vehicle image ${idx + 1}`}
        className={className}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedImages(prev => new Set(prev).add(idx))}
      />
    )
  );

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-4 overflow-hidden max-w-[900px]">
      {/* Main Image */}
      <div
        className="group relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-primary/5 shadow-[0_18px_42px_hsl(var(--primary)/.13)] sm:aspect-[16/10] lg:aspect-[16/9]"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {renderImage(url, activeIndex, 'absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105')}

        <div className="absolute inset-0 bg-primary/0 transition-colors group-hover:bg-primary/5 pointer-events-none" />

        <button
          type="button"
          ref={openerRef}
          aria-label="View gallery fullscreen"
          className="absolute inset-0 z-0 w-full h-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent inset-ring"
          onClick={() => setIsFullscreen(true)}
        />

        {allImages.length > 1 && (
          <>
            <button
              type="button"
              className={cn(arrowButton, 'left-4')}
              onClick={(e) => { e.stopPropagation(); handlePrev(); }}
              aria-label="Previous photograph"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              className={cn(arrowButton, 'right-4')}
              onClick={(e) => { e.stopPropagation(); handleNext(); }}
              aria-label="Next photograph"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
            <span className="pointer-events-none absolute right-4 top-4 inline-flex items-center gap-2 rounded-full bg-primary/85 px-3 py-1.5 font-display text-[11px] font-semibold text-primary-foreground shadow-none backdrop-blur">
              <Camera className="h-4 w-4" />
              {activeIndex + 1} / {allImages.length}
            </span>
          </>
        )}
        {caption && (
          <span className="pointer-events-none absolute bottom-4 left-4 max-w-[80%] truncate rounded-full bg-primary/85 px-4 py-2 font-display text-[11px] font-semibold text-primary-foreground shadow-none backdrop-blur">
            {caption}
          </span>
        )}
      </div>

      {/* Thumbnails */}
      {allImages.length > 1 && (
        <div className="flex min-w-0 max-w-full snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2 scroll-smooth no-scrollbar pt-2">
          {allImages.map((img, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveIndex(idx)}
              aria-label={`Show photograph ${idx + 1} of ${allImages.length}`}
              aria-current={activeIndex === idx}
              className={cn(
                'relative h-[4.5rem] w-[6.5rem] shrink-0 snap-start overflow-hidden rounded-xl border transition-all focus-visible:outline-none focus-visible:ring-0 sm:h-[5.5rem] sm:w-[8rem]',
                activeIndex === idx
                  ? 'border-accent shadow-[0_0_0_2px_hsl(var(--accent)/.22)] -translate-y-1'
                  : 'border-primary/20 opacity-60 hover:opacity-100 hover:shadow-[0_6px_18px_hsl(var(--primary)/.12)] hover:-translate-y-0.5',
              )}
            >
              {renderImage(getSafeImageUrl(img), idx, 'h-full w-full object-cover')}
            </button>
          ))}
        </div>
      )}

      {/* Fullscreen Lightbox */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-primary/95 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-label="Vehicle image gallery"
        >
          <button
            type="button"
            ref={closeButtonRef}
            onClick={() => {
              setIsFullscreen(false);
              openerRef.current?.focus();
            }}
            aria-label="Close photograph viewer"
            className="absolute right-6 top-6 z-50 grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent"
          >
            <X className="h-8 w-8" />
          </button>

          <div className="flex w-full max-w-7xl items-center justify-between px-4">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handlePrev(); }}
              aria-label="Previous photograph"
              className="hidden p-4 text-primary-foreground/50 transition-colors hover:text-accent sm:block"
            >
              <ChevronLeft className="h-14 w-14" />
            </button>

            <div
              className="relative flex max-h-[90vh] w-full flex-col items-center justify-center"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {renderImage(url, activeIndex, 'max-h-[82vh] max-w-full select-none rounded-xl object-contain')}
              <div className="mt-8 flex items-center gap-6 rounded-full bg-primary-foreground px-6 py-3 font-display text-[12px] font-semibold text-primary shadow-none">
                <span>{activeIndex + 1} / {allImages.length}</span>
                {caption && <span className="text-primary/70">{caption}</span>}
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleNext(); }}
              aria-label="Next photograph"
              className="hidden p-4 text-primary-foreground/50 transition-colors hover:text-accent sm:block"
            >
              <ChevronRight className="h-14 w-14" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}